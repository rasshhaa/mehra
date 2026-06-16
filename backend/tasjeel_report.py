"""
Tasjeel — Official Vehicle Testing Certificate (PDF)
====================================================
UAE Tasjeel-style inspection result with AI pre-inspection efficiency score.
"""

from __future__ import annotations

from datetime import datetime
import os

from reportlab.lib.pagesizes import A4
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors


TASJEEL_GREEN = colors.HexColor("#0c7d5e")
TASJEEL_DARK = colors.HexColor("#064e3b")
TASJEEL_GOLD = colors.HexColor("#b8860b")
ACCENT_TEXT = colors.HexColor("#1f2937")
ACCENT_MUTED = colors.HexColor("#6b7280")
ACCENT_BORDER = colors.HexColor("#d1d5db")
ACCENT_PANEL = colors.HexColor("#f0fdf4")

CHECK_LABELS = {
    "brake_system": "Brake System",
    "tyres": "Tyres & Wheels",
    "lights_signals": "Lights & Signals",
    "steering_suspension": "Steering & Suspension",
    "body_chassis": "Body & Chassis",
    "glass_mirrors": "Glass & Mirrors",
    "emissions": "Emissions / Exhaust",
    "documents": "Documents & Registration",
    "engine": "Engine & Transmission",
    "seatbelts": "Seat Belts & Interior",
}


def _safe(value, fallback="—"):
    if value is None:
        return fallback
    s = str(value).strip()
    return s if s else fallback


def _xml_safe(value, fallback=""):
    """Escape text for ReportLab Paragraph markup."""
    s = _safe(value, fallback)
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _truncate(value, max_len=480, fallback=""):
    s = _safe(value, fallback)
    if len(s) <= max_len:
        return s
    return s[: max_len - 3].rstrip() + "..."


def _result_color(status: str):
    s = str(status or "").lower()
    if s in ("passed", "pass"):
        return colors.HexColor("#15803d")
    if s in ("conditional", "conditional pass"):
        return colors.HexColor("#b45309")
    return colors.HexColor("#dc2626")


def _header_block(centre_name: str, styles):
    title = ParagraphStyle(
        "TjTitle", parent=styles["Title"], fontSize=18, textColor=colors.white, leading=22,
    )
    sub = ParagraphStyle(
        "TjSub", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#d1fae5"), leading=12,
    )
    band = Table(
        [[
            Paragraph("<b>🇦🇪 TASJEEL</b><br/>Vehicle Testing &amp; Registration", title),
            Paragraph(
                f"<b>{_safe(centre_name, 'Authorized Inspection Centre')}</b><br/>"
                "United Arab Emirates · Official Test Certificate",
                sub,
            ),
        ]],
        colWidths=[9 * cm, 9 * cm],
    )
    band.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), TASJEEL_GREEN),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]))
    return band


