"""ml.service — public ML API for the SilkFlow AI backend.

Implements docs/API_SPEC.md §2 exactly:

    score_trade(features) -> dict      (credit score, risk band, terms, reasons)
    anomaly_check(features) -> dict    (Isolation-Forest-based odd-order flag)
    retrain(dataset_ref=None) -> dict  (synchronous retrain, used by POST /api/models/retrain)
    FEATURE_LABELS: dict[str, str]

Behaviour
---------
* Models are loaded ONCE at import from ml/artifacts/; if artifacts are
  missing/invalid the package auto-generates synthetic data and trains on
  first use, so `from ml.service import score_trade` always works.
* Thread-safe enough for FastAPI: reads take an immutable bundle reference;
  `retrain` is serialized under a lock and swaps the bundle atomically.
* Explanations use SHAP when installed, otherwise a documented baseline-
  perturbation attribution fallback (and a coefficient view for LR).

ALL TRAINING DATA IS SYNTHETIC — scores are demo-quality, not financial
advice (see docs/DATA_MODEL.md).
"""

from __future__ import annotations

import os
import pickle
import threading
import uuid
from typing import Dict, List

from ml import features as F
from ml._compat import HAS_JOBLIB, HAS_SHAP, HAS_NUMPY, np

FEATURE_LABELS: Dict[str, str] = dict(F.FEATURE_LABELS)

_ML_DIR = os.path.dirname(os.path.abspath(__file__))
ARTIFACT_PATH = os.path.join(_ML_DIR, "artifacts", "model_artifacts.pkl")

_lock = threading.RLock()          # protects (re)training + bundle swap
_bundle: Dict = {"b": None}        # single-slot immutable-after-load state


# ---------------------------------------------------------------------------
# Loading / auto-train
# ---------------------------------------------------------------------------

def _read_artifacts() -> dict:
    if HAS_JOBLIB:
        import joblib
        return joblib.load(ARTIFACT_PATH)
    with open(ARTIFACT_PATH, "rb") as f:
        return pickle.load(f)


def _train_fresh() -> dict:
    from ml import train as _train
    if not os.path.exists(_train.DATA_PATH):
        from ml import generate_data
        generate_data.main()
    _train.train(quiet=True)
    return _read_artifacts()


def _get_bundle() -> dict:
    b = _bundle["b"]
    if b is not None:
        return b
    with _lock:
        if _bundle["b"] is None:
            try:
                if not os.path.exists(ARTIFACT_PATH):
                    raise FileNotFoundError(ARTIFACT_PATH)
                _bundle["b"] = _read_artifacts()
            except Exception:
                # Fresh checkout / corrupt artifacts -> quick auto-train.
                _bundle["b"] = _train_fresh()
        return _bundle["b"]


# ---------------------------------------------------------------------------
# Explanations (SHAP if available, else baseline-perturbation fallback)
# ---------------------------------------------------------------------------

_NUM_TO_CANON = {name: name for name in F.NUMERIC_FEATURES}
_CAT_COLS = {("cat_" + c): "goods_category" for c in F.GOODS_CATEGORIES}


def _aggregate_contribs(vec: List[float], contribs: List[float]) -> List[dict]:
    """Map model-space contributions onto canonical features, top-5 by |impact|."""
    agg: Dict[str, float] = {}
    for name, c in zip(F.MODEL_FEATURES, contribs):
        key = _NUM_TO_CANON.get(name) or _CAT_COLS.get(name)
        if key is None:
            continue
        agg[key] = agg.get(key, 0.0) + c
    out = [{"name": k, "label": FEATURE_LABELS.get(k, k),
            "impact": round(v, 2), "direction": "increase" if v >= 0 else "decrease"}
           for k, v in agg.items() if abs(v) >= 0.05]
    out.sort(key=lambda d: abs(d["impact"]), reverse=True)
    return out[:5]


def _explain(b: dict, vec: List[float], p_full: float) -> List[dict]:
    """Per-row contributions in score-point units (+ = pushes score UP)."""
    # Preferred: SHAP
    if b.get("shap_importance") and HAS_SHAP and HAS_NUMPY and np is not None \
            and b["scorer_kind"] in ("xgb", "sk_lr"):
        try:
            import shap
            X = np.array([vec])
            model = b["scorer"].model
            if b["scorer_kind"] == "xgb":
                sv = shap.TreeExplainer(model).shap_values(X)
            else:
                sv = shap.LinearExplainer(model, b["baseline_np"]).shap_values(X)
            sv = np.asarray(sv)
            if sv.ndim == 3:
                sv = sv[:, :, 1] if sv.shape[2] == 2 else sv[:, :, 0]
            # logit-space shap -> approx score points: scale by dp/dlogit * 100
            scale = p_full * (1 - p_full) * 100.0
            return _aggregate_contribs(vec, (sv[0] * scale).tolist())
        except Exception:
            pass  # fall through to perturbation fallback
    # Fallback: single-feature baseline perturbation (permutation-style)
    base = b["baseline_row"]
    contribs = []
    for j in range(len(vec)):
        v2 = list(vec)
        v2[j] = base[j]
        contribs.append((p_full - b["scorer"].proba(v2)) * 100.0)
    return _aggregate_contribs(vec, contribs)


# ---------------------------------------------------------------------------
# Terms / bands
# ---------------------------------------------------------------------------

def _risk_band(score: float) -> str:
    if score >= 70.0:
        return "low"
    if score >= 45.0:
        return "medium"
    return "high"


