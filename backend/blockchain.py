"""
AutoVault Security Ledger — a tamper-evident hash-chain ("blockchain") that the
RTA Authority uses to secure logins and seal sensitive records (PDFs) across the
whole platform.

Design goals
------------
* Server-side source of truth. The chain lives in a JSON file on the backend so
  no end user can edit it from the browser / localStorage.
* Tamper-evident. Every block embeds the SHA-256 hash of the previous block, so
  altering any historical block invalidates every block after it. `verify_chain`
  recomputes the whole chain and reports the first break.
* Lightweight proof-of-work. Each block is "mined" until its hash starts with a
  small difficulty prefix. This demonstrates an immutable, append-only ledger
  without external dependencies.
* Sealed record vault. When a sensitive PDF is sealed, its bytes are hashed and a
  canonical copy is stored under data/sealed_records/<hash>.pdf. Re-hashing that
  copy and comparing it to the on-chain hash proves the document was not tampered
  with.

This module has no third-party dependencies and is safe to import even when
Firebase is unavailable.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

_BASE = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.path.join(_BASE, "data")
_LEDGER_PATH = os.path.join(_DATA_DIR, "security_ledger.json")
_VAULT_DIR = os.path.join(_DATA_DIR, "sealed_records")

# Number of leading zeros required in a block hash (proof-of-work difficulty).
# Kept low so mining is effectively instant while still being demonstrable.
_DIFFICULTY = 3
_PREFIX = "0" * _DIFFICULTY

_lock = threading.RLock()
_chain: Optional[List[Dict[str, Any]]] = None


# ── persistence ────────────────────────────────────────────────────────────────
def _ensure_dirs() -> None:
    os.makedirs(_DATA_DIR, exist_ok=True)
    os.makedirs(_VAULT_DIR, exist_ok=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _canonical(payload: Dict[str, Any]) -> str:
    """Deterministic JSON used as the hashing pre-image."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _compute_hash(index: int, timestamp: float, block_type: str,
                  actor: Dict[str, Any], data: Dict[str, Any],
                  prev_hash: str, nonce: int) -> str:
    pre_image = _canonical({
        "index": index,
        "timestamp": timestamp,
        "type": block_type,
        "actor": actor,
        "data": data,
        "prev_hash": prev_hash,
        "nonce": nonce,
    })
    return hashlib.sha256(pre_image.encode("utf-8")).hexdigest()


def _mine(index: int, timestamp: float, block_type: str,
          actor: Dict[str, Any], data: Dict[str, Any], prev_hash: str) -> Dict[str, Any]:
    nonce = 0
    while True:
        h = _compute_hash(index, timestamp, block_type, actor, data, prev_hash, nonce)
        if h.startswith(_PREFIX):
            break
        nonce += 1
    return {
        "index": index,
        "timestamp": timestamp,
        "iso": _now_iso(),
        "type": block_type,
        "actor": actor,
        "data": data,
        "prev_hash": prev_hash,
        "nonce": nonce,
        "hash": h,
    }


def _genesis() -> Dict[str, Any]:
    return _mine(
        0, time.time(), "GENESIS",
        {"authority": "RTA Dubai", "system": "AutoVault Security Ledger"},
        {"note": "Genesis block — root of trust for all logins and sealed records."},
        "0" * 64,
    )


def _load() -> List[Dict[str, Any]]:
    global _chain
    if _chain is not None:
        return _chain
    _ensure_dirs()
    if os.path.isfile(_LEDGER_PATH):
        try:
            with open(_LEDGER_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list) and data:
                _chain = data
                return _chain
        except (json.JSONDecodeError, OSError):
            pass
    _chain = [_genesis()]
    _save()
    return _chain


def _save() -> None:
    _ensure_dirs()
    tmp = _LEDGER_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(_chain, f, indent=2, ensure_ascii=False)
    os.replace(tmp, _LEDGER_PATH)


