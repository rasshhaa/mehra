"""
AUTOVAULT — Car Life Summary Report
===================================

Generates a vehicle lifecycle PDF summarising inspections, accidents,
health score, registration, and mileage for resale / history sharing.

The function exposed here is `generate_car_life_report(...)` which is
called by `main.py`. Depends only on `reportlab`.
"""

from __future__ import annotations

from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors


# ── Theme — teal lifecycle palette ────────────────────────────────────────────
ACCENT_PRIMARY   = colors.HexColor("#0f766e")
ACCENT_SECONDARY = colors.HexColor("#0f172a")
ACCENT_OK        = colors.HexColor("#15803d")
ACCENT_WARN      = colors.HexColor("#b45309")
ACCENT_TEXT      = colors.HexColor("#1f2937")
ACCENT_MUTED     = colors.HexColor("#6b7280")
ACCENT_SOFT      = colors.HexColor("#f0fdfa")
ACCENT_PANEL     = colors.HexColor("#f8fafc")
ACCENT_BORDER    = colors.HexColor("#e5e7eb")


def _hex(color) -> str:
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


def _h1(text, styles):
    return Paragraph(
        f"<font color='#ffffff'><b>{text}</b></font>",
        ParagraphStyle(
            "H1", parent=styles["Title"], fontSize=20, alignment=0,
            leading=24, textColor=colors.white,
        ),
    )


def _h2(text, styles):
    return Paragraph(
        f"<b>{text}</b>",
        ParagraphStyle(
            "H2", parent=styles["Heading2"], fontSize=13,
            textColor=ACCENT_SECONDARY, spaceBefore=14, spaceAfter=6, leading=16,
        ),
    )


def _label(text, styles):
    return Paragraph(
        text,
        ParagraphStyle(
            "Label", parent=styles["Normal"], fontSize=8, textColor=ACCENT_MUTED,
            leading=10, spaceAfter=2,
        ),
    )


def _value(text, styles, bold=True):
    return Paragraph(
        f"<b>{text}</b>" if bold else text,
        ParagraphStyle(
            "Value", parent=styles["Normal"], fontSize=10,
            textColor=ACCENT_TEXT, leading=13,
        ),
    )


def _health_color(score: float):
    if score >= 80:
        return ACCENT_OK
    if score >= 60:
        return ACCENT_WARN
    return colors.HexColor("#b91c1c")


def _is_completed_garage_row(row: dict) -> bool:
    if not isinstance(row, dict):
        return False
    status = str(row.get("status") or "").strip().lower()
    gts = str(row.get("garageTicketStatus") or "").strip().lower()
    if status in ("done", "completed", "complete"):
        return True
    if gts == "garage_complete":
        return True
    logged = row.get("servicesLogged") or row.get("services_completed") or row.get("servicesCompleted")
    if isinstance(logged, list) and logged:
        return True
    return False


def _extract_parts_from_row(row: dict) -> list:
    parts: list = []
    if not isinstance(row, dict):
        return parts
    for key in ("partsReplaced", "parts_replaced"):
        raw = row.get(key)
        if isinstance(raw, list):
            parts.extend(str(p).strip() for p in raw if str(p).strip())
        elif isinstance(raw, str) and raw.strip() and raw.strip() != "—":
            parts.extend([p.strip() for p in raw.split(",") if p.strip()])
    logged = row.get("servicesLogged") or row.get("services_completed") or row.get("servicesCompleted")
    if isinstance(logged, list):
        for item in logged:
            if not isinstance(item, dict):
                continue
            part = str(item.get("parts") or item.get("part") or "").strip()
            task = str(item.get("task") or "").strip()
            if part and part != "—":
                parts.append(part)
            elif task:
                parts.append(task)
    return parts


def _completed_garage_events(services=None, appointments=None) -> list:
    """Completed garage visits only (not pending bookings)."""
    events: list = []
    seen: set = set()

    def _add(row: dict):
        if not _is_completed_garage_row(row):
            return
        key = str(
            row.get("id")
            or row.get("appointmentId")
            or f"{row.get('date')}_{row.get('garage')}_{row.get('service')}"
        )
        if key in seen:
            return
        seen.add(key)
        events.append(row)

    for row in services or []:
        if isinstance(row, dict):
            _add(row)
    for row in appointments or []:
        if isinstance(row, dict):
            _add(row)
    return events


