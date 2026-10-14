"""Feature engineering for SilkFlow AI trade scoring.

Canonical raw feature dict (built by the backend, per docs/API_SPEC.md §2):

    { "past_orders": int, "on_time_rate": 0-1, "buyer_avg_days_to_pay": float,
      "buyer_country_risk": 0-1, "invoice_to_avg_ratio": float,
      "doc_discrepancy_count": int, "payment_term_days": int,
      "fx_volatility": 0-1, "amount_usd": float, "goods_category": str }

`vectorize()` turns that dict into the model-space feature vector:
9 numeric features (lightly transformed for stability) + one-hot encoding of
goods_category. Works with or without numpy.
"""

from __future__ import annotations

import math
from typing import Dict, List

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

CANONICAL_FEATURES: List[str] = [
    "past_orders",
    "on_time_rate",
    "buyer_avg_days_to_pay",
    "buyer_country_risk",
    "invoice_to_avg_ratio",
    "doc_discrepancy_count",
    "payment_term_days",
    "fx_volatility",
    "amount_usd",
    "goods_category",
]

# Numeric (non-categorical) canonical features, in model-vector order.
NUMERIC_FEATURES: List[str] = CANONICAL_FEATURES[:9]

# Goods categories typical for the China -> Pakistan corridor (synthetic data
# uses exactly these; unknown strings fall into "other").
GOODS_CATEGORIES: List[str] = [
    "textiles",
    "home_textiles",
    "surgical_goods",
    "apparel",
    "electronics",
    "machinery_parts",
    "other",
]

CATEGORY_ONEHOT_NAMES: List[str] = ["cat_" + c for c in GOODS_CATEGORIES]

# Model-space feature names = numeric transforms + one-hot columns.
MODEL_FEATURES: List[str] = [
    "past_orders",          # log1p(past_orders)
    "on_time_rate",
    "buyer_avg_days_to_pay",
    "buyer_country_risk",
    "invoice_to_avg_ratio",  # capped at 6 to bound the influence of fraud rows
    "doc_discrepancy_count",
    "payment_term_days",
    "fx_volatility",
    "amount_usd",            # log1p(amount_usd / 1000) -> kUSD, bounded scale
] + CATEGORY_ONEHOT_NAMES

# Human-readable labels for every canonical feature (used by the dashboard).
FEATURE_LABELS: Dict[str, str] = {
    "past_orders": "Completed orders on record (buyer/seller history depth)",
    "on_time_rate": "Historical on-time & in-full payment rate",
    "buyer_avg_days_to_pay": "Average days the buyer takes to pay",
    "buyer_country_risk": "Buyer-country risk index (0 = safe, 1 = high risk)",
    "invoice_to_avg_ratio": "Invoice size vs. this buyer's historical average",
    "doc_discrepancy_count": "Document discrepancies found in the check",
    "payment_term_days": "Agreed payment term (days)",
    "fx_volatility": "USD/PKR volatility over the payment window",
    "amount_usd": "Invoice amount (USD)",
    "goods_category": "Goods category",
}

# Sensible demo-safe defaults if the backend omits/invalidates a field.
_DEFAULTS = {
    "past_orders": 1,
    "on_time_rate": 0.5,
    "buyer_avg_days_to_pay": 30.0,
    "buyer_country_risk": 0.5,
    "invoice_to_avg_ratio": 1.0,
    "doc_discrepancy_count": 0,
    "payment_term_days": 30,
    "fx_volatility": 0.15,
    "amount_usd": 10000.0,
    "goods_category": "other",
}


# ---------------------------------------------------------------------------
# Coercion / cleaning
# ---------------------------------------------------------------------------

def _num(value, default: float, lo: float, hi: float) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(v) or math.isinf(v):
        return default
    return min(max(v, lo), hi)


def clean_features(features: dict) -> dict:
    """Coerce a raw canonical features dict to safe, typed values."""
    src = features or {}
    out = {
        "past_orders": int(_num(src.get("past_orders", _DEFAULTS["past_orders"]),
                               _DEFAULTS["past_orders"], 0, 10000)),
        "on_time_rate": _num(src.get("on_time_rate", _DEFAULTS["on_time_rate"]),
                             _DEFAULTS["on_time_rate"], 0.0, 1.0),
        "buyer_avg_days_to_pay": _num(
            src.get("buyer_avg_days_to_pay", _DEFAULTS["buyer_avg_days_to_pay"]),
            _DEFAULTS["buyer_avg_days_to_pay"], 0.0, 365.0),
        "buyer_country_risk": _num(
            src.get("buyer_country_risk", _DEFAULTS["buyer_country_risk"]),
            _DEFAULTS["buyer_country_risk"], 0.0, 1.0),
        "invoice_to_avg_ratio": _num(
            src.get("invoice_to_avg_ratio", _DEFAULTS["invoice_to_avg_ratio"]),
            _DEFAULTS["invoice_to_avg_ratio"], 0.0, 50.0),
        "doc_discrepancy_count": int(_num(
            src.get("doc_discrepancy_count", _DEFAULTS["doc_discrepancy_count"]),
            _DEFAULTS["doc_discrepancy_count"], 0, 100)),
        "payment_term_days": int(_num(
            src.get("payment_term_days", _DEFAULTS["payment_term_days"]),
            _DEFAULTS["payment_term_days"], 0, 365)),
        "fx_volatility": _num(src.get("fx_volatility", _DEFAULTS["fx_volatility"]),
                              _DEFAULTS["fx_volatility"], 0.0, 1.0),
        "amount_usd": _num(src.get("amount_usd", _DEFAULTS["amount_usd"]),
                           _DEFAULTS["amount_usd"], 0.0, 1e9),
    }
    cat = str(src.get("goods_category") or _DEFAULTS["goods_category"]).strip().lower()
    cat = cat.replace(" ", "_").replace("-", "_")
    if cat not in GOODS_CATEGORIES:
        cat = "other"
    out["goods_category"] = cat
    return out


def _one_hot(category: str) -> Dict[str, float]:
    return {name: (1.0 if name == "cat_" + category else 0.0)
            for name in CATEGORY_ONEHOT_NAMES}


def to_model_space(clean: dict) -> Dict[str, float]:
    """Map cleaned canonical features to model-space features (named dict)."""
    vec = {
        "past_orders": math.log1p(clean["past_orders"]),
        "on_time_rate": clean["on_time_rate"],
        "buyer_avg_days_to_pay": clean["buyer_avg_days_to_pay"] / 90.0,
        "buyer_country_risk": clean["buyer_country_risk"],
        "invoice_to_avg_ratio": min(clean["invoice_to_avg_ratio"], 6.0),
        "doc_discrepancy_count": clean["doc_discrepancy_count"] / 3.0,
        "payment_term_days": clean["payment_term_days"] / 90.0,
        "fx_volatility": clean["fx_volatility"],
        "amount_usd": math.log1p(clean["amount_usd"] / 1000.0),
    }
    vec.update(_one_hot(clean["goods_category"]))
    return vec


def vectorize(features: dict) -> Dict[str, float]:
    """Raw canonical dict -> named model-space vector."""
    return to_model_space(clean_features(features))


def vector_to_row(vec: Dict[str, float]) -> List[float]:
    """Named model-space vector -> ordered list aligned with MODEL_FEATURES."""
    return [float(vec.get(name, 0.0)) for name in MODEL_FEATURES]


def row_from_raw(features: dict) -> List[float]:
    return vector_to_row(vectorize(features))
