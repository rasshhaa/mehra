"""
Marketplace: server-side validation, public/private document shaping, and API projections.

**Validation & Firestore writes** — Never trust client-supplied counts or ownership signals.
Validate against Firestore and persist **public-safe** fields on ``marketplace/{id}``. Seller
contact, notes, and report URLs belong in ``marketplace_private/{id}`` (Admin SDK only).

**Projections** — ``project_listing(doc, role, requester_uid=...)`` implements three views
driven by the caller's Firebase custom claim ``role``:

1. **public** — Anonymous / buyer browse. No seller ``contact`` / ``notes`` / ``carLifeUrl``;
   ``vin`` masked; free text through Presidio :func:`pii_redaction.redact_pii`.
2. **stakeholder** — ``rta``, ``tasjeel``, ``insurance``, ``garage``: trust booleans + factual
   fields; no seller contact or notes.
3. **privileged** — ``marketplace`` operators see the full public doc (PII merged separately).
   **owner** sees full merged data only when ``requester_uid`` matches ``doc["uid"]``;
   otherwise **public**.
"""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any, Dict, List, Optional, Tuple

from pii_redaction import redact_pii

# ── Format rules (tune for UAE production data) ───────────────────────────────
_PLATE_MIN = 4
_PLATE_MAX = 20
_VIN_MIN = 5
_VIN_MAX = 17
_PRICE_MAX_AED = 500_000_000.0
_CONTACT_MAX_LEN = 500
_NOTES_MAX_LEN = 4000


def _norm_plate(p: str) -> str:
    """UAE plates often include spaces, slashes, or dots (e.g. 2/56789) — keep letters/digits only."""
    return re.sub(r"[^A-Z0-9]", "", (p or "").strip().upper())


def normalize_plate(p: str) -> str:
    """Public alias for duplicate / ownership checks."""
    return _norm_plate(p)


def _norm_vin(v: str) -> str:
    """Strip non-alphanumerics; trim a single trailing OCR digit when len==18 (ISO VIN is 17)."""
    n = re.sub(r"[^A-Z0-9]", "", (v or "").strip().upper())
    if len(n) == 18:
        n = n[:17]
    return n


def validate_plate(plate: str) -> Tuple[bool, str, str]:
    """Return (ok, error_code_or_empty, normalized_plate)."""
    raw = (plate or "").strip()
    if not raw or raw == "—":
        return False, "plate_required", ""
    n = _norm_plate(raw)
    if not re.match(r"^[A-Z0-9]+$", n):
        return False, "plate_invalid_chars", ""
    if len(n) < _PLATE_MIN or len(n) > _PLATE_MAX:
        return False, "plate_length", ""
    return True, "", n


def validate_vin(vin: str) -> Tuple[bool, str, str]:
    """Return (ok, error_code_or_empty, normalized_vin)."""
    raw = (vin or "").strip()
    if not raw or raw == "—":
        return False, "vin_required", ""
    n = _norm_vin(raw)
    if not re.match(r"^[A-Z0-9]+$", n):
        return False, "vin_invalid_chars", ""
    if len(n) < _VIN_MIN or len(n) > _VIN_MAX:
        return False, "vin_length", ""
    return True, "", n


def validate_price(price: Any) -> Tuple[bool, float, str]:
    try:
        p = float(price)
    except (TypeError, ValueError):
        return False, 0.0, "price_not_numeric"
    if p != p or p <= 0:
        return False, p, "price_positive"
    if p > _PRICE_MAX_AED:
        return False, p, "price_too_large"
    p = round(p, 2)
    return True, p, ""


def validate_contact_channel(contact: str) -> Tuple[bool, str]:
    """Accept phone-like or email-like strings; never an address block."""
    c = (contact or "").strip()
    if not c:
        return False, "contact_required"
    if len(c) > _CONTACT_MAX_LEN:
        return False, "contact_too_long"
    if "\n" in c or len(c) > 200 and "http" in c.lower():
        return False, "contact_suspicious"
    email_ok = bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", c))
    digits = re.sub(r"\D", "", c)
    phone_ok = len(digits) >= 8 and len(digits) <= 15
    if not email_ok and not phone_ok:
        return False, "contact_not_phone_or_email"
    return True, c


