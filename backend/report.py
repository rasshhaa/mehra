from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Image, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from datetime import datetime
import os
import json
import re
from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
_ENV_PATHS = [
    os.path.join(_HERE, ".env"),
    os.path.join(os.path.dirname(_HERE), ".env"),
]
for _env_path in _ENV_PATHS:
    if os.path.exists(_env_path):
        load_dotenv(_env_path, override=True)

from pii_redaction import redact_pii

# ─────────────────────────────────────────────────────────────────────────────
# Groq AI integration
# ─────────────────────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL   = "llama-3.3-70b-versatile"
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"

# ── Original 7 part classes ───────────────────────────────────────────────────
ALL_DEFECTS = ["Bonnet", "Bumper", "Dickey", "Door", "Fender", "Light", "Windshield"]

# ── Severity classes from Model 2 ─────────────────────────────────────────────
SEVERITY_CLASSES = [
    "Car Part Crack", "Detachment", "Flat Tyre",
    "Glass Shatter", "Glass Crack", "Lamp Broken", "Lamp Crack",
    "Minor Dent", "Minor Scratch", "Moderate Dent", "Moderate Scratch",
    "Severe Dent", "Paint Chips", "Scratch", "Crack", "Dent",
    "Side Mirror Crack", "Minor Damage",
]

# ── Defect severity weights ───────────────────────────────────────────────────
DEFECT_SEVERITY = {
    # Original 7-class parts
    "windshield": {"base_penalty": 30, "label": "Windshield Damage",  "safety": True},
    "bonnet":     {"base_penalty": 20, "label": "Bonnet Damage",      "safety": True},
    "light":      {"base_penalty": 15, "label": "Light Damage",       "safety": True},
    "bumper":     {"base_penalty": 14, "label": "Bumper Damage",      "safety": False},
    "fender":     {"base_penalty": 10, "label": "Fender Damage",      "safety": False},
    "door":       {"base_penalty": 9,  "label": "Door Damage",        "safety": False},
    "dickey":     {"base_penalty": 7,  "label": "Boot/Dickey Damage", "safety": False},
    # Severity-only classes (Model 2, no part match)
   # Add these entries to the severity-only section:
"car part crack":      {"base_penalty": 15, "label": "Part Crack",        "safety": True},
"detachment":          {"base_penalty": 20, "label": "Detachment",        "safety": True},
"flat tyre":           {"base_penalty": 25, "label": "Flat Tyre",         "safety": True},
"flat-tire":           {"base_penalty": 25, "label": "Flat Tyre",         "safety": True},
"glass shatter":       {"base_penalty": 30, "label": "Shattered Glass",   "safety": True},
"glass crack":         {"base_penalty": 20, "label": "Glass Crack",       "safety": True},
"glass-crack":         {"base_penalty": 20, "label": "Glass Crack",       "safety": True},
"lamp broken":         {"base_penalty": 18, "label": "Lamp Broken",       "safety": True},
"lamp crack":          {"base_penalty": 12, "label": "Lamp Crack",        "safety": True},
"lamp-crack":          {"base_penalty": 12, "label": "Lamp Crack",        "safety": True},
"minor-deformation":   {"base_penalty": 7,  "label": "Minor Dent",        "safety": False},
"minor deformation":   {"base_penalty": 7,  "label": "Minor Dent",        "safety": False},
"minor-scratches":     {"base_penalty": 4,  "label": "Minor Scratch",     "safety": False},
"minor scratches":     {"base_penalty": 4,  "label": "Minor Scratch",     "safety": False},
"moderate-deformation":{"base_penalty": 14, "label": "Moderate Dent",     "safety": False},
"moderate deformation":{"base_penalty": 14, "label": "Moderate Dent",     "safety": False},
"moderate-scratch":    {"base_penalty": 8,  "label": "Moderate Scratch",  "safety": False},
"moderate scratch":    {"base_penalty": 8,  "label": "Moderate Scratch",  "safety": False},
"moderate-scratches":  {"base_penalty": 8,  "label": "Moderate Scratch",  "safety": False},
"severe-deformation":  {"base_penalty": 22, "label": "Severe Dent",       "safety": True},
"severe deformation":  {"base_penalty": 22, "label": "Severe Dent",       "safety": True},
"paint-chips":         {"base_penalty": 3,  "label": "Paint Chips",       "safety": False},
"paint chips":         {"base_penalty": 3,  "label": "Paint Chips",       "safety": False},
"side-mirror-crack":   {"base_penalty": 10, "label": "Side Mirror Crack", "safety": False},
"side mirror crack":   {"base_penalty": 10, "label": "Side Mirror Crack", "safety": False},
"tiny-damage":         {"base_penalty": 3,  "label": "Minor Damage",      "safety": False},
"tiny damage":         {"base_penalty": 3,  "label": "Minor Damage",      "safety": False},
"scr":                 {"base_penalty": 5,  "label": "Scratch",           "safety": False},
"scratch":             {"base_penalty": 7,  "label": "Scratch",           "safety": False},
"dent":                {"base_penalty": 12, "label": "Dent",              "safety": False},
"crack":               {"base_penalty": 15, "label": "Crack",             "safety": True},
"severe dent":         {"base_penalty": 22, "label": "Severe Dent",       "safety": False},
"minor dent":          {"base_penalty": 7,  "label": "Minor Dent",        "safety": False},
"moderate dent":       {"base_penalty": 14, "label": "Moderate Dent",     "safety": False},
"severe scratch":      {"base_penalty": 14, "label": "Severe Scratch",    "safety": False},
"minor scratch":       {"base_penalty": 4,  "label": "Minor Scratch",     "safety": False},
"tire flat":           {"base_penalty": 25, "label": "Flat Tyre",         "safety": True},
"lamp broken":         {"base_penalty": 18, "label": "Lamp Broken",       "safety": True},
"glass shatter":       {"base_penalty": 30, "label": "Shattered Glass",   "safety": True},
"car part crack":      {"base_penalty": 15, "label": "Part Crack",        "safety": True},
}

