from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from datetime import datetime
import json
import os

GROQ_API_KEY = "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"
GROQ_MODEL   = "llama-3.3-70b-versatile"
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"


# ─────────────────────────────────────────────────────────────────────────────
# Groq helper
# ─────────────────────────────────────────────────────────────────────────────
def call_groq(prompt: str) -> str:
    try:
        import urllib.request
        payload = json.dumps({
            "model": GROQ_MODEL,
            "messages": [
                {"role": "system", "content": "You are a professional automotive service advisor writing concise garage service reports."},
                {"role": "user",   "content": prompt}
            ],
            "max_tokens": 1000,
            "temperature": 0.3
        }).encode("utf-8")
        req = urllib.request.Request(
            GROQ_URL,
            data=payload,
            headers={
                "Content-Type":  "application/json",
                "Authorization": f"Bearer {GROQ_API_KEY}"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"[Groq garage_report] call failed: {e}")
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# Style helpers
# ─────────────────────────────────────────────────────────────────────────────
def _header_style(styles):
    return ParagraphStyle(
        "GarageHeader",
        parent=styles["Normal"],
        fontSize=22,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#0f2a4a"),
        alignment=1,
        spaceAfter=4
    )

def _sub_style(styles):
    return ParagraphStyle(
        "GarageSub",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.grey,
        alignment=1,
        spaceAfter=20
    )

def _section_title(styles, color="#0f2a4a"):
    return ParagraphStyle(
        "SectionTitle",
        parent=styles["Normal"],
        fontSize=12,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor(color),
        spaceBefore=14,
        spaceAfter=6
    )

def _body(styles):
    return ParagraphStyle(
        "Body",
        parent=styles["Normal"],
        fontSize=10,
        leading=15,
        textColor=colors.HexColor("#1e293b")
    )

def _mono(styles):
    return ParagraphStyle(
        "Mono",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#374151"),
        fontName="Courier",
        leading=13
    )


# ─────────────────────────────────────────────────────────────────────────────
# Status badge table cell
# ─────────────────────────────────────────────────────────────────────────────
def _status_color(status: str):
    return {
        "done":        ("#166534", "#dcfce7"),
        "in_progress": ("#5b21b6", "#ede9fe"),
        "pending":     ("#92400e", "#fef3c7"),
        "replaced":    ("#1e40af", "#dbeafe"),
        "inspected":   ("#065f46", "#d1fae5"),
        "repaired":    ("#166534", "#dcfce7"),
        "not_required":("#374151", "#f3f4f6"),
    }.get(status.lower().replace(" ", "_"), ("#374151", "#f3f4f6"))


# ─────────────────────────────────────────────────────────────────────────────
# AI service summary
# ─────────────────────────────────────────────────────────────────────────────
def _generate_service_summary(
    vehicle_info: dict,
    services_completed: list,
    defects_from_ai: list,
    appointment: dict,
    insurance_approved: bool,
    approved_amount: str
) -> str:
    make    = vehicle_info.get("make",    "Unknown")
    model   = vehicle_info.get("model",   "Unknown")
    year    = vehicle_info.get("year",    "Unknown")
    garage  = appointment.get("garage",   "Service Centre")
    svc_type = appointment.get("service", "General Service")

    svc_lines = "\n".join(
        f"  - {s.get('task','Unknown')} — {s.get('status','done')} | Parts: {s.get('parts','N/A')} | Cost: AED {s.get('cost','—')}"
        for s in services_completed
    ) or "  - General inspection and maintenance performed"

    ai_lines = "\n".join(
        f"  - {d[0]} at {d[1]:.1f}% confidence"
        for d in defects_from_ai
    ) or "  - No defects detected in AI scan"

    ins_line = f"Insurance approved: AED {approved_amount}" if insurance_approved and approved_amount else "Self-pay / insurance not involved"

    prompt = f"""Write a 3-sentence professional garage service completion summary for:

Vehicle: {year} {make} {model}
Garage: {garage}
Service Type: {svc_type}
{ins_line}

Services completed:
{svc_lines}

AI-detected defects addressed:
{ai_lines}

Be specific about what was done. End with a recommendation for next service interval."""

    result = call_groq(prompt)
    if not result:
        parts = [s.get('task', '') for s in services_completed]
        return (f"Service completed on {year} {make} {model} at {garage}. "
                f"The following work was carried out: {', '.join(parts) if parts else 'general maintenance'}. "
                f"Vehicle is now roadworthy. Schedule next service in 10,000 km or 6 months.")
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Main garage report generator
# ─────────────────────────────────────────────────────────────────────────────
def generate_garage_service_report(
    appointment: dict,
    vehicle_info: dict,
    services_completed: list,
    defects_from_ai: list,
    output_path: str,
    insurance_approved: bool = False,
    approved_amount: str = "",
    technician_name: str = "",
    technician_notes: str = ""
):
    """
    appointment        : dict with keys: garage, garageAddress, service, date, time,
                         ownerName, ownerEmail, vehicle, notes, status
    vehicle_info       : dict with keys: make, model, year, vin, mileage, color, plateNumber
    services_completed : list of dicts — each has: task, status, parts, cost, technician_note
    defects_from_ai    : list of [label, confidence] pairs from AI inspection
    output_path        : where to write the PDF
    """

    doc    = SimpleDocTemplate(
        output_path, pagesize=A4,
        rightMargin=2*cm, leftMargin=2*cm,
        topMargin=2*cm,   bottomMargin=2*cm
    )
    styles = getSampleStyleSheet()
    story  = []

    # ── Header ────────────────────────────────────────────────────────────────
    story.append(Paragraph("GARAGE SERVICE COMPLETION REPORT", _header_style(styles)))
    story.append(Paragraph(
        f"MEHRA Platform · {datetime.now().strftime('%B %d, %Y at %H:%M')}",
        _sub_style(styles)
    ))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#0f2a4a")))
    story.append(Spacer(1, 14))

    # ── Garage & Appointment Info ─────────────────────────────────────────────
    garage_name    = appointment.get("garage",        "Service Centre")
    garage_address = appointment.get("garageAddress", "UAE")
    appt_date      = appointment.get("date",          "—")
    appt_time      = appointment.get("time",          "—")
    service_type   = appointment.get("service",       "General Service")
    owner_name     = appointment.get("ownerName",     "—")
    owner_email    = appointment.get("ownerEmail",    "—")

    story.append(Paragraph("Garage & Appointment Details", _section_title(styles, "#0f2a4a")))
    garage_table = Table(
        [
            ["Garage",         garage_name,    "Service Type", service_type],
            ["Address",        garage_address, "Date",         appt_date],
            ["Owner",          owner_name,     "Time",         appt_time],
            ["Owner Email",    owner_email,    "Technician",   technician_name or "—"],
        ],
        colWidths=[4*cm, 6.5*cm, 4*cm, 4.5*cm]
    )
    garage_table.setStyle(TableStyle([
        ('GRID',          (0, 0), (-1, -1), 0.7, colors.HexColor("#e2e8f0")),
        ('BACKGROUND',    (0, 0), (0,  -1), colors.HexColor("#f1f5f9")),
        ('BACKGROUND',    (2, 0), (2,  -1), colors.HexColor("#f1f5f9")),
        ('FONTNAME',      (0, 0), (0,  -1), 'Helvetica-Bold'),
        ('FONTNAME',      (2, 0), (2,  -1), 'Helvetica-Bold'),
        ('FONTSIZE',      (0, 0), (-1, -1), 9.5),
        ('LEFTPADDING',   (0, 0), (-1, -1), 8),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 8),
        ('TOPPADDING',    (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(garage_table)
    story.append(Spacer(1, 16))

    # ── Vehicle Info ──────────────────────────────────────────────────────────
    story.append(Paragraph("Vehicle Information", _section_title(styles, "#0f2a4a")))
    make    = vehicle_info.get("make",        "—")
    model   = vehicle_info.get("model",       "—")
    year    = vehicle_info.get("year",        "—")
    vin     = vehicle_info.get("vin",         "—")
    mileage = vehicle_info.get("mileage",     "—")
    color   = vehicle_info.get("color",       "—")
    plate   = vehicle_info.get("plateNumber", "—")

    veh_table = Table(
        [
            ["Make",    make,    "Model",   model],
            ["Year",    year,    "Color",   color],
            ["VIN",     vin,     "Plate",   plate],
            ["Mileage", mileage, "",        ""],
        ],
        colWidths=[3.5*cm, 6.5*cm, 3.5*cm, 5.5*cm]
    )
    veh_table.setStyle(TableStyle([
        ('GRID',          (0, 0), (-1, -1), 0.7, colors.HexColor("#e2e8f0")),
        ('BACKGROUND',    (0, 0), (0,  -1), colors.HexColor("#f8fafc")),
        ('BACKGROUND',    (2, 0), (2,  -1), colors.HexColor("#f8fafc")),
        ('FONTNAME',      (0, 0), (0,  -1), 'Helvetica-Bold'),
        ('FONTNAME',      (2, 0), (2,  -1), 'Helvetica-Bold'),
        ('FONTSIZE',      (0, 0), (-1, -1), 9.5),
        ('LEFTPADDING',   (0, 0), (-1, -1), 8),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 8),
        ('TOPPADDING',    (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(veh_table)
    story.append(Spacer(1, 16))

    # ── Insurance Section ─────────────────────────────────────────────────────
    if insurance_approved:
        story.append(Paragraph("Insurance Authorization", _section_title(styles, "#166534")))
        ins_table = Table(
            [["Status",          "✅ APPROVED",       "Authorized Amount", f"AED {approved_amount or '—'}"],
             ["Claim Reference",  appointment.get("id", "—"), "Insurer", appointment.get("insuranceCompany", "—")]],
            colWidths=[4*cm, 5.5*cm, 4*cm, 5.5*cm]
        )
        ins_table.setStyle(TableStyle([
            ('GRID',          (0, 0), (-1, -1), 0.7, colors.HexColor("#bbf7d0")),
            ('BACKGROUND',    (0, 0), (-1,  0), colors.HexColor("#dcfce7")),
            ('BACKGROUND',    (0, 1), (-1,  1), colors.HexColor("#f0fdf4")),
            ('FONTNAME',      (0, 0), (0,  -1), 'Helvetica-Bold'),
            ('FONTNAME',      (2, 0), (2,  -1), 'Helvetica-Bold'),
            ('FONTSIZE',      (0, 0), (-1, -1), 9.5),
            ('LEFTPADDING',   (0, 0), (-1, -1), 8),
            ('TOPPADDING',    (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(ins_table)
        story.append(Spacer(1, 16))

    # ── AI Inspection Findings ────────────────────────────────────────────────
    if defects_from_ai:
        story.append(Paragraph("AI Inspection Findings (Pre-Service)", _section_title(styles, "#1e3a8a")))
        ai_data = [["Component", "Defect Type", "Confidence", "Severity"]]
        for d in defects_from_ai:
            label = d[0] if isinstance(d, (list, tuple)) else d.get("label", "Unknown")
            conf  = float(d[1]) if isinstance(d, (list, tuple)) else float(d.get("confidence", 0))
            sev   = "Severe" if conf >= 80 else "Moderate" if conf >= 55 else "Minor"
            sev_color = "#991b1b" if conf >= 80 else "#92400e" if conf >= 55 else "#166534"
            ai_data.append([
                Paragraph(f"<b>{label}</b>", styles["Normal"]),
                Paragraph(label + " Damage", styles["Normal"]),
                Paragraph(f"{conf:.1f}%", styles["Normal"]),
                Paragraph(f'<font color="{sev_color}"><b>{sev}</b></font>', styles["Normal"]),
            ])
        ai_table = Table(ai_data, colWidths=[4.5*cm, 5*cm, 3.5*cm, 6*cm])
        ai_table.setStyle(TableStyle([
            ('GRID',          (0, 0), (-1, -1), 0.7, colors.HexColor("#e2e8f0")),
            ('BACKGROUND',    (0, 0), (-1,  0), colors.HexColor("#dbeafe")),
            ('FONTNAME',      (0, 0), (-1,  0), 'Helvetica-Bold'),
            ('FONTSIZE',      (0, 0), (-1, -1), 9.5),
            ('LEFTPADDING',   (0, 0), (-1, -1), 8),
            ('TOPPADDING',    (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(ai_table)
        story.append(Spacer(1, 16))
    else:
        story.append(Paragraph("AI Inspection Findings", _section_title(styles, "#1e3a8a")))
        story.append(Paragraph("No AI inspection data available for this appointment.", _body(styles)))
        story.append(Spacer(1, 12))

    # ── Services Completed ────────────────────────────────────────────────────
    story.append(Paragraph("Services Completed", _section_title(styles, "#0f2a4a")))

    if not services_completed:
        story.append(Paragraph("No service items recorded.", _body(styles)))
    else:
        svc_data = [["#", "Task / Service", "Status", "Parts Used", "Cost (AED)"]]
        total_cost = 0
        for i, svc in enumerate(services_completed, 1):
            task   = svc.get("task",   "General Service")
            status = svc.get("status", "done")
            parts  = svc.get("parts",  "—")
            cost   = svc.get("cost",   "—")
            note   = svc.get("technician_note", "")

            try:    total_cost += float(str(cost).replace(",", ""))
            except: pass

            fg, bg = _status_color(status)
            svc_data.append([
                Paragraph(str(i), styles["Normal"]),
                Paragraph(f"<b>{task}</b>" + (f"<br/><font size='8' color='#6b7280'>{note}</font>" if note else ""), styles["Normal"]),
                Paragraph(f'<font color="{fg}"><b>{status.upper().replace("_"," ")}</b></font>', styles["Normal"]),
                Paragraph(parts, styles["Normal"]),
                Paragraph(str(cost), styles["Normal"]),
            ])

        # Total row
        svc_data.append([
            Paragraph("", styles["Normal"]),
            Paragraph("<b>TOTAL</b>", styles["Normal"]),
            Paragraph("", styles["Normal"]),
            Paragraph("", styles["Normal"]),
            Paragraph(f"<b>AED {total_cost:,.0f}</b>" if total_cost else "<b>—</b>", styles["Normal"]),
        ])

        svc_table = Table(svc_data, colWidths=[1*cm, 7*cm, 3*cm, 4*cm, 4*cm])
        svc_table.setStyle(TableStyle([
            ('GRID',          (0, 0), (-1, -2), 0.7, colors.HexColor("#e2e8f0")),
            ('BACKGROUND',    (0, 0), (-1,  0), colors.HexColor("#f1f5f9")),
            ('FONTNAME',      (0, 0), (-1,  0), 'Helvetica-Bold'),
            ('FONTSIZE',      (0, 0), (-1, -1), 9.5),
            ('LEFTPADDING',   (0, 0), (-1, -1), 8),
            ('TOPPADDING',    (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
            ('LINEABOVE',     (0, -1), (-1, -1), 1.5, colors.HexColor("#0f2a4a")),
            ('BACKGROUND',    (0, -1), (-1, -1), colors.HexColor("#f8fafc")),
        ]))
        story.append(svc_table)

    story.append(Spacer(1, 16))

    # ── Technician Notes ──────────────────────────────────────────────────────
    if technician_notes:
        story.append(Paragraph("Technician Notes", _section_title(styles, "#0f2a4a")))
        story.append(Paragraph(technician_notes, ParagraphStyle(
            "TechNote", parent=styles["Normal"],
            fontSize=10, leading=15, leftIndent=10,
            backColor=colors.HexColor("#f8fafc"),
            textColor=colors.HexColor("#374151")
        )))
        story.append(Spacer(1, 14))

    # ── AI Service Summary ────────────────────────────────────────────────────
    story.append(Paragraph("Service Summary", _section_title(styles, "#0f2a4a")))
    summary = _generate_service_summary(
        vehicle_info, services_completed, defects_from_ai,
        appointment, insurance_approved, approved_amount
    )
    story.append(Paragraph(summary, ParagraphStyle(
        "Summary", parent=styles["Normal"],
        fontSize=10.5, leading=16, leftIndent=10, rightIndent=10,
        spaceBefore=4, spaceAfter=4,
        backColor=colors.HexColor("#f0f9ff"),
        textColor=colors.HexColor("#1e3a5f")
    )))
    story.append(Spacer(1, 20))

    # ── Signature Block ───────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.8, color=colors.HexColor("#e2e8f0")))
    story.append(Spacer(1, 12))
    sig_table = Table(
        [["Technician Signature", "Customer Acknowledgement", "Garage Stamp"],
         ["\n\n_____________________", "\n\n_____________________", "\n\n_____________________"],
         [technician_name or "Name: ____________", "Name: ____________", garage_name]],
        colWidths=[6*cm, 6*cm, 7*cm]
    )
    sig_table.setStyle(TableStyle([
        ('ALIGN',         (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME',      (0, 0), (-1,  0), 'Helvetica-Bold'),
        ('FONTSIZE',      (0, 0), (-1,  0), 9),
        ('FONTSIZE',      (0, 1), (-1, -1), 9),
        ('TEXTCOLOR',     (0, 0), (-1,  0), colors.HexColor("#374151")),
        ('TOPPADDING',    (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(sig_table)
    story.append(Spacer(1, 16))

    # ── Disclaimer ────────────────────────────────────────────────────────────
    story.append(Paragraph(
        "<i>This report was generated by MEHRA Platform. "
        "All service items were performed by certified technicians at the registered garage. "
        "AI inspection data is advisory and confirmed by physical inspection on-site.</i>",
        ParagraphStyle("Disc", parent=styles["Normal"],
                       fontSize=8.5, textColor=colors.grey, alignment=1)
    ))

    doc.build(story)
