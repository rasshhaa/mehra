from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import shutil
import cv2
import os
import subprocess
import re
import time
import tempfile
import traceback
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional
from inference_sdk import InferenceHTTPClient
from report import generate_report, generate_ai_analysis
import base64
from dotenv import load_dotenv
#from garage_report import generate_garage_service_report
#from carlife_report import generate_car_life_report
import firebase_admin
from firebase_admin import credentials, firestore
import threading   
import glob


load_dotenv()
def _safe_firebase_write(collection: str, data: dict):
    """Write to Firebase only if connected, silently skip if not."""
    if db is None:
        return
    try:
        db.collection(collection).add({
            **data,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
    except Exception as e:
        print(f"⚠️ Firebase save failed: {e}")
# ── Firebase ──────────────────────────────────────────────────────────────────
# ── Firebase ──────────────────────────────────────────────────────────────────
db = None
try:
    if not firebase_admin._apps:
        cred = credentials.Certificate("serviceAccountKey.json")
        firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("✅ Firebase Connected!")
except Exception as e:
    print(f"⚠️ Firebase init failed: {e}")
    print("⚠️ Running without Firebase — inspections will work but won't be saved to Firestore")
    db = None

app = FastAPI(title="AI Vehicle Inspection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Roboflow clients ──────────────────────────────────────────────────────────
# Both models share the same API key and base URL
_RF_API_KEY = os.getenv("ROBOFLOW_API_KEY", "bUF0vK5fXo62uixEN4PN")

CLIENT = InferenceHTTPClient(
    api_url="https://serverless.roboflow.com",
    api_key=_RF_API_KEY
)

# Model IDs
VEHICLE_MODEL_ID  = os.getenv("ROBOFLOW_MODEL_ID", "car-damage-detection-t0g92/3")
SEVERITY_MODEL_ID = "car-damage-severity-detection-cardd/1"

# Thread pool for running both model calls in parallel
_executor = ThreadPoolExecutor(max_workers=4)

# ── Paths ─────────────────────────────────────────────────────────────────────
UPLOAD_DIR = "uploads"
STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "static")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

REPORT_PATH       = os.path.join(STATIC_DIR, "inspection_report.pdf")
GARAGE_REPORT_PATH = os.path.join(STATIC_DIR, "garage_service_report.pdf")
CARLIFE_REPORT_PATH = os.path.join(STATIC_DIR, "carlife_report.pdf")

# ── Class mappings ─────────────────────────────────────────────────────────────
# Model 1 — part detection (7 classes)
CLASS_MAPPING = {
    "bonnet":     "Bonnet",
    "bumper":     "Bumper",
    "dickey":     "Dickey",
    "door":       "Door",
    "fender":     "Fender",
    "light":      "Light",
    "windshield": "Windshield",
}

# Model 2 — severity detection classes
# Map raw Roboflow class names → normalised display names
SEVERITY_CLASS_MAPPING = {
    "car-part-crack":     "Part Crack",
    "detachment":         "Detachment",
    "flat-tire":          "Flat Tyre",
    "tire flat":          "Flat Tyre",
    "glass shatter":      "Shattered Glass",
    "glass-crack":        "Glass Crack",
    "lamp broken":        "Lamp Broken",
    "lamp-crack":         "Lamp Crack",
    "minor-deformation":  "Minor Dent",
    "minor-scratches":    "Minor Scratch",
    "moderate-deformation": "Moderate Dent",
    "paint-chips":        "Paint Chips",
    "scr":                "Scratch",
    "severe-deformation": "Severe Dent",
    "side-mirror-crack":  "Side Mirror Crack",
    "crack":              "Crack",
    "scratch":            "Scratch",
    "dent":               "Dent",
    "scratches":          "Scratch",
}

# Confidence thresholds for each model
PART_CONF_THRESHOLD     = 0.25   # Model 1 — lower threshold OK (parts are distinct)
SEVERITY_CONF_THRESHOLD = 0.20   # Model 2 — slightly more permissive for severity

# IoU threshold for matching a severity box to a part box
IOU_MATCH_THRESHOLD = 0.05   # low because boxes may not perfectly overlap

# Bounding-box colours per severity level
SEVERITY_COLORS = {
    "minor":    (0, 200, 100),    # green
    "moderate": (0, 140, 255),    # orange-blue
    "severe":   (0, 30,  220),    # red-ish
    "default":  (180, 0, 220),    # purple for unmatched severity detections
}

DEFECT_TYPE_LABELS = {
    "windshield": {"minor": "Surface Chip/Crack", "moderate": "Windshield Crack",    "severe": "Shattered/Major Crack"},
    "bonnet":     {"minor": "Surface Scratch",    "moderate": "Bonnet Dent",          "severe": "Crumple/Deep Impact"},
    "bumper":     {"minor": "Scuff/Scratch",       "moderate": "Bumper Dent/Crack",   "severe": "Bumper Collapse"},
    "fender":     {"minor": "Surface Scratch",    "moderate": "Fender Dent",          "severe": "Deep Dent/Crease"},
    "door":       {"minor": "Paint Scratch/Scuff","moderate": "Door Dent",            "severe": "Deep Dent/Panel Damage"},
    "dickey":     {"minor": "Surface Scratch",    "moderate": "Boot Dent",            "severe": "Deep Dent/Structural"},
    "light":      {"minor": "Cover Scratch",      "moderate": "Cracked Cover",        "severe": "Broken/Shattered"},
}


# ─────────────────────────────────────────────────────────────────────────────
# GEOMETRY HELPERS
# ─────────────────────────────────────────────────────────────────────────────
def _box_from_pred(pred: dict):
    """Return (x1, y1, x2, y2) from a Roboflow centre-format prediction."""
    x, y = pred["x"], pred["y"]
    w, h = pred["width"], pred["height"]
    return x - w / 2, y - h / 2, x + w / 2, y + h / 2


def _iou(a, b):
    """Intersection-over-Union of two (x1,y1,x2,y2) boxes."""
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1 = max(ax1, bx1); iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2); iy2 = min(ay2, by2)
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    if inter == 0:
        return 0.0
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    return inter / (area_a + area_b - inter)


def _severity_tier(class_name: str, confidence: float) -> str:
    cn = class_name.lower()
    if "minor"    in cn or "tiny"   in cn: return "minor"
    if "moderate" in cn:                   return "moderate"
    if "severe"   in cn or "broken" in cn: return "severe"
    if "flat"     in cn or "detach" in cn: return "severe"
    if "shatter"  in cn:                   return "severe"
    if "crack"    in cn or "glass"  in cn: return "moderate"
    if "paint"    in cn or "chip"   in cn: return "minor"
    if "scratch"  in cn or "scr"    == cn: return "minor"
    if "dent"     in cn:                   return "moderate"
    # Confidence fallback — only reached for unrecognised class names
    if confidence >= 80: return "severe"
    if confidence >= 55: return "moderate"
    return "minor"

def _normalise_severity_class(raw: str) -> str:
    key = raw.lower().strip().replace(" ", "-").replace("_", "-")
    # Try exact match first
    for k, v in SEVERITY_CLASS_MAPPING.items():
        if k.replace("_", "-") == key:
            return v
    # Partial match
    for k, v in SEVERITY_CLASS_MAPPING.items():
        if k.replace("_", "-") in key or key in k.replace("_", "-"):
            return v
    # Capitalise raw name as fallback
    return raw.replace("-", " ").replace("_", " ").title()


def get_defect_type_label(part_key: str, confidence: float) -> str:
    safety_parts = {"windshield", "light", "bonnet"}
    if part_key in safety_parts:
        tier = "severe" if confidence >= 50 else "moderate" if confidence >= 30 else "minor"
    else:
        tier = "severe" if confidence >= 80 else "moderate" if confidence >= 55 else "minor"
    result = DEFECT_TYPE_LABELS.get(part_key, {}).get(tier,
        f"{part_key.replace('_', ' ').title()} Damage")
    print(f"[DefectLabel] part={part_key} conf={confidence} tier={tier} → {result}")
    return result


# ─────────────────────────────────────────────────────────────────────────────
# DUAL-MODEL INFERENCE
# ─────────────────────────────────────────────────────────────────────────────
def _run_model1(image_path: str) -> dict:
    """Run the 7-class part-detection model (blocking)."""
    try:
        return CLIENT.infer(image_path, model_id=VEHICLE_MODEL_ID)
    except Exception as e:
        print(f"[Model1] inference error: {e}")
        return {"predictions": []}


def _run_model2(image_path: str) -> dict:
    """Run the severity-detection model (blocking)."""
    try:
        return CLIENT.infer(image_path, model_id=SEVERITY_MODEL_ID)
    except Exception as e:
        print(f"[Model2] inference error: {e}")
        return {"predictions": []}


async def _run_both_models(image_path: str):
    """Run both models concurrently and return (model1_result, model2_result)."""
    loop = asyncio.get_event_loop()
    m1_future = loop.run_in_executor(_executor, _run_model1, image_path)
    m2_future = loop.run_in_executor(_executor, _run_model2, image_path)
    m1_result, m2_result = await asyncio.gather(m1_future, m2_future)
    return m1_result, m2_result


def _merge_predictions(part_preds: list, severity_preds: list):
    """
    Merge predictions from both models.

    Returns:
        merged_defects  — list of dicts for the /inspect response
        enriched_parts  — part_preds augmented with matched severity info
        unmatched_sev   — severity_preds that didn't match any part box
    """
    # Filter by confidence
    part_preds = [p for p in part_preds     if p.get("confidence", 0) >= PART_CONF_THRESHOLD]
    sev_preds  = [p for p in severity_preds if p.get("confidence", 0) >= SEVERITY_CONF_THRESHOLD]

    # Pre-compute boxes
    part_boxes = [_box_from_pred(p) for p in part_preds]
    sev_boxes  = [_box_from_pred(p) for p in sev_preds]

    # Match each severity prediction to its best-overlapping part prediction
    sev_matched = [False] * len(sev_preds)
    enriched = []
    for pi, part in enumerate(part_preds):
        best_sev = None
        best_iou = IOU_MATCH_THRESHOLD
        best_si  = -1
        for si, sev in enumerate(sev_preds):
            iou = _iou(part_boxes[pi], sev_boxes[si])
            if iou > best_iou:
                best_iou = iou
                best_sev = sev
                best_si  = si
        enriched.append({
            "part_pred":  part,
            "sev_pred":   best_sev,      # None if no match
            "iou":        best_iou if best_sev else 0,
        })
        if best_si >= 0:
            sev_matched[best_si] = True

    unmatched_sev = [sev_preds[i] for i, m in enumerate(sev_matched) if not m]

    # Build merged defect list
    merged_defects = []

    # From matched parts (+ optional severity)
    for entry in enriched:
        part  = entry["part_pred"]
        sev   = entry["sev_pred"]
        cn    = part["class"].lower().strip()
        label = CLASS_MAPPING.get(cn, cn.capitalize())
        conf  = round(part["confidence"] * 100, 1)

        if sev:
            sev_raw   = sev["class"]
            sev_label = _normalise_severity_class(sev_raw)
            sev_tier  = _severity_tier(sev_raw, round(sev["confidence"] * 100, 1))
            sev_conf  = round(sev["confidence"] * 100, 1)
            # Boost confidence slightly when both models agree
            effective_conf = min(99.9, max(conf, sev_conf) * 1.05)
            merged_defects.append({
                "label":          f"{label} — {sev_label}",
                "part":           label,
                "severity_class": sev_label,
                "severity_tier":  sev_tier,
                "confidence":     round(effective_conf, 1),
                "part_conf":      conf,
                "severity_conf":  sev_conf,
                "source":         "both_models",
            })
        else:
            # Part detected but no severity match — use confidence-based tier
            tier  = get_defect_type_label(cn, conf)
            merged_defects.append({
                "label":          f"{label} — {tier}",
                "part":           label,
                "severity_class": tier,
                "severity_tier":  _severity_tier(cn, conf),
                "confidence":     conf,
                "part_conf":      conf,
                "severity_conf":  None,
                "source":         "model1_only",
            })

    # From unmatched severity detections (no part box matched)
    for sev in unmatched_sev:
        sev_raw   = sev["class"]
        sev_label = _normalise_severity_class(sev_raw)
        sev_tier  = _severity_tier(sev_raw, round(sev["confidence"] * 100, 1))
        sev_conf  = round(sev["confidence"] * 100, 1)
        merged_defects.append({
            "label":          sev_label,
            "part":           sev_label,
            "severity_class": sev_label,
            "severity_tier":  sev_tier,
            "confidence":     sev_conf,
            "part_conf":      None,
            "severity_conf":  sev_conf,
            "source":         "model2_only",
        })

    return merged_defects, enriched, unmatched_sev


# ─────────────────────────────────────────────────────────────────────────────
# ANNOTATION DRAWING
# ─────────────────────────────────────────────────────────────────────────────
def draw_annotation(image, pred, label_override: str = None, color_override=None):
    """Draw a single bounding box + label on the image (in-place)."""
    x, y = int(pred["x"]), int(pred["y"])
    w, h = int(pred["width"]), int(pred["height"])
    cn   = pred["class"].lower().strip()
    cf   = round(pred["confidence"] * 100, 1)

    display_label = label_override or f"{cn.capitalize()} {cf}%"
    x1, y1 = x - w // 2, y - h // 2
    x2, y2 = x + w // 2, y + h // 2

    box_color = color_override or (
        (0, 0, 220) if cf >= 80 else (0, 120, 255) if cf >= 55 else (0, 200, 255)
    )
    cv2.rectangle(image, (x1, y1), (x2, y2), box_color, 3)
    font, font_scale, thickness = cv2.FONT_HERSHEY_SIMPLEX, 0.60, 2
    (tw, th), _ = cv2.getTextSize(display_label, font, font_scale, thickness)
    cv2.rectangle(image, (x1, y1 - th - 10), (x1 + tw + 10, y1), box_color, -1)
    cv2.putText(image, display_label, (x1 + 5, y1 - 6), font, font_scale, (255, 255, 255), thickness)

def annotate_with_dual_model(image, enriched_parts, unmatched_sev):
    safety_parts = {"windshield", "light", "bonnet"}

    for entry in enriched_parts:
        part = entry["part_pred"]
        sev  = entry["sev_pred"]
        cn   = part["class"].lower().strip()
        cf   = round(part["confidence"] * 100, 1)

        if sev:
            sev_raw   = sev["class"]
            sev_label = _normalise_severity_class(sev_raw)
            sev_tier  = _severity_tier(sev_raw, round(sev["confidence"] * 100, 1))
            part_name = CLASS_MAPPING.get(cn, cn.capitalize())

            # ── Override for safety-critical parts ──────────────────────────
            if cn in safety_parts and cf >= 50:
                sev_tier  = "severe"
                sev_label = DEFECT_TYPE_LABELS.get(cn, {}).get("severe", sev_label)

            label = f"{part_name}: {sev_label} ({cf}%)"
            color = SEVERITY_COLORS.get(sev_tier, SEVERITY_COLORS["default"])

        else:
            dtype = get_defect_type_label(cn, cf)
            label = f"{CLASS_MAPPING.get(cn, cn.capitalize())}: {dtype} ({cf}%)"
            color = (0, 120, 255) if cf >= 55 else (0, 200, 255)

        draw_annotation(image, part, label_override=label, color_override=color)

    for sev in unmatched_sev:
        sev_raw   = sev["class"]
        sev_label = _normalise_severity_class(sev_raw)
        sev_conf  = round(sev["confidence"] * 100, 1)
        draw_annotation(
            image, sev,
            label_override=f"{sev_label} ({sev_conf}%)",
            color_override=SEVERITY_COLORS["default"],
        )
# ─────────────────────────────────────────────────────────────────────────────
# ENGINE MODEL (unchanged from original)
# ─────────────────────────────────────────────────────────────────────────────
_engine_extractor = _engine_model = _engine_labels = None
_engine_target_sr = 16000

KNOCK_LABEL_KEYS = {"knock", "knocking", "engine_knock", "defective", "fault", "faulty"}
CLEAN_LABEL_KEYS = {"no_knock", "no knock", "clean", "healthy", "normal", "ok", "good"}


def _label_is_knock(label: str) -> bool:
    l = label.lower().replace("-", "_").replace(" ", "_")
    for c in CLEAN_LABEL_KEYS:
        if c.replace(" ", "_") in l: return False
    for k in KNOCK_LABEL_KEYS:
        if k.replace(" ", "_") in l: return True
    return "knock" in l and not l.startswith("no")


def _get_engine_model():
    global _engine_extractor, _engine_model, _engine_labels, _engine_target_sr
    if _engine_model is not None:
        return _engine_extractor, _engine_model, _engine_labels, _engine_target_sr
    try:
        from transformers import AutoFeatureExtractor, AutoModelForAudioClassification
        import torch
        _engine_extractor = AutoFeatureExtractor.from_pretrained("MIT/ast-finetuned-audioset-10-10-0.4593")
        _engine_model     = AutoModelForAudioClassification.from_pretrained("cxlrd/revix-AST-engine-knock")
        _engine_model.eval()
        _engine_labels    = _engine_model.config.id2label
        _engine_target_sr = getattr(_engine_extractor, "sampling_rate", 16000)
        return _engine_extractor, _engine_model, _engine_labels, _engine_target_sr
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Engine model unavailable: {str(e)}")


def _convert_to_wav(input_path: str, target_sr: int) -> str:
    wav_path = input_path + "_converted.wav"
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-ar", str(target_sr), "-ac", "1", "-f", "wav", wav_path],
        capture_output=True, timeout=60,
    )
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Audio conversion failed: {result.stderr.decode(errors='replace')[-600:]}")
    return wav_path


