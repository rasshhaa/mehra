"""
AUTOVAULT — Garage Accident Service Report
==========================================

Generates a post-repair PDF report that the garage hands back to the owner
once an accident-related repair is complete. This is intentionally a
*different* document from the pre-repair AI inspection report:

    • pre-repair AI damage findings (recap, not a re-run of the inspection)
    • incident & insurance authorization summary
    • services / parts / labour completed at the garage
    • a Roadworthy Readiness Score (post-repair) computed from how many
      pre-repair defects were actually addressed by the services performed
    • technician sign-off + warranty / disclaimer

The function exposed here is `generate_accident_service_report(...)` which is
called by `main.py`. The implementation only depends on `reportlab`, which is
already in `requirements.txt`.
"""

from __future__ import annotations

from datetime import datetime
import re

from reportlab.lib.pagesizes import A4
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    KeepTogether,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors


# ─────────────────────────────────────────────────────────────────────────────
# Theme — visually distinct from the blue inspection report so the owner can
# tell the two documents apart at a glance.
# ─────────────────────────────────────────────────────────────────────────────
ACCENT_PRIMARY   = colors.HexColor("#b91c1c")   # accident red
ACCENT_SECONDARY = colors.HexColor("#0f172a")   # deep slate
ACCENT_OK        = colors.HexColor("#15803d")   # repair-complete green
ACCENT_WARN      = colors.HexColor("#b45309")   # rework amber
ACCENT_TEXT      = colors.HexColor("#1f2937")
ACCENT_MUTED     = colors.HexColor("#6b7280")
ACCENT_SOFT      = colors.HexColor("#fef2f2")
ACCENT_PANEL     = colors.HexColor("#f8fafc")
ACCENT_BORDER    = colors.HexColor("#e5e7eb")


# Safety-critical part keywords that should really be addressed before the
# vehicle is considered roadworthy after an accident.
SAFETY_PART_KEYWORDS = {
    "windshield", "windscreen", "glass", "light", "lamp", "headlight",
    "tail light", "brake", "tyre", "tire", "wheel", "airbag", "bonnet",
    "hood", "structural", "frame", "chassis", "suspension",
}


# ─────────────────────────────────────────────────────────────────────────────
# Small helpers
# ─────────────────────────────────────────────────────────────────────────────
def _hex(color) -> str:
    """Return a "#rrggbb" string usable inside ReportLab <font color="..."> tags.

    ``Color.hexval()`` returns "0xrrggbb" — that prefix is fine for direct
    parameters but the inline-tag parser only accepts CSS-style "#rrggbb"
    or named colours.
    """
    try:
        raw = color.hexval()
    except AttributeError:
        return str(color)
    if raw.startswith("0x"):
        return "#" + raw[2:]
    if raw.startswith("#"):
        return raw
    return "#" + raw


def _safe(value, fallback="—"):
    if value is None:
        return fallback
    s = str(value).strip()
    return s if s else fallback


def _format_currency(amount, currency="AED"):
    try:
        f = float(amount)
    except (TypeError, ValueError):
        return f"{currency} —"
    if f == 0:
        return f"{currency} 0.00"
    return f"{currency} {f:,.2f}"


def _normalise_defect(d) -> dict:
    """
    Normalise a pre-repair defect record into a uniform shape regardless of
    whether it came from the dashboard, the inspection store, or the claim.
    """
    if d is None:
        return {"label": "Unknown", "part": "Unknown", "severity": "moderate", "confidence": 0.0}

    if isinstance(d, (list, tuple)):
        label = str(d[0]) if len(d) > 0 else "Unknown"
        conf = float(d[1]) if len(d) > 1 else 0.0
        return {"label": label, "part": label, "severity": _severity_from_conf(conf), "confidence": conf}

    if isinstance(d, dict):
        label = (
            d.get("label") or d.get("class") or d.get("name") or
            d.get("defect_type") or d.get("zone") or "Unknown"
        )
        part = d.get("part") or d.get("affected_part") or d.get("zone") or label
        severity = (
            d.get("severity_tier") or d.get("severity") or d.get("tier") or "moderate"
        )
        conf_raw = d.get("confidence", d.get("confidence_score", 0))
        try:
            conf_f = float(conf_raw)
        except (TypeError, ValueError):
            conf_f = 0.0
        if 0 < conf_f <= 1:
            conf_f = conf_f * 100
        return {
            "label": str(label),
            "part": str(part),
            "severity": str(severity).lower(),
            "confidence": conf_f,
        }

    return {"label": str(d), "part": str(d), "severity": "moderate", "confidence": 0.0}


