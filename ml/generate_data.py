"""Synthetic trade-finance dataset generator for SilkFlow AI.

    python -m ml.generate_data          # -> ml/data/synthetic_trades.csv (~5000 rows)

EVERY ROW IS SYNTHETIC. Nothing here was observed in real transaction data.
The generator encodes documented assumptions about a China -> Pakistan trade
corridor (textiles, home textiles, surgical goods, apparel, electronics,
machinery parts) to produce a plausible, reproducible demo/training set.
Assumptions are listed in docs/DATA_MODEL.md.

Mechanics
---------
* Seeded RNG (default 42) => byte-identical CSV every run.
* A latent "risk logit" links features causally (more history & higher
  on-time rate => safer; country risk, late payment, inflated invoices,
  doc discrepancies, long terms, FX volatility => riskier), then the target
  `trade_completed_on_time` is drawn from sigmoid(logit) with noise. This
  keeps the label *learnable but not deterministic* (realistic AUC ~0.85-0.92).
* ~2.5% of rows are injected anomalies (inflated invoice vs. history, huge
  amounts, extreme payment delays, many doc discrepancies, FX spikes) and
  mostly end in non-completion — fodder for the Isolation Forest.

Uses numpy/pandas when available; falls back to pure-stdlib random+csv and
writes the identical schema.
"""

from __future__ import annotations

import csv
import os
import random
from typing import List

from ml._compat import HAS_NUMPY, HAS_PANDAS, expit
from ml.features import GOODS_CATEGORIES

SEED = 42
N_ROWS = 5000
ANOMALY_FRACTION = 0.025

# Category weights + a small intrinsic corridor-risk adjustment (synthetic
# assumption: surgical goods are heavily vetted / reliable exporters, fresh
# electronics categories dispute more on this corridor).
CATEGORY_WEIGHTS = {
    "textiles": 0.30,
    "home_textiles": 0.22,
    "surgical_goods": 0.15,
    "apparel": 0.12,
    "electronics": 0.10,
    "machinery_parts": 0.06,
    "other": 0.05,
}
CATEGORY_RISK_DELTA = {  # added to the risk logit (positive = riskier)
    "textiles": -0.10,
    "home_textiles": -0.05,
    "surgical_goods": -0.25,
    "apparel": 0.05,
    "electronics": 0.25,
    "machinery_parts": 0.10,
    "other": 0.00,
}

PAYMENT_TERMS = [0, 15, 30, 45, 60, 90]  # 0 = prepaid/COD (safest)
TERM_WEIGHTS = [0.10, 0.15, 0.35, 0.20, 0.12, 0.08]

COLUMNS = [
    "order_id", "seller_id", "buyer_id", "goods_category", "amount_usd",
    "past_orders", "on_time_rate", "buyer_avg_days_to_pay",
    "buyer_country_risk", "invoice_to_avg_ratio", "doc_discrepancy_count",
    "payment_term_days", "fx_volatility", "is_anomaly",
    "trade_completed_on_time",
]


def _risk_logit(r: dict) -> float:
    """Synthetic causal model: features -> log-odds of NON-completion."""
    return (
        -2.7                                   # base: ~78% of trades complete
        - 2.4 * r["on_time_rate"]              # reliable counterparties are safer
        - 0.9 * min(r["past_orders"], 60) / 60  # relationship depth
        + 2.6 * r["buyer_country_risk"]        # jurisdiction risk
        + 1.3 * min(r["buyer_avg_days_to_pay"], 180) / 90  # slow payers
        + 1.5 * max(0.0, r["invoice_to_avg_ratio"] - 1.0)  # invoice inflation
        + 0.7 * min(r["doc_discrepancy_count"], 6)         # paperwork problems
        + 0.9 * r["payment_term_days"] / 90    # open credit = exposure
        + 1.6 * r["fx_volatility"]             # currency stress
        + CATEGORY_RISK_DELTA.get(r["goods_category"], 0.0)
    )