def _build_engine_result(
    verdict: Optional[str] = None,
    is_knock: Optional[str] = None,
    confidence: Optional[str] = None,
    duration: Optional[str] = None,
):
    if not verdict or not verdict.strip():
        return None
    return {
        "verdict": verdict.strip(),
        "is_knock": (is_knock or "").strip().lower() in {"true", "1", "yes", "knock", "knocking"},
        "confidence": float(confidence or 0),
        "duration_s": float(duration or 0),
    }


async def _analyze_engine_upload(audio: UploadFile) -> dict:
    try:
        import librosa, torch
    except ImportError:
        raise HTTPException(status_code=503, detail="Audio libraries not installed.")

    extractor, model, labels, target_sr = _get_engine_model()
    suffix = os.path.splitext(audio.filename or "audio.webm")[-1].lower() or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(audio.file, tmp)
        raw_path = tmp.name

    wav_path = None
    try:
        try:
            wav_path = _convert_to_wav(raw_path, target_sr)
        except FileNotFoundError:
            wav_path = raw_path
        waveform, _ = librosa.load(wav_path, sr=target_sr, mono=True)
        waveform    = waveform.astype("float32")
        duration_s  = round(len(waveform) / target_sr, 2)
        inputs      = extractor(waveform, sampling_rate=target_sr, return_tensors="pt")
        with torch.no_grad():
            logits = model(**inputs).logits
        probs     = torch.softmax(logits, dim=-1)[0]
        scores    = {labels[i]: float(probs[i]) for i in range(len(probs))}
        top_label = max(scores, key=scores.get)
        return {
            "verdict": top_label,
            "is_knock": _label_is_knock(top_label),
            "confidence": round(scores[top_label] * 100, 2),
            "scores": [{"label": k, "score": round(v, 6)} for k, v in scores.items()],
            "model": "cxlrd/revix-AST-engine-knock",
            "sample_rate": target_sr,
            "audio_file": audio.filename,
            "duration_s": duration_s,
        }
    finally:
        for path in (raw_path, wav_path):
            if path and os.path.exists(path):
                try: os.remove(path)
                except: pass