def _severity_from_conf(conf: float) -> str:
    if conf >= 80:
        return "severe"
    if conf >= 55:
        return "moderate"
    return "minor"


def _is_safety_defect(defect: dict) -> bool:
    blob = (defect.get("label", "") + " " + defect.get("part", "")).lower()
    if any(kw in blob for kw in SAFETY_PART_KEYWORDS):
        return True
    sev = defect.get("severity", "").lower()
    if sev in {"severe", "critical"}:
        return True
    return False


def _service_blob(svc: dict) -> str:
    if not isinstance(svc, dict):
        return str(svc).lower()
    return " ".join(str(svc.get(k, "")) for k in ("task", "parts", "notes")).lower()


def _service_addresses_defect(svc_blob: str, defect: dict) -> bool:
    """
    Heuristic: a service "addresses" a defect when the service text mentions
    any token from the defect's label/part. This is intentionally lenient
    (e.g. "Replace windshield" matches a "Windshield — Glass Crack" defect).
    """
    label = (defect.get("label", "") + " " + defect.get("part", "")).lower()
    tokens = [t for t in re.split(r"[^a-z]+", label) if len(t) >= 4]
    if not tokens:
        return False
    return any(tok in svc_blob for tok in tokens)


def _compute_readiness(defects, services_completed, technician_notes):
    """
    Roadworthy Readiness Score (0-100) for the *post-repair* state.

    Different from the pre-repair AI Vehicle Health Score:

        - starts at 100
        - any pre-repair defect that is NOT addressed by the services list
          deducts points (10 for safety-critical, 5 otherwise)
        - if technician notes confirm verification (test-driven, inspected, ok)
          we add a 5 point confidence bump
        - clamped to [40, 100]
    """
    notes_l = (technician_notes or "").lower()
    service_blobs = [_service_blob(s) for s in (services_completed or [])]

    rows = []
    deduction = 0
    for d in defects:
        addressed = any(_service_addresses_defect(b, d) for b in service_blobs)
        is_safety = _is_safety_defect(d)
        if not addressed:
            deduction += 10 if is_safety else 5
        rows.append({
            "label": d.get("label", "Unknown"),
            "severity": d.get("severity", "moderate"),
            "confidence": d.get("confidence", 0.0),
            "addressed": addressed,
            "safety": is_safety,
        })

    confidence_bump = 0
    if any(kw in notes_l for kw in ("test driven", "test-driven", "tested", "inspected", "verified", "road test")):
        confidence_bump += 5

    score = 100 - deduction + confidence_bump
    score = max(40, min(100, score))

    if score >= 90:
        status, status_color = "ROADWORTHY", ACCENT_OK
    elif score >= 70:
        status, status_color = "READY WITH NOTES", ACCENT_WARN
    else:
        status, status_color = "REWORK RECOMMENDED", ACCENT_PRIMARY

    return score, status, status_color, rows


# ─────────────────────────────────────────────────────────────────────────────
# Visual helpers
# ─────────────────────────────────────────────────────────────────────────────
def _para(text, style):
    return Paragraph(text, style)


def _h1(text, styles):
    return Paragraph(
        f"<font color='#ffffff'><b>{text}</b></font>",
        ParagraphStyle("H1", parent=styles["Title"], fontSize=20, alignment=0, leading=24, textColor=colors.white)
    )


def _h2(text, styles):
    return Paragraph(
        f"<b>{text}</b>",
        ParagraphStyle("H2", parent=styles["Heading2"], fontSize=13, textColor=ACCENT_SECONDARY,
                       spaceBefore=14, spaceAfter=6, leading=16)
    )


def _label(text, styles):
    return Paragraph(
        text,
        ParagraphStyle("Label", parent=styles["Normal"], fontSize=8, textColor=ACCENT_MUTED,
                       leading=10, spaceAfter=2, alignment=0)
    )


def _value(text, styles, bold=True):
    return Paragraph(
        f"<b>{text}</b>" if bold else text,
        ParagraphStyle("Value", parent=styles["Normal"], fontSize=10, textColor=ACCENT_TEXT, leading=13)
    )