def _resolve_fields(
    *,
    vehicle_plate="",
    owner_name="",
    total_inspections=0,
    accidents=None,
    avg_health_score=0,
    registration_expiry="",
    mileage_estimate="",
    vehicle_info=None,
    inspections=None,
    services=None,
    appointments=None,
):
    """Merge explicit fields with legacy vehicle / history payloads."""
    vehicle_info = vehicle_info or {}
    inspections = inspections or []
    services = services or []
    appointments = appointments or []
    accidents = accidents or []

    plate = (
        vehicle_plate
        or vehicle_info.get("plateNumber")
        or vehicle_info.get("plate")
        or ""
    )
    owner = owner_name or vehicle_info.get("ownerName") or ""
    expiry = (
        registration_expiry
        or vehicle_info.get("registrationExpiry")
        or vehicle_info.get("expiryDate")
        or vehicle_info.get("regExpiry")
        or ""
    )
    mileage = (
        mileage_estimate
        or vehicle_info.get("mileage")
        or vehicle_info.get("odometer")
        or ""
    )

    inspection_count = total_inspections or len(inspections)

    if not avg_health_score and inspections:
        scores = []
        for insp in inspections:
            if not isinstance(insp, dict):
                continue
            raw = (
                insp.get("healthScore")
                or insp.get("health_score")
                or (insp.get("aiAnalysis") or {}).get("healthScore")
                or (insp.get("ai_analysis") or {}).get("health_score")
            )
            try:
                if raw is not None:
                    scores.append(float(raw))
            except (TypeError, ValueError):
                pass
        if scores:
            avg_health_score = round(sum(scores) / len(scores), 1)

    if not accidents:
        accident_dates = []
        for appt in appointments:
            if not isinstance(appt, dict):
                continue
            svc = str(appt.get("service") or appt.get("serviceType") or "").lower()
            if appt.get("accidentClaimId") or "accident" in svc or "body" in svc:
                dt = appt.get("date") or appt.get("createdAt") or appt.get("bookedAt") or ""
                if dt:
                    accident_dates.append(str(dt))
        for svc in services:
            if not isinstance(svc, dict):
                continue
            if svc.get("accidentClaimId") or svc.get("type") == "accident":
                dt = svc.get("date") or svc.get("doneAt") or ""
                if dt:
                    accident_dates.append(str(dt))
        accidents = accident_dates

    accident_list = [str(a).strip() for a in accidents if str(a).strip()]

    make = _safe(vehicle_info.get("make"), "")
    model = _safe(vehicle_info.get("model") or vehicle_info.get("bodyType"), "")
    year = _safe(vehicle_info.get("year"), "")
    vehicle_label = " ".join(x for x in (make, model, year) if x and x != "—").strip() or "Vehicle"

    try:
        score_f = float(avg_health_score)
    except (TypeError, ValueError):
        score_f = 0.0

    completed_garage = _completed_garage_events(services, appointments)

    return {
        "vehicle_plate": _safe(plate),
        "owner_name": _safe(owner),
        "vehicle_label": vehicle_label,
        "total_inspections": int(inspection_count),
        "accidents": accident_list,
        "avg_health_score": score_f,
        "registration_expiry": _safe(expiry),
        "mileage_estimate": _safe(mileage),
        "services_count": len(completed_garage),
        "appointments_count": len(appointments),
        "completed_garage": completed_garage,
    }


def _section_header(styles, vehicle_plate: str, owner_name: str):
    title = _h1("CAR LIFE · VEHICLE HISTORY SUMMARY", styles)
    subtitle = Paragraph(
        f"<font color='#ccfbf1'>{_safe(vehicle_plate)} · Owner: {_safe(owner_name)}</font>",
        ParagraphStyle(
            "HSub", parent=styles["Normal"], fontSize=10,
            textColor=colors.HexColor("#ccfbf1"), leading=12,
        ),
    )
    brand = Paragraph(
        "<font color='#ffffff'><b>AUTOVAULT</b></font>"
        "<font color='#99f6e4'>  ·  Vehicle Lifecycle Platform</font>",
        ParagraphStyle(
            "Brand", parent=styles["Normal"], fontSize=9,
            textColor=colors.HexColor("#99f6e4"), spaceAfter=4,
        ),
    )
    generated = Paragraph(
        f"<font color='#99f6e4'>Generated {_safe(datetime.now().strftime('%B %d, %Y at %H:%M'))}</font>",
        ParagraphStyle(
            "Gen", parent=styles["Normal"], fontSize=8.5,
            textColor=colors.HexColor("#99f6e4"), leading=11,
        ),
    )
    inner = Table([[brand], [title], [subtitle], [generated]], colWidths=[17 * cm])
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


