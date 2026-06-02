"""
Firebase Storage helpers for marketplace car-life reports and listing photos.
"""

from __future__ import annotations

import os
import re
import tempfile
import time
import uuid
from typing import List, Optional, Tuple
from urllib.parse import quote

from firebase_admin import storage

_MAX_PHOTOS = 12
_MAX_PHOTO_BYTES = 8 * 1024 * 1024


def storage_bucket_name() -> str:
    # Prefer explicit env override. Fall back to this project's active bucket.
    # NOTE: many newer Firebase projects use *.firebasestorage.app (not *.appspot.com).
    return (
        os.getenv("FIREBASE_STORAGE_BUCKET", "").strip()
        or os.getenv("FB_STORAGE_BUCKET", "").strip()
        or "mehra-b3a7c.firebasestorage.app"
    )


def get_bucket():
    try:
        return storage.bucket(storage_bucket_name())
    except Exception as e:
        print(f"[marketplace_storage] bucket unavailable: {e}")
        return None


def firebase_download_url(bucket_name: str, object_path: str, token: str) -> str:
    encoded = quote(object_path, safe="")
    return (
        f"https://firebasestorage.googleapis.com/v0/b/{bucket_name}/o/{encoded}"
        f"?alt=media&token={token}"
    )


def upload_file_to_storage(
    local_path: str,
    object_path: str,
    content_type: str,
) -> Optional[str]:
    bucket = get_bucket()
    if bucket is None:
        return None
    try:
        token = str(uuid.uuid4())
        blob = bucket.blob(object_path)
        blob.metadata = {"firebaseStorageDownloadTokens": token}
        blob.upload_from_filename(local_path, content_type=content_type)
        return firebase_download_url(bucket.name, object_path, token)
    except Exception as e:
        print(f"[marketplace_storage] upload failed {object_path}: {e}")
        return None


def upload_bytes_to_storage(
    data: bytes,
    object_path: str,
    content_type: str,
) -> Optional[str]:
    bucket = get_bucket()
    if bucket is None:
        return None
    try:
        token = str(uuid.uuid4())
        blob = bucket.blob(object_path)
        blob.metadata = {"firebaseStorageDownloadTokens": token}
        blob.upload_from_string(data, content_type=content_type)
        return firebase_download_url(bucket.name, object_path, token)
    except Exception as e:
        print(f"[marketplace_storage] upload bytes failed {object_path}: {e}")
        return None


def list_storage_prefix(prefix: str, *, limit: int = 20) -> List[Tuple[str, float]]:
    """Return (name, updated_ts) for blobs under prefix, newest first."""
    bucket = get_bucket()
    if bucket is None:
        return []
    out: List[Tuple[str, float]] = []
    try:
        for blob in bucket.list_blobs(prefix=prefix):
            updated = 0.0
            if blob.updated:
                updated = blob.updated.timestamp()
            elif blob.time_created:
                updated = blob.time_created.timestamp()
            out.append((blob.name, updated))
    except Exception as e:
        print(f"[marketplace_storage] list failed {prefix}: {e}")
        return []
    out.sort(key=lambda x: x[1], reverse=True)
    return out[:limit]


def find_latest_car_life_report(uid: str) -> Tuple[Optional[str], str]:
    """
    Latest Car Life object under users/{uid}/marketplace_car_life/.
    Returns (https download URL, display file name).
    """
    prefix = f"users/{uid}/marketplace_car_life/"
    entries = list_storage_prefix(prefix, limit=30)
    if not entries:
        return None, ""
    name = entries[0][0]
    bucket = get_bucket()
    if bucket is None:
        return None, ""
    try:
        blob = bucket.blob(name)
        blob.reload()
        token = (blob.metadata or {}).get("firebaseStorageDownloadTokens")
        if not token:
            token = str(uuid.uuid4())
            blob.metadata = {**(blob.metadata or {}), "firebaseStorageDownloadTokens": token}
            blob.patch()
        base = os.path.basename(name)
        display = re.sub(r"^\d+_", "", base) or "Car_Life_Report.pdf"
        return firebase_download_url(bucket.name, name, str(token)), display[:120]
    except Exception as e:
        print(f"[marketplace_storage] car life resolve failed: {e}")
        return None, ""


def validate_owner_photo_urls(urls: List[str], uid: str) -> List[str]:
    """Keep HTTPS Storage URLs or local /static/marketplace_photos paths (dev fallback)."""
    bucket = storage_bucket_name()
    prefix_snippet = quote(f"users/{uid}/marketplace_photos/", safe="")
    out: List[str] = []
    for raw in urls or []:
        u = str(raw or "").strip()
        if u.startswith("/static/marketplace_photos/"):
            out.append(u[:2000])
        elif u.startswith("https://"):
            if bucket not in u and prefix_snippet not in u and f"users%2F{uid}%2Fmarketplace_photos" not in u:
                continue
            out.append(u[:2000])
        else:
            continue
        if len(out) >= _MAX_PHOTOS:
            break
    return out


def save_listing_photo_local(
    file_bytes: bytes,
    listing_id: str,
    *,
    original_name: str = "photo.jpg",
    static_dir: str,
) -> str:
    """Blur plates/faces and save under frontend static (no Firebase Storage)."""
    if len(file_bytes) > _MAX_PHOTO_BYTES:
        raise ValueError("photo_too_large")
    ext = ".jpg"
    safe = re.sub(r"[^\w.\-]+", "_", (original_name or "photo").split(".")[0])[:40]
    subdir = os.path.join(static_dir, "marketplace_photos", listing_id)
    os.makedirs(subdir, exist_ok=True)
    fname = f"{int(time.time() * 1000)}_{safe}{ext}"
    path = os.path.join(subdir, fname)
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    try:
        from pii_redaction import blur_plates_marketplace_photo

        blur_plates_marketplace_photo(tmp_path)
        with open(tmp_path, "rb") as src, open(path, "wb") as dst:
            dst.write(src.read())
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
    return f"/static/marketplace_photos/{listing_id}/{fname}"


def process_and_upload_listing_photo(
    file_bytes: bytes,
    uid: str,
    listing_id: str,
    *,
    original_name: str = "photo.jpg",
) -> Optional[str]:
    """Blur plates/faces, upload JPEG to Storage, return download URL."""
    if len(file_bytes) > _MAX_PHOTO_BYTES:
        raise ValueError("photo_too_large")
    ext = ".jpg"
    safe = re.sub(r"[^\w.\-]+", "_", (original_name or "photo").split(".")[0])[:40]
    object_path = (
        f"users/{uid}/marketplace_photos/{listing_id}/"
        f"{int(time.time() * 1000)}_{safe}{ext}"
    )
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    try:
        from pii_redaction import blur_plates_marketplace_photo

        blur_plates_marketplace_photo(tmp_path)
        return upload_file_to_storage(tmp_path, object_path, "image/jpeg")
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