def _kv_pair(label_text, value_text, styles):
    """A 2-cell row used inside _section_customer_vehicle.

    Returns ``[label_paragraph, value_paragraph]`` so the table can fix
    explicit column widths (label / value) and the value paragraph
    word-wraps within its column instead of pushing the table wider.
    """
    return [_label(label_text.upper(), styles), _value(value_text, styles)]


def _readiness_bar(score: int, status: str, status_color, styles):
    filled = max(0, min(10, round(score / 10)))
    empty = 10 - filled

    sc_hex = _hex(status_color)
    bar_para = Paragraph(
        f"<font color='{sc_hex}'>{'█' * filled}</font>"
        f"<font color='#e5e7eb'>{'█' * empty}</font>",
        ParagraphStyle("ReadyBar", parent=styles["Normal"], fontSize=18, alignment=1, leading=20)
    )
    score_para = Paragraph(
        f"<font color='{sc_hex}'><b>{score}/100</b></font>",
        ParagraphStyle("ReadyScore", parent=styles["Normal"], fontSize=26, alignment=1, leading=28)
    )
    status_para = Paragraph(
        f"<font color='{sc_hex}'><b>{status}</b></font>",
        ParagraphStyle("ReadyStatus", parent=styles["Normal"], fontSize=11, alignment=1)
    )
    sub_para = Paragraph(
        "Post-Repair Roadworthy Readiness Score",
        ParagraphStyle("ReadySub", parent=styles["Normal"], fontSize=8.5, textColor=ACCENT_MUTED, alignment=1)
    )

    t = Table(
        [[score_para], [bar_para], [status_para], [sub_para]],
        colWidths=[17 * cm],
    )
    t.setStyle(TableStyle([
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND",    (0, 0), (-1, -1), ACCENT_PANEL),
        ("BOX",           (0, 0), (-1, -1), 0.8, ACCENT_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


# ─────────────────────────────────────────────────────────────────────────────
# Sections
# ─────────────────────────────────────────────────────────────────────────────
def _section_header(styles, garage_name: str, completion_date: str):
    """Top banner — distinct from the inspection report so the owner can
    immediately tell this is the garage's accident-repair completion document."""

    title = _h1("ACCIDENT REPAIR · SERVICE COMPLETION REPORT", styles)
    subtitle = Paragraph(
        f"<font color='#fde2e2'>{_safe(garage_name)} · Completed {_safe(completion_date)}</font>",
        ParagraphStyle("HSub", parent=styles["Normal"], fontSize=10,
                       textColor=colors.HexColor("#fde2e2"), leading=12)
    )
    brand = Paragraph(
        "<font color='#ffffff'><b>AUTOVAULT</b></font>"
        "<font color='#fecaca'>  ·  Vehicle Lifecycle Platform</font>",
        ParagraphStyle("Brand", parent=styles["Normal"], fontSize=9,
                       textColor=colors.HexColor("#fecaca"), spaceAfter=4)
    )

    inner = Table([[brand], [title], [subtitle]], colWidths=[17 * cm])
    inner.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), ACCENT_PRIMARY),
        ("ALIGN",         (0, 0), (-1, -1), "LEFT"),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING",   (0, 0), (-1, -1), 18),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 18),
    ]))
    return inner


def _section_reference_card(styles, *, claim_id, garage_name, garage_address,
                            completion_date, technician_name, appointment_id):
    rows = [
        [
            _label("TICKET / CLAIM REF", styles),
            _label("GARAGE", styles),
            _label("COMPLETED", styles),
        ],
        [
            _value(_safe(claim_id), styles),
            _value(_safe(garage_name), styles),
            _value(_safe(completion_date), styles),
        ],
        [
            _label("APPOINTMENT", styles),
            _label("TECHNICIAN", styles),
            _label("ADDRESS", styles),
        ],
        [
            _value(_safe(appointment_id), styles),
            _value(_safe(technician_name), styles),
            _value(_safe(garage_address), styles),
        ],
    ]
    t = Table(rows, colWidths=[5.5 * cm, 5.5 * cm, 6 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), ACCENT_PANEL),
        ("BOX",           (0, 0), (-1, -1), 0.8, ACCENT_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.4, ACCENT_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
    ]))
    return t


