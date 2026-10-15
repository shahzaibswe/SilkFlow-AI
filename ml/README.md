# SilkFlow AI ML subsystem

Trade credit scoring + anomaly detection for the China → Pakistan corridor
prototype. **All training data is synthetic** (documented assumptions in
`../docs/DATA_MODEL.md`); scores are demo-grade, not financial advice.

## Quickstart (run from the repo root `silkflow/`, with `.` on PYTHONPATH)

```bash
pip install -r ml/requirements.txt      # numpy/pandas/sklearn/joblib (+ optional xgboost, shap)
python -m ml.generate_data              # -> ml/data/synthetic_trades.csv (~5000 rows)
python -m ml.train                      # -> ml/artifacts/ (prints holdout AUC/accuracy)
python -m ml.tests.test_service         # or: pytest ml/tests/test_service.py
```

Use from the backend:

```python
from ml.service import score_trade, anomaly_check, FEATURE_LABELS

score_trade({"past_orders": 45, "on_time_rate": 0.95, "buyer_avg_days_to_pay": 18,
             "buyer_country_risk": 0.15, "invoice_to_avg_ratio": 1.0,
             "doc_discrepancy_count": 0, "payment_term_days": 30,
             "fx_volatility": 0.08, "amount_usd": 15000, "goods_category": "surgical_goods"})
anomaly_check({"invoice_to_avg_ratio": 9.0, ...})
```

If `ml/artifacts/` is missing, `ml.service` auto-generates data and trains on
first import — no manual step needed.

## Graceful degradation (Python 3.15 friendly)

| Capability          | Preferred            | Fallback                                  |
|---------------------|----------------------|-------------------------------------------|
| Credit scorer       | XGBoost              | sklearn LogisticRegression → pure-Python logistic regression |
| Anomaly detector    | sklearn IsolationForest | robust z-score (median/MAD) detector   |
| Explanations        | SHAP (Tree/Linear)   | baseline-perturbation attribution + coefficients |
| Persistence         | joblib               | stdlib pickle                             |
| Data gen / load     | numpy + pandas       | stdlib `random` + `csv` (same CSV schema) |

Everything is checked at import time (`ml/_compat.py`); nothing hard-fails if
an optional package is missing. `python -c "from ml._compat import smain; smain()"`
prints the active stack.

## Layout

- `generate_data.py`, seeded synthetic dataset with injected anomalies
- `features.py` , canonical features dict → model-space vector (one-hot categories)
- `train.py` , scorer + IsolationForest + SHAP/fallback attributions → `artifacts/`
- `service.py` , spec API: `score_trade`, `anomaly_check`, `retrain`, `FEATURE_LABELS`
- `pure_model.py` , dependency-free logistic regression / outlier detector
- `tests/test_service.py` ,API contract, monotonicity, anomaly, retrain tests
