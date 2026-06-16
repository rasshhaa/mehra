"""
AutoVault — automated accident intake (voice, OCR, police ref rules, RTA/insurer mocks).
"""

from __future__ import annotations

import base64
import json
import re
import time
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple

import requests

GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_WHISPER_MODEL = "whisper-large-v3-turbo"
GROQ_TEXT_MODEL = "llama-3.3-70b-versatile"


def infer_lighting(hour: Optional[int] = None) -> str:
    h = hour if hour is not None else datetime.now().hour
    if h < 6 or h >= 20:
        return "Night / artificial lighting"
    if 6 <= h < 8 or 18 <= h < 20:
        return "Dawn / dusk — reduced visibility"
    return "Daylight"


def fetch_weather_context(lat: float, lon: float) -> dict:
    """Open-Meteo — no API key required."""
    try:
        url = (
            "https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            "&current=temperature_2m,weather_code,wind_speed_10m,is_day"
            "&timezone=auto"
        )
        r = requests.get(url, timeout=8)
        r.raise_for_status()
        cur = (r.json() or {}).get("current") or {}
        code = int(cur.get("weather_code") or 0)
        weather_map = {
            0: "Clear / dry",
            1: "Mainly clear",
            2: "Partly cloudy",
            3: "Overcast",
            45: "Fog / low visibility",
            48: "Depositing rime fog",
            51: "Light drizzle",
            61: "Light rain",
            63: "Moderate rain",
            65: "Heavy rain",
            71: "Light snow",
            95: "Thunderstorm",
        }
        label = weather_map.get(code, "Clear / dry")
        if code in (45, 48):
            label = "Fog / low visibility"
        return {
            "weather": label,
            "temperature_c": cur.get("temperature_2m"),
            "wind_kmh": cur.get("wind_speed_10m"),
            "is_day": bool(cur.get("is_day", 1)),
            "lighting": infer_lighting(datetime.now().hour if cur.get("is_day") else 21),
            "source": "open-meteo",
        }
    except Exception as e:
        return {
            "weather": "Clear / dry",
            "lighting": infer_lighting(),
            "source": "fallback",
            "error": str(e),
        }