def _gen_rows(seed: int, n: int) -> List[dict]:
    rng = random.Random(seed)

    cats = list(CATEGORY_WEIGHTS.keys())
    cat_w = [CATEGORY_WEIGHTS[c] for c in cats]

    rows: List[dict] = []
    for i in range(n):
        cat = rng.choices(cats, weights=cat_w, k=1)[0]
        past_orders = int(rng.expovariate(1 / 28.0)) + rng.randint(0, 3)  # ~0-120
        # On-time rate improves slightly with history; long-tail of sloppy buyers.
        base_otr = rng.gauss(0.62, 0.16) + 0.10 * min(past_orders, 60) / 60
        on_time_rate = min(max(base_otr, 0.02), 0.99)
        country_risk = min(max(rng.gauss(0.42, 0.18), 0.02), 0.98)  # PK corridor
        days_to_pay = min(max(rng.gauss(38 + 55 * country_risk, 16), 3), 210)
        ratio = min(max(rng.gauss(1.0, 0.22), 0.25), 2.6)
        disc = rng.choices([0, 1, 2, 3, 4, 5], weights=[0.55, 0.24, 0.12,
                                                        0.05, 0.03, 0.01], k=1)[0]
        term = rng.choices(PAYMENT_TERMS, weights=TERM_WEIGHTS, k=1)[0]
        fx_vol = min(max(rng.gauss(0.16, 0.09), 0.01), 0.60)  # USD/PKR regime
        amount = min(math_e(rng, 9.6, 0.75), 900_000.0)  # lognormal ~14k median

        r = dict(goods_category=cat, past_orders=past_orders,
                 on_time_rate=on_time_rate, buyer_country_risk=country_risk,
                 buyer_avg_days_to_pay=days_to_pay, invoice_to_avg_ratio=ratio,
                 doc_discrepancy_count=disc, payment_term_days=term,
                 fx_volatility=fx_vol, amount_usd=amount)

        p_bad = expit(_risk_logit(r) + rng.gauss(0, 0.25))  # label noise
        completed = 1 if rng.random() > p_bad else 0
        r["trade_completed_on_time"] = completed
        r["is_anomaly"] = 0
        rows.append(r)

    # ---- inject anomalies (~2.5%) --------------------------------------
    n_anom = int(n * ANOMALY_FRACTION)
    for idx in rng.sample(range(n), n_anom):
        r = rows[idx]
        kind = rng.choice(["inflated_invoice", "oversized_order",
                           "late_payer", "doc_mess", "fx_stress", "combo"])
        if kind == "inflated_invoice":
            r["invoice_to_avg_ratio"] = rng.uniform(3.0, 9.0)
        elif kind == "oversized_order":
            r["amount_usd"] *= rng.uniform(6, 20)
            r["invoice_to_avg_ratio"] = max(r["invoice_to_avg_ratio"],
                                            rng.uniform(2.0, 4.5))
        elif kind == "late_payer":
            r["buyer_avg_days_to_pay"] = rng.uniform(90, 200)
            r["payment_term_days"] = rng.choice([90, 120, 150])
        elif kind == "doc_mess":
            r["doc_discrepancy_count"] = rng.randint(4, 9)
        elif kind == "fx_stress":
            r["fx_volatility"] = rng.uniform(0.55, 0.95)
        else:  # combo: a few subtle-ish oddities at once
            r["invoice_to_avg_ratio"] = rng.uniform(1.8, 3.5)
            r["doc_discrepancy_count"] = rng.randint(2, 5)
            r["buyer_country_risk"] = min(r["buyer_country_risk"]
                                          + rng.uniform(0.2, 0.4), 0.99)
        r["is_anomaly"] = 1
        # Anomalous trades mostly fail (~75%):
        r["trade_completed_on_time"] = 1 if rng.random() > 0.75 else 0

    # ---- ids ------------------------------------------------------------
    for i, r in enumerate(rows):
        r["order_id"] = f"SYN-{10000 + i}"
        r["seller_id"] = f"CN-{rng.randrange(1, 120):04d}"
        r["buyer_id"] = f"PK-{rng.randrange(1, 260):04d}"
    return rows


def math_e(rng: random.Random, mu: float, sigma: float) -> float:
    """lognormal draw (stdlib)."""
    import math
    return math.exp(rng.gauss(mu, sigma))


def generate(n: int = N_ROWS, seed: int = SEED) -> List[dict]:
    """Return rows as list of dicts (synthetic; deterministic)."""
    return _gen_rows(seed, n)


DATA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "data", "synthetic_trades.csv")


def write_csv(rows: List[dict], path: str = DATA_PATH) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if HAS_PANDAS:
        import pandas as pd  # noqa: WPS433 (guarded re-import for typing)
        df = pd.DataFrame(rows, columns=COLUMNS)
        df["amount_usd"] = df["amount_usd"].round(2)
        for col in ("on_time_rate", "buyer_country_risk", "fx_volatility"):
            df[col] = df[col].round(4)
        df["buyer_avg_days_to_pay"] = df["buyer_avg_days_to_pay"].round(1)
        df["invoice_to_avg_ratio"] = df["invoice_to_avg_ratio"].round(3)
        df.to_csv(path, index=False)
        return path
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        for r in rows:
            r = dict(r)
            r["amount_usd"] = round(r["amount_usd"], 2)
            for col in ("on_time_rate", "buyer_country_risk", "fx_volatility"):
                r[col] = round(r[col], 4)
            r["buyer_avg_days_to_pay"] = round(r["buyer_avg_days_to_pay"], 1)
            r["invoice_to_avg_ratio"] = round(r["invoice_to_avg_ratio"], 3)
            w.writerow(r)
    return path


def main() -> str:
    rows = generate()
    path = write_csv(rows)
    n_anom = sum(r["is_anomaly"] for r in rows)
    n_ok = sum(r["trade_completed_on_time"] for r in rows)
    print(f"[synthetic] wrote {len(rows)} rows "
          f"({n_ok} completed on time, {n_anom} injected anomalies) -> {path}")
    print("[synthetic] ALL DATA IS SYNTHETIC - see docs/DATA_MODEL.md "
          "for the assumptions behind every column.")
    return path


if __name__ == "__main__":
    main()