def validate_notes(notes: str) -> Tuple[bool, str]:
    n = (notes or "").strip()
    if len(n) > _NOTES_MAX_LEN:
        return False, "notes_too_long"
    return True, n


def vehicle_owned_by_user(
    vehicles: List[Dict[str, Any]],
    plate_norm: str,
    vin_norm: str,
) -> bool:
    """If the user has vehicle docs, plate or VIN must match at least one."""
    if not vehicles:
        return True
    for v in vehicles:
        p = _norm_plate(str(v.get("plateNumber") or v.get("plate") or ""))
        vin = _norm_vin(str(v.get("vin") or ""))
        if plate_norm and p and plate_norm == p:
            return True
        if vin_norm and vin and vin_norm == vin:
            return True
    return False


def compute_health_score_from_records(records: List[Dict[str, Any]]) -> Optional[int]:
    """Mirror frontend heuristic: latest score or synthetic from defects."""
    if not records:
        return None
    latest = records[0]
    if latest.get("score") is not None:
        try:
            return max(0, min(100, int(latest["score"])))
        except (TypeError, ValueError):
            pass
    total = len(records)
    passed = sum(1 for r in records if (r.get("status") or "").lower() == "pass")
    defects = sum(int(r.get("defects") or 0) for r in records)
    knock = sum(1 for r in records if r.get("engineKnock") is True)
    return max(
        0,
        min(
            100,
            int(round(100 - (defects * 5) - (knock * 15) - ((total - passed) * 8))),
        ),
    )


def _is_allowed_public_media_url(url: Any) -> bool:
    s = str(url or "").strip()
    if not s:
        return False
    if s.startswith("https://") or s.startswith("http://"):
        return True
    if s.startswith("/static/marketplace_photos/"):
        return True
    if s.startswith("/static/marketplace_car_life/"):
        return True
    return False


def build_public_listing_doc(
    *,
    uid: str,
    vehicle: str,
    plate_display: str,
    vin_display: str,
    price: float,
    health_score: Optional[int],
    inspection_count: int,
    status: str,
    created_at: Optional[str],
    updated_at: str,
    timestamp_ms: int,
    contact_relay_id: str,
    car_life_report_attached: bool,
    validation_flags: Dict[str, bool],
    photo_urls: Optional[List[str]] = None,
    photo_count: int = 0,
    car_life_summary: str = "",
    buy_reliability_score: Optional[int] = None,
    buy_reliability_summary: str = "",
    photos_processing: bool = False,
    car_life_url: Optional[str] = None,
    car_life_file_name: str = "",
) -> Dict[str, Any]:
    """Fields safe to store on the world-readable collection (rules should still lock writes)."""
    urls = [str(u)[:2000] for u in (photo_urls or []) if _is_allowed_public_media_url(u)][:12]
    doc: Dict[str, Any] = {
        "uid": uid,
        "vehicle": (vehicle or "").strip()[:500],
        "plateNumber": plate_display.strip()[:40],
        "vin": vin_display.strip()[:32],
        "price": price,
        "healthScore": health_score,
        "inspectionCount": inspection_count,
        "status": status[:32],
        "contactRelayId": contact_relay_id,
        "createdAt": created_at,
        "updatedAt": updated_at,
        "timestamp": timestamp_ms,
        "carLifeReportAttached": bool(car_life_report_attached),
        "photoUrls": urls,
        "photoCount": len(urls) if urls else int(photo_count or 0),
    }
    if photos_processing:
        doc["photosProcessing"] = True
    if _is_allowed_public_media_url(car_life_url):
        doc["carLifeUrl"] = str(car_life_url)[:2000]
    fn = (car_life_file_name or "").strip()
    if fn:
        doc["carLifeFileName"] = fn[:120]
    summary = (car_life_summary or "").strip()[:600]
    if summary:
        doc["carLifeSummary"] = summary
    if buy_reliability_score is not None:
        doc["buyReliabilityScore"] = max(0, min(100, int(buy_reliability_score)))
    brs = (buy_reliability_summary or "").strip()[:500]
    if brs:
        doc["buyReliabilitySummary"] = brs
    doc.update(validation_flags)
    return {k: v for k, v in doc.items() if v is not None}