DEFECT_ADVICE = {
    "windshield": "Windshield cracks impair visibility and cabin structural integrity — repair or replace immediately.",
    "bonnet":     "Bonnet damage may indicate impact near the engine — inspect for underlying mechanical damage.",
    "light":      "Damaged lights reduce road legality — replace before driving at night.",
    "bumper":     "Bumper damage reduces collision absorption — repair recommended.",
    "fender":     "Exposed metal will oxidise — treat and repair at nearest opportunity.",
    "door":       "Inspect door seals and hinges — repair to prevent water ingress.",
    "dickey":     "Boot damage affects weather sealing — repair as needed.",
   "glass crack":       "Glass cracks compromise structural integrity and visibility — replace immediately.",
"glass shatter":     "Shattered glass is an immediate safety hazard — do not drive, replace immediately.",
"lamp broken":       "Broken lamps are a legal and safety issue — replace before driving.",
"lamp crack":        "Cracked lamp covers allow moisture ingress — replace promptly.",
"flat tyre":         "Flat tyre detected — do not drive, replace or repair immediately.",
"detachment":        "Detached panel or component is a road safety hazard — secure or replace immediately.",
"car part crack":    "Cracked component detected — assess structural impact and repair.",
"side mirror crack": "Cracked side mirror reduces visibility — replace as soon as possible.",
"paint chips":       "Paint chips expose bare metal to moisture — treat with touch-up paint to prevent rust.",
"tiny damage":       "Minor surface damage detected — monitor and repair at next service.",
"moderate scratch":  "Moderate scratches may expose bare metal — treat to prevent rust spreading.",
"minor scratches":   "Minor surface scratches — treat with touch-up paint at next opportunity.",
"moderate deformation": "Moderate deformation indicates impact damage — inspect for underlying structural issues.",
"minor deformation": "Minor dent detected — repair to prevent moisture trapping and rust.",
"severe deformation":"Severe structural deformation — professional assessment required before driving.",
"scratch":          "Scratches expose bare metal — treat with touch-up paint to prevent rust.",
"dent":             "Dents can trap moisture and cause rust — repair promptly.",
"crack":            "Cracks can propagate under stress — assess and repair before they worsen.",
"severe dent":      "Severe dent indicates significant impact — professional repair required.",
"minor dent":       "Minor dent detected — repair at next service to prevent rust.",
"moderate dent":    "Moderate dent detected — repair recommended to prevent further damage.",
"severe scratch":   "Deep scratch exposes bare metal — repaint affected area immediately.",
"minor scratch":    "Minor surface scratch — treat with touch-up paint at next opportunity.",
"tire flat":        "Flat tyre detected — do not drive, replace or repair immediately.",
}

DEFECT_TYPE_LABELS = {
    "windshield": {"minor": "Surface Chip/Stress Crack", "moderate": "Windshield Crack",    "severe": "Shattered/Major Crack"},
    "bonnet":     {"minor": "Surface Scratch/Paint Chip","moderate": "Bonnet Dent",          "severe": "Crumple/Deep Impact"},
    "bumper":     {"minor": "Scuff/Paint Scratch",        "moderate": "Bumper Dent/Crack",   "severe": "Bumper Collapse"},
    "fender":     {"minor": "Surface Scratch",           "moderate": "Fender Dent",          "severe": "Deep Dent/Crease"},
    "door":       {"minor": "Paint Scratch/Scuff",       "moderate": "Door Dent",            "severe": "Deep Dent/Panel Damage"},
    "dickey":     {"minor": "Surface Scratch",           "moderate": "Boot Dent",            "severe": "Deep Dent/Structural"},
    "light":      {"minor": "Cover Scratch",             "moderate": "Cracked Cover",        "severe": "Broken/Shattered"},
}


def _extract_part_key(label: str) -> str:
    if " — " in label:
        part = label.split(" — ")[0].strip().lower()
        return part
    # Normalise hyphens to spaces so "glass-crack" matches "glass crack"
    return label.strip().lower().replace("-", " ")


def _get_defect_type_label(part_key: str, confidence: float) -> str:
    safety_parts = {"windshield", "light", "bonnet"}
    if part_key in safety_parts:
        tier = "severe" if confidence >= 50 else "moderate" if confidence >= 30 else "minor"
    else:
        tier = "severe" if confidence >= 80 else "moderate" if confidence >= 55 else "minor"
    return DEFECT_TYPE_LABELS.get(part_key, {}).get(tier,
        f"{part_key.replace('_', ' ').title()} Damage")