def _section_overview(styles, fields: dict):
    rows = [
        [
            _label("VEHICLE", styles),
            _label("PLATE", styles),
            _label("OWNER", styles),
        ],
        [
            _value(fields["vehicle_label"], styles),
            _value(fields["vehicle_plate"], styles),
            _value(fields["owner_name"], styles),
        ],
        [
            _label("MILEAGE EST.", styles),
            _label("REG. EXPIRY", styles),
            _label("GENERATED", styles),
        ],
        [
            _value(fields["mileage_estimate"], styles),
            _value(fields["registration_expiry"], styles),
            _value(datetime.now().strftime("%B %d, %Y"), styles),
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


def _section_health_score(styles, score: float, total_inspections: int, services_count: int):
    color = _health_color(score)
    sc_hex = _hex(color)
    filled = max(0, min(10, round(score / 10)))
    empty = 10 - filled

    score_para = Paragraph(
        f"<font color='{sc_hex}'><b>{score:.0f}/100</b></font>",
        ParagraphStyle("Score", parent=styles["Normal"], fontSize=26, alignment=1, leading=28),
    )
    bar_para = Paragraph(
        f"<font color='{sc_hex}'>{'█' * filled}</font>"
        f"<font color='#e5e7eb'>{'█' * empty}</font>",
        ParagraphStyle("Bar", parent=styles["Normal"], fontSize=18, alignment=1, leading=20),
    )
    sub_para = Paragraph(
        "Average Vehicle Health Score",
        ParagraphStyle("Sub", parent=styles["Normal"], fontSize=8.5, textColor=ACCENT_MUTED, alignment=1),
    )

    metrics = [
        [
            _label("AI INSPECTIONS", styles),
            _label("GARAGE SERVICES", styles),
            _label("ACCIDENT EVENTS", styles),
        ],
        [
            _value(str(total_inspections), styles),
            _value(str(services_count), styles),
            _value("See section below", styles, bold=False),
        ],
    ]
    metrics_tbl = Table(metrics, colWidths=[5.5 * cm, 5.5 * cm, 6 * cm])
    metrics_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), ACCENT_SOFT),
        ("BOX",           (0, 0), (-1, -1), 0.6, ACCENT_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.4, ACCENT_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))

    score_tbl = Table([[score_para], [bar_para], [sub_para]], colWidths=[17 * cm])
    score_tbl.setStyle(TableStyle([
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("BACKGROUND",    (0, 0), (-1, -1), ACCENT_PANEL),
        ("BOX",           (0, 0), (-1, -1), 0.8, ACCENT_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))

    return KeepTogether([score_tbl, Spacer(1, 8), metrics_tbl])


def _section_garage_services(styles, completed_events: list):
    if not completed_events:
        return Paragraph(
            "<i>No completed garage service visits recorded yet.</i>",
            ParagraphStyle(
                "EmptyGarage", parent=styles["Normal"], fontSize=10,
                textColor=ACCENT_MUTED, leading=14, spaceAfter=8,
            ),
        )

    rows = [["#", "Date", "Garage / Service", "Parts & work completed"]]
    for i, ev in enumerate(completed_events[:20], 1):
        dt = _safe(
            ev.get("doneAt")
            or ev.get("date")
            or ev.get("createdAt")
            or ev.get("bookedAt")
        )
        garage = _safe(ev.get("garage") or "Garage", "Garage")
        svc = str(ev.get("service") or ev.get("serviceType") or "").strip()
        svc_label = svc.replace("-", " ").title() if svc else "General service"
        parts = _extract_parts_from_row(ev)
        parts_text = ", ".join(parts) if parts else "— (no parts logged)"
        if len(parts_text) > 220:
            parts_text = parts_text[:217] + "…"
        rows.append([
            _value(str(i), styles, bold=False),
            _value(dt, styles, bold=False),
            _value(f"{garage} · {svc_label}", styles, bold=False),
            Paragraph(parts_text, ParagraphStyle(
                "PartsCell", parent=styles["Normal"], fontSize=9,
                textColor=ACCENT_TEXT, leading=12,
            )),
        ])

    t = Table(rows, colWidths=[1.0 * cm, 3.2 * cm, 5.0 * cm, 7.8 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), ACCENT_SECONDARY),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 9),
        ("BOX",           (0, 0), (-1, -1), 0.6, ACCENT_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.3, ACCENT_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def _section_accidents(styles, accidents: list):
    if not accidents:
        return Paragraph(
            "<i>No accident-related service events recorded in this vehicle history.</i>",
            ParagraphStyle(
                "EmptyAcc", parent=styles["Normal"], fontSize=10,
                textColor=ACCENT_MUTED, leading=14, spaceAfter=8,
            ),
        )

    rows = [["#", "Accident / Body-Repair Event Date"]]
    for i, dt in enumerate(accidents, 1):
        rows.append([
            _value(str(i), styles, bold=False),
            _value(_safe(dt), styles, bold=False),
        ])

    t = Table(rows, colWidths=[1.5 * cm, 15.5 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), ACCENT_SECONDARY),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 9),
        ("BOX",           (0, 0), (-1, -1), 0.6, ACCENT_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.3, ACCENT_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
    ]))
    return t


