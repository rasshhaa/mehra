"""
AUTOVAULT — Official UAE Motor Accident Report (insurer-facing).

Single-page PDF: incident summary, vehicle parties, insurer authorization, signatures.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

NAVY = colors.HexColor("#1e3a5f")
NAVY_DARK = colors.HexColor("#0f2744")
ORANGE = colors.HexColor("#d97706")
RED_TXT = colors.HexColor("#b91c1c")
MUTED = colors.HexColor("#6b7280")
BORDER = colors.HexColor("#cbd5e1")
SOFT_BG = colors.HexColor("#f8fafc")

# Usable width inside 1.8 cm margins on A4
CONTENT_W = 17.0 * cm
COL_4 = [3.4 * cm, 5.1 * cm, 3.4 * cm, 5.1 * cm]


def _safe(value: Any, fallback: str = "—") -> str:
    if value is None:
        return fallback
    s = str(value).strip()
    return s if s else fallback


def _fmt_money(amount: Any, currency: str = "AED") -> str:
    try:
        f = float(amount)
    except (TypeError, ValueError):
        return f"{currency} —"
    return f"{currency} {f:,.2f}"


def _report_number(claim_id: str) -> str:
    suffix = re.sub(r"[^0-9]", "", claim_id or "")[-6:] or datetime.now().strftime("%H%M%S")
    return f"ACC-{datetime.now().year}-{suffix.zfill(6)}"


def _infer_emirate(location: str) -> str:
    loc = (location or "").lower()
    for em in ("Dubai", "Abu Dhabi", "Sharjah", "Ajman", "RAK", "Fujairah", "Umm Al Quwain"):
        if em.lower() in loc:
            return em
    if "dxb" in loc:
        return "Dubai"
    if "auh" in loc:
        return "Abu Dhabi"
    return "UAE"


def _severity_label(count: int, has_safety: bool) -> str:
    if count >= 4 or has_safety:
        return "Moderate"
    if count >= 2:
        return "Minor"
    return "Minor"


def _damage_summary(defects: List[dict], ai_scan: Optional[dict]) -> str:
    lines = []
    for d in defects[:6]:
        label = d.get("defect_type") or d.get("label") or "Damage"
        sev = (d.get("severity") or "moderate").title()
        conf = d.get("confidence_score", 0)
        if conf and conf <= 1:
            conf = conf * 100
        lines.append(f"{label} ({sev}, {conf:.0f}%)")
    if not lines and ai_scan:
        n = ai_scan.get("defectsFound") or 0
        if n:
            lines.append(f"{n} AI-detected damage zone(s)")
    return "; ".join(lines) if lines else "Minor exterior damage — verify at workshop"


def _esc(text: str) -> str:
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _build_styles(base):
    return {
        "label": ParagraphStyle(
            "OARLabel", parent=base["Normal"], fontSize=8, fontName="Helvetica-Bold",
            textColor=MUTED, leading=10,
        ),
        "value": ParagraphStyle(
            "OARValue", parent=base["Normal"], fontSize=8.5, fontName="Helvetica",
            textColor=colors.HexColor("#1f2937"), leading=11, wordWrap="CJK",
        ),
        "valueBold": ParagraphStyle(
            "OARValueBold", parent=base["Normal"], fontSize=8.5, fontName="Helvetica-Bold",
            textColor=colors.HexColor("#1f2937"), leading=11, wordWrap="CJK",
        ),
        "body": ParagraphStyle(
            "OARBody", parent=base["Normal"], fontSize=9, leading=13,
            textColor=colors.HexColor("#1f2937"), wordWrap="CJK",
        ),
        "damage": ParagraphStyle(
            "OARDmg", parent=base["Normal"], fontSize=8.5, leading=12,
            textColor=RED_TXT, wordWrap="CJK",
        ),
    }


def _cell(text: str, st: dict, kind: str = "value") -> Paragraph:
    style = st["label"] if kind == "label" else st["value"]
    return Paragraph(_esc(text), style)


def _section_bar(title: str, st: dict) -> Table:
    bar_style = ParagraphStyle(
        "SecBar", parent=st["label"], fontSize=9, textColor=colors.white,
        fontName="Helvetica-Bold", leading=12, leftIndent=0,
    )
    t = Table([[Paragraph(_esc(title), bar_style)]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def _kv_table(rows: List[List[str]], col_widths: List[float], st: dict) -> Table:
    """Four-column label/value grid with wrapped Paragraph cells."""
    data = []
    for row in rows:
        cells = []
        for i, raw in enumerate(row):
            cells.append(_cell(raw, st, "label" if i % 2 == 0 else "value"))
        data.append(cells)
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("BACKGROUND", (0, 0), (0, -1), SOFT_BG),
        ("BACKGROUND", (2, 0), (2, -1), SOFT_BG),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def _header_block(base_styles) -> Table:
    title_style = ParagraphStyle(
        "OARTitle", parent=base_styles["Normal"], fontSize=13, textColor=colors.white,
        fontName="Helvetica-Bold", alignment=TA_CENTER, leading=16,
    )
    sub_style = ParagraphStyle(
        "OARSub", parent=base_styles["Normal"], fontSize=8, textColor=colors.HexColor("#cbd5e1"),
        alignment=TA_CENTER, leading=10,
    )
    brand_style = ParagraphStyle("b1", parent=base_styles["Normal"], fontSize=7.5, textColor=NAVY)
    brand_center = ParagraphStyle("b2", parent=brand_style, alignment=TA_CENTER)
    brand_right = ParagraphStyle("b3", parent=brand_style, alignment=2, textColor=MUTED)

    banner = Table(
        [
            [Paragraph("OFFICIAL ACCIDENT REPORT", title_style)],
            [Paragraph("تقرير حادث مروري", sub_style)],
        ],
        colWidths=[CONTENT_W],
    )
    banner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY_DARK),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))

    brand = Table(
        [[
            Paragraph("<b>AUTOVAULT AI VEHICLE PLATFORM</b>", brand_style),
            Paragraph("<b>UNITED ARAB EMIRATES</b>", brand_center),
            Paragraph("TRAFFIC SYSTEMS DIV. · INTEGRATED NETWORK", brand_right),
        ]],
        colWidths=[CONTENT_W / 3, CONTENT_W / 3, CONTENT_W / 3],
    )
    brand.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))

    outer = Table([[brand], [banner]], colWidths=[CONTENT_W])
    outer.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    return outer


def generate_official_accident_report(claim: Dict[str, Any], output_path: str, cost_breakdown: Optional[dict] = None) -> dict:
    base = getSampleStyleSheet()
    st = _build_styles(base)

    claim_id = _safe(claim.get("id") or claim.get("claim_id"), "CLAIM")
    mulkiya = claim.get("mulkiya") or {}
    if not isinstance(mulkiya, dict):
        mulkiya = {}
    ai_scan = claim.get("aiScanData") or {}
    defects = claim.get("inspection_defects") or []
    breakdown = cost_breakdown or claim.get("cost_breakdown") or {}
    currency = breakdown.get("currency") or claim.get("currency") or "AED"
    payout = breakdown.get("final_payout") or claim.get("final_amount") or claim.get("approvedAmount") or 0
    coverage = breakdown.get("coverage_percent", 80)

    report_no = claim.get("report_number") or _report_number(claim_id)
    location = _safe(claim.get("incidentLocation"))
    emirate = _safe(claim.get("emirate") or _infer_emirate(location))
    narrative = claim.get("description") or claim.get("accNarrative") or ""
    third_party = _safe(claim.get("thirdPartyInvolvement") or claim.get("third_party"), "No — single vehicle")
    severity = _severity_label(
        len(defects),
        any("windshield" in str(d).lower() or "glass" in str(d).lower() for d in defects),
    )

    make = _safe(mulkiya.get("make"))
    model = _safe(mulkiya.get("bodyType") or mulkiya.get("model"))
    year = _safe(mulkiya.get("year"))
    plate = _safe(claim.get("plate") or mulkiya.get("plateNumber"))
    vin = _safe(mulkiya.get("vin"))
    owner = _safe(claim.get("ownerName"))
    policy = _safe(claim.get("policyNo") or mulkiya.get("insurancePolicy"))
    insurer = _safe(claim.get("insuranceCompany") or mulkiya.get("insuranceCompany"))
    policy_ins = f"{policy}<br/>{insurer}" if policy != "—" or insurer != "—" else "—"

    liable_pct = "100% Liable" if "rear" in narrative.lower() or "yes" in third_party.lower() else "Under review"
    affected_pct = "0% Liable" if liable_pct == "100% Liable" else "—"

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=1.8 * cm,
        leftMargin=1.8 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
    )
    story: List[Any] = []

    story.append(_header_block(base))
    story.append(Spacer(1, 8))

    summary_rows = [
        ["Report Number", report_no, "Report Date", datetime.now().strftime("%B %d, %Y %H:%M")],
        ["Accident Location", location, "Emirate", emirate],
        ["Accident Severity", severity, "GPS Coordinates", _safe(claim.get("gps_coordinates"))],
        ["Authorized Estimate", _fmt_money(payout, currency), "Coverage", f"{coverage}%"],
        ["Claim ID", claim_id, "Workshop", _safe(claim.get("garageName"))],
    ]
    summary = _kv_table(summary_rows, COL_4, st)
    summary.setStyle(TableStyle([
        ("TEXTCOLOR", (1, 2), (1, 2), ORANGE),
        ("FONTNAME", (1, 2), (1, 2), "Helvetica-Bold"),
    ]))
    story.append(summary)
    story.append(Spacer(1, 10))

    story.append(_section_bar("1. Incident Context & Conditions", st))
    story.append(_kv_table([
        ["Time of Incident", _safe(claim.get("incidentTime") or claim.get("incidentDate")), "Road Type", _safe(claim.get("roadConditions"), "Normal traffic — dry road")],
        ["Weather Condition", _safe(claim.get("weather"), "Clear / dry"), "Lighting", _safe(claim.get("lighting"), "Full artificial streetlight")],
    ], COL_4, st))
    story.append(Spacer(1, 6))
    circ = (narrative or "Incident reported via AutoVault owner self-report.").split("--- Incident details ---")[0].strip()
    story.append(Paragraph("<b>Brief Description of Circumstances</b>", st["body"]))
    story.append(Paragraph(_esc(circ).replace("\n", "<br/>"), st["body"]))
    story.append(Spacer(1, 8))

    story.append(_section_bar("2. Vehicle 1 (Reporting / Liable Party)", st))
    v1 = _kv_table([
        ["Plate Number", plate, "Vehicle Responsibility", liable_pct],
        ["Make & Model", f"{make} {model} ({year})".strip(), "Policy / Insurer", policy_ins],
        ["Chassis Number (VIN)", vin, "Mulkiya Expiry", _safe(mulkiya.get("registrationExpiry"))],
        ["Driver / Owner", owner, "Garage Assigned", _safe(claim.get("garageName"))],
    ], COL_4, st)
    v1.setStyle(TableStyle([
        ("TEXTCOLOR", (1, 0), (1, 0), ORANGE),
        ("FONTNAME", (1, 0), (1, 0), "Helvetica-Bold"),
    ]))
    story.append(v1)
    story.append(Spacer(1, 4))
    story.append(Paragraph("<b>Identified Damage Areas</b>", st["body"]))
    story.append(Paragraph(_esc(_damage_summary(defects, ai_scan)), st["damage"]))

    if "yes" in third_party.lower():
        story.append(Spacer(1, 8))
        story.append(_section_bar("3. Vehicle 2 (Affected Party)", st))
        story.append(_kv_table([
            ["Plate Number", "Pending verification", "Vehicle Responsibility", affected_pct],
            ["Make & Model", "Third party — details pending", "Notes", third_party],
        ], COL_4, st))

    story.append(Spacer(1, 14))
    sig_style = ParagraphStyle("sig", parent=st["value"], fontSize=8, leading=11)
    sig = Table(
        [
            [
                Paragraph("First Party Signature<br/><font size='7'>التوقيع الطرف الأول (المتسبب)</font>", sig_style),
                Paragraph("Second Party Signature<br/><font size='7'>التوقيع الطرف الثاني (المتضرر)</font>", sig_style),
            ],
            [
                Paragraph("AUTOVAULT Verification Authority<br/><font size='7'>اعتماد سلطة النظام الموحد</font>", sig_style),
                "",
            ],
        ],
        colWidths=[CONTENT_W / 2, CONTENT_W / 2],
    )
    sig.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("SPAN", (0, 1), (1, 1)),
        ("TOPPADDING", (0, 0), (-1, -1), 22),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(sig)

    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "<i>AUTOVAULT AI Platform · Traffic Systems Integration · "
        "Generated for insurer and workshop adjudication.</i>",
        ParagraphStyle("foot", parent=base["Normal"], fontSize=7.5, textColor=MUTED, alignment=TA_CENTER),
    ))

    doc.build(story)

    return {
        "report_number": report_no,
        "final_payout": payout,
        "currency": currency,
        "severity": severity,
    }