def _section_customer_vehicle(styles, *, owner_name, owner_email, vehicle_info):
    """Single-column-stacked 2-col table that's guaranteed to fit on A4.

    Using one wide table with hard column widths (label = 4 cm,
    value = 13 cm, total = 17 cm = A4 minus 2 cm margins) avoids the
    fragile nested-table side-by-side layout that previously let long
    values overflow the page width.
    """
    make = _safe(vehicle_info.get("make"))
    model = _safe(vehicle_info.get("model") or vehicle_info.get("bodyType"))
    year = _safe(vehicle_info.get("year"))
    plate = _safe(vehicle_info.get("plateNumber") or vehicle_info.get("plate"))
    vin = _safe(vehicle_info.get("vin"))
    mileage = _safe(vehicle_info.get("mileage"))

    rows = [
        _kv_pair("Owner",          owner_name, styles),
        _kv_pair("Contact",        owner_email, styles),
        _kv_pair("Make / Model",   f"{make} {model}".strip(), styles),
        _kv_pair("Year / Mileage", f"{year} · {mileage}", styles),
        _kv_pair("Plate / VIN",    f"{plate} · {vin}", styles),
    ]

    # 4 cm label + 13 cm value = 17 cm — exactly fills the usable A4 width
    # (21 cm page − 2 cm left − 2 cm right margins) with no overflow risk.
    tbl = Table(rows, colWidths=[4 * cm, 13 * cm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), colors.white),
        ("BOX",           (0, 0), (-1, -1), 0.6, ACCENT_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.3, ACCENT_BORDER),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return tbl


def _section_incident(styles, claim: dict):
    insurer = _safe(claim.get("insuranceCompany"))
    policy = _safe(claim.get("policyNo"))
    incident_date = _safe(claim.get("incidentDate"))
    incident_loc = _safe(claim.get("incidentLocation"))
    police_ref = _safe(claim.get("policeReference"))

    cells = [
        [_label("INSURER", styles), _value(insurer, styles), _label("POLICY", styles), _value(policy, styles)],
        [_label("INCIDENT DATE", styles), _value(incident_date, styles),
         _label("POLICE REF", styles), _value(police_ref, styles)],
        [_label("LOCATION", styles), _value(incident_loc, styles, bold=False), "", ""],
    ]
    t = Table(cells, colWidths=[3.5 * cm, 5 * cm, 3.5 * cm, 5 * cm])
    t.setStyle(TableStyle([
        ("SPAN",          (1, 2), (3, 2)),
        ("BACKGROUND",    (0, 0), (-1, -1), ACCENT_SOFT),
        ("BOX",           (0, 0), (-1, -1), 0.6, ACCENT_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.4, ACCENT_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
    ]))
    return t


def _section_pre_repair_ai(styles, *, defects: list, ai_summary: dict):
    if not defects:
        return Paragraph(
            "<i>No pre-repair AI defects were recorded for this vehicle.</i>",
            ParagraphStyle("EmptyAI", parent=styles["Normal"], fontSize=10,
                           textColor=ACCENT_MUTED, leading=14, spaceAfter=8)
        )

    headline = ai_summary.get("overallStatus") or ai_summary.get("overall_status") or "ATTENTION"
    health = ai_summary.get("healthScore") or ai_summary.get("health_score")
    risk = ai_summary.get("riskLevel") or ai_summary.get("risk_level")
    defects_count = ai_summary.get("defectsFound") or len(defects)

    summary = [
        [
            _label("AI VERDICT (PRE-REPAIR)", styles),
            _label("HEALTH SCORE", styles),
            _label("RISK", styles),
            _label("DAMAGE AREAS", styles),
        ],
        [
            _value(_safe(headline), styles),
            _value(_safe(f"{health}/100" if health is not None else "—"), styles),
            _value(_safe(risk), styles),
            _value(str(defects_count), styles),
        ],
    ]
    head = Table(summary, colWidths=[5 * cm, 4 * cm, 4 * cm, 4 * cm])
    head.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), ACCENT_PANEL),
        ("BOX",           (0, 0), (-1, -1), 0.6, ACCENT_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.4, ACCENT_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))

    rows = [["Damage", "Severity", "Confidence", "Safety-critical"]]
    for d in defects:
        rows.append([
            _value(_safe(d.get("label")), styles, bold=False),
            _value(_safe(d.get("severity")).title(), styles, bold=False),
            _value(f"{d.get('confidence', 0):.1f}%", styles, bold=False),
            _value("Yes" if _is_safety_defect(d) else "No", styles, bold=False),
        ])

    body = Table(rows, colWidths=[7 * cm, 3.5 * cm, 3 * cm, 3.5 * cm])
    body.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), ACCENT_SECONDARY),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 9),
        ("BOX",           (0, 0), (-1, -1), 0.6, ACCENT_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.3, ACCENT_BORDER),
        ("ALIGN",         (0, 0), (-1, 0), "LEFT"),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
    ]))

    return KeepTogether([head, Spacer(1, 6), body])