def _section_disclaimer(styles):
    text = (
        "<i>This Car Life Summary aggregates inspection, service, and accident "
        "records available in AutoVault at the time of generation. It is intended "
        "for owner reference and resale transparency — not a legal vehicle history "
        "certificate. Registration expiry and mileage are estimates based on "
        "profile data supplied by the owner.</i>"
    )
    return Paragraph(
        text,
        ParagraphStyle(
            "Disclaimer", parent=styles["Normal"], fontSize=8.5,
            textColor=ACCENT_MUTED, alignment=0, leading=12, spaceBefore=14,
        ),
    )


def generate_car_life_report(
    *,
    output_path: str,
    vehicle_plate: str = "",
    owner_name: str = "",
    total_inspections: int = 0,
    accidents: list | None = None,
    avg_health_score=0,
    registration_expiry: str = "",
    mileage_estimate: str = "",
    vehicle_info: dict | None = None,
    inspections: list | None = None,
    services: list | None = None,
    appointments: list | None = None,
):
    """Build and write the Car Life summary PDF to ``output_path``."""
    fields = _resolve_fields(
        vehicle_plate=vehicle_plate,
        owner_name=owner_name,
        total_inspections=total_inspections,
        accidents=accidents,
        avg_health_score=avg_health_score,
        registration_expiry=registration_expiry,
        mileage_estimate=mileage_estimate,
        vehicle_info=vehicle_info,
        inspections=inspections,
        services=services,
        appointments=appointments,
    )

    doc = SimpleDocTemplate(
        output_path, pagesize=A4,
        rightMargin=2 * cm, leftMargin=2 * cm,
        topMargin=1.6 * cm, bottomMargin=1.8 * cm,
    )
    styles = getSampleStyleSheet()
    story = []

    story.append(_section_header(styles, fields["vehicle_plate"], fields["owner_name"]))
    story.append(Spacer(1, 14))
    story.append(_section_overview(styles, fields))

    story.append(_h2("1 · Health & Activity Summary", styles))
    story.append(_section_health_score(
        styles,
        fields["avg_health_score"],
        fields["total_inspections"],
        fields["services_count"],
    ))

    story.append(_h2("2 · Garage Service History", styles))
    story.append(_section_garage_services(styles, fields.get("completed_garage") or []))

    story.append(_h2("3 · Accident History", styles))
    story.append(_section_accidents(styles, fields["accidents"]))

    story.append(_section_disclaimer(styles))

    try:
        doc.build(story)
    except Exception as e:
        raise RuntimeError(f"Failed to build Car Life PDF: {e}") from e

    return {
        "vehicle_plate": fields["vehicle_plate"],
        "total_inspections": fields["total_inspections"],
        "avg_health_score": fields["avg_health_score"],
        "accidents_count": len(fields["accidents"]),
    }