def build_private_listing_doc(
    *,
    owner_uid: str,
    contact: str,
    notes: str,
    car_life_url: Optional[str],
    car_life_file_name: str = "",
) -> Dict[str, Any]:
    """Never served to anonymous clients — only merged on privileged API responses."""
    out: Dict[str, Any] = {
        "ownerUid": owner_uid,
        "contact": contact[:_CONTACT_MAX_LEN],
        "notes": notes[:_NOTES_MAX_LEN],
    }
    if car_life_url:
        out["carLifeUrl"] = str(car_life_url)[:2000]
    fn = (car_life_file_name or "").strip()
    if fn:
        out["carLifeFileName"] = fn[:120]
    return out


def enrich_with_private_for_privileged(
    base: Dict[str, Any],
    role: str,
    requester_uid: Optional[str],
    private: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Attach seller channels for marketplace operators and listing owner only."""
    out = dict(base)
    uid = str(out.get("uid") or "")
    show = False
    if (role or "").lower() == "marketplace":
        show = True
    elif (role or "").lower() == "owner" and requester_uid and str(requester_uid) == uid:
        show = True
    if show and private:
        out["contact"] = private.get("contact")
        out["notes"] = private.get("notes")
        if private.get("carLifeUrl"):
            out["carLifeUrl"] = private.get("carLifeUrl")
        if private.get("carLifeFileName"):
            out["carLifeFileName"] = private.get("carLifeFileName")
    return out


# ── Listing projections & trust heuristics ───────────────────────────────────

STAKEHOLDER_ROLES = frozenset({"rta", "tasjeel", "insurance", "garage"})


def mask_vin(v: str) -> str:
    s = (v or "").strip()
    if not s or s == "—":
        return "—"
    if len(s) <= 6:
        return "***"
    return f"{s[:4]}…{s[-4:]}"


def run_all_marketplace_validations(data: Dict[str, Any], *, private_notes: str = "") -> Dict[str, bool]:
    """
    Run all four stakeholder-aligned checks used at listing submit time.

    In production, replace the heuristics below with RTA / Tasjeel / insurer / garage API calls.
    ``private_notes`` is used for insurer heuristics (never stored on the public listing doc).
    """
    plate = str(data.get("plateNumber") or "").strip()
    plate_norm = plate.replace(" ", "").replace("-", "")
    n_ins = int(data.get("inspectionCount") or 0)
    health = data.get("healthScore")
    notes_l = str(private_notes or data.get("notes") or "").lower()

    rta_plate_valid = bool(plate_norm and plate != "—" and len(plate_norm) >= 4)
    tasjeel_inspection_ok = n_ins > 0 or health is not None
    insurance_no_open_claims = "open claim" not in notes_l and "total loss" not in notes_l
    garage_service_verified = n_ins > 0

    return {
        "rta_plate_valid": rta_plate_valid,
        "tasjeel_inspection_ok": tasjeel_inspection_ok,
        "insurance_no_open_claims": insurance_no_open_claims,
        "garage_service_verified": garage_service_verified,
    }


def _listing_media_fields(doc: Dict[str, Any]) -> Dict[str, Any]:
    urls = doc.get("photoUrls") or []
    if not isinstance(urls, list):
        urls = []
    return {
        "photoUrls": [str(u) for u in urls if _is_allowed_public_media_url(u)][:12],
        "photoCount": int(doc.get("photoCount") or len(urls) or 0),
        "carLifeUrl": str(doc.get("carLifeUrl") or "")[:2000] if _is_allowed_public_media_url(doc.get("carLifeUrl")) else "",
        "carLifeFileName": str(doc.get("carLifeFileName") or "")[:120],
        "carLifeSummary": str(doc.get("carLifeSummary") or "")[:600],
        "buyReliabilityScore": doc.get("buyReliabilityScore"),
        "buyReliabilitySummary": str(doc.get("buyReliabilitySummary") or "")[:500],
    }


def _public_projection(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc.get("id"),
        "vehicle": redact_pii(str(doc.get("vehicle") or "")),
        "price": doc.get("price"),
        "healthScore": doc.get("healthScore"),
        "inspectionCount": doc.get("inspectionCount"),
        "status": doc.get("status"),
        "timestamp": doc.get("timestamp"),
        "uid": doc.get("uid"),
        # Plate is PII for listings; do not expose publicly.
        "vin": mask_vin(str(doc.get("vin") or "")),
        "rta_plate_valid": doc.get("rta_plate_valid"),
        "tasjeel_inspection_ok": doc.get("tasjeel_inspection_ok"),
        "insurance_no_open_claims": doc.get("insurance_no_open_claims"),
        "garage_service_verified": doc.get("garage_service_verified"),
        "contactRelayId": doc.get("contactRelayId"),
        "carLifeReportAttached": doc.get("carLifeReportAttached"),
        "createdAt": doc.get("createdAt"),
        "updatedAt": doc.get("updatedAt"),
        **_listing_media_fields(doc),
    }


def _stakeholder_projection(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc.get("id"),
        "vehicle": str(doc.get("vehicle") or ""),
        "price": doc.get("price"),
        "plateNumber": doc.get("plateNumber"),
        "vin": mask_vin(str(doc.get("vin") or "")),
        "healthScore": doc.get("healthScore"),
        "inspectionCount": doc.get("inspectionCount"),
        "status": doc.get("status"),
        "timestamp": doc.get("timestamp"),
        "uid": doc.get("uid"),
        "rta_plate_valid": doc.get("rta_plate_valid"),
        "tasjeel_inspection_ok": doc.get("tasjeel_inspection_ok"),
        "insurance_no_open_claims": doc.get("insurance_no_open_claims"),
        "garage_service_verified": doc.get("garage_service_verified"),
        "contactRelayId": doc.get("contactRelayId"),
        "carLifeReportAttached": doc.get("carLifeReportAttached"),
        "createdAt": doc.get("createdAt"),
        "updatedAt": doc.get("updatedAt"),
        **_listing_media_fields(doc),
    }


def project_listing(
    doc: Dict[str, Any],
    role: str,
    *,
    requester_uid: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Strip / mask fields for ``role`` (Firebase custom claim), mirroring PDPL-style minimization.

    :param doc: Raw Firestore dict (may include ``id`` if merged by caller).
    :param role: Custom claim ``role`` or ``public`` for unauthenticated callers.
    :param requester_uid: Firebase uid of the authenticated user, if any.
    """
    r = (role or "public").strip().lower()
    if r in ("", "anonymous", "anon", "buyer", "guest"):
        r = "public"

    if r == "marketplace":
        d = deepcopy(doc)
        for k in ("contact", "notes", "carLifeUrl", "carLifeFileName"):
            d.pop(k, None)
        return d

    if r == "owner":
        if requester_uid and str(doc.get("uid")) == str(requester_uid):
            d = deepcopy(doc)
            for k in ("contact", "notes", "carLifeUrl", "carLifeFileName"):
                d.pop(k, None)
            return d
        return _public_projection(doc)

    if r in STAKEHOLDER_ROLES:
        return _stakeholder_projection(doc)

    return _public_projection(doc)