def generate_tasjeel_inspection_report(
    output_path: str,
    *,
    plate: str = "",
    vin: str = "",
    vehicle: str = "",
    centre: str = "",
    owner_name: str = "",
    inspector_name: str = "",
    inspection_date: str = "",
    result_status: str = "passed",
    defects_found: list | None = None,
    inspector_notes: str = "",
    pre_inspection: dict | None = None,
    sustainability: dict | None = None,
    certificate_no: str = "",
) -> dict:
    """Build Tasjeel official-style PDF; returns summary metadata."""
    defects = list(defects_found or [])
    pre = pre_inspection or {}
    sus = sustainability or {}
    status = str(result_status or "passed").lower()
    rc = _result_color(status)
    cert = certificate_no or f"TJL-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    date_str = inspection_date or datetime.utcnow().strftime("%d %B %Y")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    doc = SimpleDocTemplate(
        output_path, pagesize=A4,
        rightMargin=1.8 * cm, leftMargin=1.8 * cm,
        topMargin=1.4 * cm, bottomMargin=1.6 * cm,
    )
    styles = getSampleStyleSheet()
    body = ParagraphStyle("Body", parent=styles["Normal"], fontSize=9, textColor=ACCENT_TEXT, leading=13)
    muted = ParagraphStyle("Muted", parent=body, fontSize=8, textColor=ACCENT_MUTED, leading=11)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=11, textColor=TASJEEL_DARK, spaceBefore=10, spaceAfter=6)

    story = [ _header_block(centre, styles), Spacer(1, 10) ]

    result_label = status.upper().replace("_", " ")
    res_hex = "#15803d" if status in ("passed", "pass") else ("#b45309" if status == "conditional" else "#dc2626")
    result_band = Table(
        [[Paragraph(
            f'<font color="{res_hex}"><b>OFFICIAL RESULT: {result_label}</b></font>',
            ParagraphStyle("Res", parent=body, fontSize=14, alignment=1),
        )]],
        colWidths=[17.4 * cm],
    )
    result_band.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), ACCENT_PANEL),
        ("BOX", (0, 0), (-1, -1), 1, TASJEEL_GREEN),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    story += [ result_band, Spacer(1, 8) ]

    info_rows = [
        ["Certificate No.", cert, "Inspection Date", date_str],
        ["Plate Number", _safe(plate), "VIN / Chassis", _safe(vin)],
        ["Vehicle", _safe(vehicle), "Owner", _safe(owner_name)],
        ["Test Centre", _safe(centre), "Inspector", _safe(inspector_name)],
    ]
    info_t = Table(info_rows, colWidths=[3.8 * cm, 5 * cm, 3.8 * cm, 5 * cm])
    info_t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("TEXTCOLOR", (0, 0), (0, -1), ACCENT_MUTED),
        ("TEXTCOLOR", (2, 0), (2, -1), ACCENT_MUTED),
        ("TEXTCOLOR", (1, 0), (1, -1), ACCENT_TEXT),
        ("TEXTCOLOR", (3, 0), (3, -1), ACCENT_TEXT),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fafafa")),
        ("BOX", (0, 0), (-1, -1), 0.5, ACCENT_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, ACCENT_BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story += [ info_t, Spacer(1, 10) ]

    story.append(Paragraph("<b>1 · Vehicle Testing Checklist</b>", h2))
    all_keys = list(CHECK_LABELS.keys())
    defect_set = set(defects)
    check_rows = [["Test Category", "Result", "Remarks"]]
    for key in all_keys:
        failed = key in defect_set
        check_rows.append([
            CHECK_LABELS[key],
            "FAIL" if failed else "PASS",
            "Defect recorded" if failed else "Within specification",
        ])
    check_t = Table(check_rows, colWidths=[7 * cm, 3 * cm, 7.4 * cm])
    check_style = [
        ("BACKGROUND", (0, 0), (-1, 0), TASJEEL_GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("BOX", (0, 0), (-1, -1), 0.5, ACCENT_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, ACCENT_BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]
    for i, key in enumerate(all_keys, start=1):
        if key in defect_set:
            check_style.append(("TEXTCOLOR", (1, i), (1, i), colors.HexColor("#dc2626")))
            check_style.append(("FONTNAME", (1, i), (1, i), "Helvetica-Bold"))
    check_t.setStyle(TableStyle(check_style))
    story += [ check_t, Spacer(1, 8) ]

    if inspector_notes:
        story.append(Paragraph("<b>2 · Inspector Notes</b>", h2))
        story.append(Paragraph(_xml_safe(_truncate(inspector_notes, 1200)), body))
        story.append(Spacer(1, 6))

    ai_score = pre.get("readiness_score")
    ai_likelihood = pre.get("pass_likelihood")
    eff_score = sus.get("sustainability_score")
    if pre or sus:
        story.append(Paragraph("<b>3 · AI Pre-Inspection vs Official Tasjeel Test</b>", h2))
        focus_txt = _truncate(", ".join(pre.get("tasjeel_focus_areas") or []) or "None flagged", 220)
        defect_txt = _truncate(", ".join(CHECK_LABELS.get(d, d) for d in defects) or "None", 220)
        comp_rows = [
            ["", "AutoVault AI (Pre-Test)", "Official Tasjeel"],
            ["Readiness / Result", f"{ai_score}/100 · {_safe(ai_likelihood)}" if ai_score else "—", result_label],
            [
                "Focus / Defects",
                Paragraph(_xml_safe(focus_txt), body),
                Paragraph(_xml_safe(defect_txt), body),
            ],
        ]
        comp_t = Table(comp_rows, colWidths=[4.5 * cm, 6.5 * cm, 6.4 * cm])
        comp_t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), TASJEEL_DARK),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("BOX", (0, 0), (-1, -1), 0.5, ACCENT_BORDER),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, ACCENT_BORDER),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ]))
        story += [ comp_t, Spacer(1, 8) ]

        if sus:
            eff = eff_score if eff_score is not None else "—"
            savings = sus.get("estimated_savings_aed", 0)
            summary = _xml_safe(_truncate(sus.get("summary"), 700))
            retest_note = " · Re-test avoided" if sus.get("retest_avoided") else ""
            eff_rows = [
                [Paragraph(
                    f'<font color="#0c7d5e"><b>OWNER EFFICIENCY SCORE: {eff}/100</b></font>',
                    ParagraphStyle("Eff", parent=body, fontSize=12, alignment=1),
                )],
                [Paragraph(summary or "AI pre-inspection compared with Tasjeel outcome.", muted)],
                [Paragraph(
                    f"Estimated savings from AI pre-inspection before Tasjeel: <b>AED {savings}</b>{retest_note}",
                    body,
                )],
            ]
            eff_panel = Table(eff_rows, colWidths=[17.4 * cm])
            eff_panel.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ecfdf5")),
                ("BOX", (0, 0), (-1, -1), 1, TASJEEL_GREEN),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]))
            story += [eff_panel]

    story += [
        Spacer(1, 14),
        Paragraph(
            "This certificate is issued by an authorized Tasjeel inspection centre under UAE federal "
            "vehicle testing regulations. Re-test within 30 days at the same centre if failed (AED 50 re-test fee applies). "
            "AI pre-inspection efficiency score is computed by Groq explainability comparing AutoVault AI assessment with this official result.",
            ParagraphStyle("Disc", parent=muted, fontSize=7, leading=10),
        ),
    ]

    doc.build(story)
    return {
        "certificate_no": cert,
        "plate": plate,
        "status": status,
        "defects_count": len(defects),
        "efficiency_score": eff_score,
    }