def _groq_vision_json(
    groq_post: Callable,
    api_key: str,
    prompt: str,
    image_path: str,
    vision_models: List[str],
) -> dict:
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    last_err = ""
    for model in vision_models:
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    ],
                }
            ],
            "temperature": 0.1,
            "max_tokens": 600,
        }
        try:
            res = groq_post(payload, api_key, 45)
            if not res.ok:
                last_err = res.text[:200]
                continue
            raw = (res.json().get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
            clean = raw
            if clean.startswith("```"):
                clean = "\n".join(clean.split("\n")[1:])
            if clean.endswith("```"):
                clean = "\n".join(clean.split("\n")[:-1])
            return json.loads(clean.strip())
        except Exception as e:
            last_err = str(e)
    raise ValueError(last_err or "Groq vision failed")


def parse_plate_photo(image_path: str, groq_post: Callable, api_key: str, vision_models: List[str]) -> dict:
    prompt = """You are a UAE vehicle plate OCR assistant. Read the license plate from this photo.
Respond ONLY with JSON:
{
  "plate_number": "<e.g. A 12345>",
  "emirate": "<Dubai|Abu Dhabi|Sharjah|Ajman|RAK|Fujairah|UAQ|unknown>",
  "plate_confidence": <0-100>,
  "vehicle_color": "<if visible or unknown>",
  "vehicle_make": "<if visible or unknown>",
  "notes": "<short>"
}"""
    try:
        data = _groq_vision_json(groq_post, api_key, prompt, image_path, vision_models)
    except Exception:
        data = {
            "plate_number": "",
            "emirate": "unknown",
            "plate_confidence": 0,
            "vehicle_color": "unknown",
            "vehicle_make": "unknown",
            "notes": "Could not read plate — owner may re-photograph.",
        }
    plate = re.sub(r"\s+", " ", str(data.get("plate_number") or "").strip().upper())
    data["plate_number"] = plate
    return data


def parse_police_screenshot(image_path: str, groq_post: Callable, api_key: str, vision_models: List[str]) -> dict:
    prompt = """You are a UAE traffic accident report OCR assistant. This image is a screenshot from Dubai Police, Muroor, or RTA traffic app.
Extract:
{
  "police_reference": "<report number / reference if visible>",
  "reporting_track": "<police_attended|self_report|unknown>",
  "fault_split": "<not_at_fault|at_fault|shared_fault|unknown>",
  "claim_type": "<third_party_property|own_damage|comprehensive|unknown>",
  "incident_date": "<YYYY-MM-DD or empty>",
  "incident_time": "<HH:MM or empty>",
  "location_hint": "<if visible>",
  "confidence": <0-100>,
  "notes": "<short>"
}
Rules:
- If a formal police/Muroor reference number is visible → reporting_track police_attended.
- If app shows self-report / minor accident e-report without officer → self_report.
- fault_split from text like "100% other party", "50-50", "at fault".
"""
    try:
        data = _groq_vision_json(groq_post, api_key, prompt, image_path, vision_models)
    except Exception:
        data = {
            "police_reference": "",
            "reporting_track": "unknown",
            "fault_split": "unknown",
            "claim_type": "unknown",
            "confidence": 0,
            "notes": "OCR could not parse screenshot.",
        }
    return classify_from_police_data(data)


def classify_from_police_data(data: dict) -> dict:
    """Normalize police OCR + apply UAE track / claim-type rules."""
    ref = str(data.get("police_reference") or "").strip()
    track = str(data.get("reporting_track") or "unknown").lower()
    fault = str(data.get("fault_split") or "unknown").lower()
    claim_type = str(data.get("claim_type") or "unknown").lower()

    if ref and track == "unknown":
        track = "police_attended"
    if not ref and track == "unknown":
        track = "self_report"

    if fault in ("not_at_fault", "not at fault", "other_party", "other party"):
        fault = "not_at_fault"
        if claim_type == "unknown":
            claim_type = "third_party_property"
    elif fault in ("at_fault", "at fault", "self"):
        fault = "at_fault"
        if claim_type == "unknown":
            claim_type = "own_damage"
    elif fault in ("shared", "50-50", "50/50", "shared_fault"):
        fault = "shared_fault"
        if claim_type == "unknown":
            claim_type = "comprehensive"

    if claim_type == "unknown" and track == "police_attended":
        claim_type = "third_party_property"

    data["police_reference"] = ref
    data["reporting_track"] = track
    data["fault_split"] = fault
    data["claim_type"] = claim_type
    return data


def transcribe_voice_note(audio_path: str, api_key: str) -> str:
    with open(audio_path, "rb") as f:
        res = requests.post(
            GROQ_TRANSCRIBE_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (audio_path.split("/")[-1] or "voice.webm", f)},
            data={"model": GROQ_WHISPER_MODEL, "language": "en", "response_format": "json"},
            timeout=60,
        )
    res.raise_for_status()
    return str((res.json() or {}).get("text") or "").strip()