# ─────────────────────────────────────────────────────────────────────────────
# LIVE CAMERA STATE
# ─────────────────────────────────────────────────────────────────────────────
captured_frames      = []
captured_defect_types = set()
captured_all_defects  = []


# ─────────────────────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ─────────────────────────────────────────────────────────────────────────────
class AIAnalysisRequest(BaseModel):
    defects_detected:    list
    unique_defect_types: int = 0
    vehicle_info:        dict = {}
    engine_result:       Optional[dict] = None
    overall_status:      str = ""


class _EngineResult(BaseModel):
    verdict:    str   = ""
    is_knock:   bool  = False
    confidence: float = 0.0
    duration_s: float = 0.0


class _VehicleInfo(BaseModel):
    vin:     str = ""
    make:    str = ""
    model:   str = ""
    year:    str = ""
    mileage: str = ""


class GenerateReportRequest(BaseModel):
    defects_detected:    list
    annotated_images:    List[str]
    image_count:         int = 0
    unique_defect_types: int = 0
    vehicle_info:        _VehicleInfo = _VehicleInfo()
    engine_result:       Optional[_EngineResult] = None


class InsuranceClaimRequest(BaseModel):
    ownerId: str = "";    ownerName: str = "";   ownerEmail: str = ""
    ownerPhone: str = ""; insurerId: str = "";   insurerName: str = ""
    policyNumber: str = ""; vehiclePlate: str = ""; vehicleMake: str = ""
    vehicleModel: str = ""; vehicleYear: str = ""; incidentDate: str = ""
    description: str = ""; status: str = "pending"


