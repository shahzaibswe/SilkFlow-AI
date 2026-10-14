"""Model training for SilkFlow AI.

    python -m ml.train

Trains and persists (into ml/artifacts/):
  1. Trade credit scorer — XGBoost if installed, else scikit-learn
     LogisticRegression baseline, else pure-Python logistic regression.
     Reports AUC + accuracy on a seeded 20% holdout.
  2. Anomaly detector — sklearn IsolationForest (else robust-z fallback).
  3. Explanations — SHAP values when shap is installed; otherwise a
     coefficient / baseline-perturbation attribution fallback (documented).

All training data is SYNTHETIC (see ml/generate_data.py, docs/DATA_MODEL.md).
"""

from __future__ import annotations

import json
import os
import pickle
import random
from typing import Dict, List, Tuple

from ml import features as F
from ml._compat import (HAS_JOBLIB, HAS_NUMPY, HAS_PANDAS, HAS_SHAP,
                        HAS_SKLEARN, HAS_XGBOOST, scorer_kind)

if HAS_NUMPY:
    import numpy as _np

ML_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(ML_DIR, "data", "synthetic_trades.csv")
ARTIFACT_DIR = os.path.join(ML_DIR, "artifacts")
ARTIFACT_PATH = os.path.join(ARTIFACT_DIR, "model_artifacts.pkl")
META_PATH = os.path.join(ARTIFACT_DIR, "model_meta.json")

MODEL_VERSION = "v1.3-synth"


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_dataset(path: str = DATA_PATH) -> List[dict]:
    if not os.path.exists(path):
        from ml import generate_data
        path = generate_data.main()
    rows: List[dict] = []
    if HAS_PANDAS:
        import pandas as pd
        df = pd.read_csv(path)
        rows = df.to_dict("records")
    else:
        import csv
        with open(path, newline="", encoding="utf-8") as f:
            for rec in csv.DictReader(f):
                for k in ("amount_usd", "on_time_rate", "buyer_avg_days_to_pay",
                          "buyer_country_risk", "invoice_to_avg_ratio",
                          "fx_volatility"):
                    rec[k] = float(rec[k])
                for k in ("past_orders", "doc_discrepancy_count",
                          "payment_term_days", "trade_completed_on_time"):
                    rec[k] = int(float(rec[k]))
                rows.append(rec)
    return rows


def build_matrices(rows: List[dict]) -> Tuple[List[List[float]], List[int]]:
    X = [F.vector_to_row(F.vectorize(r)) for r in rows]
    y = [int(r["trade_completed_on_time"]) for r in rows]
    return X, y


# ---------------------------------------------------------------------------
# Metrics (pure-python; no sklearn needed)
# ---------------------------------------------------------------------------

def roc_auc(y_true: List[int], scores: List[float]) -> float:
    paired = sorted(zip(scores, y_true), key=lambda t: t[0])
    ranks = [0.0] * len(paired)
    i = 0
    while i < len(paired):  # average ranks for ties
        j = i
        while j + 1 < len(paired) and paired[j + 1][0] == paired[i][0]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[k] = avg
        i = j + 1
    pos = [r for r, (_, y) in zip(ranks, paired) if y == 1]
    neg = [r for r, (_, y) in zip(ranks, paired) if y == 0]
    if not pos or not neg:
        return 0.5
    n_pos, n_neg = len(pos), len(neg)
    auc = (sum(pos) - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)
    return max(0.5, min(1.0, auc)) if auc >= 0.5 else 1.0 - auc


def classification_metrics(y_true: List[int], proba: List[float],
                           threshold: float = 0.5) -> dict:
    """Precision / recall / F1 / ROC-AUC / confusion matrix at a fixed cutoff."""
    tp = sum(1 for p, t in zip(proba, y_true) if p >= threshold and t == 1)
    fp = sum(1 for p, t in zip(proba, y_true) if p >= threshold and t == 0)
    fn = sum(1 for p, t in zip(proba, y_true) if p < threshold and t == 1)
    tn = sum(1 for p, t in zip(proba, y_true) if p < threshold and t == 0)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    acc = (tp + tn) / max(1, len(y_true))
    return {"auc": round(roc_auc(list(y_true), list(proba)), 4),
            "accuracy": round(acc, 4), "precision": round(precision, 4),
            "recall": round(recall, 4), "f1": round(f1, 4),
            "threshold": threshold,
            "confusion_matrix": {"tp": tp, "fp": fp, "fn": fn, "tn": tn}}


# ---------------------------------------------------------------------------
# Fitted wrappers (uniform predict_proba interface over the 3 backends)
# ---------------------------------------------------------------------------