def _section_insurance_authorization(styles, *, claim: dict, insurance_approved: bool, approved_amount: str):
    breakdown = claim.get("cost_breakdown") if isinstance(claim, dict) else None
    currency = (claim or {}).get("currency") or (breakdown or {}).get("currency") or "AED"
    coverage = (claim or {}).get("coverage_percent") or (breakdown or {}).get("coverage_percent")
    final_amount = (claim or {}).get("final_amount") or approved_amount
    owner_liability = (breakdown or {}).get("owner_liability")
    subtotal = (breakdown or {}).get("subtotal")

    status = "APPROVED" if insurance_approved or final_amount else "PENDING"
    status_color = ACCENT_OK if status == "APPROVED" else ACCENT_WARN

    status_box = Paragraph(
        f"<font color='{_hex(status_color)}'><b>Status:&nbsp;{status}</b></font>",
        ParagraphStyle("InsStatus", parent=styles["Normal"], fontSize=10.5)
    )

    summary_rows = [
        [
            _label("FINAL AUTHORIZED", styles),
            _label("COVERAGE %", styles),
            _label("OWNER LIABILITY", styles),
            _label("SUBTOTAL", styles),
        ],
        [
            _value(_format_currency(final_amount, currency), styles),
            _value(_safe(f"{coverage}%" if coverage is not None else "—"), styles),
            _value(_format_currency(owner_liability, currency) if owner_liability is not None else "—", styles),
            _value(_format_currency(subtotal, currency) if subtotal is not None else "—", styles),
        ],
    ]
    head = Table(summary_rows, colWidths=[4.5 * cm, 4 * cm, 4 * cm, 4 * cm])
    head.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), ACCENT_PANEL),
        ("BOX",           (0, 0), (-1, -1), 0.6, ACCENT_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.4, ACCENT_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))

    line_items = (breakdown or {}).get("line_items") or []
    if not line_items:
        return KeepTogether([status_box, Spacer(1, 6), head])

    rows = [["Defect", "Severity", "Base", "Multipliers", "Weighted"]]
    for li in line_items:
        rows.append([
            _value(_safe(li.get("defect_type")), styles, bold=False),
            _value(_safe(li.get("severity")).title(), styles, bold=False),
            _value(_format_currency(li.get("base_cost"), currency), styles, bold=False),
            _value(
                f"x{_safe(li.get('severity_multiplier'))} · "
                f"{(float(li.get('confidence_score', 0)) * 100):.0f}%",
                styles,
                bold=False,
            ),
            _value(_format_currency(li.get("weighted_cost"), currency), styles, bold=False),
        ])
    body = Table(rows, colWidths=[5 * cm, 2.5 * cm, 2.5 * cm, 4 * cm, 3 * cm])
    body.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), ACCENT_SECONDARY),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 9),
        ("BOX",           (0, 0), (-1, -1), 0.6, ACCENT_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.3, ACCENT_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
    ]))
    return KeepTogether([status_box, Spacer(1, 6), head, Spacer(1, 6), body])


