from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from datetime import datetime
import json

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
                {
                    "role": "system",
                    "content": "You are a professional automotive historian writing detailed vehicle life reports."
                },
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 1200,
            "temperature": 0.35
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
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"[Groq carlife_report] call failed: {e}")
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# Health score helpers
# ─────────────────────────────────────────────────────────────────────────────
def _compute_health_score(
    total_inspections: int,
    passed: int,
    total_defects: int,
    knock_count: int,
    accident_count: int
) -> int:
    score = 100
    if total_inspections > 0:
        fail_rate = (total_inspections - passed) / total_inspections
        score -= fail_rate * 25
    score -= min(total_defects * 4, 30)
    score -= min(knock_count * 15, 30)
    score -= min(accident_count * 10, 20)
    return max(5, min(100, round(score)))


def _score_label(score: int) -> str:
    if score >= 85: return "Excellent"
    if score >= 70: return "Good"
    if score >= 50: return "Fair"
    if score >= 30: return "Poor"
    return "Critical"


def _score_color(score: int) -> str:
    if score >= 75: return "#166534"
    if score >= 50: return "#92400e"
    return "#991b1b"


def _score_bg(score: int) -> str:
    if score >= 75: return "#dcfce7"
    if score >= 50: return "#fef3c7"
    return "#fee2e2"


# ─────────────────────────────────────────────────────────────────────────────
# AI narrative generator
# ─────────────────────────────────────────────────────────────────────────────
def _generate_narrative(
    vehicle_info: dict,
    stats: dict,
    inspections: list,
    services: list,
    appointments: list,
    health_score: int
) -> str:
    make    = vehicle_info.get("make",    "Unknown")
    model   = vehicle_info.get("model",   "Unknown")
    year    = vehicle_info.get("year",    "Unknown")
    plate   = vehicle_info.get("plateNumber", "—")
    vin     = vehicle_info.get("vin",     "—")

    total   = stats.get("total_inspections", 0)
    passed  = stats.get("passed", 0)
    defects = stats.get("total_defects", 0)
    knock   = stats.get("knock_count", 0)
    accs    = stats.get("accident_count", 0)
    appts   = stats.get("appointment_count", 0)

    prompt = f"""Write a 4-sentence professional Car Life Report narrative for:

Vehicle: {year} {make} {model}
Plate: {plate} | VIN: {vin}
Health Score: {health_score}/100 ({_score_label(health_score)} condition)

Lifetime statistics:
- Total AI inspections: {total}
- Passed clean: {passed}
- Total defect instances: {defects}
- Engine knock occurrences: {knock}
- Accident repairs: {accs}
- Garage service appointments: {appts}

Write as a professional vehicle history report. Be specific about the vehicle condition,
highlight any risks, and give a clear recommendation for potential buyers or for the owner.
Do not use bullet points. Write in flowing professional prose."""

    result = call_groq(prompt)
    if not result:
        label = _score_label(health_score)
        return (
            f"This {year} {make} {model} (Plate: {plate}) has undergone {total} AI-powered inspections "
            f"through the MEHRA platform, with {passed} passing clean. "
            f"A total of {defects} defect instances were detected across all inspections"
            f"{', including ' + str(knock) + ' engine knock occurrence(s)' if knock else ''}. "
            f"The vehicle has a current health score of {health_score}/100, "
            f"indicating {label.lower()} overall condition."
        )
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Style helpers
# ─────────────────────────────────────────────────────────────────────────────
def _h1(styles, color="#0f2a4a"):
    return ParagraphStyle(
        "CLH1", parent=styles["Normal"],
        fontSize=22, fontName="Helvetica-Bold",
        textColor=colors.HexColor(color),
        alignment=1, spaceAfter=4
    )

def _h2(styles, color="#0f2a4a"):
    return ParagraphStyle(
        "CLH2", parent=styles["Normal"],
        fontSize=12, fontName="Helvetica-Bold",
        textColor=colors.HexColor(color),
        spaceBefore=16, spaceAfter=6
    )

def _body(styles):
    return ParagraphStyle(
        "CLBody", parent=styles["Normal"],
        fontSize=10, leading=15,
        textColor=colors.HexColor("#1e293b")
    )

