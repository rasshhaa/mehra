"""
UAE repair-matrix style claim cost estimation (mirrors frontend claim-cost-config.js).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

DEFAULT_CONFIG = {
    "currency": "AED",
    "defaultCoveragePercent": 80,
    "severityMultipliers": {"minor": 1.0, "moderate": 1.5, "severe": 2.5},
    "defectBaseCosts": {
        "bumper crack": 300,
        "windshield damage": 600,
        "door dent": 400,
        "hood scratch": 200,
        "side mirror": 150,
        "tyre damage": 250,
    },
}

_RULES = [
    (("windshield", "glass"), "windshield damage"),
    (("bumper",), "bumper crack"),
    (("door",), "door dent"),
    (("hood", "bonnet"), "hood scratch"),
    (("mirror",), "side mirror"),
    (("tyre", "tire", "wheel"), "tyre damage"),
]


def _norm(s: str) -> str:
    return (s or "").lower().strip()


def _normalize_severity(raw: str) -> str:
    s = _norm(raw)
    if s in ("minor", "moderate", "severe"):
        return s
    return "minor"


def _resolve_base_cost(defect_type: str, affected_part: str, base_costs: dict) -> float:
    key = _norm(defect_type)
    if key in base_costs:
        return float(base_costs[key])
    text = f"{key} {_norm(affected_part)}".strip()
    for tokens, price_key in _RULES:
        if any(t in text for t in tokens):
            return float(base_costs.get(price_key, 0))
    return 0.0


def normalize_inspection_defects(defects: Optional[List[Any]]) -> List[dict]:
    out = []
    for d in defects or []:
        if isinstance(d, dict):
            conf_raw = d.get("confidence_score", d.get("confidence", d.get("score", 1)))
            try:
                conf = float(conf_raw)
            except (TypeError, ValueError):
                conf = 0.0
            if conf > 1:
                conf = conf / 100.0
            conf = max(0.0, min(1.0, conf))
            out.append({
                "defect_type": d.get("defect_type") or d.get("label") or d.get("class") or "unknown defect",
                "severity": _normalize_severity(d.get("severity") or d.get("severity_tier") or "minor"),
                "affected_part": d.get("affected_part") or d.get("part") or d.get("label") or "unknown part",
                "confidence_score": conf,
            })
    return out


def calculate_claim_cost(
    defects_input: Optional[List[Any]],
    coverage_percent_input: Optional[float] = None,
    config: Optional[dict] = None,
) -> dict:
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    defects = normalize_inspection_defects(defects_input)
    coverage = float(coverage_percent_input if coverage_percent_input is not None else cfg["defaultCoveragePercent"])
    coverage = max(0.0, min(100.0, coverage))
    base_costs = cfg.get("defectBaseCosts") or {}
    multipliers = cfg.get("severityMultipliers") or {}

    line_items = []
    for idx, d in enumerate(defects, 1):
        base = _resolve_base_cost(d["defect_type"], d["affected_part"], base_costs)
        sev_mult = float(multipliers.get(d["severity"], 1))
        weighted = round(base * sev_mult * d["confidence_score"], 2)
        line_items.append({
            "index": idx,
            "defect_type": d["defect_type"],
            "affected_part": d["affected_part"],
            "severity": d["severity"],
            "confidence_score": d["confidence_score"],
            "base_cost": base,
            "severity_multiplier": sev_mult,
            "weighted_cost": weighted,
        })

    subtotal = round(sum(i["weighted_cost"] for i in line_items), 2)
    coverage_amount = round(subtotal * (coverage / 100.0), 2)
    owner_liability = round(subtotal - coverage_amount, 2)

    return {
        "currency": cfg.get("currency", "AED"),
        "coverage_percent": coverage,
        "line_items": line_items,
        "subtotal": subtotal,
        "coverage_amount": coverage_amount,
        "owner_liability": owner_liability,
        "final_payout": coverage_amount,
    }
