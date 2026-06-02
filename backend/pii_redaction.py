"""
PII redaction (Microsoft Presidio) and coarse image redaction (OpenCV Haar) for external LLM / vision APIs.
Engines load lazily so the API can start if optional NLP dependencies are missing.
"""
from __future__ import annotations

import copy
import json
import threading
from typing import Any, Dict, Optional, Sequence, Tuple

import cv2

# Presidio entity types that exist on the default English NLP engine (avoid unknown labels).
_DEFAULT_ENTITIES: Sequence[str] = (
    "PERSON",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "LOCATION",
    "DATE_TIME",
    "US_DRIVER_LICENSE",
    "US_SSN",
    "CREDIT_CARD",
    "IBAN_CODE",
    "IP_ADDRESS",
    "URL",
)

_lock = threading.Lock()
_analyzer = None
_anonymizer = None
_presidio_error: Optional[str] = None


def _init_presidio() -> Tuple[Optional[object], Optional[object], Optional[str]]:
    global _analyzer, _anonymizer, _presidio_error
    with _lock:
        if _analyzer is not None or _presidio_error is not None:
            return _analyzer, _anonymizer, _presidio_error
        try:
            from presidio_analyzer import AnalyzerEngine
            from presidio_anonymizer import AnonymizerEngine

            _analyzer = AnalyzerEngine()
            _anonymizer = AnonymizerEngine()
            _presidio_error = None
        except Exception as e:  # pragma: no cover - env specific
            _presidio_error = str(e)
            _analyzer = None
            _anonymizer = None
            print(f"[PII] Presidio unavailable: {_presidio_error}")
        return _analyzer, _anonymizer, _presidio_error


def redact_pii(text: str, entities: Optional[Sequence[str]] = None) -> str:
    """
    Replace detected PII spans with placeholders. Returns original text if Presidio is unavailable.
    """
    if text is None:
        return ""
    s = str(text)
    if not s.strip():
        return s

    analyzer, anonymizer, _ = _init_presidio()
    if analyzer is None or anonymizer is None:
        return s

    ents: Sequence[str] = entities if entities is not None else _DEFAULT_ENTITIES
    try:
        results = analyzer.analyze(text=s, language="en", entities=list(ents))
        out = anonymizer.anonymize(text=s, analyzer_results=results)
        return out.text
    except Exception as e:  # pragma: no cover - model / entity mismatches
        print(f"[PII] redact_pii failed: {e}")
        return s


