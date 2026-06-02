"""
Local JSON persistence for marketplace when Firestore admin credentials are unavailable.
"""

from __future__ import annotations

import json
import os
import threading
from typing import Any, Dict, List, Optional

from marketplace_listing import normalize_plate

_BASE = os.path.dirname(os.path.abspath(__file__))
_STORE_PATH = os.path.join(_BASE, "data", "marketplace_store.json")
_lock = threading.RLock()


def _ensure_dir() -> None:
    os.makedirs(os.path.dirname(_STORE_PATH), exist_ok=True)


def _read() -> Dict[str, Any]:
    _ensure_dir()
    if not os.path.isfile(_STORE_PATH):
        return {"public": {}, "private": {}, "chats": []}
    try:
        with open(_STORE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"public": {}, "private": {}, "chats": []}
    if not isinstance(data.get("public"), dict):
        data["public"] = {}
    if not isinstance(data.get("private"), dict):
        data["private"] = {}
    if not isinstance(data.get("chats"), list):
        data["chats"] = []
    return data


def _write(data: Dict[str, Any]) -> None:
    _ensure_dir()
    tmp = _STORE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, _STORE_PATH)


def list_public_rows() -> List[dict]:
    with _lock:
        data = _read()
        out: List[dict] = []
        for lid, doc in data["public"].items():
            row = dict(doc)
            row["id"] = lid
            out.append(row)
        return out


def get_public(listing_id: str) -> Optional[dict]:
    with _lock:
        doc = _read()["public"].get(listing_id)
        if not doc:
            return None
        row = dict(doc)
        row["id"] = listing_id
        return row


def get_private(listing_id: str) -> Optional[dict]:
    with _lock:
        doc = _read()["private"].get(listing_id)
        return dict(doc) if doc else None


def upsert_listing(listing_id: str, public_doc: dict, private_doc: dict) -> None:
    with _lock:
        data = _read()
        data["public"][listing_id] = public_doc
        data["private"][listing_id] = private_doc
        _write(data)


def patch_public(listing_id: str, patch: dict) -> None:
    with _lock:
        data = _read()
        prev = data["public"].get(listing_id) or {}
        prev.update(patch)
        data["public"][listing_id] = prev
        _write(data)


def delete_listing(listing_id: str) -> bool:
    with _lock:
        data = _read()
        if listing_id not in data["public"]:
            return False
        data["public"].pop(listing_id, None)
        data["private"].pop(listing_id, None)
        _write(data)
        return True


def duplicate_active(uid: str, plate_norm: str, exclude_id: Optional[str]) -> bool:
    for row in list_public_rows():
        if exclude_id and row.get("id") == exclude_id:
            continue
        if str(row.get("uid")) != str(uid):
            continue
        st = str(row.get("status") or "").lower()
        if st in ("sold", "draft"):
            continue
        if normalize_plate(str(row.get("plateNumber") or "")) == plate_norm:
            return True
    return False


def add_chat_message(row: dict) -> dict:
    with _lock:
        data = _read()
        chats = data.get("chats") or []
        chats.append(dict(row))
        data["chats"] = chats[-5000:]
        _write(data)
        return dict(row)


def list_chat_rows_for_uid(uid: str, *, listing_id: Optional[str] = None) -> List[dict]:
    with _lock:
        data = _read()
        out: List[dict] = []
        lid = str(listing_id or "").strip()
        for row in data.get("chats") or []:
            r = dict(row)
            if str(r.get("buyerUid") or "") != str(uid) and str(r.get("sellerUid") or "") != str(uid):
                continue
            if lid and str(r.get("listingId") or "") != lid:
                continue
            out.append(r)
        out.sort(key=lambda x: int(x.get("ts") or 0))
        return out