def _small(styles):
    return ParagraphStyle(
        "CLSmall", parent=styles["Normal"],
        fontSize=8.5, textColor=colors.grey, alignment=1
    )

def _mono(styles):
    return ParagraphStyle(
        "CLMono", parent=styles["Normal"],
        fontSize=9, fontName="Courier",
        textColor=colors.HexColor("#374151"), leading=13
    )


# ─────────────────────────────────────────────────────────────────────────────
# Score ring table (visual health indicator)
# ─────────────────────────────────────────────────────────────────────────────
def _score_block(score: int, styles) -> Table:
    sc  = _score_color(score)
    bg  = _score_bg(score)
    lbl = _score_label(score)
    filled = round(score / 10)
    empty  = 10 - filled

    t = Table(
        [
            [Paragraph(
                f'<font color="{sc}"><b>{score}</b></font>'
                f'<font color="#94a3b8" size="14">/100</font>',
                ParagraphStyle("ScoreNum", parent=styles["Normal"],
                               fontSize=28, alignment=1)
            )],
            [Paragraph(
                f'<font color="{sc}">{"█" * filled}</font>'
                f'<font color="#e5e7eb">{"█" * empty}</font>',
                ParagraphStyle("ScoreBar", parent=styles["Normal"],
                               fontSize=20, alignment=1)
            )],
            [Paragraph(
                f'<font color="{sc}"><b>{lbl} Condition</b></font>',
                ParagraphStyle("ScoreLbl", parent=styles["Normal"],
                               fontSize=10, alignment=1)
            )],
            [Paragraph("Vehicle Health Score", _small(styles))],
        ],
        colWidths=[17 * cm]
    )
    t.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1, -1), colors.HexColor(bg)),
        ('BOX',           (0, 0), (-1, -1), 1.5, colors.HexColor(sc)),
        ('ALIGN',         (0, 0), (-1, -1), 'CENTER'),
        ('TOPPADDING',    (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('ROUNDEDCORNERS', [8]),
    ]))
    return t