class Scorer:
    """Uniform 0..1 'probability of on-time completion' over any backend."""

    def __init__(self, kind: str, model):
        self.kind = kind
        self.model = model

    def proba(self, row: List[float]) -> float:
        if self.kind == "pure":
            return float(self.model.predict_proba1(row))
        p = self.model.predict_proba([row])
        return float(p[0][1])

    def proba_many(self, X: List[List[float]]):
        if self.kind == "pure":
            return [self.model.predict_proba1(r) for r in X]
        return [p[1] for p in self.model.predict_proba(X)]


class Outlier:
    """Uniform anomaly interface over IsolationForest / robust-z fallback."""

    def __init__(self, kind: str, model, names: List[str]):
        self.kind = kind      # "iforest" | "robust_z"
        self.model = model
        self.names = names

    def is_anomaly(self, row: List[float]) -> bool:
        if self.kind == "iforest":
            return int(self.model.predict([row])[0]) == -1
        return bool(self.model.is_outlier(row))

    def anomaly_score(self, row: List[float]) -> float:
        """Higher = more anomalous. If: -score_function; robust-z: max |z|."""
        if self.kind == "iforest":
            return float(-self.model.score_samples([row])[0])
        return float(self.model.score(row))


# ---------------------------------------------------------------------------
# Training pipeline
# ---------------------------------------------------------------------------

def _split(X, y, test_frac=0.2, seed=7):
    idx = list(range(len(X)))
    random.Random(seed).shuffle(idx)
    n_test = max(50, int(len(idx) * test_frac))
    te, tr = idx[:n_test], idx[n_test:]
    return ([X[i] for i in tr], [y[i] for i in tr],
            [X[i] for i in te], [y[i] for i in te])


def _train_scorer(Xtr, ytr, Xte, yte):
    kind = scorer_kind()
    if kind == "xgboost":
        import xgboost as xgb
        model = xgb.XGBClassifier(
            n_estimators=250, max_depth=4, learning_rate=0.08,
            subsample=0.9, colsample_bytree=0.9, reg_lambda=1.0,
            eval_metric="logloss", random_state=42, n_jobs=4,
            verbosity=0)
        if HAS_NUMPY:
            model.fit(_np.array(Xtr), _np.array(ytr))
            proba = [float(p) for p in model.predict_proba(_np.array(Xte))[:, 1]]
        else:  # xgboost always brings numpy; defensive
            model.fit(Xtr, ytr)
            proba = [float(p) for p in model.predict_proba(Xte)[:, 1]]
        sc = Scorer("xgb", model)
    elif kind == "logistic_regression":
        from sklearn.linear_model import LogisticRegression
        model = LogisticRegression(max_iter=2000, C=1.0)
        if HAS_NUMPY:
            import numpy as np
            model.fit(np.array(Xtr), np.array(ytr))
            proba = [float(p) for p in model.predict_proba(np.array(Xte))[:, 1]]
        else:
            model.fit(Xtr, ytr)
            proba = [float(p) for p in model.predict_proba(Xte)[:, 1]]
        sc = Scorer("sk_lr", model)
    else:
        from ml.pure_model import PureLogistic
        model = PureLogistic(epochs=600, lr=0.3).fit(Xtr, ytr)
        proba = [model.predict_proba1(r) for r in Xte]
        sc = Scorer("pure", model)

    acc = sum((p >= 0.5) == (t == 1) for p, t in zip(proba, yte)) / max(1, len(yte))
    metrics = classification_metrics(yte, proba)
    metrics["accuracy"] = round(acc, 4)
    metrics["n_train"] = len(Xtr)
    metrics["n_test"] = len(yte)
    return sc, kind, metrics, proba


def _lr_baseline_proba(Xtr, ytr, Xte, yte):
    """Interpretable Logistic Regression baseline trained on the same split.

    Returns (metrics, kind) or None when no LR backend is available
    (then the pure-Python logistic model itself is the baseline).
    """
    try:
        from sklearn.linear_model import LogisticRegression
    except ImportError:
        return None
    model = LogisticRegression(max_iter=2000, C=1.0)
    if HAS_NUMPY:
        import numpy as np
        model.fit(np.array(Xtr), np.array(ytr))
        proba = [float(p) for p in model.predict_proba(np.array(Xte))[:, 1]]
    else:
        model.fit(Xtr, ytr)
        proba = [float(p) for p in model.predict_proba(Xte)[:, 1]]
    return classification_metrics(yte, proba), "sk_lr"


def _train_outlier(Xtr, kind_stack):
    if HAS_SKLEARN:
        from sklearn.ensemble import IsolationForest
        if HAS_NUMPY:
            import numpy as np
            model = IsolationForest(n_estimators=200, contamination=0.025,
                                    random_state=42)
            model.fit(np.array(Xtr))
        else:
            model = None
        if model is not None:
            return Outlier("iforest", model, F.MODEL_FEATURES)
    from ml.pure_model import PureOutlier
    return Outlier("robust_z", PureOutlier(contamination=0.025).fit(Xtr, F.MODEL_FEATURES),
                   F.MODEL_FEATURES)