def call_groq(prompt: str, system: str = "You are an expert vehicle inspector and automotive AI assistant.") -> str:
    if not GROQ_API_KEY:
        print("[Groq] GROQ_API_KEY missing; skipping AI call")
        return ""
    try:
        import urllib.request
        safe_system = redact_pii(system)
        safe_prompt = redact_pii(prompt)
        payload = json.dumps({
            "model": GROQ_MODEL,
            "messages": [
                {"role": "system", "content": safe_system},
                {"role": "user",   "content": safe_prompt}
            ],
            "max_tokens": 1400,
            "temperature": 0.4
        }).encode("utf-8")
        req = urllib.request.Request(
            GROQ_URL, data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {GROQ_API_KEY}"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"[Groq] call failed: {e}")
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# SCORING HELPERS
# ─────────────────────────────────────────────────────────────────────────────
def _build_defect_detail(defects: list) -> list:
    """
    Collapse raw defect list into per-type dicts with max confidence.
    Handles both legacy (label, conf) tuples and enriched dicts from dual model.
    """
    grouped = {}
    for d in defects:
        if isinstance(d, (list, tuple)):
            name, conf = str(d[0]), float(d[1]) if len(d) > 1 else 0.0
        elif isinstance(d, dict):
            name = d.get("label") or d.get("class") or d.get("name") or "Unknown"
            conf = float(d.get("confidence", 0))
        else:
            name, conf = str(d), 0.0

        key     = _extract_part_key(name)
        sev_info = DEFECT_SEVERITY.get(key, {"base_penalty": 10, "label": name.split(" — ")[0].title(), "safety": False})

        if key not in grouped or grouped[key]["confidence"] < conf:
            grouped[key] = {
                "key":        key,
                "label":      name,                  # keep full label with severity
                "short":      name.split(" — ")[0],  # just the part name
                "confidence": conf,
                "sev":        sev_info,
            }
    return list(grouped.values())


def _compute_health_score(defect_details: list, engine_result) -> int:
    score = 100
    for d in defect_details:
        score -= d["sev"]["base_penalty"] * (d["confidence"] / 100)
    if engine_result and engine_result.get("is_knock"):
        score -= 25 * (engine_result.get("confidence", 100) / 100)
    return max(5, min(100, round(score)))


def _compute_risk(defect_details: list, engine_result) -> str:
    has_safety = any(d["sev"]["safety"] for d in defect_details)
    high_conf  = any(d["confidence"] >= 75 for d in defect_details)
    count      = len(defect_details)
    knock      = engine_result.get("is_knock", False) if engine_result else False

    if knock and (count >= 2 or has_safety):   return "Critical"
    if knock or (has_safety and high_conf) or count >= 4: return "High"
    if count >= 2 or (has_safety and not high_conf) or (count == 1 and high_conf): return "Medium"
    return "Low"


def _fallback_summary(status: str, defect_details: list) -> str:
    if not defect_details:
        return ("The vehicle passed all visual inspection checks with no detectable exterior damage. "
                "It appears to be in excellent condition with no immediate repair needs.")
    parts        = [d["label"] for d in defect_details]
    safety_parts = [d["label"] for d in defect_details if d["sev"]["safety"]]
    parts_str    = ", ".join(parts)
    if safety_parts:
        return (f"The inspection detected: {parts_str}. "
                f"Safety-critical damage identified on {', '.join(safety_parts)} requires immediate attention.")
    return (f"The inspection identified {parts_str}. "
            f"Timely repair will prevent deterioration and maintain resale value.")


def _fallback_recommendations(defect_details: list, engine_result) -> list:
    recs = []
    for d in defect_details:
        key    = d["key"]
        # Try exact key, then partial match
        advice = DEFECT_ADVICE.get(key)
        if not advice:
            for k, v in DEFECT_ADVICE.items():
                if k in key or key in k:
                    advice = v; break
        if advice:
            recs.append(advice)
    if engine_result and engine_result.get("is_knock"):
        recs.append("Engine knock detected — consult a mechanic to inspect fuel system, ignition timing, and knock sensors.")
    if not recs:
        recs = ["Continue routine maintenance schedule.", "Keep records of this clean inspection for future resale."]
    return recs[:5]


def _fallback_risk_factors(defect_details: list, engine_result) -> list:
    factors = []
    safety  = [d["label"] for d in defect_details if d["sev"]["safety"]]
    if safety:
        factors.append(f"Safety-critical components affected: {', '.join(safety)}")
    high_conf = [d["label"] for d in defect_details if d["confidence"] >= 75]
    if high_conf:
        factors.append(f"High-confidence damage on: {', '.join(high_conf)}")
    if engine_result and engine_result.get("is_knock"):
        factors.append(f"Engine knock confirmed at {engine_result.get('confidence', 0):.0f}% confidence")
    cosmetic = [d["label"] for d in defect_details if not d["sev"]["safety"] and d["confidence"] < 75]
    if cosmetic:
        factors.append(f"Minor cosmetic damage on: {', '.join(cosmetic)}")
    return factors[:4]


# ─────────────────────────────────────────────────────────────────────────────
# MAIN AI ANALYSIS (unchanged signature — fully backward-compatible)
# ─────────────────────────────────────────────────────────────────────────────
def generate_ai_analysis(defects: list, vehicle_info: dict, engine_result, overall_status: str) -> dict:
    make    = vehicle_info.get("make",    "Unknown")
    model   = vehicle_info.get("model",   "Unknown")
    year    = vehicle_info.get("year",    "Unknown")
    mileage = vehicle_info.get("mileage", "Unknown")

    defect_details = _build_defect_detail(defects)
    fallback_score = _compute_health_score(defect_details, engine_result)
    fallback_risk  = _compute_risk(defect_details, engine_result)

    if defect_details:
        defect_lines = []
        for d in defect_details:
            sev_word   = "severe" if d["confidence"] >= 80 else "moderate" if d["confidence"] >= 55 else "minor"
            safety_tag = " [SAFETY-CRITICAL]" if d["sev"]["safety"] else ""
            defect_lines.append(f"  - {d['label']} | {sev_word} ({d['confidence']:.1f}% confidence){safety_tag}")
        defect_str = "\n".join(defect_lines)
    else:
        defect_str = "  - None detected"

    engine_str = "Not tested"
    if engine_result and engine_result.get("verdict"):
        engine_str = (
            f"{'KNOCK DETECTED' if engine_result.get('is_knock') else 'HEALTHY'} "
            f"(verdict: {engine_result.get('verdict','?')}, confidence: {engine_result.get('confidence', 0):.1f}%)"
        )

    prompt = f"""You are an expert automotive inspector writing a professional vehicle condition report.

Vehicle: {year} {make} {model}  |  Mileage: {mileage}
Overall status: {overall_status}
Engine audio: {engine_str}

Detected defects (from dual AI models — part detection + severity detection):
{defect_str}

Note: Labels like "Door — Moderate Dent" mean the Door part was detected by Model 1
and a Moderate Dent was detected in the same region by Model 2.
Labels without " — " are severity-only detections (no matching part box).

SCORING RULES (follow exactly):
- Start at 100. Deduct only for detected defects.
- Minor cosmetic defect <55% confidence: deduct 4-7 pts
- Moderate defect 55-79% confidence: deduct 10-15 pts
- Severe defect >=80% confidence: deduct 18-28 pts
- Safety-critical parts (windshield, lights, bonnet, crack, shattered): add 5 extra pts to deduction
- Engine knock: deduct 20-25 pts
- Single low-confidence cosmetic defect must NOT drop below 80
- Suggested score: {fallback_score}

Respond ONLY with valid JSON, no markdown:
{{
  "health_score": <integer 0-100>,
  "risk_level": "<Low|Medium|High|Critical>",
  "summary": "<2-3 sentences naming SPECIFIC defects found, their severity, and practical impact>",
  "defect_explanations": {{
    "<defect key in lowercase>": "<1 sentence: what this means and what action is needed>"
  }},
  "recommendations": ["<specific action>", "<another>", "<another>"],
  "risk_factors": ["<specific risk>", "<another>"]
}}"""

    raw = call_groq(prompt)

    try:
        clean = raw.strip()
        if clean.startswith("```"):
            clean = "\n".join(clean.split("\n")[1:])
        if clean.endswith("```"):
            clean = "\n".join(clean.split("\n")[:-1])
        result = json.loads(clean)
        result["health_score"]    = max(5, min(100, int(result.get("health_score", fallback_score))))
        result.setdefault("risk_level",          fallback_risk)
        result.setdefault("summary",             _fallback_summary(overall_status, defect_details))
        result.setdefault("recommendations",     _fallback_recommendations(defect_details, engine_result))
        result.setdefault("risk_factors",        _fallback_risk_factors(defect_details, engine_result))
        result.setdefault("defect_explanations", {})
        return result
    except Exception as e:
        print(f"[Groq] JSON parse failed: {e}\nRaw: {raw}")
        return {
            "health_score":        fallback_score,
            "risk_level":          fallback_risk,
            "summary":             _fallback_summary(overall_status, defect_details),
            "recommendations":     _fallback_recommendations(defect_details, engine_result),
            "risk_factors":        _fallback_risk_factors(defect_details, engine_result),
            "defect_explanations": {},
        }


def generate_tasjeel_readiness_analysis(
    defects: list,
    vehicle_info: dict,
    engine_result=None,
    overall_status: str = "ATTENTION",
) -> dict:
    """Groq explainability focused on UAE Tasjeel periodic inspection pass readiness."""
    make = vehicle_info.get("make", "Unknown")
    model = vehicle_info.get("model", "Unknown")
    year = vehicle_info.get("year", "Unknown")
    mileage = vehicle_info.get("mileage", "Unknown")

    defect_lines = []
    for d in defects or []:
        if isinstance(d, (list, tuple)) and len(d) >= 2:
            defect_lines.append(f"- {d[0]} ({d[1]}% confidence)")
        elif isinstance(d, dict):
            label = d.get("label") or d.get("part") or "Unknown"
            conf = d.get("confidence", 0)
            defect_lines.append(f"- {label} ({conf}% confidence)")
    defect_str = "\n".join(defect_lines) if defect_lines else "No defects detected in pre-inspection."

    engine_str = "Not analysed"
    if engine_result:
        if engine_result.get("is_knock"):
            engine_str = f"Engine knock detected ({engine_result.get('confidence', 0)}% confidence)"
        else:
            engine_str = f"Engine audio: {engine_result.get('verdict', 'Normal')}"

    ut = len({(d[0] if isinstance(d, (list, tuple)) else d.get("label", "")).lower() for d in (defects or []) if d})
    base_score = 92 if ut == 0 and not (engine_result and engine_result.get("is_knock")) else max(25, 88 - ut * 12)

    prompt = f"""You are a UAE Tasjeel vehicle testing centre expert. Assess whether this vehicle is likely to PASS a Tasjeel periodic inspection based on an AI pre-inspection report.

Vehicle: {year} {make} {model} | Mileage: {mileage}
Overall AI status: {overall_status}
Engine: {engine_str}

AI-detected issues (pre-inspection — not official Tasjeel result):
{defect_str}

TASJEEL FOCUS AREAS (UAE periodic test checks):
- Brakes, steering, suspension
- Lights, indicators, windshield visibility
- Tyres, wheels, body structural safety
- Emissions / engine noise (knock, excessive smoke)
- Visible damage affecting roadworthiness

SCORING:
- readiness_score 0-100 = likelihood of passing Tasjeel if tested today
- pass_likelihood: High (75+), Medium (50-74), Low (25-49), Unlikely (<25)
- Be specific about which Tasjeel test categories may fail

Respond ONLY with valid JSON, no markdown:
{{
  "readiness_score": <integer 0-100>,
  "pass_likelihood": "<High|Medium|Low|Unlikely>",
  "summary": "<2-3 sentences on Tasjeel readiness in plain language>",
  "tasjeel_focus_areas": ["<Tasjeel category at risk>", "<another>"],
  "defect_explanations": {{
    "<defect key lowercase>": "<1 sentence: why this matters for Tasjeel and what to fix>"
  }},
  "recommendations": ["<fix before booking>", "<another>"],
  "risk_factors": ["<Tasjeel-specific risk>", "<another>"]
}}"""

    raw = call_groq(prompt, system="You are a UAE Tasjeel inspection readiness advisor. Focus on pass/fail likelihood for official vehicle testing.")

    try:
        clean = raw.strip()
        if clean.startswith("```"):
            clean = "\n".join(clean.split("\n")[1:])
        if clean.endswith("```"):
            clean = "\n".join(clean.split("\n")[:-1])
        result = json.loads(clean)
        result["readiness_score"] = max(5, min(100, int(result.get("readiness_score", base_score))))
        result.setdefault("pass_likelihood", "Medium" if result["readiness_score"] >= 50 else "Low")
        result.setdefault("summary", "Review detected issues before your Tasjeel appointment.")
        result.setdefault("tasjeel_focus_areas", [])
        result.setdefault("recommendations", [])
        result.setdefault("risk_factors", [])
        result.setdefault("defect_explanations", {})
        return result
    except Exception as e:
        print(f"[Groq] Tasjeel readiness JSON parse failed: {e}\nRaw: {raw}")
        likelihood = "High" if base_score >= 75 else "Medium" if base_score >= 50 else "Low"
        return {
            "readiness_score": base_score,
            "pass_likelihood": likelihood,
            "summary": (
                "AI pre-inspection complete. Address visible damage and engine issues before Tasjeel testing."
                if ut else "No major defects detected — vehicle appears ready for Tasjeel testing."
            ),
            "tasjeel_focus_areas": ["Body & structural", "Lights & visibility"] if ut else [],
            "recommendations": ["Fix detected defects before your appointment", "Arrive with valid insurance and registration"],
            "risk_factors": [f"{ut} defect area(s) detected"] if ut else [],
            "defect_explanations": {},
        }


def generate_tasjeel_sustainability_score(
    pre_report: dict,
    tasjeel_result: str,
    tasjeel_notes: str = "",
    reason_category: str = "",
) -> dict:
    """Groq explainability: did AI pre-inspection help the owner avoid Tasjeel fail/re-test costs?"""
    ai = pre_report or {}
    readiness = ai.get("readiness_score") or ai.get("readiness", {}).get("readiness_score")
    likelihood = ai.get("pass_likelihood") or ai.get("readiness", {}).get("pass_likelihood") or "Unknown"
    focus = ai.get("tasjeel_focus_areas") or ai.get("readiness", {}).get("tasjeel_focus_areas") or []
    recs = ai.get("recommendations") or ai.get("readiness", {}).get("recommendations") or []
    summary = ai.get("summary") or ai.get("readiness", {}).get("summary") or ""

    prompt = f"""You are a UAE vehicle inspection sustainability analyst. Compare an owner's AutoVault AI pre-inspection with the official Tasjeel test outcome.

UAE TASJEEL CONTEXT (use in reasoning):
- If a vehicle FAILS Tasjeel, the owner has 30 days to repair and re-test at the SAME centre.
- Re-test fee is AED 50 (light vehicle) vs AED 150 full test — missing the 30-day window means paying full fee again.
- AI pre-inspection helps owners fix issues BEFORE the official test, avoiding fail, re-test trips, workshop cost, and registration delays.

AI PRE-INSPECTION:
- Readiness score: {readiness}/100
- Pass likelihood: {likelihood}
- Summary: {summary}
- Focus areas flagged: {', '.join(focus) if focus else 'None'}
- Recommendations given: {'; '.join(recs[:5]) if recs else 'None'}

OFFICIAL TASJEEL RESULT: {tasjeel_result}
Inspector notes: {tasjeel_notes or 'None'}
Reason category: {reason_category or 'None'}

Analyze whether the AI pre-inspection aligned with Tasjeel and whether it likely saved the owner money/time/emissions from avoided re-tests.

Respond ONLY with valid JSON:
{{
  "sustainability_score": <integer 0-100 — higher = more owner/environment benefit from pre-inspection>,
  "ai_prediction_accurate": <true|false>,
  "retest_avoided": <true|false — true if owner passed first time and AI helped>,
  "estimated_savings_aed": <integer estimated AED saved, 0 if none>,
  "summary": "<2-3 sentences plain language for Tasjeel staff>",
  "comparison_notes": ["<AI vs Tasjeel insight>", "<another>"],
  "sustainability_factors": ["<e.g. avoided re-test trip>", "<another>"],
  "recommendations": ["<for future owners>", "<another>"]
}}"""

    raw = call_groq(prompt, system="You assess sustainability and owner savings from AI vehicle pre-inspection before UAE Tasjeel testing.")

    passed = str(tasjeel_result).lower() in ("passed", "conditional")
    ai_high = str(likelihood).lower() == "high" or (readiness and readiness >= 75)
    fallback_savings = 50 if passed and ai_high else 0
    fallback_score = 78 if passed and ai_high else (55 if passed else 35)

    try:
        clean = raw.strip()
        if clean.startswith("```"):
            clean = "\n".join(clean.split("\n")[1:])
        if clean.endswith("```"):
            clean = "\n".join(clean.split("\n")[:-1])
        result = json.loads(clean)
        result["sustainability_score"] = max(0, min(100, int(result.get("sustainability_score", fallback_score))))
        result.setdefault("ai_prediction_accurate", passed == ai_high)
        result.setdefault("retest_avoided", passed and bool(recs or focus))
        result.setdefault("estimated_savings_aed", fallback_savings)
        result.setdefault("summary", "AI pre-inspection compared with Tasjeel outcome.")
        result.setdefault("comparison_notes", [])
        result.setdefault("sustainability_factors", [])
        result.setdefault("recommendations", [])
        return result
    except Exception as e:
        print(f"[Groq] Sustainability JSON parse failed: {e}\nRaw: {raw}")
        return {
            "sustainability_score": fallback_score,
            "ai_prediction_accurate": passed == ai_high,
            "retest_avoided": passed and bool(recs or focus),
            "estimated_savings_aed": fallback_savings,
            "summary": (
                "Owner passed Tasjeel on first attempt — AI pre-inspection may have helped avoid a fail and AED 50 re-test fee."
                if passed else
                "Vehicle failed Tasjeel — compare AI focus areas with inspector notes to improve pre-inspection guidance."
            ),
            "comparison_notes": [
                f"AI pass likelihood was {likelihood}; official result was {tasjeel_result}.",
            ],
            "sustainability_factors": ["Reduced re-test centre visits"] if passed else ["Re-test within 30 days required"],
            "recommendations": recs[:2] if recs else ["Run AI pre-inspection before booking Tasjeel"],
        }


# ─────────────────────────────────────────────────────────────────────────────
# PDF HELPERS
# ─────────────────────────────────────────────────────────────────────────────
def _health_bar_table(score: int, styles):
    bar_color = (colors.HexColor("#16a34a") if score >= 75 else
                 colors.HexColor("#d97706") if score >= 50 else
                 colors.HexColor("#dc2626"))
    hex_color = "#16a34a" if score >= 75 else "#d97706" if score >= 50 else "#dc2626"
    filled = round(score / 10); empty = 10 - filled
    t = Table(
        [[Paragraph(f"<b>{score}/100</b>",  ParagraphStyle("ScoreVal",   parent=styles["Normal"], fontSize=22, textColor=bar_color, alignment=1))],
         [Paragraph(f'<font color="{hex_color}">{"█" * filled}</font><font color="#e5e7eb">{"█" * empty}</font>',
                    ParagraphStyle("Bar", parent=styles["Normal"], fontSize=18, alignment=1))],
         [Paragraph("Vehicle Health Score",  ParagraphStyle("ScoreLabel", parent=styles["Normal"], fontSize=9, textColor=colors.grey, alignment=1))]],
        colWidths=[17 * cm]
    )
    t.setStyle(TableStyle([
        ('ALIGN',         (0,0),(-1,-1),'CENTER'),
        ('VALIGN',        (0,0),(-1,-1),'MIDDLE'),
        ('BACKGROUND',    (0,0),(-1,-1),colors.HexColor("#f9fafb")),
        ('BOX',           (0,0),(-1,-1),1,colors.HexColor("#e5e7eb")),
        ('TOPPADDING',    (0,0),(-1,-1),6),
        ('BOTTOMPADDING', (0,0),(-1,-1),6),
    ]))
    return t


def _risk_badge_color(risk: str):
    return {"Low": ("#166534","#dcfce7"), "Medium": ("#92400e","#fef3c7"),
            "High": ("#9a3412","#ffedd5"), "Critical": ("#991b1b","#fee2e2")}.get(risk, ("#374151","#f3f4f6"))


# ─────────────────────────────────────────────────────────────────────────────
# MAIN REPORT GENERATOR
# ─────────────────────────────────────────────────────────────────────────────
def generate_report(
    defects:       list,
    image_paths:   list,
    output_path:   str,
    vehicle_info:  dict = None,
    engine_result: dict = None,
    ai_analysis:   dict = None,
):
    if vehicle_info is None:
        vehicle_info = {}

    def _norm(d):
        if isinstance(d, (list, tuple)):
            return [str(d[0]) if len(d) > 0 else "Unknown", float(d[1]) if len(d) > 1 else 0.0]
        if isinstance(d, dict):
            label = d.get("label") or d.get("class") or d.get("name") or "Unknown"
            return [str(label), float(d.get("confidence", 0))]
        return [str(d), 0.0]

    defects = [_norm(d) for d in (defects or [])]

    # Count unique PARTS (strip severity suffix)
    detected_parts  = {_extract_part_key(d[0]) for d in defects if d[0]}
    # Also track original 7 for the checklist
    detected_7class = {_extract_part_key(d[0]) for d in defects
                       if _extract_part_key(d[0]) in [p.lower() for p in ALL_DEFECTS]}

    total_detected_types = len(detected_parts)

    engine_knock_detected = bool(engine_result and engine_result.get("is_knock"))

    if engine_knock_detected:
        overall_status = "FAIL";      status_color = "#991b1b"
    elif total_detected_types == 0:
        overall_status = "PASS";      status_color = "#166534"
    elif total_detected_types <= 2:
        overall_status = "ATTENTION"; status_color = "#d97706"
    else:
        overall_status = "FAIL";      status_color = "#991b1b"

    if ai_analysis is None:
        ai_analysis = generate_ai_analysis(defects, vehicle_info, engine_result, overall_status)

    health_score        = ai_analysis.get("health_score",       50)
    risk_level          = ai_analysis.get("risk_level",         "Medium")
    ai_summary          = ai_analysis.get("summary",            "")
    recommendations     = ai_analysis.get("recommendations",    [])
    risk_factors        = ai_analysis.get("risk_factors",       [])
    defect_explanations = ai_analysis.get("defect_explanations",{})

    doc    = SimpleDocTemplate(output_path, pagesize=A4,
                               rightMargin=2*cm, leftMargin=2*cm,
                               topMargin=2*cm,   bottomMargin=2*cm)
    styles = getSampleStyleSheet()
    story  = []

    # ── Title ─────────────────────────────────────────────────────────────────
    story.append(Paragraph("VEHICLE INSPECTION REPORT", ParagraphStyle(
        "BigTitle", parent=styles["Title"], fontSize=24, spaceAfter=6,
        alignment=1, textColor=colors.HexColor("#1e3a8a")
    )))
    story.append(Paragraph(
        f"AI-Powered Body + Engine Sound Analysis · {datetime.now().strftime('%B %d, %Y at %H:%M')}",
        ParagraphStyle("Sub", parent=styles["Normal"], fontSize=10, alignment=1,
                       textColor=colors.grey, spaceAfter=4)
    ))
    story.append(Paragraph(
        "Physical Defect Detection (7-class YOLO + Severity Model) + Engine Knock Audio Classification",
        ParagraphStyle("Models", parent=styles["Normal"], fontSize=8, alignment=1,
                       textColor=colors.HexColor("#6b7280"), spaceAfter=20)
    ))

    # ── Vehicle Info ──────────────────────────────────────────────────────────
    vin        = vehicle_info.get("vin",     "Not Provided")
    make       = vehicle_info.get("make",    "Not Provided")
    model_name = vehicle_info.get("model",   "Not Provided")
    year       = vehicle_info.get("year",    "Not Provided")
    mileage    = vehicle_info.get("mileage", "Not Provided")
    make_model = f"{make} {model_name}" if make != "Not Provided" else "Not Provided"

    value_style = ParagraphStyle(
        "InfoVal",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=11,
        wordWrap="CJK",
    )
    label_style = ParagraphStyle(
        "InfoLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=11,
    )
    info_table = Table(
        [
            [
                Paragraph("VIN / Registration", label_style),
                Paragraph(str(vin), value_style),
                Paragraph("Mileage", label_style),
                Paragraph(str(mileage), value_style),
            ],
            [
                Paragraph("Make / Model", label_style),
                Paragraph(str(make_model), value_style),
                Paragraph("Year", label_style),
                Paragraph(str(year), value_style),
            ],
        ],
        # Must stay within A4 content width (~17cm with 2cm margins).
        colWidths=[4.1*cm, 6.1*cm, 3.0*cm, 3.8*cm]
    )
    info_table.setStyle(TableStyle([
        ('GRID',          (0,0),(-1,-1),1,   colors.grey),
        ('BACKGROUND',    (0,0),(-1, 0),colors.lightgrey),
        ('ALIGN',         (0,0),(-1,-1),'LEFT'),
        ('VALIGN',        (0,0),(-1,-1),'TOP'),
        ('LEFTPADDING',   (0,0),(-1,-1),8),
        ('RIGHTPADDING',  (0,0),(-1,-1),8),
        ('TOPPADDING',    (0,0),(-1,-1),6),
        ('BOTTOMPADDING', (0,0),(-1,-1),6),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 24))

    # ── AI Health Assessment ──────────────────────────────────────────────────
    story.append(Paragraph("<b>AI Vehicle Health Assessment</b>", styles["Heading2"]))
    story.append(Spacer(1, 8))
    story.append(_health_bar_table(health_score, styles))
    story.append(Spacer(1, 12))

    fg, bg = _risk_badge_color(risk_level)
    risk_table = Table([[
        Paragraph("<b>Risk Level</b>",    styles["Normal"]),
        Paragraph(f"<font color='{fg}'><b>{risk_level}</b></font>",
                  ParagraphStyle("RV", parent=styles["Normal"], fontSize=14)),
        Paragraph("<b>Overall Status</b>", styles["Normal"]),
        Paragraph(f"<font color='{status_color}'><b>{overall_status}</b></font>",
                  ParagraphStyle("SV", parent=styles["Normal"], fontSize=14)),
    ]], colWidths=[4*cm, 4.5*cm, 4*cm, 4.5*cm])
    risk_table.setStyle(TableStyle([
        ('BOX',           (0,0),(-1,-1),1,   colors.HexColor("#e5e7eb")),
        ('LINEAFTER',     (1,0),(1, 0), 0.5, colors.HexColor("#e5e7eb")),
        ('BACKGROUND',    (0,0),(1, 0),colors.HexColor(bg)),
        ('BACKGROUND',    (2,0),(3, 0),colors.HexColor("#f0f9ff")),
        ('ALIGN',         (0,0),(-1,-1),'CENTER'),
        ('VALIGN',        (0,0),(-1,-1),'MIDDLE'),
        ('TOPPADDING',    (0,0),(-1,-1),10),
        ('BOTTOMPADDING', (0,0),(-1,-1),10),
    ]))
    story.append(risk_table)
    story.append(Spacer(1, 16))

    # ── Risk Factors ──────────────────────────────────────────────────────────
    if risk_factors:
        story.append(Paragraph("<b>Key Risk Factors:</b>", styles["Heading3"]))
        for rf in risk_factors:
            story.append(Paragraph(f"• {rf}", ParagraphStyle(
                "RF", parent=styles["Normal"], fontSize=10,
                leftIndent=14, spaceBefore=3, textColor=colors.HexColor("#7f1d1d")
            )))
        story.append(Spacer(1, 12))

    # ── AI Summary ────────────────────────────────────────────────────────────
    story.append(Paragraph("<b>AI Inspection Summary</b>", styles["Heading3"]))
    story.append(Paragraph(ai_summary, ParagraphStyle(
        "AISummary", parent=styles["Normal"], fontSize=10.5, leading=16,
        leftIndent=10, rightIndent=10, spaceBefore=6, spaceAfter=6,
        backColor=colors.HexColor("#f0f9ff"), textColor=colors.HexColor("#1e3a5f")
    )))
    story.append(Spacer(1, 12))

    # ── Defect-by-Defect Analysis ─────────────────────────────────────────────
    if detected_parts:
        story.append(Paragraph("<b>Defect Analysis — Dual Model Results</b>", styles["Heading3"]))
        story.append(Spacer(1, 4))

        for d_label, d_conf in defects:
            key       = _extract_part_key(d_label)
            sev_info  = DEFECT_SEVERITY.get(key, {"label": d_label.split(" — ")[0], "safety": False, "base_penalty": 10})
            is_safety = sev_info["safety"]
            # Extract severity label from combined label if present
            if " — " in d_label:
                part_name = d_label.split(" — ")[0]
                sev_name  = d_label.split(" — ")[1]
                display   = f"{part_name} — <b>{sev_name}</b>"
            else:
                part_name = d_label
                display   = d_label

            sev_word   = "Severe" if d_conf >= 80 else "Moderate" if d_conf >= 55 else "Minor"
            color_hex  = "#991b1b" if is_safety else "#92400e"
            tag        = " ⚠ Safety-Critical" if is_safety else ""
            expl       = (defect_explanations.get(key)
                          or defect_explanations.get(d_label.lower())
                          or DEFECT_ADVICE.get(key, "Consult a qualified technician for assessment and repair."))
            story.append(Paragraph(
                f"<font color='{color_hex}'><b>{display}{tag}</b></font>  "
                f"<font color='#6b7280' size=9>({sev_word}, {d_conf:.1f}% confidence)</font>",
                ParagraphStyle("DH", parent=styles["Normal"], fontSize=10, spaceBefore=7, leftIndent=10)
            ))
            story.append(Paragraph(expl, ParagraphStyle(
                "DE", parent=styles["Normal"], fontSize=9.5, leftIndent=22,
                spaceBefore=2, spaceAfter=5, textColor=colors.HexColor("#374151")
            )))
        story.append(Spacer(1, 12))

    # ── Recommendations ───────────────────────────────────────────────────────
    story.append(Paragraph("<b>AI Recommendations</b>", styles["Heading3"]))
    for i, rec in enumerate(recommendations, 1):
        story.append(Paragraph(f"<b>{i}.</b> {rec}", ParagraphStyle(
            "Rec", parent=styles["Normal"], fontSize=10, leftIndent=14, spaceBefore=4, leading=14
        )))
    story.append(Spacer(1, 24))

    # ── Engine Audio ──────────────────────────────────────────────────────────
    if engine_result and engine_result.get("verdict"):
        is_knock = engine_result.get("is_knock", False)
        verdict  = engine_result.get("verdict", "")
        conf     = engine_result.get("confidence", 0)
        duration = engine_result.get("duration_s", 0)
        eng_remark = (
            "Pre-detonation knock detected — inspect fuel system, ignition timing, and knock sensors."
            if is_knock else
            "No knock detected. Engine sounds healthy. Continue regular maintenance schedule."
        )
        story.append(Paragraph("<b>Engine Sound Analysis</b>", styles["Heading2"]))
        story.append(Spacer(1, 8))
        eng_table = Table(
            [["Engine Status", "KNOCK DETECTED" if is_knock else "ENGINE HEALTHY", "Confidence", f"{conf}%"],
             ["Verdict",       verdict,                                              "Duration",   f"{duration}s"],
             ["Remarks",       Paragraph(eng_remark, styles["Normal"]),             "",           ""]],
            colWidths=[4*cm, 6*cm, 4*cm, 4*cm]
        )
        eng_table.setStyle(TableStyle([
            ('GRID',          (0,0),(-1,-1),0.8,colors.grey),
            ('BACKGROUND',    (0,0),(-1, 0),colors.HexColor("#fee2e2" if is_knock else "#dcfce7")),
            ('FONTNAME',      (0,0),(-1, 0),'Helvetica-Bold'),
            ('FONTSIZE',      (0,0),(-1,-1),10),
            ('ALIGN',         (0,0),(-1,-1),'LEFT'),
            ('VALIGN',        (0,0),(-1,-1),'MIDDLE'),
            ('LEFTPADDING',   (0,0),(-1,-1),8),
            ('RIGHTPADDING',  (0,0),(-1,-1),8),
            ('BOTTOMPADDING', (0,0),(-1,-1),8),
            ('TOPPADDING',    (0,0),(-1,-1),8),
            ('SPAN',          (1, 2),(3, 2)),
        ]))
        story.append(eng_table)
        story.append(Spacer(1, 24))

    # ── Damage Checklist — Original 7 Parts ───────────────────────────────────
    story.append(Paragraph("<b>Standard 7-Part Damage Checklist</b>", styles["Heading2"]))
    story.append(Spacer(1, 10))

    table_data = [["Component", "Defect Type / Severity", "Confidence", "Status"]]
    for defect_name in ALL_DEFECTS:
        key = defect_name.lower()
        # Find all defects matching this part key
        matches = [(d[0], d[1]) for d in defects if _extract_part_key(d[0]) == key]
        if matches:
            max_conf   = max(c for _, c in matches)
            # Use the label that has the most detail (prefer one with " — ")
            best_label = max(matches, key=lambda x: (1 if " — " in x[0] else 0, x[1]))[0]
            sev_word   = "Severe" if max_conf >= 80 else "Moderate" if max_conf >= 55 else "Minor"
            if DEFECT_SEVERITY.get(key, {}).get("safety"):
                sev_word += " ⚠"
            table_data.append([
                Paragraph(f"<b>{defect_name}</b>",    styles["Normal"]),
                Paragraph(f"<font color='#991b1b'>{best_label}</font>", styles["Normal"]),
                Paragraph(f"{max_conf:.1f}%",          styles["Normal"]),
                Paragraph(sev_word,                    styles["Normal"]),
            ])
        else:
            table_data.append([
                Paragraph(f"<b>{defect_name}</b>", styles["Normal"]),
                Paragraph("No Damage Detected",    styles["Normal"]),
                Paragraph("—",                     styles["Normal"]),
                Paragraph("—",                     styles["Normal"]),
            ])

    table_data.append([
        Paragraph("<b>Total Unique Parts/Types</b>", styles["Normal"]),
        Paragraph(f"<font color='{status_color}'><b>{total_detected_types}</b></font>", styles["Normal"]),
        Paragraph("<b>Overall Status:</b>",          styles["Normal"]),
        Paragraph(f"<font color='{status_color}'><b>{overall_status}</b></font>", styles["Normal"]),
    ])

    defect_table = Table(table_data, colWidths=[4.5*cm, 5.8*cm, 3*cm, 5.2*cm])
    defect_table.setStyle(TableStyle([
        ('GRID',          (0,0),(-1,-1),0.8,colors.grey),
        ('BACKGROUND',    (0,0),(-1, 0),colors.lightgrey),
        ('FONTNAME',      (0,0),(-1, 0),'Helvetica-Bold'),
        ('FONTSIZE',      (0,0),(-1, 0),11),
        ('ALIGN',         (0,0),(-1, 0),'CENTER'),
        ('VALIGN',        (0,0),(-1,-1),'MIDDLE'),
        ('FONTSIZE',      (0,1),(-1,-1),10),
        ('ALIGN',         (0,1),(-1,-1),'LEFT'),
        ('LEFTPADDING',   (0,0),(-1,-1),10),
        ('RIGHTPADDING',  (0,0),(-1,-1),10),
        ('BOTTOMPADDING', (0,0),(-1,-1),8),
        ('TOPPADDING',    (0,0),(-1,-1),8),
    ]))
    story.append(defect_table)
    story.append(Spacer(1, 20))

    # ── Severity-Only Detections (Model 2 unmatched) ──────────────────────────
    severity_only = [(d[0], d[1]) for d in defects
                     if _extract_part_key(d[0]) not in [p.lower() for p in ALL_DEFECTS]
                     and " — " not in d[0]]
    if severity_only:
        story.append(Paragraph("<b>Additional Damage Detections (Severity Model)</b>", styles["Heading3"]))
        story.append(Spacer(1, 6))
        sev_data = [["Damage Type", "Confidence", "Severity Tier"]]
        for label, conf in severity_only:
            tier     = "Severe" if conf >= 80 else "Moderate" if conf >= 55 else "Minor"
            sev_data.append([
                Paragraph(label, styles["Normal"]),
                Paragraph(f"{conf:.1f}%", styles["Normal"]),
                Paragraph(tier, styles["Normal"]),
            ])
        sev_table = Table(sev_data, colWidths=[8*cm, 4*cm, 6.5*cm])
        sev_table.setStyle(TableStyle([
            ('GRID',          (0,0),(-1,-1),0.8,colors.grey),
            ('BACKGROUND',    (0,0),(-1, 0),colors.HexColor("#f3e8ff")),
            ('FONTNAME',      (0,0),(-1, 0),'Helvetica-Bold'),
            ('FONTSIZE',      (0,0),(-1,-1),10),
            ('ALIGN',         (0,0),(-1,-1),'LEFT'),
            ('VALIGN',        (0,0),(-1,-1),'MIDDLE'),
            ('LEFTPADDING',   (0,0),(-1,-1),10),
            ('TOPPADDING',    (0,0),(-1,-1),6),
            ('BOTTOMPADDING', (0,0),(-1,-1),6),
        ]))
        story.append(sev_table)
        story.append(Spacer(1, 20))

    # ── Annotated Images ──────────────────────────────────────────────────────
    if defects and image_paths:
        story.append(Paragraph("<b>Annotated Images — Dual Model Detections</b>", styles["Heading2"]))
        story.append(Paragraph(
            "<font color='#6b7280' size=8>Blue/green boxes = part detections; Purple boxes = severity-only detections</font>",
            styles["Normal"]
        ))
        story.append(Spacer(1, 12))
        image_grid_data = []
        row = []
        for idx, img_path in enumerate(image_paths):
            try:
                row.append(Image(img_path, width=8*cm, height=5*cm))
                if len(row) == 2:
                    image_grid_data.append(row); row = []
            except Exception as e:
                print(f"Error loading image {idx}: {e}")
        if row:
            image_grid_data.append(row)
        if image_grid_data:
            image_table = Table(image_grid_data, colWidths=[8.5*cm, 8.5*cm])
            image_table.setStyle(TableStyle([
                ('ALIGN',         (0,0),(-1,-1),'CENTER'),
                ('VALIGN',        (0,0),(-1,-1),'MIDDLE'),
                ('LEFTPADDING',   (0,0),(-1,-1),5),
                ('RIGHTPADDING',  (0,0),(-1,-1),5),
                ('TOPPADDING',    (0,0),(-1,-1),5),
                ('BOTTOMPADDING', (0,0),(-1,-1),5),
            ]))
            story.append(image_table)
        story.append(Spacer(1, 24))

    # ── Disclaimer ────────────────────────────────────────────────────────────
    story.append(Paragraph(
        "<i>This report was generated using the unified MEHRA inspection pipeline: physical defect detection "
        "with a 7-class part model and severity model, engine sound knock classification, "
        "and Groq LLaMA 3.3 for report analysis. Results should be verified by a qualified technician.</i>",
        ParagraphStyle("Disclaimer", parent=styles["Normal"],
                       fontSize=9, textColor=colors.grey, alignment=1, spaceBefore=20)
    ))

    try:
        doc.build(story)
    except Exception as e:
        raise Exception(f"Failed to build PDF: {e}")


def verify_annotated_capture_with_groq(
    image_path: str,
    defect_labels: list,
    groq_post_fn,
    groq_api_key: str,
    vision_models: list,
) -> dict:
    """
    Second-step QA: Groq vision verifies a Roboflow-annotated capture.
    Returns {valid: bool, reason: str}.
    """
    import base64

    if not os.path.exists(image_path):
        return {"valid": False, "reason": "Image file not found"}

    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    data_url = f"data:image/jpeg;base64,{b64}"

    labels = ", ".join(defect_labels) if defect_labels else "vehicle body damage"
    prompt = (
        "You are a vehicle damage inspection QA expert. "
        f"This image was annotated by an AI detector (Roboflow) claiming: {labels}. "
        "Bounding boxes are drawn on the image. "
        "Determine if the annotations are CORRECT — real visible vehicle damage at the marked locations. "
        "Reply with ONLY valid JSON, no markdown: "
        '{"valid": true or false, "reason": "brief explanation"}. '
        "Set valid=false for false positives (reflections, shadows, background objects, "
        "mislabeled parts, or no real damage)."
    )

    last_error = "Verification failed"
    for model in vision_models:
        try:
            payload = {
                "model": model,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": data_url, "detail": "low"}},
                    ],
                }],
                "temperature": 0.0,
                "max_tokens": 256,
            }
            res = groq_post_fn(payload, groq_api_key, 30)
            if not res.ok:
                last_error = f"HTTP {res.status_code}"
                continue
            text = (
                res.json().get("choices", [{}])[0]
                .get("message", {}).get("content", "") or ""
            ).strip()
            clean = re.sub(r"```json\s*|```\s*", "", text, flags=re.IGNORECASE).strip()
            parsed = json.loads(clean)
            return {
                "valid": bool(parsed.get("valid")),
                "reason": str(parsed.get("reason", ""))[:200],
            }
        except Exception as e:
            last_error = str(e)
            continue

    # If Groq unavailable, accept capture (don't block pipeline)
    return {"valid": True, "reason": f"Groq verification skipped: {last_error}"}
