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
        return {"public": {}, "private": {}, "chats": [], "reports": {}, "blocks": []}
    try:
        with open(_STORE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"public": {}, "private": {}, "chats": [], "reports": {}, "blocks": []}
    if not isinstance(data.get("public"), dict):
        data["public"] = {}
    if not isinstance(data.get("private"), dict):
        data["private"] = {}
    if not isinstance(data.get("chats"), list):
        data["chats"] = []
    if not isinstance(data.get("reports"), dict):
        data["reports"] = {}
    if not isinstance(data.get("blocks"), list):
        data["blocks"] = []
    return data


def chat_thread_id(listing_id: str, buyer_uid: str) -> str:
    return f"{str(listing_id or '').strip()}__{str(buyer_uid or '').strip()}"


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
        out = dict(row)
        now = int(out.get("ts") or 0)
        out.setdefault("status", "sent")
        out.setdefault("deliveredAt", None)
        out.setdefault("readAt", None)
        chats.append(out)
        data["chats"] = chats[-5000:]
        _write(data)
        return dict(out)


def mark_chat_delivered_for_recipient(recipient_uid: str, listing_id: Optional[str] = None) -> int:
    """Mark incoming messages as delivered for this user."""
    with _lock:
        data = _read()
        n = 0
        lid = str(listing_id or "").strip()
        now = int(__import__("time").time() * 1000)
        for row in data.get("chats") or []:
            if str(row.get("fromUid") or "") == str(recipient_uid):
                continue
            if lid and str(row.get("listingId") or "") != lid:
                continue
            if str(row.get("buyerUid") or "") != str(recipient_uid) and str(row.get("sellerUid") or "") != str(recipient_uid):
                continue
            if not row.get("deliveredAt"):
                row["deliveredAt"] = now
                row["status"] = "delivered"
                n += 1
        if n:
            _write(data)
        return n


def mark_chat_read_for_recipient(recipient_uid: str, listing_id: str, buyer_uid: str) -> int:
    with _lock:
        data = _read()
        n = 0
        lid = str(listing_id or "").strip()
        bu = str(buyer_uid or "").strip()
        now = int(__import__("time").time() * 1000)
        for row in data.get("chats") or []:
            if str(row.get("listingId") or "") != lid:
                continue
            if str(row.get("buyerUid") or "") != bu:
                continue
            if str(row.get("fromUid") or "") == str(recipient_uid):
                continue
            if not row.get("readAt"):
                row["readAt"] = now
                row["status"] = "read"
                n += 1
        if n:
            _write(data)
        return n


def is_user_blocked(blocker_uid: str, blocked_uid: str) -> bool:
    with _lock:
        data = _read()
        pair = f"{blocker_uid}::{blocked_uid}"
        return pair in (data.get("blocks") or [])


def block_user(blocker_uid: str, blocked_uid: str) -> None:
    with _lock:
        data = _read()
        blocks = list(data.get("blocks") or [])
        pair = f"{blocker_uid}::{blocked_uid}"
        if pair not in blocks:
            blocks.append(pair)
        data["blocks"] = blocks[-2000:]
        _write(data)


def save_chat_report(chat_id: str, report: dict) -> dict:
    with _lock:
        data = _read()
        reports = data.get("reports") or {}
        reports[str(chat_id)] = dict(report)
        data["reports"] = reports
        _write(data)
        return dict(report)


def list_chat_threads_for_uid(uid: str) -> List[dict]:
    """Group messages into threads sorted by latest activity."""
    with _lock:
        rows = list_chat_rows_for_uid(uid)
        data = _read()
        blocked_other = {
            pair.split("::", 1)[-1]
            for pair in (data.get("blocks") or [])
            if isinstance(pair, str) and pair.startswith(f"{uid}::")
        }

    threads: Dict[str, dict] = {}
    for r in rows:
        lid = str(r.get("listingId") or "")
        bu = str(r.get("buyerUid") or "")
        su = str(r.get("sellerUid") or "")
        tid = chat_thread_id(lid, bu)
        other = bu if str(uid) == su else su
        if other in blocked_other:
            continue
        ts = int(r.get("ts") or 0)
        t = threads.setdefault(
            tid,
            {
                "threadId": tid,
                "chatId": tid,
                "listingId": lid,
                "buyerUid": bu,
                "sellerUid": su,
                "vehicle": r.get("vehicle") or "",
                "lastMessage": "",
                "lastTs": 0,
                "unread": 0,
                "otherUid": other,
            },
        )
        if ts >= int(t.get("lastTs") or 0):
            t["lastTs"] = ts
            t["lastMessage"] = r.get("body") or ""
            t["vehicle"] = r.get("vehicle") or t["vehicle"]
        if str(r.get("fromUid") or "") != str(uid) and not r.get("readAt"):
            t["unread"] = int(t.get("unread") or 0) + 1

    out = list(threads.values())
    out.sort(key=lambda x: int(x.get("lastTs") or 0), reverse=True)
    return out


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