class GarageReportRequest(BaseModel):
    appointment:        dict = {}
    vehicle_info:       dict = {}
    services_completed: list = []
    defects_from_ai:    list = []
    insurance_approved: bool = False
    approved_amount:    str  = ""
    technician_name:    str  = ""
    technician_notes:   str  = ""


class CarLifeReportRequest(BaseModel):
    vehicle_info: dict = {}
    inspections:  list = []
    services:     list = []
    appointments: list = []
    owner_name:   str  = ""


# ─────────────────────────────────────────────────────────────────────────────
# HELPER — convert merged defect dicts to the legacy (label, confidence) tuples
# so report.py / generate_ai_analysis remain unchanged
# ─────────────────────────────────────────────────────────────────────────────
def _to_legacy_defects(merged: list) -> list:
    """Convert merged defect dicts → [(label_str, confidence_float), ...]"""
    return [(d["label"], d["confidence"]) for d in merged]


# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/ai-analysis")
async def ai_analysis_endpoint(req: AIAnalysisRequest):
    defects_norm = []
    for d in req.defects_detected:
        if isinstance(d, (list, tuple)) and len(d) >= 2:
            defects_norm.append((str(d[0]), float(d[1])))
        elif isinstance(d, dict):
            name = d.get("label") or d.get("class") or d.get("name") or "Unknown"
            defects_norm.append((name, float(d.get("confidence", 0))))
    overall_status = req.overall_status
    if not overall_status:
        ut = req.unique_defect_types or len({d[0].lower() for d in defects_norm})
        overall_status = "FAIL" if req.engine_result and req.engine_result.get("is_knock") else "PASS" if ut == 0 else "ATTENTION" if ut <= 2 else "FAIL"
    try:
        result = generate_ai_analysis(
            defects=defects_norm, vehicle_info=req.vehicle_info,
            engine_result=req.engine_result, overall_status=overall_status
        )
        return {"success": True, "ai_analysis": result, "overall_status": overall_status}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


