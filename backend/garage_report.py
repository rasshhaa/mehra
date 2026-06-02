"""
AUTOVAULT — Routine Garage Service Report
=========================================

Generates a post-service PDF for routine (non-accident) garage completions:
service type, parts replaced, technician sign-off, and total cost.

The function exposed here is `generate_garage_service_report(...)` which is
called by `main.py`. Depends only on `reportlab`.
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
    KeepTogether,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors


# ── Theme — blue routine-service palette (distinct from accident red) ─────────
ACCENT_PRIMARY   = colors.HexColor("#1d4ed8")
ACCENT_SECONDARY = colors.HexColor("#0f172a")
ACCENT_OK        = colors.HexColor("#15803d")
ACCENT_TEXT      = colors.HexColor("#1f2937")
ACCENT_MUTED     = colors.HexColor("#6b7280")
ACCENT_SOFT      = colors.HexColor("#eff6ff")
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


def _format_currency(amount, currency="AED"):
    try:
        f = float(re.sub(r"[^0-9.\-]", "", str(amount)))
    except (TypeError, ValueError):
        return f"{currency} —"
    return f"{currency} {f:,.2f}"


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


def _kv_pair(label_text, value_text, styles):
    return [_label(label_text.upper(), styles), _value(value_text, styles)]


def _resolve_fields(
    *,
    vehicle_plate="",
    service_type="",
    parts_replaced=None,
    technician_name="",
    total_cost="",
    date_completed="",
    garage_name="",
    appointment=None,
    vehicle_info=None,
    services_completed=None,
    technician_notes="",
):
    """Merge explicit fields with legacy appointment / services payloads."""
    appointment = appointment or {}
    vehicle_info = vehicle_info or {}
    services_completed = services_completed or []
    parts_replaced = parts_replaced or []

    plate = (
        vehicle_plate
        or vehicle_info.get("plateNumber")
        or vehicle_info.get("plate")
        or appointment.get("vehiclePlate")
        or appointment.get("plate")
        or ""
    )
    svc_type = (
        service_type
        or appointment.get("service")
        or appointment.get("serviceType")
        or appointment.get("serviceLabel")
        or "Routine Service"
    )
    garage = (
        garage_name
        or appointment.get("garage")
        or appointment.get("garageName")
        or ""
    )
    tech = technician_name or appointment.get("technicianName") or ""
    completed = (
        date_completed
        or appointment.get("doneAt")
        or datetime.now().strftime("%B %d, %Y")
    )

    if not parts_replaced and services_completed:
        for svc in services_completed:
            if isinstance(svc, dict):
                part = svc.get("parts") or svc.get("part") or svc.get("task") or ""
                if part:
                    parts_replaced.append(str(part))
            elif svc:
                parts_replaced.append(str(svc))

    if not total_cost:
        running = 0.0
        has_cost = False
        for svc in services_completed:
            if not isinstance(svc, dict):
                continue
            raw = svc.get("cost")
            if raw is None:
                continue
            try:
                running += float(re.sub(r"[^0-9.\-]", "", str(raw)))
                has_cost = True
            except (TypeError, ValueError):
                pass
        if has_cost:
            total_cost = running
        else:
            total_cost = appointment.get("totalCost") or appointment.get("cost") or ""

    return {
        "vehicle_plate": _safe(plate),
        "service_type": _safe(svc_type),
        "parts_replaced": [str(p).strip() for p in parts_replaced if str(p).strip()],
        "technician_name": _safe(tech),
        "total_cost": total_cost,
        "date_completed": _safe(completed),
        "garage_name": _safe(garage),
        "technician_notes": (technician_notes or "").strip(),
    }


def _section_header(styles, garage_name: str, date_completed: str):
    title = _h1("ROUTINE SERVICE · COMPLETION REPORT", styles)
    subtitle = Paragraph(
        f"<font color='#dbeafe'>{_safe(garage_name)} · Completed {_safe(date_completed)}</font>",
        ParagraphStyle(
            "HSub", parent=styles["Normal"], fontSize=10,
            textColor=colors.HexColor("#dbeafe"), leading=12,
        ),
    )
    brand = Paragraph(
        "<font color='#ffffff'><b>AUTOVAULT</b></font>"
        "<font color='#bfdbfe'>  ·  Vehicle Lifecycle Platform</font>",
        ParagraphStyle(
            "Brand", parent=styles["Normal"], fontSize=9,
            textColor=colors.HexColor("#bfdbfe"), spaceAfter=4,
        ),
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


def _section_summary(styles, fields: dict):
    rows = [
        [
            _label("VEHICLE PLATE", styles),
            _label("SERVICE TYPE", styles),
            _label("GARAGE", styles),
        ],
        [
            _value(fields["vehicle_plate"], styles),
            _value(fields["service_type"], styles),
            _value(fields["garage_name"], styles),
        ],
        [
            _label("TECHNICIAN", styles),
            _label("DATE COMPLETED", styles),
            _label("TOTAL COST", styles),
        ],
        [
            _value(fields["technician_name"], styles),
            _value(fields["date_completed"], styles),
            _value(_format_currency(fields["total_cost"]), styles),
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


def _section_parts(styles, parts_replaced: list):
    if not parts_replaced:
        return Paragraph(
            "<i>No replacement parts were logged for this service.</i>",
            ParagraphStyle(
                "EmptyParts", parent=styles["Normal"], fontSize=10,
                textColor=ACCENT_MUTED, leading=14, spaceAfter=8,
            ),
        )

    rows = [["#", "Part / Component Replaced"]]
    for i, part in enumerate(parts_replaced, 1):
        rows.append([
            _value(str(i), styles, bold=False),
            _value(_safe(part), styles, bold=False),
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
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t


def _section_signoff(styles, technician_name: str, technician_notes: str, garage_name: str):
    notes_para = Paragraph(
        _safe(technician_notes, "No additional notes from the technician."),
        ParagraphStyle(
            "Notes", parent=styles["Normal"], fontSize=10, leading=14,
            leftIndent=8, rightIndent=8, textColor=ACCENT_TEXT,
            backColor=ACCENT_PANEL, borderPadding=10,
        ),
    )
    sig_rows = [
        [_label("TECHNICIAN", styles), _label("CUSTOMER ACKNOWLEDGEMENT", styles)],
        [_value(_safe(technician_name), styles, bold=True), _value("__________________________", styles, bold=False)],
        [_value(_safe(garage_name), styles, bold=False), _value(_safe(datetime.now().strftime("%B %d, %Y")), styles, bold=False)],
    ]
    sigs = Table(sig_rows, colWidths=[8.5 * cm, 8.5 * cm])
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
        "<i>This Routine Service Completion Report documents maintenance and "
        "service work performed at the garage. It is not a roadworthiness "
        "certificate. Parts replaced are covered by the garage's standard "
        "workmanship warranty unless stated otherwise in the technician notes.</i>"
    )
    return Paragraph(
        text,
        ParagraphStyle(
            "Disclaimer", parent=styles["Normal"], fontSize=8.5,
            textColor=ACCENT_MUTED, alignment=0, leading=12, spaceBefore=14,
        ),
    )


def generate_garage_service_report(
    *,
    output_path: str,
    vehicle_plate: str = "",
    service_type: str = "",
    parts_replaced: list | None = None,
    technician_name: str = "",
    total_cost="",
    date_completed: str = "",
    garage_name: str = "",
    appointment: dict | None = None,
    vehicle_info: dict | None = None,
    services_completed: list | None = None,
    defects_from_ai: list | None = None,
    insurance_approved: bool = False,
    approved_amount: str = "",
    technician_notes: str = "",
):
    """Build and write the routine garage service PDF to ``output_path``."""
    del defects_from_ai, insurance_approved, approved_amount  # legacy compat only

    fields = _resolve_fields(
        vehicle_plate=vehicle_plate,
        service_type=service_type,
        parts_replaced=parts_replaced,
        technician_name=technician_name,
        total_cost=total_cost,
        date_completed=date_completed,
        garage_name=garage_name,
        appointment=appointment,
        vehicle_info=vehicle_info,
        services_completed=services_completed,
        technician_notes=technician_notes,
    )

    doc = SimpleDocTemplate(
        output_path, pagesize=A4,
        rightMargin=2 * cm, leftMargin=2 * cm,
        topMargin=1.6 * cm, bottomMargin=1.8 * cm,
    )
    styles = getSampleStyleSheet()
    story = []

    story.append(_section_header(styles, fields["garage_name"], fields["date_completed"]))
    story.append(Spacer(1, 14))
    story.append(_section_summary(styles, fields))

    story.append(_h2("1 · Parts Replaced", styles))
    story.append(_section_parts(styles, fields["parts_replaced"]))

    story.append(_h2("2 · Technician Notes & Sign-Off", styles))
    for el in _section_signoff(
        styles, fields["technician_name"], fields["technician_notes"], fields["garage_name"],
    ):
        story.append(el)

    story.append(_section_disclaimer(styles))

    try:
        doc.build(story)
    except Exception as e:
        raise RuntimeError(f"Failed to build garage service PDF: {e}") from e

    return {
        "vehicle_plate": fields["vehicle_plate"],
        "service_type": fields["service_type"],
        "parts_count": len(fields["parts_replaced"]),
        "total_cost": _format_currency(fields["total_cost"]),
    }
