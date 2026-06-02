"""
Optional dual Firebase project Firestore clients with quota failover.

Set FIREBASE_SERVICE_ACCOUNT_SECONDARY to a second service account JSON path.
Primary is always serviceAccountKey.json (existing).

Quotas reset daily; process restart also resets to primary unless you persist state.
"""
from __future__ import annotations

import os
from typing import Any, Callable, Optional, TypeVar

import firebase_admin
from firebase_admin import credentials, firestore

T = TypeVar("T")

_primary_db: Any = None
_secondary_db: Any = None
_active: str = "primary"
_secondary_path: Optional[str] = None


def _is_quota_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return (
        "quota" in msg
        or "resource-exhausted" in msg
        or "resource exhausted" in msg
        or "exceeded" in msg
        or "429" in msg
    )


def _init_app(cred_path: str, name: str) -> None:
    if not os.path.isfile(cred_path):
        return
    try:
        firebase_admin.get_app(name)
    except ValueError:
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred, name=name)


def init_firestore_pool(
    primary_cred_path: str,
    secondary_cred_path: Optional[str] = None,
) -> None:
    """Initialize primary (default) and optional secondary Admin SDK apps."""
    global _primary_db, _secondary_db, _secondary_path, _active

    _secondary_path = secondary_cred_path
    _active = "primary"

    if not firebase_admin._apps:
        _init_app(primary_cred_path, "[DEFAULT]")
    elif "[DEFAULT]" not in firebase_admin._apps:
        _init_app(primary_cred_path, "[DEFAULT]")

    try:
        _primary_db = firestore.client()
    except Exception:
        _primary_db = None

    _secondary_db = None
    if secondary_cred_path and os.path.isfile(secondary_cred_path):
        _init_app(secondary_cred_path, "autovault-secondary")
        try:
            _secondary_db = firestore.client(app=firebase_admin.get_app("autovault-secondary"))
            print(f"[INFO] Firestore backup project configured ({secondary_cred_path})")
        except Exception as e:
            print(f"[WARN] Firestore backup client failed: {e}")


def get_active_firestore():
    """Return the currently selected Firestore client (primary or secondary)."""
    if _active == "secondary" and _secondary_db is not None:
        return _secondary_db
    return _primary_db


def get_primary_firestore():
    """Return primary Firestore client (for auth/profile lookups)."""
    return _primary_db


def has_secondary() -> bool:
    return _secondary_db is not None


def firestore_with_failover(op: Callable[[Any], T]) -> T:
    """
    Run op(db). On quota error, switch to secondary (if configured) and retry once.
    """
    global _active

    db = get_active_firestore()
    if db is None:
        raise RuntimeError("Firestore not initialized")

    try:
        return op(db)
    except Exception as e:
        if _secondary_db is None or _active == "secondary" or not _is_quota_error(e):
            raise
        print("[WARN] Primary Firestore quota/limit — switching to backup project")
        _active = "secondary"
        return op(_secondary_db)


def reset_firestore_pool_primary() -> None:
    global _active
    _active = "primary"


def is_quota_error(exc: BaseException) -> bool:
    return _is_quota_error(exc)