def _robust_stats(Xtr):
    """Per-model-feature median/MAD (used for anomaly flags + explanations)."""
    stats = {}
    for j, name in enumerate(F.MODEL_FEATURES):
        col = sorted(row[j] for row in Xtr)
        med = col[len(col) // 2] if col else 0.0
        mad = sorted(abs(v - med) for v in col)
        mad = (mad[len(mad) // 2] if mad else 0.0) * 1.4826 or 1e-6
        stats[name] = {"median": med, "mad": mad}
    return stats


def _shap_importance(scorer, Xte) -> Dict[str, float]:
    """Mean |SHAP| per feature when shap is usable; never raises."""
    if not (HAS_SHAP and HAS_NUMPY):
        return {}
    try:
        import shap
        X = _np.array(Xte[: min(len(Xte), 300)])
        if scorer.kind == "xgb":
            explainer = shap.TreeExplainer(scorer.model)
            sv = explainer.shap_values(X)
        elif scorer.kind == "sk_lr":
            explainer = shap.LinearExplainer(scorer.model, X)
            sv = explainer.shap_values(X)
        else:
            return {}
        sv = sv if isinstance(sv, _np.ndarray) else _np.asarray(sv)
        if sv.ndim == 3:      # binary classifier: take positive class
            sv = sv[:, :, 1] if sv.shape[2] == 2 else sv[:, :, 0]
        mean_abs = [round(float(v), 4) for v in sv.mean(axis=0)]
        return dict(zip(F.MODEL_FEATURES, mean_abs))
    except Exception as e:  # pragma: no cover
        print(f"[train] SHAP unavailable, using perturbation fallback ({e!r})")
        return {}


def train(dataset_path: str = DATA_PATH, quiet: bool = False) -> dict:
    """Full training pipeline; writes artifacts and returns the meta dict."""
    rows = load_dataset(dataset_path)
    X, y = build_matrices(rows)
    Xtr, ytr, Xte, yte = _split(X, y)

    scorer, kind, metrics, _proba = _train_scorer(Xtr, ytr, Xte, yte)
    if kind != "sk_lr":
        baseline = _lr_baseline_proba(Xtr, ytr, Xte, yte)
        if baseline is not None:
            bl_metrics, bl_kind = baseline
            metrics["baseline"] = {"scorer_kind": bl_kind, **bl_metrics}
        elif kind == "pure":
            metrics["baseline"] = {"scorer_kind": "pure",
                                   **{k: metrics[k] for k in
                                      ("auc", "accuracy", "precision",
                                       "recall", "f1", "threshold",
                                       "confusion_matrix")}}
    outlier = _train_outlier(Xtr, kind)
    stats = _robust_stats(Xtr)
    shap_imp = _shap_importance(scorer, Xte)

    # Baseline vector = per-feature median (for perturbation explanations).
    baseline = [stats[name]["median"] for name in F.MODEL_FEATURES]

    bundle = {
        "model_version": MODEL_VERSION,
        "scorer_kind": kind,
        "scorer": scorer,
        "outlier": outlier,
        "feature_names": F.MODEL_FEATURES,
        "robust_stats": stats,
        "baseline_row": baseline,
        "baseline_np": (_np.array([baseline]) if HAS_NUMPY else None),
        "shap_importance": shap_imp,      # {} => fallback explanations
        "metrics": metrics,
        "data_source": "synthetic (ml/data/synthetic_trades.csv)",
    }
    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    if HAS_JOBLIB:
        import joblib
        joblib.dump(bundle, ARTIFACT_PATH)
    else:
        with open(ARTIFACT_PATH, "wb") as f:
            pickle.dump(bundle, f, protocol=pickle.HIGHEST_PROTOCOL)

    meta = {
        "model_version": MODEL_VERSION,
        "scorer_kind": kind,
        "anomaly_kind": outlier.kind,
        "explanations": "shap" if shap_imp else "perturbation_fallback",
        "metrics": metrics,
        "n_rows": len(rows),
        "synthetic": True,
    }
    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    if not quiet:
        print(f"[train] scorer={kind} anomaly={outlier.kind} "
              f"explanations={'shap' if shap_imp else 'perturbation-fallback'}")
        print(f"[train] holdout AUC={metrics['auc']:.4f} "
              f"accuracy={metrics['accuracy']:.4f} "
              f"(n={metrics['n_test']}, rows={len(rows)})")
        print(f"[train] artifacts -> {ARTIFACT_PATH}")
        print("[train] data is 100% synthetic - pilot must retrain on real data")
    return meta


def main():
    return train()


if __name__ == "__main__":
    main()