def _section_services_performed(styles, services_completed: list):
    if not services_completed:
        return Paragraph(
            "<i>No service items were logged for this repair.</i>",
            ParagraphStyle("EmptyServices", parent=styles["Normal"], fontSize=10,
                           textColor=ACCENT_MUTED, spaceAfter=8)
        )

    rows = [["#", "Task", "Parts", "Cost", "Status"]]
    total = 0.0
    has_total = False
    for i, svc in enumerate(services_completed, 1):
        if not isinstance(svc, dict):
            svc = {"task": str(svc)}
        cost_raw = svc.get("cost") or "—"
        try:
            cost_f = float(re.sub(r"[^0-9.\-]", "", str(cost_raw)))
            if cost_f > 0:
                total += cost_f
                has_total = True
                cost_disp = _format_currency(cost_f)
            else:
                cost_disp = _safe(cost_raw)
        except (TypeError, ValueError):
            cost_disp = _safe(cost_raw)

        rows.append([
            _value(str(i), styles, bold=False),
            _value(_safe(svc.get("task")), styles, bold=True),
            _value(_safe(svc.get("parts")), styles, bold=False),
            _value(cost_disp, styles, bold=False),
            _value(_safe(svc.get("status") or "done").title(), styles, bold=False),
        ])

    if has_total:
        rows.append([
            "", "", _value("<b>TOTAL</b>", styles), _value(f"<b>{_format_currency(total)}</b>", styles), ""
        ])

    t = Table(rows, colWidths=[1 * cm, 6 * cm, 4 * cm, 3 * cm, 3 * cm])
    style = [
        ("BACKGROUND",    (0, 0), (-1, 0), ACCENT_SECONDARY),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 9),
        ("BOX",           (0, 0), (-1, -1), 0.6, ACCENT_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.3, ACCENT_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]
    if has_total:
        style.append(("BACKGROUND", (0, -1), (-1, -1), ACCENT_PANEL))
    t.setStyle(TableStyle(style))
    return t


def _section_readiness_table(styles, readiness_rows: list):
    if not readiness_rows:
        return None
    rows = [["Pre-repair defect", "Severity", "Safety", "Post-repair status"]]
    for r in readiness_rows:
        addressed = bool(r.get("addressed"))
        status_text = "Restored" if addressed else "Outstanding"
        status_color = ACCENT_OK if addressed else ACCENT_PRIMARY
        rows.append([
            _value(_safe(r.get("label")), styles, bold=False),
            _value(_safe(r.get("severity")).title(), styles, bold=False),
            _value("Yes" if r.get("safety") else "No", styles, bold=False),
            Paragraph(
                f"<font color='{_hex(status_color)}'><b>{status_text}</b></font>",
                ParagraphStyle("StatusCell", parent=styles["Normal"], fontSize=10)
            ),
        ])
    t = Table(rows, colWidths=[7 * cm, 3 * cm, 2.5 * cm, 4.5 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), ACCENT_SECONDARY),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 9),
        ("BOX",           (0, 0), (-1, -1), 0.6, ACCENT_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.3, ACCENT_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
    ]))
    return t


def _section_signoff(styles, technician_name: str, technician_notes: str, garage_name: str):
    notes_para = Paragraph(
        _safe(technician_notes, "No additional notes from the technician."),
        ParagraphStyle("Notes", parent=styles["Normal"], fontSize=10, leading=14,
                       leftIndent=8, rightIndent=8, textColor=ACCENT_TEXT,
                       backColor=ACCENT_PANEL, borderPadding=10)
    )

    signature_rows = [
        [_label("TECHNICIAN", styles), _label("CUSTOMER ACKNOWLEDGEMENT", styles)],
        [_value(_safe(technician_name), styles, bold=True), _value("__________________________", styles, bold=False)],
        [_value(_safe(garage_name), styles, bold=False), _value(_safe(datetime.now().strftime('%B %d, %Y')), styles, bold=False)],
    ]
    sigs = Table(signature_rows, colWidths=[8.5 * cm, 8.5 * cm])
    sigs.setStyle(TableStyle([
        ("BOX",           (0, 0), (-1, -1), 0.6, ACCENT_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.4, ACCENT_BORDER),
        ("BACKGROUND",    (0, 0), (-1, 0), ACCENT_PANEL),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
    ]))
    return [notes_para, Spacer(1, 12), sigs]