@app.post("/analyze-engine")
async def analyze_engine(audio: UploadFile = File(...)):
    try:
        return await _analyze_engine_upload(audio)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Audio analysis failed: {str(e)}")


@app.post("/detect-live")
async def detect_live(file: UploadFile = File(...)):
    """Live camera — only uses Model 1 for speed; severity in final report."""
    global captured_frames, captured_defect_types, captured_all_defects
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    temp_path = os.path.join(UPLOAD_DIR, "temp_frame.jpg")
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    try:
        result      = _run_model1(temp_path)
        predictions = result.get("predictions", [])
        frame       = cv2.imread(temp_path)
        defects, new_defect = [], False
        for pred in predictions:
            cn = pred["class"].lower().strip()
            cf = round(pred["confidence"] * 100, 1)
            if cf < PART_CONF_THRESHOLD * 100:
                continue
            dn = CLASS_MAPPING.get(cn, cn.capitalize())
            defects.append({"class": dn, "confidence": cf})
            if cn not in captured_defect_types:
                captured_defect_types.add(cn)
                new_defect = True
        ann = frame.copy()
        for pred in predictions:
            cn = pred["class"].lower().strip()
            cf = round(pred["confidence"] * 100, 1)
            dtype = get_defect_type_label(cn, cf)
            draw_annotation(ann, pred, label_override=f"{CLASS_MAPPING.get(cn, cn.capitalize())}: {dtype} ({cf}%)")
        if new_defect and predictions:
            cp = os.path.join(STATIC_DIR, f"capture_{len(captured_frames)}.jpg")
            cv2.imwrite(cp, ann)
            captured_frames.append(cp)
            for pred in predictions:
                cn = pred["class"].lower().strip()
                captured_all_defects.append((CLASS_MAPPING.get(cn, cn.capitalize()), round(pred["confidence"] * 100, 1)))
        _, buf2 = cv2.imencode(".jpg", ann)
        return JSONResponse({
            "success": True, "defects": defects, "count": len(defects),
            "new_capture": new_defect and bool(predictions),
            "total_captures": len(captured_frames), "unique_defects": len(captured_defect_types),
            "annotated_frame": base64.b64encode(buf2).decode("utf-8"),
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detection failed: {str(e)}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/finalize-live-detection")
async def finalize_live_detection(
    vin: Optional[str] = Form(None), make: Optional[str] = Form(None),
    model: Optional[str] = Form(None), year: Optional[str] = Form(None),
    mileage: Optional[str] = Form(None), engine_verdict: Optional[str] = Form(None),
    engine_is_knock: Optional[str] = Form(None), engine_confidence: Optional[str] = Form(None),
    engine_duration: Optional[str] = Form(None),
):
    global captured_frames, captured_defect_types, captured_all_defects
    if not captured_frames:
        raise HTTPException(status_code=400, detail="No frames captured")
    all_defects  = captured_all_defects.copy()
    vehicle_info = {
        "vin": vin or "Not Provided", "make": make or "Not Provided",
        "model": model or "Not Provided", "year": year or "Not Provided", "mileage": mileage or "Not Provided"
    }
    engine_result = _build_engine_result(engine_verdict, engine_is_knock, engine_confidence, engine_duration)
    ut = len(captured_defect_types)
    overall_status = "FAIL" if engine_result and engine_result.get("is_knock") else "PASS" if ut == 0 else "ATTENTION" if ut <= 2 else "FAIL"
    ai_analysis = generate_ai_analysis(all_defects, vehicle_info, engine_result, overall_status)
    try:
        generate_report(all_defects, captured_frames, REPORT_PATH, vehicle_info,
                        engine_result=engine_result, ai_analysis=ai_analysis)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Report failed: {str(e)}")
    _safe_firebase_write("inspections", {
        "vehicle_info":  vehicle_info,
        "defects":       [{"part": d[0], "confidence": d[1]} for d in all_defects],
        "engine_result": engine_result,
        "overall_status": overall_status,
        "ai_analysis":   ai_analysis,
    })
    ann = [f"static/{os.path.basename(p)}" for p in captured_frames]
    captured_frames = []; captured_defect_types = set(); captured_all_defects = []
    return {
        "message": "Live detection report generated", "image_count": len(ann),
        "total_defects_detected": len(all_defects), "unique_defect_types": ut,
        "defects_detected": all_defects, "annotated_images": ann,
        "engine_result": engine_result, "ai_analysis": ai_analysis,
    }


@app.post("/reset-live-detection")
async def reset_live_detection():
    global captured_frames, captured_defect_types, captured_all_defects
    for p in captured_frames:
        if os.path.exists(p):
            try: os.remove(p)
            except: pass
    captured_frames = []; captured_defect_types = set(); captured_all_defects = []
    return {"message": "Live detection reset"}


# ── /inspect — DUAL-MODEL ─────────────────────────────────────────────────────
@app.post("/inspect")
async def inspect_vehicle(
    files:             List[UploadFile] = File(...),
    engine_audio:      Optional[UploadFile] = File(None),
    vin:               Optional[str]    = Form(None),
    make:              Optional[str]    = Form(None),
    model:             Optional[str]    = Form(None),
    year:              Optional[str]    = Form(None),
    mileage:           Optional[str]    = Form(None),
    inspection_type:   Optional[str]    = Form(None),
    engine_verdict:    Optional[str]    = Form(None),
    engine_is_knock:   Optional[str]    = Form(None),
    engine_confidence: Optional[str]    = Form(None),
    engine_duration:   Optional[str]    = Form(None),
):
    if not files:
        raise HTTPException(status_code=400, detail="At least one image file is required")
    for f in files:
        if not f.content_type or not f.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="All uploaded files must be images")

    all_merged_defects     = []   # enriched dicts
    all_merged_legacy      = []   # (label, conf) tuples for report.py
    annotated_image_paths  = []

    # Delete stale annotated images from previous runs
    
    for old_file in glob.glob(os.path.join(STATIC_DIR, "annotated_*.jpg")):
        try:
            os.remove(old_file)
        except:
            pass

    for idx, file in enumerate(files):
        input_path = os.path.join(UPLOAD_DIR, f"input_{idx}.jpg")
        with open(input_path, "wb") as buf:
            shutil.copyfileobj(file.file, buf)

        try:
            # ── Run both models in parallel ───────────────────────────────────
            m1_result, m2_result = await _run_both_models(input_path)

            part_preds     = m1_result.get("predictions", [])
            severity_preds = m2_result.get("predictions", [])

            print(f"[Image {idx+1}] Model1 predictions: {len(part_preds)}  |  Model2 predictions: {len(severity_preds)}")

            # ── Merge ─────────────────────────────────────────────────────────
            merged, enriched_parts, unmatched_sev = _merge_predictions(part_preds, severity_preds)
            all_merged_defects.extend(merged)
            all_merged_legacy.extend(_to_legacy_defects(merged))

            # ── Annotate ──────────────────────────────────────────────────────
            image = cv2.imread(input_path)
            if image is None:
                print(f"[Image {idx+1}] Could not load image for annotation")
                continue

            annotate_with_dual_model(image, enriched_parts, unmatched_sev)

            if merged:
                ts = int(time.time())
                ap = os.path.join(STATIC_DIR, f"annotated_{ts}_{idx}.jpg")
                cv2.imwrite(ap, image)
                annotated_image_paths.append(f"static/annotated_{ts}_{idx}.jpg")

        except Exception as e:
            traceback.print_exc()
            print(f"[Image {idx+1}] Processing error: {e}")
        finally:
            if os.path.exists(input_path):
                os.remove(input_path)

    # ── Build response ────────────────────────────────────────────────────────
    vehicle_info = {
        "vin":     vin     or "Not Provided",
        "make":    make    or "Not Provided",
        "model":   model   or "Not Provided",
        "year":    year    or "Not Provided",
        "mileage": mileage or "Not Provided",
    }
    engine_result = _build_engine_result(engine_verdict, engine_is_knock, engine_confidence, engine_duration)
    if engine_audio and engine_audio.filename:
        try:
            engine_result = await _analyze_engine_upload(engine_audio)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Engine knock analysis failed: {str(e)}")

    # Unique defect types by part label (ignores severity suffix)
    unique_parts = {d["part"].lower() for d in all_merged_defects}
    unique_defect_types = len(unique_parts)

    # ── Firebase ──────────────────────────────────────────────────────────────
 # ── Firebase (non-blocking) ───────────────────────────────────────────────
    overall_status = "FAIL" if engine_result and engine_result.get("is_knock") else "PASS" if unique_defect_types == 0 else "ATTENTION" if unique_defect_types <= 2 else "FAIL"
    ai_analysis = generate_ai_analysis(
        defects=all_merged_legacy,
        vehicle_info=vehicle_info,
        engine_result=engine_result,
        overall_status=overall_status,
    )

    def _save_inspect_to_firebase():
        _safe_firebase_write("inspections", {
            "vehicle_info":    vehicle_info,
            "inspection_type": inspection_type or "owner",
            "defects": [
                {"part": d["part"], "severity": d["severity_class"], "confidence": d["confidence"]}
                for d in all_merged_defects
            ],
            "engine_result":  engine_result,
            "overall_status": overall_status,
            "ai_analysis":    ai_analysis,
            "models_used":    [VEHICLE_MODEL_ID, SEVERITY_MODEL_ID],
        })

    threading.Thread(target=_save_inspect_to_firebase, daemon=True).start()

    # Return both the enriched merged defects AND the legacy tuple format
    # so the frontend (which expects [label, confidence] arrays) still works
    return {
        "message":              "Dual-model inspection complete",
        "image_count":          len(files),
        "total_defects_detected": len(all_merged_legacy),
        "unique_defect_types":  unique_defect_types,
        # Legacy format: [[label, confidence], ...]  ← frontend uses this
        "defects_detected":     [[d[0], d[1]] for d in all_merged_legacy],
        # Rich format: [{label, part, severity_class, severity_tier, ...}, ...]
        "defects_enriched":     all_merged_defects,
        "annotated_images":     annotated_image_paths,
        "engine_result":        engine_result,
        "ai_analysis":          ai_analysis,
        "overall_status":       overall_status,
        "models_used":          {
            "model1": VEHICLE_MODEL_ID,
            "model2": SEVERITY_MODEL_ID,
            "engine": engine_result.get("model") if engine_result else "not_tested",
        },
    }


@app.post("/generate-report")
async def generate_report_from_data(req: GenerateReportRequest):
    defects_normalised = []
    for d in req.defects_detected:
        if isinstance(d, (list, tuple)) and len(d) >= 2:
            defects_normalised.append((str(d[0]), float(d[1])))
        elif isinstance(d, dict):
            name = d.get("label") or d.get("class") or d.get("name") or "Unknown"
            defects_normalised.append((name, float(d.get("confidence", 0))))

    image_paths = []
    for rel in req.annotated_images:
        basename  = os.path.basename(rel.lstrip("/"))
        candidate = os.path.join(STATIC_DIR, basename)
        if os.path.isfile(candidate):
            image_paths.append(candidate)
        elif os.path.isfile(rel.lstrip("/")):
            image_paths.append(rel.lstrip("/"))

    vehicle_info  = req.vehicle_info.dict()
    engine_result = req.engine_result.dict() if req.engine_result else None

    # Count unique parts (strip severity suffix after " — ")
    unique_parts  = {d[0].split(" — ")[0].lower() for d in defects_normalised}
    unique_types  = len(unique_parts)
    overall_status = "FAIL" if engine_result and engine_result.get("is_knock") else "PASS" if unique_types == 0 else "ATTENTION" if unique_types <= 2 else "FAIL"

    ai_analysis = generate_ai_analysis(
        defects=defects_normalised, vehicle_info=vehicle_info,
        engine_result=engine_result, overall_status=overall_status
    )
    try:
        generate_report(
            defects=defects_normalised, image_paths=image_paths, output_path=REPORT_PATH,
            vehicle_info=vehicle_info, engine_result=engine_result, ai_analysis=ai_analysis
        )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")

    return {
        "message":                "Report generated with AI analysis",
        "image_count":            req.image_count,
        "total_defects_detected": len(defects_normalised),
        "unique_defect_types":    unique_types,
        "defects_detected":       [[d[0], d[1]] for d in defects_normalised],
        "annotated_images":       req.annotated_images,
        "engine_result":          engine_result,
        "ai_analysis":            ai_analysis,
    }


@app.post("/save-claim")
async def save_claim(req: InsuranceClaimRequest):
    try:
        _, doc_ref = db.collection("claims").add({
            **req.dict(), "createdAt": firestore.SERVER_TIMESTAMP, "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        return {"success": True, "claimId": doc_ref.id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save claim: {str(e)}")


@app.get("/get-insurance-companies")
async def get_insurance_companies():
    try:
        docs = db.collection("users").where("role", "==", "insurance").stream()
        return {"companies": [{"uid": d.id, **{k: v for k, v in d.to_dict().items() if k in ("companyName", "email")}} for d in docs]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/generate-garage-report")
async def generate_garage_report_endpoint(req: GarageReportRequest):
    try:
        generate_garage_service_report(
            appointment=req.appointment, vehicle_info=req.vehicle_info,
            services_completed=req.services_completed, defects_from_ai=req.defects_from_ai,
            output_path=GARAGE_REPORT_PATH, insurance_approved=req.insurance_approved,
            approved_amount=req.approved_amount, technician_name=req.technician_name,
            technician_notes=req.technician_notes,
        )
        return {"success": True, "report_url": "/garage-report"}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Garage report failed: {str(e)}")


@app.get("/garage-report")
def get_garage_report():
    if not os.path.exists(GARAGE_REPORT_PATH):
        raise HTTPException(status_code=404, detail="Garage report not generated yet.")
    return FileResponse(
        GARAGE_REPORT_PATH, media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=MEHRA_Garage_Service_Report.pdf"},
    )


@app.post("/generate-car-life-report")
async def generate_carlife_report_endpoint(req: CarLifeReportRequest):
    try:
        generate_car_life_report(
            vehicle_info=req.vehicle_info, inspections=req.inspections,
            services=req.services, appointments=req.appointments,
            output_path=CARLIFE_REPORT_PATH, owner_name=req.owner_name,
        )
        return {"success": True, "report_url": "/carlife-report"}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Car Life report failed: {str(e)}")


@app.get("/carlife-report")
def get_carlife_report():
    if not os.path.exists(CARLIFE_REPORT_PATH):
        raise HTTPException(status_code=404, detail="Car Life report not generated yet.")
    return FileResponse(
        CARLIFE_REPORT_PATH, media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=MEHRA_Car_Life_Report.pdf"},
    )


@app.get("/")
async def read_root():
    frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "index.html")
    if os.path.exists(frontend_path):
        return FileResponse(frontend_path)
    return JSONResponse(status_code=404, content={"error": "index.html not found"})

@app.get("/sw.js")
async def get_service_worker():
    sw_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "sw.js")
    if not os.path.exists(sw_path):
        raise HTTPException(status_code=404, detail="sw.js not found")
    return FileResponse(
        sw_path,
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/"}
    )


@app.get("/report")
def get_report():
    if not os.path.exists(REPORT_PATH):
        raise HTTPException(status_code=404, detail="Report not generated yet.")
    return FileResponse(
        REPORT_PATH, media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=AI_Vehicle_Inspection_Report.pdf"},
    )


@app.get("/get-captured-images")
async def get_captured_images():
    return {"images": [{"path": f"static/{os.path.basename(p)}", "defects": [], "approved": True} for p in captured_frames]}


@app.get("/test-firebase")
def test_firebase():
    db.collection("test").document("demo").set({"message": "Hello from FastAPI!", "status": "connected"})
    return {"message": "Data written to Firebase!"}


# ── Debug endpoint — inspect what both models return on a test image ──────────
@app.post("/debug-dual-model")
async def debug_dual_model(file: UploadFile = File(...)):
    """
    Returns raw predictions from both models side-by-side for debugging.
    Useful for tuning IOU_MATCH_THRESHOLD and confidence thresholds.
    """
    temp_path = os.path.join(UPLOAD_DIR, f"debug_{int(time.time())}.jpg")
    with open(temp_path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)
    try:
        m1, m2 = await _run_both_models(temp_path)
        merged, enriched, unmatched = _merge_predictions(
            m1.get("predictions", []), m2.get("predictions", [])
        )
        return {
            "model1_raw":     m1.get("predictions", []),
            "model2_raw":     m2.get("predictions", []),
            "merged_defects": merged,
            "unmatched_severity": unmatched,
            "model1_id":      VEHICLE_MODEL_ID,
            "model2_id":      SEVERITY_MODEL_ID,
        }
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app.mount("/static", StaticFiles(directory="../frontend/static"), name="static")