def extract_voice_intake(transcript: str, api_key: str, groq_post: Callable) -> dict:
    """Whisper transcript → LLaMA structured intake driving the accident flow."""
    transcript = (transcript or "").strip()
    if not transcript:
        return {
            "transcript": "",
            "formal_description": "",
            "other_vehicles_involved": False,
            "incident_type": "single_vehicle",
            "injuries": False,
            "injuries_label": "No injuries — property only",
            "collision": False,
        }

    prompt = f"""You analyze spoken UAE motor accident accounts for an insurer intake app.

Transcript:
{transcript}

Respond ONLY with JSON:
{{
  "formal_description": "<3-5 sentence formal insurer narrative, past tense, neutral>",
  "other_vehicles_involved": <true if another car/vehicle/driver was involved, else false>,
  "incident_type": "<single_vehicle|collision>",
  "injuries": <true if anyone was hurt, else false>,
  "injuries_label": "<No injuries — property only|Minor injuries reported|Serious injuries — emergency services>",
  "collision": <true if two or more vehicles collided, false for solo incidents like hitting a wall>
}}

Rules:
- other_vehicles_involved=true if they mention another car, driver, vehicle, truck, taxi, etc.
- incident_type=collision when two+ vehicles; single_vehicle for pole/wall/parking solo damage.
- injuries=true if pain, hospital, ambulance, hurt, injured mentioned."""
    payload = {
        "model": GROQ_TEXT_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.15,
        "max_tokens": 500,
    }
    res = groq_post(payload, api_key, 35)
    fallback = {
        "transcript": transcript,
        "formal_description": transcript,
        "other_vehicles_involved": any(
            w in transcript.lower()
            for w in ("other car", "other driver", "other vehicle", "rear-ended", "hit me", "collision", "third party")
        ),
        "incident_type": "collision"
        if any(w in transcript.lower() for w in ("other", "collision", "rear", "hit me", "their car"))
        else "single_vehicle",
        "injuries": any(w in transcript.lower() for w in ("injur", "hurt", "hospital", "ambulance", "pain")),
        "injuries_label": "No injuries — property only",
        "collision": "collision" in transcript.lower() or "other car" in transcript.lower(),
    }
    if not res.ok:
        return fallback
    raw = (res.json().get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
    try:
        clean = raw
        if clean.startswith("```"):
            clean = "\n".join(clean.split("\n")[1:])
        if clean.endswith("```"):
            clean = "\n".join(clean.split("\n")[:-1])
        out = json.loads(clean.strip())
        out["transcript"] = transcript
        out["other_vehicles_involved"] = bool(out.get("other_vehicles_involved"))
        out["injuries"] = bool(out.get("injuries"))
        out["collision"] = bool(out.get("collision", out.get("incident_type") == "collision"))
        if out.get("incident_type") not in ("single_vehicle", "collision"):
            out["incident_type"] = "collision" if out["other_vehicles_involved"] else "single_vehicle"
        if not out.get("injuries_label"):
            out["injuries_label"] = (
                "Serious injuries — emergency services"
                if out["injuries"]
                else "No injuries — property only"
            )
        return out
    except Exception:
        return fallback


def formalize_incident_narrative(transcript: str, api_key: str, groq_post: Callable) -> dict:
    """Legacy wrapper — prefer extract_voice_intake for the 5-step accident flow."""
    out = extract_voice_intake(transcript, api_key, groq_post)
    return {
        "transcript": out.get("transcript", ""),
        "formal_description": out.get("formal_description", ""),
        "injuries": out.get("injuries_label", "No injuries — property only"),
        "third_party_mentioned": out.get("other_vehicles_involved", False),
        **out,
    }


def get_approved_garages_for_insurer(insurer: str) -> List[dict]:
    """Mock approved repair network per insurer."""
    name = (insurer or "Insurer").strip()
    network = {
        "Oman Insurance Company": [
            {"name": "Al Quoz Auto Works", "address": "Al Quoz Industrial 3, Dubai", "rating": 4.8, "distance_km": 3.2},
            {"name": "Marina Motors Repair", "address": "Dubai Marina, Dubai", "rating": 4.6, "distance_km": 5.1},
        ],
        "Abu Dhabi National Insurance": [
            {"name": "ADNIC Certified Body Shop", "address": "Mussafah M-14, Abu Dhabi", "rating": 4.7, "distance_km": 4.0},
            {"name": "Khalifa City Motors", "address": "Khalifa City A, Abu Dhabi", "rating": 4.5, "distance_km": 6.8},
        ],
        "Orient Insurance": [
            {"name": "Orient Partner Garage", "address": "Al Barsha, Dubai", "rating": 4.6, "distance_km": 2.9},
            {"name": "JLT Auto Care", "address": "Jumeirah Lakes Towers, Dubai", "rating": 4.4, "distance_km": 4.5},
        ],
        "Tokio Marine": [
            {"name": "Tokio Marine Approved Center", "address": "Ras Al Khor, Dubai", "rating": 4.7, "distance_km": 7.2},
        ],
        "RSA Insurance": [
            {"name": "RSA Network Garage", "address": "Business Bay, Dubai", "rating": 4.5, "distance_km": 3.8},
        ],
    }
    for key, garages in network.items():
        if key.lower() in name.lower() or name.lower() in key.lower():
            return [{**g, "insurer": key, "approved": True} for g in garages]
    return [
        {"name": "AutoVault Partner Garage", "address": "Dubai — insurer network", "rating": 4.5, "distance_km": 4.0, "insurer": name, "approved": True},
        {"name": "Certified Collision Center", "address": "Sharjah Industrial Area", "rating": 4.3, "distance_km": 8.5, "insurer": name, "approved": True},
    ]


def resolve_target_insurer(
    fault_stance: str,
    owner_insurer: str,
    other_vehicles: bool,
    tp_insurance: Optional[dict] = None,
    police_ocr: Optional[dict] = None,
) -> dict:
    """fault_stance: victim | at_fault — which insurer receives the claim."""
    stance = (fault_stance or "").strip().lower()
    tp = tp_insurance or {}
    police = police_ocr or {}
    owner_ins = (owner_insurer or "—").strip()
    tp_ins = str(tp.get("insurance_company") or "").strip()

    if stance == "at_fault":
        return {
            "target_insurer": owner_ins,
            "routing": "own_damage",
            "rationale": "At-fault — claim filed with your insurer under own-damage / comprehensive.",
            "notify_insurer": owner_ins,
        }
    if other_vehicles and tp_ins:
        return {
            "target_insurer": tp_ins,
            "routing": "third_party_claim",
            "rationale": "Not at fault — third-party claim routed to the other driver's insurer.",
            "notify_insurer": tp_ins,
            "owner_insurer_copy": owner_ins,
        }
    claim_type = str(police.get("claim_type") or "")
    if claim_type == "third_party_property" and tp_ins:
        return {
            "target_insurer": tp_ins,
            "routing": "third_party_claim",
            "rationale": "Police track indicates third-party property — other insurer notified.",
            "notify_insurer": tp_ins,
            "owner_insurer_copy": owner_ins,
        }
    return {
        "target_insurer": owner_ins,
        "routing": "comprehensive",
        "rationale": "Not at fault — comprehensive claim with your insurer.",
        "notify_insurer": owner_ins,
    }


def mock_lookup_autovault_owner(plate: str) -> dict:
    """Mock: deterministic AutoVault owner match for third-party notification demos."""
    plate = re.sub(r"\s+", " ", (plate or "").strip().upper())
    if not plate:
        return {"found": False}
    digits = re.sub(r"\D", "", plate) or "0"
    if int(digits[-1]) % 2 == 0:
        return {
            "found": True,
            "ownerId": f"demo_owner_{digits[-4:]}",
            "ownerEmail": f"owner{digits[-4:]}@autovault.demo",
            "plate": plate,
            "source": "mock_plate_registry",
        }
    return {"found": False, "plate": plate, "source": "mock_plate_registry"}


def rta_insurance_verify(plate: str, emirate: str = "") -> dict:
    """
    Mock RTA insurance verification — deterministic demo data from plate hash.
  Production: replace with RTA e-insurance API.
    """
    plate = re.sub(r"\s+", " ", (plate or "").strip().upper())
    if not plate:
        return {"verified": False, "reason": "No plate supplied"}

    insurers = [
        {"company": "Oman Insurance Company", "policy_prefix": "OIC"},
        {"company": "Abu Dhabi National Insurance", "policy_prefix": "ADNIC"},
        {"company": "Orient Insurance", "policy_prefix": "ORI"},
        {"company": "Tokio Marine", "policy_prefix": "TMN"},
        {"company": "RSA Insurance", "policy_prefix": "RSA"},
    ]
    idx = sum(ord(c) for c in plate) % len(insurers)
    ins = insurers[idx]
    digits = re.sub(r"\D", "", plate) or "12345"
    policy = f"{ins['policy_prefix']}-TP-{digits[-6:].zfill(6)}"
    return {
        "verified": True,
        "plate": plate,
        "emirate": emirate or "Dubai",
        "insurance_company": ins["company"],
        "policy_number": policy,
        "coverage_type": "Third Party Liability",
        "valid_until": datetime.now().replace(year=datetime.now().year + 1).strftime("%Y-%m-%d"),
        "source": "rta_insurance_verify_mock",
    }


def submit_insurer_claim_api(claim: dict) -> dict:
    """
    Mock insurer claims API — instant reference.
    Production: per-insurer REST adapter.
    """
    cid = str(claim.get("id") or claim.get("claim_id") or f"CLM-{int(time.time())}")
    insurer = str(claim.get("insuranceCompany") or claim.get("target_insurer") or "Insurer")
    prefix = "".join(w[0] for w in insurer.split()[:3]).upper() or "INS"
    ref = f"{prefix}-{datetime.now().year}-{cid[-8:].upper()}"
    return {
        "success": True,
        "insurer_reference": ref,
        "insurer": insurer,
        "status": "received",
        "submitted_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "message": "Claim received via AutoVault Claims API — no portal login required.",
        "api_mode": "mock",
    }


def build_auto_metadata(lat: Optional[float], lon: Optional[float], reverse_geocode: str = "") -> dict:
    now = datetime.now()
    ctx = fetch_weather_context(lat, lon) if lat is not None and lon is not None else {
        "weather": "Clear / dry",
        "lighting": infer_lighting(now.hour),
        "source": "default",
    }
    return {
        "incident_date": now.strftime("%Y-%m-%d"),
        "incident_time": now.strftime("%H:%M"),
        "timestamp_iso": now.isoformat(),
        "gps_coordinates": f"{lat},{lon}" if lat is not None and lon is not None else "",
        "incident_location": reverse_geocode or "",
        "weather": ctx.get("weather"),
        "lighting": ctx.get("lighting"),
        "temperature_c": ctx.get("temperature_c"),
        "road_conditions": "Wet road" if "rain" in str(ctx.get("weather", "")).lower() else "Dry road",
    }