# ── public API ───────────────────────────────────────────────────────────────
def add_block(block_type: str, actor: Optional[Dict[str, Any]] = None,
              data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Mine and append a new block, returning the stored block."""
    with _lock:
        chain = _load()
        prev = chain[-1]
        block = _mine(
            len(chain), time.time(), str(block_type).upper(),
            actor or {}, data or {}, prev["hash"],
        )
        chain.append(block)
        _save()
        return block


def get_chain(limit: Optional[int] = None, newest_first: bool = False) -> List[Dict[str, Any]]:
    with _lock:
        chain = list(_load())
    if newest_first:
        chain = list(reversed(chain))
    if limit and limit > 0:
        chain = chain[:limit]
    return chain


def verify_chain() -> Dict[str, Any]:
    """Recompute the entire chain and detect tampering."""
    with _lock:
        chain = list(_load())
    errors: List[Dict[str, Any]] = []
    broken_at: Optional[int] = None
    for i, block in enumerate(chain):
        recomputed = _compute_hash(
            block["index"], block["timestamp"], block["type"],
            block.get("actor", {}), block.get("data", {}),
            block["prev_hash"], block["nonce"],
        )
        if recomputed != block["hash"]:
            errors.append({"index": block["index"], "reason": "hash mismatch (block content altered)"})
            if broken_at is None:
                broken_at = block["index"]
        if not block["hash"].startswith(_PREFIX):
            errors.append({"index": block["index"], "reason": "invalid proof-of-work"})
            if broken_at is None:
                broken_at = block["index"]
        if i > 0 and block["prev_hash"] != chain[i - 1]["hash"]:
            errors.append({"index": block["index"], "reason": "broken link to previous block"})
            if broken_at is None:
                broken_at = block["index"]
    return {
        "valid": len(errors) == 0,
        "length": len(chain),
        "broken_at": broken_at,
        "errors": errors,
        "difficulty": _DIFFICULTY,
        "verified_at": _now_iso(),
    }


def _sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def seal_record(file_bytes: Optional[bytes] = None, *,
                file_hash: Optional[str] = None,
                doc_type: str = "document",
                doc_id: Optional[str] = None,
                file_name: Optional[str] = None,
                actor: Optional[Dict[str, Any]] = None,
                extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Seal a sensitive record onto the ledger. If raw bytes are supplied, a
    canonical copy is stored in the vault so its integrity can be re-verified
    later. Returns the appended block.
    """
    if file_bytes is None and not file_hash:
        raise ValueError("seal_record requires either file_bytes or file_hash")

    size = None
    vaulted = False
    if file_bytes is not None:
        file_hash = _sha256_bytes(file_bytes)
        size = len(file_bytes)
        _ensure_dirs()
        vault_path = os.path.join(_VAULT_DIR, f"{file_hash}.pdf")
        if not os.path.isfile(vault_path):
            try:
                with open(vault_path, "wb") as f:
                    f.write(file_bytes)
                vaulted = True
            except OSError:
                vaulted = False
        else:
            vaulted = True

    data: Dict[str, Any] = {
        "doc_type": doc_type,
        "doc_id": doc_id or file_hash[:16],
        "file_name": file_name or f"{doc_type}.pdf",
        "file_hash": file_hash,
        "algo": "sha256",
        "size": size,
        "vaulted": vaulted,
    }
    if extra:
        data.update(extra)
    return add_block("RECORD", actor or {}, data)


def log_accident_claim(
    claim_id: str,
    payload: Dict[str, Any],
    actor: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Hash accident claim intake data (SHA-256) and append a RECORD block.
    Used to show 'Blockchain Verified' on Car Life accident entries.
    """
    canonical = _canonical({
        "claim_id": str(claim_id or "").strip(),
        "payload": payload or {},
    })
    file_hash = _sha256_bytes(canonical.encode("utf-8"))
    data: Dict[str, Any] = {
        "doc_type": "accident_claim",
        "doc_id": str(claim_id or "")[:128],
        "file_name": f"accident_claim_{claim_id}.json",
        "file_hash": file_hash,
        "algo": "sha256",
        "vaulted": False,
        "payload_keys": sorted((payload or {}).keys()),
    }
    block = add_block("RECORD", actor or {}, data)
    return {
        "file_hash": file_hash,
        "block_index": block["index"],
        "block_hash": block["hash"],
        "sealed_at": block["iso"],
        "claim_id": claim_id,
    }


def verify_accident_claim(claim_id: Optional[str] = None,
                          file_hash: Optional[str] = None) -> Dict[str, Any]:
    """Return whether an accident claim hash exists on the ledger."""
    cid = str(claim_id or "").strip()
    fh = str(file_hash or "").strip().lower()
    with _lock:
        chain = list(_load())
    for block in chain:
        if block.get("type") != "RECORD":
            continue
        data = block.get("data") or {}
        if str(data.get("doc_type") or "") != "accident_claim":
            continue
        if cid and str(data.get("doc_id") or "") == cid:
            return {
                "verified": True,
                "match": True,
                "claim_id": cid,
                "file_hash": data.get("file_hash"),
                "block_index": block["index"],
                "sealed_at": block.get("iso"),
            }
        if fh and str(data.get("file_hash") or "").lower() == fh:
            return {
                "verified": True,
                "match": True,
                "claim_id": data.get("doc_id"),
                "file_hash": fh,
                "block_index": block["index"],
                "sealed_at": block.get("iso"),
            }
    return {
        "verified": False,
        "match": False,
        "claim_id": cid or None,
        "file_hash": fh or None,
        "reason": "No matching accident claim on the security ledger.",
    }


def verify_record(file_hash: Optional[str] = None,
                  file_bytes: Optional[bytes] = None) -> Dict[str, Any]:
    """
    Check whether a record matches what was sealed on the ledger. If bytes are
    provided they are hashed first. Also re-hashes the vaulted copy when present.
    """
    if file_bytes is not None:
        file_hash = _sha256_bytes(file_bytes)
    if not file_hash:
        return {"match": False, "reason": "no hash provided"}

    file_hash = file_hash.strip().lower()
    with _lock:
        chain = list(_load())

    sealed = [b for b in chain if b["type"] == "RECORD" and str(b["data"].get("file_hash", "")).lower() == file_hash]
    if not sealed:
        return {
            "match": False,
            "file_hash": file_hash,
            "reason": "No matching record on the ledger — document is unknown or was altered.",
        }

    block = sealed[0]
    vault_ok = None
    vault_path = os.path.join(_VAULT_DIR, f"{file_hash}.pdf")
    if os.path.isfile(vault_path):
        try:
            with open(vault_path, "rb") as f:
                vault_ok = (_sha256_bytes(f.read()) == file_hash)
        except OSError:
            vault_ok = None

    return {
        "match": True,
        "file_hash": file_hash,
        "block_index": block["index"],
        "sealed_at": block["iso"],
        "doc_type": block["data"].get("doc_type"),
        "file_name": block["data"].get("file_name"),
        "actor": block.get("actor", {}),
        "vault_intact": vault_ok,
        "reason": "Document fingerprint matches the sealed ledger entry — no tampering detected.",
    }


def vault_path_for(file_hash: str) -> Optional[str]:
    p = os.path.join(_VAULT_DIR, f"{(file_hash or '').strip().lower()}.pdf")
    return p if os.path.isfile(p) else None


def stats() -> Dict[str, Any]:
    with _lock:
        chain = list(_load())
    by_type: Dict[str, int] = {}
    for b in chain:
        by_type[b["type"]] = by_type.get(b["type"], 0) + 1
    integrity = verify_chain()
    last = chain[-1] if chain else None
    return {
        "blocks": len(chain),
        "logins": by_type.get("LOGIN", 0),
        "records": by_type.get("RECORD", 0),
        "alerts": by_type.get("ALERT", 0),
        "by_type": by_type,
        "valid": integrity["valid"],
        "broken_at": integrity["broken_at"],
        "difficulty": _DIFFICULTY,
        "last_block": {
            "index": last["index"],
            "type": last["type"],
            "iso": last["iso"],
            "hash": last["hash"],
        } if last else None,
    }


# ── AI Security Sentinel — autonomous verification + alerting ────────────────
_ALERTS_PATH = os.path.join(_DATA_DIR, "security_alerts.json")
_SEV_RANK = {"critical": 3, "high": 2, "medium": 1, "info": 0}
_monitor_started = False
_last_scan: Dict[str, Any] = {}


def _load_alerts() -> List[Dict[str, Any]]:
    _ensure_dirs()
    if not os.path.isfile(_ALERTS_PATH):
        return []
    try:
        with open(_ALERTS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _save_alerts(alerts: List[Dict[str, Any]]) -> None:
    _ensure_dirs()
    tmp = _ALERTS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(alerts, f, indent=2, ensure_ascii=False)
    os.replace(tmp, _ALERTS_PATH)


def _recommendation(level: str, open_alerts: List[Dict[str, Any]]) -> str:
    if level == "critical":
        if any(a["type"] == "ledger" for a in open_alerts):
            return "CRITICAL: Ledger integrity compromised. Freeze writes, isolate the host, and restore from the last verified backup."
        if any(a["type"] == "document" for a in open_alerts):
            return "CRITICAL: A sealed document was altered. Quarantine the file and re-issue from the trusted source."
        return "CRITICAL: Authentication abuse detected. Lock the targeted account and enforce step-up verification."
    if level == "high":
        return "HIGH: Suspicious authentication activity. Review the flagged sessions and consider temporary lockout."
    if level == "medium":
        return "MEDIUM: Minor anomaly logged. Monitor — no immediate action required."
    return "All systems verified. Chain intact, sealed records authentic, no auth anomalies."


def scan() -> Dict[str, Any]:
    """
    Autonomous security sweep: re-verifies the whole chain, re-hashes every
    vaulted record, and analyses login activity for anomalies. New findings are
    written to the ledger as ALERT blocks and persisted so they are notified
    only once.
    """
    global _last_scan
    with _lock:
        chain = list(_load())
    integrity = verify_chain()
    findings: List[Dict[str, Any]] = []

    # 1) Ledger chain integrity
    if not integrity["valid"]:
        findings.append({
            "sig": "chain_broken", "severity": "critical", "type": "ledger",
            "title": "Ledger chain integrity broken",
            "detail": f"Hash chain breaks at block #{integrity['broken_at']} — a historical block was altered.",
        })

    # 2) Sealed-document integrity (re-hash vaulted copies)
    for b in chain:
        if b["type"] != "RECORD":
            continue
        h = str(b["data"].get("file_hash", "")).lower()
        if not h:
            continue
        vp = os.path.join(_VAULT_DIR, f"{h}.pdf")
        if os.path.isfile(vp):
            try:
                with open(vp, "rb") as f:
                    current = _sha256_bytes(f.read())
            except OSError:
                continue
            if current != h:
                findings.append({
                    "sig": f"vault:{h}", "severity": "critical", "type": "document",
                    "title": "Sealed document tampered",
                    "detail": f"Vaulted copy of {b['data'].get('file_name', 'document')} (block #{b['index']}) no longer matches its sealed fingerprint.",
                })

    # 3) Login anomaly analysis
    login_blocks = [b for b in chain if b["type"] == "LOGIN"]
    failed = [b for b in login_blocks if str(b["data"].get("status", "")).lower() == "failed"]
    for b in failed:
        dev = b["data"].get("device", "") or ""
        suspicious = any(x.lower() in dev.lower() for x in ("tor", "unknown", "vpn", "proxy"))
        findings.append({
            "sig": f"login_fail:{b['index']}",
            "severity": "high" if suspicious else "medium", "type": "auth",
            "title": "Failed login attempt",
            "detail": f"{b['actor'].get('email', 'unknown')} failed authentication from {dev or 'unknown device'} (block #{b['index']}).",
        })
    now = time.time()
    recent_fail = [b for b in failed if now - b.get("timestamp", 0) <= 3600]
    if len(recent_fail) >= 3:
        findings.append({
            "sig": f"bruteforce:{len(recent_fail) // 3}", "severity": "critical", "type": "auth",
            "title": "Possible brute-force / credential stuffing",
            "detail": f"{len(recent_fail)} failed logins detected within the last hour.",
        })

    # Persist + raise ALERT blocks only for findings not seen before
    alerts = _load_alerts()
    seen = {a["sig"] for a in alerts}
    new: List[Dict[str, Any]] = []
    for f in findings:
        if f["sig"] in seen:
            continue
        blk = add_block("ALERT", {"role": "system", "email": "ai-sentinel"},
                        {k: f[k] for k in ("sig", "severity", "type", "title", "detail")})
        rec = {**f, "at": blk["iso"], "block_index": blk["index"], "acknowledged": False}
        alerts.append(rec)
        new.append(rec)
        seen.add(f["sig"])
    if new:
        _save_alerts(alerts)

    open_alerts = [a for a in alerts if not a.get("acknowledged")]
    level = "clear"
    if open_alerts:
        level = max(open_alerts, key=lambda a: _SEV_RANK.get(a["severity"], 0))["severity"]

    _last_scan = {
        "ok": True,
        "scanned_at": _now_iso(),
        "integrity": integrity,
        "threat_level": level,
        "open_count": len(open_alerts),
        "new_count": len(new),
        "new_alerts": new,
        "alerts": list(reversed(alerts))[:50],
        "totals": {"records": sum(1 for b in chain if b["type"] == "RECORD"),
                   "logins": len(login_blocks), "failed_logins": len(failed)},
        "recommendation": _recommendation(level, open_alerts),
    }
    return _last_scan


def acknowledge_alert(sig: Optional[str] = None, all_alerts: bool = False) -> Dict[str, Any]:
    alerts = _load_alerts()
    n = 0
    for a in alerts:
        if all_alerts or a.get("sig") == sig:
            if not a.get("acknowledged"):
                a["acknowledged"] = True
                n += 1
    if n:
        _save_alerts(alerts)
    return {"acknowledged": n}


def start_monitor(interval: int = 45) -> None:
    """Launch the background sentinel loop (idempotent)."""
    global _monitor_started
    if _monitor_started:
        return
    _monitor_started = True

    def _loop():
        while True:
            try:
                scan()
            except Exception as e:  # never kill the thread
                print(f"[sentinel] scan error: {e}")
            time.sleep(max(10, interval))

    threading.Thread(target=_loop, daemon=True, name="ai-security-sentinel").start()
    print(f"[sentinel] AI Security Sentinel started (interval={interval}s)")


def seed_demo(force: bool = False) -> Dict[str, Any]:
    """
    Populate the ledger with a few representative blocks so the RTA security
    console is meaningful before any real activity. No-op if records already
    exist (unless force=True).
    """
    with _lock:
        chain = _load()
        has_activity = any(b["type"] in ("LOGIN", "RECORD") for b in chain)
    if has_activity and not force:
        return {"seeded": 0, "reason": "ledger already has activity"}

    demo_logins = [
        {"uid": "demo_owner_3", "email": "ahmed.almaktoum@mail.ae", "role": "owner", "status": "success", "device": "Chrome · Dubai"},
        {"uid": "demo_tj_0", "email": "tasjeelalbarsha@tasjeel.ae", "role": "tasjeel", "status": "success", "device": "Edge · Al Barsha"},
        {"uid": "demo_garage_1", "email": "alquozmotors@garage.ae", "role": "garage", "status": "success", "device": "Safari · Al Quoz"},
        {"uid": "unknown", "email": "attacker@evil.example", "role": "owner", "status": "failed", "device": "Tor · Unknown"},
        {"uid": "demo_ins_0", "email": "sukooninsurance@insure.ae", "role": "insurance", "status": "success", "device": "Chrome · DIFC"},
        {"uid": "demo_rta_0", "email": "control@rta.ae", "role": "rta", "status": "success", "device": "Firefox · RTA HQ"},
    ]
    seeded = 0
    for ev in demo_logins:
        add_block("LOGIN", {"uid": ev["uid"], "email": ev["email"], "role": ev["role"]},
                  {"status": ev["status"], "device": ev["device"],
                   "session": hashlib.sha256(f"{ev['uid']}{ev['device']}".encode()).hexdigest()[:16]})
        seeded += 1

    demo_records = [
        {"doc_type": "inspection_report", "doc_id": "demo_insp_3", "file_name": "Tasjeel_Inspection_A12345.pdf", "role": "tasjeel", "email": "tasjeelalbarsha@tasjeel.ae"},
        {"doc_type": "car_life_report", "doc_id": "demo_owner_3", "file_name": "CarLife_LandCruiser.pdf", "role": "owner", "email": "ahmed.almaktoum@mail.ae"},
        {"doc_type": "garage_service_report", "doc_id": "demo_garage_1", "file_name": "Service_Patrol.pdf", "role": "garage", "email": "alquozmotors@garage.ae"},
        {"doc_type": "insurance_claim", "doc_id": "demo_claim_2", "file_name": "Claim_Settlement.pdf", "role": "insurance", "email": "sukooninsurance@insure.ae"},
    ]
    for rec in demo_records:
        fake_bytes = f"DEMO-SEALED::{rec['doc_id']}::{rec['file_name']}::{time.time()}".encode("utf-8")
        seal_record(
            file_bytes=fake_bytes,
            doc_type=rec["doc_type"],
            doc_id=rec["doc_id"],
            file_name=rec["file_name"],
            actor={"uid": rec["doc_id"], "email": rec["email"], "role": rec["role"]},
            extra={"demo": True},
        )
        seeded += 1

    return {"seeded": seeded}
