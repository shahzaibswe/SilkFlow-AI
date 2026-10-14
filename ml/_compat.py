"""Environment capability detection + graceful-degradation shims.

SilkFlow AI must run on any Python (including 3.15 where some wheels may be
missing). Import order of preference:

    xgboost  ->  scikit-learn  ->  pure-stdlib logistic regression
    shap     ->  coefficient / perturbation-based attribution fallback
    joblib   ->  stdlib pickle
    pandas/numpy -> stdlib csv / plain-python math

Importing this module NEVER raises; check the HAS_* flags instead.
"""

from __future__ import annotations

import math
import os

# --- numpy -----------------------------------------------------------------
try:
    import numpy as np  # type: ignore
    HAS_NUMPY = True
except Exception:  # pragma: no cover
    np = None  # type: ignore
    HAS_NUMPY = False

# --- pandas ----------------------------------------------------------------
try:
    import pandas as pd  # type: ignore
    HAS_PANDAS = HAS_NUMPY and True
except Exception:  # pragma: no cover
    pd = None  # type: ignore
    HAS_PANDAS = False

# --- joblib (else stdlib pickle) --------------------------------------------
try:
    import joblib  # type: ignore
    HAS_JOBLIB = True
except Exception:  # pragma: no cover
    joblib = None  # type: ignore
    HAS_JOBLIB = False

# --- scikit-learn -----------------------------------------------------------
try:
    from sklearn.ensemble import IsolationForest  # type: ignore
    from sklearn.linear_model import LogisticRegression  # type: ignore
    HAS_SKLEARN = True
except Exception:  # pragma: no cover
    IsolationForest = None  # type: ignore
    LogisticRegression = None  # type: ignore
    HAS_SKLEARN = False

# --- xgboost ----------------------------------------------------------------
try:
    import xgboost as xgb  # type: ignore
    HAS_XGBOOST = HAS_SKLEARN and True
except Exception:  # pragma: no cover
    xgb = None  # type: ignore
    HAS_XGBOOST = False

# --- shap --------------------------------------------------------------------
try:
    if HAS_XGBOOST or HAS_SKLEARN:
        import shap  # type: ignore
        HAS_SHAP = True
    else:
        shap = None  # type: ignore
        HAS_SHAP = False
except Exception:  # pragma: no cover
    shap = None  # type: ignore
    HAS_SHAP = False


def smain() -> str:
    """Human-readable summary of the active model stack (for logs/README)."""
    parts = [
        f"numpy={'yes' if HAS_NUMPY else 'NO'}",
        f"pandas={'yes' if HAS_PANDAS else 'NO'}",
        f"joblib={'yes' if HAS_JOBLIB else 'stdlib-pickle'}",
        f"sklearn={'yes' if HAS_SKLEARN else 'NO'}",
        f"xgboost={'yes' if HAS_XGBOOST else 'NO'}",
        f"shap={'yes' if HAS_SHAP else 'NO'}",
    ]
    return " | ".join(parts)


def scorer_kind() -> str:
    if HAS_XGBOOST:
        return "xgboost"
    if HAS_SKLEARN:
        return "logistic_regression"
    return "pure_python_logistic_regression"


# ---------------------------------------------------------------------------
# Tiny numpy-free helpers used by the pure fallbacks. With numpy present these
# delegate to it; without, they run in plain Python (fine for ~5k rows).
# ---------------------------------------------------------------------------

def expit(z: float) -> float:
    """Numerically-stable logistic sigmoid (scalar, stdlib only)."""
    if z >= 0:
        e = math.exp(-z)
        return 1.0 / (1.0 + e)
    e = math.exp(z)
    return e / (1.0 + e)


def ensure_dir(path: str) -> str:
    os.makedirs(path, exist_ok=True)
    return path