def _section_disclaimer(styles):
    text = (
        "<i>This Accident Repair Service Report documents the services performed at the "
        "garage following an insurance-authorised accident repair. The Roadworthy Readiness "
        "Score is a heuristic post-repair indicator derived from the pre-repair AI inspection "
        "and the services logged at completion — it is not a replacement for an independent "
        "roadworthiness inspection (e.g. Tasjeel/RTA). Parts replaced during this repair are "
        "covered by the garage's standard workmanship warranty unless explicitly stated "
        "otherwise in the technician notes.</i>"
    )
    return Paragraph(
        text,
        ParagraphStyle("Disclaimer", parent=styles["Normal"], fontSize=8.5,
                       textColor=ACCENT_MUTED, alignment=0, leading=12, spaceBefore=14)
    )


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────────
def generate_accident_service_report(
    *,
    output_path: str,
    appointment: dict | None = None,
    vehicle_info: dict | None = None,
    services_completed: list | None = None,
    defects_from_ai: list | None = None,
    technician_name: str = "",
    technician_notes: str = "",
    claim_id: str = "",
    claim: dict | None = None,
    owner_name: str = "",
    owner_email: str = "",
    garage_name: str = "",
    garage_address: str = "",
):
    """Build and write the post-repair accident service PDF to ``output_path``."""

    appointment = appointment or {}
    vehicle_info = vehicle_info or {}
    services_completed = services_completed or []
    defects_from_ai = defects_from_ai or []
    claim = claim or {}

    # Pull AI scan summary either from the claim or from the appointment payload.
    ai_summary = claim.get("aiScanData") or appointment.get("aiScanData") or {}

    # Normalise pre-repair defects (prefer the richer aiScanData.defectDetails).
    if ai_summary.get("defectDetails"):
        raw_defects = ai_summary.get("defectDetails", [])
    else:
        raw_defects = defects_from_ai or []
    defects = [_normalise_defect(d) for d in raw_defects]

    # Resolve identifiers / labels
    claim_id = claim_id or claim.get("id") or ""
    owner_name = owner_name or claim.get("ownerName") or appointment.get("ownerName") or ""
    owner_email = owner_email or claim.get("ownerEmail") or appointment.get("ownerEmail") or ""
    garage_name = garage_name or claim.get("garageName") or appointment.get("garage") or ""
    garage_address = garage_address or claim.get("garageAddress") or appointment.get("garageAddress") or ""
    appointment_id = appointment.get("id") or claim.get("appointmentId") or ""
    completion_date = datetime.now().strftime("%B %d, %Y at %H:%M")

    insurance_approved = bool(claim.get("status") == "approved" or claim.get("approvedAmount"))
    approved_amount = claim.get("approvedAmount") or ""

    score, status_text, status_color, readiness_rows = _compute_readiness(
        defects, services_completed, technician_notes
    )

    doc = SimpleDocTemplate(
        output_path, pagesize=A4,
        rightMargin=2 * cm, leftMargin=2 * cm,
        topMargin=1.6 * cm, bottomMargin=1.8 * cm,
    )
    styles = getSampleStyleSheet()
    story = []

    story.append(_section_header(styles, garage_name, completion_date))
    story.append(Spacer(1, 14))

    story.append(_section_reference_card(
        styles,
        claim_id=claim_id, garage_name=garage_name, garage_address=garage_address,
        completion_date=completion_date, technician_name=technician_name,
        appointment_id=appointment_id,
    ))

    story.append(_h2("1 · Customer & Vehicle", styles))
    story.append(_section_customer_vehicle(
        styles, owner_name=owner_name, owner_email=owner_email, vehicle_info=vehicle_info,
    ))

    story.append(_h2("2 · Incident & Insurance Reference", styles))
    story.append(_section_incident(styles, claim))

    story.append(_h2("3 · Pre-Repair AI Damage Assessment", styles))
    story.append(_section_pre_repair_ai(styles, defects=defects, ai_summary=ai_summary))

    story.append(_h2("4 · Insurance Cost Authorization", styles))
    story.append(_section_insurance_authorization(
        styles, claim=claim, insurance_approved=insurance_approved, approved_amount=approved_amount,
    ))

    story.append(_h2("5 · Services Performed at the Garage", styles))
    story.append(_section_services_performed(styles, services_completed))

    story.append(_h2("6 · Post-Repair Roadworthy Readiness", styles))
    story.append(_readiness_bar(score, status_text, status_color, styles))
    story.append(Spacer(1, 8))
    readiness_table = _section_readiness_table(styles, readiness_rows)
    if readiness_table is not None:
        story.append(readiness_table)

    story.append(_h2("7 · Technician Notes & Sign-Off", styles))
    for el in _section_signoff(styles, technician_name, technician_notes, garage_name):
        story.append(el)

    story.append(_section_disclaimer(styles))

    try:
        doc.build(story)
    except Exception as e:
        raise RuntimeError(f"Failed to build accident service PDF: {e}") from e

    return {
        "score": score,
        "status": status_text,
        "defects_total": len(defects),
        "defects_addressed": sum(1 for r in readiness_rows if r.get("addressed")),
        "services_count": len(services_completed),
    }
