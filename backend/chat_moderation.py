"""
Marketplace chat content moderation — contact details, URLs, basic profanity.
"""
from __future__ import annotations

import re
from typing import Dict, List, Tuple

# UAE / international phone patterns (loose)
_PHONE_RE = re.compile(
    r"(?:"
    r"\+?\d{1,4}[\s\-.]?\(?\d{1,4}\)?[\s\-.]?\d{2,4}[\s\-.]?\d{2,4}[\s\-.]?\d{2,4}"
    r"|\b0\d{8,11}\b"
    r"|\b\d{3}[\s\-.]?\d{3}[\s\-.]?\d{4}\b"
    r")",
    re.IGNORECASE,
)
_EMAIL_RE = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
    re.IGNORECASE,
)
_WHATSAPP_RE = re.compile(
    r"(?:whatsapp|wa\.me|wa\s*me|watsapp|what'?s\s*app)",
    re.IGNORECASE,
)
_URL_RE = re.compile(
    r"(?:https?://|www\.)[^\s<>'\"]+|"
    r"\b[a-z0-9][-a-z0-9]*\.(?:com|ae|net|org|io|co|uk|app|me|link|xyz)\b[^\s]*",
    re.IGNORECASE,
)

_PROFANITY: Tuple[str, ...] = (
    "fuck", "shit", "bitch", "asshole", "bastard", "dick", "pussy", "cunt",
    "motherfucker", "wtf", "stfu", "bollocks", "wanker",
)

_BLOCK_REASON = (
    "For your safety, do not share personal contact details until you "
    "are ready to meet. AutoVault keeps your info protected."
)


def _mask_profanity(text: str) -> str:
    out = text
    for word in _PROFANITY:
        pat = re.compile(r"\b" + re.escape(word) + r"\b", re.IGNORECASE)
        out = pat.sub(lambda m: "*" * len(m.group(0)), out)
    return out


def scan_message(body: str) -> Dict[str, object]:
    """
    Returns { ok, body, blocked, flags }.
    blocked=True when contact/URL detected; body is profanity-masked when allowed.
    """
    raw = str(body or "")
    flags: List[str] = []
    if _EMAIL_RE.search(raw):
        flags.append("email")
    if _PHONE_RE.search(raw):
        flags.append("phone")
    if _WHATSAPP_RE.search(raw):
        flags.append("whatsapp")
    if _URL_RE.search(raw):
        flags.append("url")
    if flags:
        return {
            "ok": False,
            "blocked": True,
            "reason": _BLOCK_REASON,
            "flags": flags,
            "body": raw,
        }
    return {
        "ok": True,
        "blocked": False,
        "reason": None,
        "flags": [],
        "body": _mask_profanity(raw),
    }