def sanitize_groq_chat_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Deep-copy a Groq/OpenAI-style chat payload and redact free-text bound for an external LLM.
    Skips `role: system` strings (static prompts). Redacts user/assistant/tool messages and
    vision `text` parts so outbound traffic aligns with PDPL-style minimization.
    """
    if not isinstance(payload, dict):
        return payload
    try:
        out: Dict[str, Any] = json.loads(json.dumps(payload))
    except (TypeError, ValueError):
        out = copy.deepcopy(payload)

    for msg in out.get("messages") or []:
        if not isinstance(msg, dict):
            continue
        role = (msg.get("role") or "").strip().lower()
        if role == "system":
            continue
        content = msg.get("content")
        if isinstance(content, str):
            msg["content"] = redact_pii(content)
        elif isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    part["text"] = redact_pii(part.get("text") or "")
    return out


def _blur_roi(img, x: int, y: int, w: int, h: int, ksize: int = 31) -> None:
    """Blur a region in-place; ksize must be odd."""
    ih, iw = img.shape[:2]
    x = max(0, x)
    y = max(0, y)
    w = min(w, iw - x)
    h = min(h, ih - y)
    if w <= 0 or h <= 0:
        return
    k = ksize if ksize % 2 == 1 else ksize + 1
    roi = img[y : y + h, x : x + w]
    if roi.size == 0:
        return
    img[y : y + h, x : x + w] = cv2.GaussianBlur(roi, (k, k), 0)


def _clip_roi(iw: int, ih: int, x: int, y: int, w: int, h: int) -> Tuple[int, int, int, int]:
    x = max(0, int(x))
    y = max(0, int(y))
    w = max(1, min(int(w), iw - x))
    h = max(1, min(int(h), ih - y))
    return x, y, w, h


def _cap_roi_size(
    iw: int, ih: int, x: int, y: int, w: int, h: int, max_area_ratio: float = 0.08
) -> Tuple[int, int, int, int]:
    """Shrink an oversized ROI around its centre (guards bad cascade / heuristic boxes)."""
    img_area = float(iw * ih)
    max_area = img_area * max_area_ratio
    x, y, w, h = _clip_roi(iw, ih, x, y, w, h)
    if w * h <= max_area:
        return x, y, w, h
    scale = (max_area / float(w * h)) ** 0.5
    nw = max(24, int(w * scale))
    nh = max(8, int(h * scale))
    cx = x + w // 2
    cy = y + h // 2
    nx = max(0, min(cx - nw // 2, iw - nw))
    ny = max(0, min(cy - nh // 2, ih - nh))
    return _clip_roi(iw, ih, nx, ny, nw, nh)


def _strong_obscure_roi(img, x: int, y: int, w: int, h: int) -> None:
    """Heavy pixelation + blur so plate digits cannot be read."""
    ih, iw = img.shape[:2]
    x, y, w, h = _clip_roi(iw, ih, x, y, w, h)
    roi = img[y : y + h, x : x + w]
    if roi.size == 0:
        return
    blocks = max(6, min(w, h) // 8)
    tiny_w = max(2, w // blocks)
    tiny_h = max(2, h // blocks)
    tiny = cv2.resize(roi, (tiny_w, tiny_h), interpolation=cv2.INTER_LINEAR)
    pixelated = cv2.resize(tiny, (w, h), interpolation=cv2.INTER_NEAREST)
    img[y : y + h, x : x + w] = pixelated
    _blur_roi(img, x, y, w, h, ksize=99)


def _merge_rois(rois: list, iw: int, ih: int) -> list:
    """Drop tiny boxes and merge heavy overlaps."""
    cleaned: list = []
    for x, y, w, h in rois:
        x, y, w, h = _clip_roi(iw, ih, x, y, w, h)
        if w * h < 400:
            continue
        cleaned.append((x, y, w, h))
    if not cleaned:
        return []
    cleaned.sort(key=lambda b: b[2] * b[3], reverse=True)
    merged: list = []
    for box in cleaned:
        x, y, w, h = box
        absorbed = False
        for i, (mx, my, mw, mh) in enumerate(merged):
            ix = max(x, mx)
            iy = max(y, my)
            iw_overlap = min(x + w, mx + mw) - ix
            ih_overlap = min(y + h, my + mh) - iy
            if iw_overlap > 0 and ih_overlap > 0:
                overlap = iw_overlap * ih_overlap
                if overlap > 0.35 * min(w * h, mw * mh):
                    nx = min(x, mx)
                    ny = min(y, my)
                    nw = max(x + w, mx + mw) - nx
                    nh = max(y + h, my + mh) - ny
                    merged[i] = _clip_roi(iw, ih, nx, ny, nw, nh)
                    absorbed = True
                    break
        if not absorbed:
            merged.append(box)
    return merged


def _heuristic_plate_rois(w: int, h: int) -> list:
    """Small fallback zones when Haar finds nothing — plate-sized, not full bumper."""
    rois: list = []
    margin_y = max(2, int(h * 0.02))
    # Rear / front centre — typical plate aspect ~3.5:1
    plate_w = max(48, int(w * 0.26))
    plate_h = max(10, int(h * 0.055))
    x0 = max(0, (w - plate_w) // 2)
    y0 = max(0, h - plate_h - margin_y)
    rois.append((x0, y0, plate_w, plate_h))
    # 3/4 view — lower front corners only
    corner_w = max(40, int(w * 0.20))
    corner_h = max(10, int(h * 0.05))
    yc = max(0, h - corner_h - margin_y)
    margin_x = max(4, int(w * 0.05))
    rois.append((margin_x, yc, corner_w, corner_h))
    rois.append((max(0, w - corner_w - margin_x), yc, corner_w, corner_h))
    return rois


def _detect_plate_rois(gray, w: int, h: int) -> list:
    rois: list = []
    img_area = float(w * h)
    plate_path = cv2.data.haarcascades + "haarcascade_russian_plate_number.xml"
    plate_cascade = cv2.CascadeClassifier(plate_path)
    if plate_cascade.empty():
        return rois
    configs = (
        {"scaleFactor": 1.05, "minNeighbors": 6, "minSize": (36, 12)},
        {"scaleFactor": 1.08, "minNeighbors": 8, "minSize": (40, 14)},
        {"scaleFactor": 1.12, "minNeighbors": 7, "minSize": (32, 11)},
    )
    seen: set = set()
    for cfg in configs:
        plates = plate_cascade.detectMultiScale(gray, **cfg)
        for (x, y, pw, ph) in plates:
            x, y, pw, ph = int(x), int(y), int(pw), int(ph)
            if pw <= 0 or ph <= 0:
                continue
            aspect = pw / float(ph)
            if aspect < 1.5 or aspect > 7.5:
                continue
            if (pw * ph) / img_area > 0.06:
                continue
            pad_x = int(pw * 0.08)
            pad_y = int(ph * 0.12)
            box = _clip_roi(w, h, x - pad_x, y - pad_y, pw + 2 * pad_x, ph + 2 * pad_y)
            key = (box[0] // 8, box[1] // 8, box[2] // 8, box[3] // 8)
            if key in seen:
                continue
            seen.add(key)
            rois.append(box)
    return rois


def blur_plates_marketplace_photo(image_path: str) -> str:
    """
    Strong plate redaction for marketplace listing photos.
    Prefer tight Haar detections; small bumper heuristics only when nothing is found.
    """
    img = cv2.imread(image_path)
    if img is None:
        return image_path

    h, w = img.shape[:2]
    detect_gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    scale_back = 1.0
    max_dim = max(w, h)
    if max_dim > 1280:
        scale_back = 1280.0 / float(max_dim)
        detect_gray = cv2.resize(
            detect_gray,
            (max(1, int(w * scale_back)), max(1, int(h * scale_back))),
            interpolation=cv2.INTER_AREA,
        )

    dw, dh = detect_gray.shape[1], detect_gray.shape[0]
    rois = _detect_plate_rois(detect_gray, dw, dh)
    if scale_back != 1.0:
        inv = 1.0 / scale_back
        rois = [
            _clip_roi(w, h, int(x * inv), int(y * inv), int(pw * inv), int(ph * inv))
            for x, y, pw, ph in rois
        ]
    if not rois:
        rois = _heuristic_plate_rois(w, h)

    merged = _merge_rois(rois, w, h)
    capped = [_cap_roi_size(w, h, x, y, pw, ph) for x, y, pw, ph in merged]

    for x, y, pw, ph in capped:
        _strong_obscure_roi(img, x, y, pw, ph)

    cv2.imwrite(image_path, img)
    return image_path


def blur_plates_and_faces(image_path: str) -> str:
    """
    In-place blur of likely license-plate regions (Russian plate Haar cascade) and frontal faces.
    Overwrites `image_path` and returns the same path for a simple call chain.
    """
    img = cv2.imread(image_path)
    if img is None:
        return image_path

    # Speed up OpenCV detection on very large images.
    # We blur privacy regions; downscaling makes Haar detection much faster.
    h, w = img.shape[:2]
    max_dim = max(w, h)
    if max_dim > 1400:
        scale = 1400.0 / float(max_dim)
        new_w = max(1, int(w * scale))
        new_h = max(1, int(h * scale))
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    plate_path = cv2.data.haarcascades + "haarcascade_russian_plate_number.xml"
    plate_cascade = cv2.CascadeClassifier(plate_path)
    if not plate_cascade.empty():
        plates = plate_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4)
        for (x, y, w, h) in plates:
            x, y, w, h = int(x), int(y), int(w), int(h)
            if w <= 0 or h <= 0:
                continue
            roi = img[y : y + h, x : x + w]
            if roi.size == 0:
                continue
            img[y : y + h, x : x + w] = cv2.GaussianBlur(roi, (51, 51), 0)

    face_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(face_path)
    if not face_cascade.empty():
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=5)
        for (x, y, w, h) in faces:
            x, y, w, h = int(x), int(y), int(w), int(h)
            if w <= 0 or h <= 0:
                continue
            roi = img[y : y + h, x : x + w]
            if roi.size == 0:
                continue
            img[y : y + h, x : x + w] = cv2.GaussianBlur(roi, (51, 51), 0)

    cv2.imwrite(image_path, img)
    return image_path