def _suggested_terms(score: float, band: str, amount_usd: float) -> dict:
    escrow = {"low": 20, "medium": 50, "high": 75}[band]
    if band == "high" and amount_usd > 50_000:
        escrow = 100
    if band == "medium" and score < 55:
        escrow = 60
    return {
        "escrow_pct": int(escrow),
        "requires_review": bool(score < 60.0),
        "min_documents": {"low": 3, "medium": 4, "high": 5}[band],
    }


# ---------------------------------------------------------------------------
# Public API (spec-exact)
# ---------------------------------------------------------------------------

def score_trade(features: dict) -> dict:
    b = _get_bundle()
    clean = F.clean_features(features)
    vec = F.vector_to_row(F.vectorize(clean))
    p = b["scorer"].proba(vec)                      # P(completes on time)
    score = round(max(0.0, min(100.0, p * 100.0)), 1)
    band = _risk_band(score)
    return {
        "score": score,
        "risk_band": band,
        "suggested_terms": _suggested_terms(score, band, clean["amount_usd"]),
        "top_features": _explain(b, vec, p),
        "model_version": b["model_version"],
    }


def _anomaly_flags(clean: dict, vec: List[float], b: dict) -> List[str]:
    flags: List[str] = []
    if clean["invoice_to_avg_ratio"] > 2.5:
        flags.append(f"inflated_invoice: {clean['invoice_to_avg_ratio']:.1f}x "
                     "the buyer's historical order size")
    if clean["amount_usd"] > 250_000:
        flags.append(f"oversized_order: ${clean['amount_usd']:,.0f} far exceeds "
                     "corridor norms")
    if clean["doc_discrepancy_count"] >= 3:
        flags.append(f"document_trouble: {clean['doc_discrepancy_count']} "
                     "discrepancies in the doc check")
    if clean["buyer_avg_days_to_pay"] > 90:
        flags.append(f"slow_payer: buyer averages "
                     f"{clean['buyer_avg_days_to_pay']:.0f} days to pay")
    if clean["fx_volatility"] > 0.5:
        flags.append(f"fx_stress: USD/PKR volatility "
                     f"{clean['fx_volatility']:.0%} over the payment window")
    if clean["buyer_country_risk"] > 0.85:
        flags.append("extreme_country_risk: buyer jurisdiction near top of "
                     "risk scale")
    if clean["payment_term_days"] > 90:
        flags.append(f"open_credit: {clean['payment_term_days']}-day payment "
                     "term stretches exposure")
    if clean["past_orders"] == 0 and clean["amount_usd"] > 100_000:
        flags.append("first_order_large: no trade history at this size")
    # Statistical outliers via robust z-scores captured at training time.
    stats = b.get("robust_stats") or {}
    for name, val in zip(F.MODEL_FEATURES, vec):
        s = stats.get(name)
        if not s or _CAT_COLS.get(name):
            continue
        z = abs(val - s["median"]) / max(s["mad"], 1e-6)
        if z > 8.0:
            label = FEATURE_LABELS.get(name, name)
            flags.append(f"statistical_outlier: {label} is {z:.0f} robust-sigma "
                         "from the corridor norm")
    return flags


def anomaly_check(features: dict) -> dict:
    b = _get_bundle()
    clean = F.clean_features(features)
    vec = F.vector_to_row(F.vectorize(clean))
    model_anom = b["outlier"].is_anomaly(vec)
    flags = _anomaly_flags(clean, vec, b)
    return {
        "is_anomaly": bool(model_anom or len(flags) >= 2),
        "flags": flags,
    }


def model_info() -> dict:
    """Active model version + holdout metrics (incl. LR baseline when present)."""
    b = _get_bundle()
    metrics = dict(b.get("metrics", {}))
    metrics.update(scorer=b.get("scorer_kind"), anomaly=b["outlier"].kind,
                   explanations="shap" if b.get("shap_importance") else "perturbation_fallback",
                   data_source=b.get("data_source", "synthetic"), synthetic=True)
    return {"model_version": b.get("model_version"), "metrics": metrics}


def retrain(dataset_ref: str = None) -> dict:
    """Synchronous retrain (backend POST /api/models/retrain)."""
    from ml import train as _train
    with _lock:
        path = dataset_ref or _train.DATA_PATH
        if not os.path.exists(path):
            from ml import generate_data
            generate_data.main()
            path = _train.DATA_PATH
        meta = _train.train(path, quiet=True)
        b = _read_artifacts()
        # Bump the version so every stored score can cite the model that
        # produced it (audit requirement from the handoff doc §8).
        b = dict(b)
        counter = int(os.environ.get("SILKFLOW_RETRAIN_COUNT", "0")) + 1
        os.environ["SILKFLOW_RETRAIN_COUNT"] = str(counter)
        b["model_version"] = f"{_train.MODEL_VERSION}.r{counter}"
        _bundle["b"] = b                      # atomic swap
        metrics = dict(meta["metrics"])
        metrics.update(scorer=meta["scorer_kind"], anomaly=meta["anomaly_kind"],
                       explanations=meta["explanations"], n_rows=meta["n_rows"],
                       synthetic=True)
        return {
            "job_id": f"train-{uuid.uuid4().hex[:12]}",
            "status": "completed",
            "model_version": b["model_version"],
            "metrics": metrics,
        }


# Warm the models at import so the first API call is fast (spec: load once
# at import; auto-trains on a fresh checkout).
_get_bundle()
