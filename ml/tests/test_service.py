"""Tests for ml.service (pytest-compatible; also runnable standalone:

    python -m ml.tests.test_service
"""

from __future__ import annotations

import os

os.environ.setdefault("PYTHONPATH", os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")))

from ml.service import (FEATURE_LABELS, anomaly_check, retrain,  # noqa: E402
                        score_trade)

SAFE = {
    "past_orders": 45, "on_time_rate": 0.95, "buyer_avg_days_to_pay": 18.0,
    "buyer_country_risk": 0.15, "invoice_to_avg_ratio": 1.0,
    "doc_discrepancy_count": 0, "payment_term_days": 30,
    "fx_volatility": 0.08, "amount_usd": 15000.0,
    "goods_category": "surgical_goods",
}
RISKY = {
    "past_orders": 1, "on_time_rate": 0.30, "buyer_avg_days_to_pay": 95.0,
    "buyer_country_risk": 0.85, "invoice_to_avg_ratio": 1.9,
    "doc_discrepancy_count": 3, "payment_term_days": 90,
    "fx_volatility": 0.55, "amount_usd": 120000.0,
    "goods_category": "electronics",
}
ODD = dict(SAFE, invoice_to_avg_ratio=9.0, amount_usd=500000.0,
           doc_discrepancy_count=6)


def _base(**over):
    f = dict(SAFE)
    f.update(over)
    return f


def test_score_returns_all_spec_keys():
    out = score_trade(SAFE)
    assert set(out) == {"score", "risk_band", "suggested_terms",
                        "top_features", "model_version"}
    assert 0.0 <= out["score"] <= 100.0
    assert out["risk_band"] in ("low", "medium", "high")
    st = out["suggested_terms"]
    assert set(st) == {"escrow_pct", "requires_review", "min_documents"}
    assert isinstance(st["escrow_pct"], int) and 0 <= st["escrow_pct"] <= 100
    assert isinstance(st["requires_review"], bool)
    assert isinstance(st["min_documents"], int)
    tf = out["top_features"]
    assert isinstance(tf, list) and len(tf) <= 5
    for item in tf:
        assert set(item) == {"name", "label", "impact", "direction"}
        assert item["direction"] in ("increase", "decrease")
    assert out["model_version"] and isinstance(out["model_version"], str)


def test_higher_score_means_safer_monotonic():
    good = score_trade(SAFE)["score"]
    bad = score_trade(RISKY)["score"]
    assert good > bad, f"safe {good} should beat risky {bad}"
    # Monotonic slices: improving one feature must not lower the score.
    s1 = score_trade(_base(on_time_rate=0.9))["score"]
    s2 = score_trade(_base(on_time_rate=0.4))["score"]
    assert s1 >= s2, "higher on_time_rate must not reduce the score"
    c1 = score_trade(_base(doc_discrepancy_count=0))["score"]
    c2 = score_trade(_base(doc_discrepancy_count=4))["score"]
    assert c1 >= c2, "more doc discrepancies must not raise the score"
    r1 = score_trade(_base(buyer_country_risk=0.1))["score"]
    r2 = score_trade(_base(buyer_country_risk=0.9))["score"]
    assert r1 >= r2, "higher country risk must not raise the score"


def test_bands_and_terms_align():
    lo = score_trade(SAFE)
    hi = score_trade(RISKY)
    assert lo["risk_band"] == "low" and hi["risk_band"] == "high"
    assert lo["suggested_terms"]["escrow_pct"] < hi["suggested_terms"]["escrow_pct"]
    assert hi["suggested_terms"]["requires_review"] is True
    assert lo["suggested_terms"]["min_documents"] <= hi["suggested_terms"]["min_documents"]


def test_anomaly_flags_grossly_odd_order():
    out = anomaly_check(ODD)
    assert set(out) == {"is_anomaly", "flags"}
    assert out["is_anomaly"] is True
    assert any("inflated_invoice" in fl for fl in out["flags"])
    normal = anomaly_check(SAFE)
    assert normal["is_anomaly"] is False
    assert len(normal["flags"]) <= 1


def test_retrain_returns_job_dict():
    out = retrain()
    assert set(out) == {"job_id", "status", "model_version", "metrics"}
    assert out["status"] == "completed"
    assert out["job_id"].startswith("train-")
    m = out["metrics"]
    assert 0.5 <= m["auc"] <= 1.0 and 0.0 <= m["accuracy"] <= 1.0
    # Service keeps working after a retrain.
    assert 0.0 <= score_trade(SAFE)["score"] <= 100.0


def test_feature_labels_cover_canonical():
    from ml.features import CANONICAL_FEATURES
    for name in CANONICAL_FEATURES:
        assert name in FEATURE_LABELS and FEATURE_LABELS[name]


def test_bad_input_degrades_not_crashes():
    out = score_trade({"past_orders": None, "on_time_rate": "abc",
                       "goods_category": "quantum-widgets"})
    assert 0.0 <= out["score"] <= 100.0


def _run_all():
    fails = 0
    for fn in [test_score_returns_all_spec_keys,
               test_higher_score_means_safer_monotonic,
               test_bands_and_terms_align,
               test_anomaly_flags_grossly_odd_order,
               test_retrain_returns_job_dict,
               test_feature_labels_cover_canonical,
               test_bad_input_degrades_not_crashes]:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception as e:
            fails += 1
            print(f"FAIL {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{fails} failure(s)")
    return fails


if __name__ == "__main__":
    raise SystemExit(1 if _run_all() else 0)