# ─────────────────────────────────────────────────────────────────────────────
# Main car life report generator
# ─────────────────────────────────────────────────────────────────────────────
def generate_car_life_report(
    vehicle_info: dict,
    inspections: list,
    services: list,
    appointments: list,
    output_path: str,
    owner_name: str = ""
):
    """
    vehicle_info  : dict — make, model, year, vin, plateNumber, color, fuelType,
                           cylinders, grossWeight, registrationExpiry, insuranceExpiry,
                           insuranceCompany, insurancePolicy
    inspections   : list of dicts — each has: date, vehicle, status, defects (int),
                                              engineKnock (bool|None), serviceType
    services      : list of dicts — garage service records, same shape as inspections
                                    but with serviceType = 'service' or 'accident'
    appointments  : list of dicts — each has: garage, service, date, time, status
    output_path   : str — where to write the PDF
    owner_name    : str — optional owner display name
    """

    # ── Compute stats ─────────────────────────────────────────────────────────
    total_insp  = len(inspections)
    passed      = sum(1 for r in inspections if r.get("status") == "pass")
    total_def   = sum(int(r.get("defects", 0)) for r in inspections)
    knock_count = sum(1 for r in inspections if r.get("engineKnock") is True)
    acc_count   = sum(1 for r in services    if r.get("serviceType") == "accident")
    appt_count  = len(appointments)

    stats = {
        "total_inspections": total_insp,
        "passed":            passed,
        "total_defects":     total_def,
        "knock_count":       knock_count,
        "accident_count":    acc_count,
        "appointment_count": appt_count,
    }

    health_score = _compute_health_score(total_insp, passed, total_def, knock_count, acc_count)

    # ── Build PDF ─────────────────────────────────────────────────────────────
    doc    = SimpleDocTemplate(
        output_path, pagesize=A4,
        rightMargin=2*cm, leftMargin=2*cm,
        topMargin=2*cm,   bottomMargin=2*cm
    )
    styles = getSampleStyleSheet()
    story  = []

    # ── Cover header ──────────────────────────────────────────────────────────
    story.append(Paragraph("CAR LIFE REPORT", _h1(styles)))
    story.append(Paragraph(
        "MEHRA Platform · Official Vehicle History",
        ParagraphStyle("SubH", parent=styles["Normal"],
                       fontSize=9, textColor=colors.grey, alignment=1, spaceAfter=4)
    ))
    story.append(Paragraph(
        f"Generated: {datetime.now().strftime('%B %d, %Y at %H:%M')}",
        ParagraphStyle("SubH2", parent=styles["Normal"],
                       fontSize=9, textColor=colors.grey, alignment=1, spaceAfter=16)
    ))
    story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor("#0f2a4a")))
    story.append(Spacer(1, 14))

    # ── Vehicle + Owner identity block ────────────────────────────────────────
    make  = vehicle_info.get("make",        "—")
    model = vehicle_info.get("model",       vehicle_info.get("bodyType", "—"))
    year  = vehicle_info.get("year",        "—")
    vin   = vehicle_info.get("vin",         "—")
    plate = vehicle_info.get("plateNumber", "—")
    color = vehicle_info.get("color",       "—")
    fuel  = vehicle_info.get("fuelType",    "—")
    cyls  = vehicle_info.get("cylinders",   "—")
    reg_exp = vehicle_info.get("registrationExpiry", "—")
    ins_exp = vehicle_info.get("insuranceExpiry",    "—")
    ins_co  = vehicle_info.get("insuranceCompany",   "—")
    ins_pol = vehicle_info.get("insurancePolicy",    "—")

    story.append(Paragraph("Vehicle & Owner Details", _h2(styles)))
    id_table = Table(
        [
            ["Owner",         owner_name or "—",   "Plate Number",  plate],
            ["Make",          make,                 "VIN / Chassis", vin],
            ["Model / Body",  model,                "Year",          year],
            ["Color",         color,                "Fuel Type",     fuel],
            ["Cylinders",     cyls,                 "Reg. Expiry",   reg_exp],
            ["Insurance Co.", ins_co,               "Ins. Expiry",   ins_exp],
            ["Policy No.",    ins_pol,              "",              ""],
        ],
        colWidths=[3.8*cm, 6.2*cm, 3.8*cm, 5.2*cm]
    )
    id_table.setStyle(TableStyle([
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
    story.append(id_table)
    story.append(Spacer(1, 16))

    # ── Health score block ────────────────────────────────────────────────────
    story.append(_score_block(health_score, styles))
    story.append(Spacer(1, 16))

    # ── Lifetime statistics ───────────────────────────────────────────────────
    story.append(Paragraph("Lifetime Statistics", _h2(styles)))
    sc = _score_color(health_score)
    stat_table = Table(
        [
            [
                Paragraph(f'<font color="{sc}"><b>{total_insp}</b></font>', ParagraphStyle("SV", parent=styles["Normal"], fontSize=18, alignment=1)),
                Paragraph(f'<font color="#166534"><b>{passed}</b></font>',  ParagraphStyle("SV", parent=styles["Normal"], fontSize=18, alignment=1)),
                Paragraph(f'<font color="#92400e"><b>{total_insp - passed}</b></font>', ParagraphStyle("SV", parent=styles["Normal"], fontSize=18, alignment=1)),
                Paragraph(f'<font color="#991b1b"><b>{knock_count}</b></font>', ParagraphStyle("SV", parent=styles["Normal"], fontSize=18, alignment=1)),
                Paragraph(f'<font color="#7c3aed"><b>{acc_count}</b></font>',   ParagraphStyle("SV", parent=styles["Normal"], fontSize=18, alignment=1)),
                Paragraph(f'<font color="#0369a1"><b>{appt_count}</b></font>',  ParagraphStyle("SV", parent=styles["Normal"], fontSize=18, alignment=1)),
            ],
            [
                Paragraph("Total<br/>Inspections", ParagraphStyle("SL", parent=styles["Normal"], fontSize=8, alignment=1, textColor=colors.grey)),
                Paragraph("Passed<br/>Clean",      ParagraphStyle("SL", parent=styles["Normal"], fontSize=8, alignment=1, textColor=colors.grey)),
                Paragraph("Had<br/>Issues",        ParagraphStyle("SL", parent=styles["Normal"], fontSize=8, alignment=1, textColor=colors.grey)),
                Paragraph("Engine<br/>Knock",      ParagraphStyle("SL", parent=styles["Normal"], fontSize=8, alignment=1, textColor=colors.grey)),
                Paragraph("Accident<br/>Repairs",  ParagraphStyle("SL", parent=styles["Normal"], fontSize=8, alignment=1, textColor=colors.grey)),
                Paragraph("Garage<br/>Visits",     ParagraphStyle("SL", parent=styles["Normal"], fontSize=8, alignment=1, textColor=colors.grey)),
            ]
        ],
        colWidths=[2.83*cm] * 6
    )
    stat_table.setStyle(TableStyle([
        ('BOX',           (0, 0), (-1, -1), 1,   colors.HexColor("#e2e8f0")),
        ('LINEBEFORE',    (1, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('BACKGROUND',    (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ('ALIGN',         (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING',    (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
    ]))
    story.append(stat_table)
    story.append(Spacer(1, 16))

    # ── AI Narrative ──────────────────────────────────────────────────────────
    story.append(Paragraph("AI Vehicle History Assessment", _h2(styles)))
    narrative = _generate_narrative(
        vehicle_info, stats, inspections, services, appointments, health_score
    )
    story.append(Paragraph(narrative, ParagraphStyle(
        "Narrative", parent=styles["Normal"],
        fontSize=10.5, leading=17, leftIndent=10, rightIndent=10,
        spaceBefore=4, spaceAfter=4,
        backColor=colors.HexColor("#f0f9ff"),
        textColor=colors.HexColor("#1e3a5f")
    )))
    story.append(Spacer(1, 16))

    # ── AI Inspection history table ───────────────────────────────────────────
    story.append(Paragraph(f"AI Inspection History ({total_insp} records)", _h2(styles)))
    if not inspections:
        story.append(Paragraph("No AI inspections recorded yet.", _body(styles)))
    else:
        insp_data = [["#", "Date", "Vehicle", "Result", "Defects", "Engine"]]
        for i, r in enumerate(inspections, 1):
            status = r.get("status", "—")
            sc_map = {"pass": "#166534", "attention": "#92400e", "fail": "#991b1b"}
            sc2    = sc_map.get(status, "#374151")
            knock  = r.get("engineKnock")
            eng    = "⚠ Knock" if knock is True else "✓ OK" if knock is False else "—"
            eng_c  = "#991b1b" if knock is True else "#166534" if knock is False else "#374151"
            insp_data.append([
                Paragraph(str(i), styles["Normal"]),
                Paragraph(r.get("date", "—"), styles["Normal"]),
                Paragraph(r.get("vehicle", "—"), styles["Normal"]),
                Paragraph(f'<font color="{sc2}"><b>{status.upper()}</b></font>', styles["Normal"]),
                Paragraph(str(r.get("defects", 0)), styles["Normal"]),
                Paragraph(f'<font color="{eng_c}">{eng}</font>', styles["Normal"]),
            ])
        insp_table = Table(insp_data, colWidths=[1*cm, 3.2*cm, 5.5*cm, 2.5*cm, 2*cm, 2.8*cm])
        insp_table.setStyle(TableStyle([
            ('GRID',          (0, 0), (-1, -1), 0.7, colors.HexColor("#e2e8f0")),
            ('BACKGROUND',    (0, 0), (-1,  0), colors.HexColor("#dbeafe")),
            ('FONTNAME',      (0, 0), (-1,  0), 'Helvetica-Bold'),
            ('FONTSIZE',      (0, 0), (-1, -1), 9),
            ('LEFTPADDING',   (0, 0), (-1, -1), 7),
            ('TOPPADDING',    (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1),
             [colors.white, colors.HexColor("#f8fafc")]),
        ]))
        story.append(insp_table)
    story.append(Spacer(1, 16))

    # ── Garage service history ────────────────────────────────────────────────
    story.append(Paragraph(f"Garage Service History ({len(services)} records)", _h2(styles)))
    if not services:
        story.append(Paragraph("No garage service records found.", _body(styles)))
    else:
        svc_data = [["#", "Date", "Vehicle", "Service Type", "Result"]]
        for i, r in enumerate(services, 1):
            stype  = r.get("serviceType", "service")
            slabel = "🚨 Accident Repair" if stype == "accident" else "🔧 Routine Service"
            status = r.get("status", "—")
            sc_map = {"pass": "#166534", "attention": "#92400e", "fail": "#991b1b"}
            sc2    = sc_map.get(status, "#374151")
            svc_data.append([
                Paragraph(str(i), styles["Normal"]),
                Paragraph(r.get("date", "—"), styles["Normal"]),
                Paragraph(r.get("vehicle", "—"), styles["Normal"]),
                Paragraph(slabel, styles["Normal"]),
                Paragraph(f'<font color="{sc2}"><b>{status.upper()}</b></font>', styles["Normal"]),
            ])
        svc_table = Table(svc_data, colWidths=[1*cm, 3.2*cm, 5.5*cm, 4.5*cm, 2.8*cm])
        svc_table.setStyle(TableStyle([
            ('GRID',          (0, 0), (-1, -1), 0.7, colors.HexColor("#e2e8f0")),
            ('BACKGROUND',    (0, 0), (-1,  0), colors.HexColor("#ede9fe")),
            ('FONTNAME',      (0, 0), (-1,  0), 'Helvetica-Bold'),
            ('FONTSIZE',      (0, 0), (-1, -1), 9),
            ('LEFTPADDING',   (0, 0), (-1, -1), 7),
            ('TOPPADDING',    (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1),
             [colors.white, colors.HexColor("#f8fafc")]),
        ]))
        story.append(svc_table)
    story.append(Spacer(1, 16))

    # ── Appointments history ──────────────────────────────────────────────────
    story.append(Paragraph(f"Garage Appointment History ({appt_count} records)", _h2(styles)))
    if not appointments:
        story.append(Paragraph("No garage appointments recorded.", _body(styles)))
    else:
        appt_data = [["#", "Garage", "Service", "Date", "Time", "Status"]]
        status_colors = {
            "confirmed":   "#166534", "completed": "#166534",
            "done":        "#166534", "pending":   "#92400e",
            "rejected":    "#991b1b", "claimed":   "#1e40af",
            "in_progress": "#5b21b6"
        }
        for i, a in enumerate(appointments, 1):
            st  = a.get("status", "—")
            sc2 = status_colors.get(st, "#374151")
            appt_data.append([
                Paragraph(str(i), styles["Normal"]),
                Paragraph(a.get("garage",  "—"), styles["Normal"]),
                Paragraph(a.get("service", "—"), styles["Normal"]),
                Paragraph(a.get("date",    "—"), styles["Normal"]),
                Paragraph(a.get("time",    "—"), styles["Normal"]),
                Paragraph(f'<font color="{sc2}"><b>{st.upper().replace("_"," ")}</b></font>', styles["Normal"]),
            ])
        appt_table = Table(appt_data, colWidths=[1*cm, 4*cm, 4*cm, 2.8*cm, 2*cm, 3.2*cm])
        appt_table.setStyle(TableStyle([
            ('GRID',          (0, 0), (-1, -1), 0.7, colors.HexColor("#e2e8f0")),
            ('BACKGROUND',    (0, 0), (-1,  0), colors.HexColor("#dcfce7")),
            ('FONTNAME',      (0, 0), (-1,  0), 'Helvetica-Bold'),
            ('FONTSIZE',      (0, 0), (-1, -1), 9),
            ('LEFTPADDING',   (0, 0), (-1, -1), 7),
            ('TOPPADDING',    (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1),
             [colors.white, colors.HexColor("#f8fafc")]),
        ]))
        story.append(appt_table)
    story.append(Spacer(1, 20))

    # ── Disclaimer ────────────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.8, color=colors.HexColor("#e2e8f0")))
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "<i>This Car Life Report was generated by MEHRA Platform using AI analysis and platform activity data. "
        "All inspection records are sourced from verified AI scans. "
        "Garage service records are based on bookings made through MEHRA. "
        "This report is suitable for resale verification and insurance purposes.</i>",
        _small(styles)
    ))

    doc.build(story)
