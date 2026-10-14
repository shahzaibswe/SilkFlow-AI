"""FX rate service: live rates from Frankfurter (no key), DB-cached, synthetic
deterministic fallback when offline.

- latest:      GET {base_url}/latest?base=USD&symbols=PKR
- timeseries:  GET {base_url}/{start}..{end}?base=USD&symbols=PKR  -> volatility
Volatility = population std-dev of daily log returns scaled to 0-1 via a soft cap.
Snapshots are cached in the `fx_snapshots` table (TTL 15 minutes).
"""
import hashlib
import json
import logging
import math
import os
import statistics
import time
from datetime import date, timedelta

from sqlalchemy.orm import Session

from ..models import FxSnapshot

log = logging.getLogger("silkflow.fx")

BASE_URL = os.getenv("FX_BASE_URL", "https://api.frankfurter.dev/v1")
CACHE_TTL = 15 * 60

# static fallback table: [reference rate, annualized volatility estimate]
_SYNTHETIC = {
    "USD/PKR": (278.60, 0.065),
    "USD/CNY": (7.0850, 0.021),
    "USD/AED": (3.6725, 0.003),
    "USD/BDT": (117.00, 0.055),
    "USD/VND": (25400.0, 0.018),
    "USD/INR": (83.20, 0.032),
}
_DEFAULT_SYNTH = (1.0, 0.04)


def _http_get(url: str) -> dict | None:
    try:
        import httpx
        r = httpx.get(url, timeout=5.0)
        if r.status_code == 200:
            return r.json()
    except Exception as exc:
        log.debug("fx fetch failed (%s): %s", url, exc)
    return None


def _synthetic(pair: str) -> tuple[float, float]:
    base, quote = pair.split("/")
    rate, vol = _SYNTHETIC.get(pair, _DEFAULT_SYNTH)
    # deterministic daily jitter from sha256 so successive days differ slightly
    h = int(hashlib.sha256(f"{pair}:{date.today().isoformat()}".encode()).hexdigest()[:6], 16)
    jitter = 1.0 + ((h % 2000) - 1000) / 1000.0 / 100.0  # +/- 1%
    return round(rate * jitter, 4), vol


def _volatility_from_series(rates: list[float]) -> float:
    rets = [math.log(rates[i] / rates[i - 1]) for i in range(1, len(rates)) if rates[i - 1] > 0]
    if len(rets) < 2:
        return 0.0
    daily = statistics.pstdev(rets)
    return min(1.0, daily * math.sqrt(252) / 0.5)  # annualized, soft-capped to 0..1


def get_rate_and_volatility(db: Session, base: str, quote: str, days: int) -> dict:
    """Return {"rate","volatility","source"} with live -> cache -> synthetic."""
    pair = f"{base.upper()}/{quote.upper()}"
    cached = (db.query(FxSnapshot)
              .filter(FxSnapshot.pair == pair,
                      FxSnapshot.captured_at > time.time() - CACHE_TTL)
              .order_by(FxSnapshot.id.desc()).first())
    if cached:
        return {"rate": cached.rate, "volatility": cached.volatility, "source": "cache"}

    rate = vol = None
    source = "synthetic"
    js = _http_get(f"{BASE_URL}/latest?base={base.upper()}&symbols={quote.upper()}")
    if js and quote.upper() in js.get("rates", {}):
        rate = float(js["rates"][quote.upper()])
        start = (date.today() - timedelta(days=days)).isoformat()
        end = date.today().isoformat()
        ts = _http_get(f"{BASE_URL}/{start}..{end}?base={base.upper()}&symbols={quote.upper()}")
        if ts and isinstance(ts.get("rates"), dict):
            series = [v.get(quote.upper()) for k, v in sorted(ts["rates"].items())
                      if isinstance(v, dict) and v.get(quote.upper())]
            vol = _volatility_from_series([float(x) for x in series if x])
        else:
            vol = _SYNTHETIC.get(pair, _DEFAULT_SYNTH)[1]
        source = "live"
    if rate is None:
        rate, vol = _synthetic(pair)
        vol = min(1.0, vol)

    snap = FxSnapshot(pair=pair, rate=rate, volatility=round(vol, 4), source=source)
    db.add(snap)
    db.flush()
    return {"rate": rate, "volatility": round(vol, 4), "source": source}


def fx_risk_note(db: Session, base: str = "USD", quote: str = "PKR", days: int = 30,
                 amount: float | None = None) -> dict:
    """Spec response shape for GET /api/fx/risk."""
    data = get_rate_and_volatility(db, base, quote, days)
    vol_pct = round(data["volatility"] * 100, 2)
    # expected adverse exposure over the payment window (sqrt-of-time heuristic)
    exposure_pct = round(vol_pct * math.sqrt(max(days, 1) / 365.0), 2)
    exposure_amt = round((amount or 0.0) * exposure_pct / 100.0, 2)
    if vol_pct < 3:
        note = f"{base}->{quote} has been stable ({vol_pct}% annualized vol); FX risk over {days} days is low."
    elif vol_pct < 10:
        note = (f"{base}->{quote} moved ~{vol_pct}% annualized; expect roughly {exposure_pct}% "
                f"of the invoice value at risk over the {days}-day payment window.")
    else:
        note = (f"High {base}->{quote} volatility ({vol_pct}%): up to ~{exposure_pct}% "
                f"(${exposure_amt:,.0f} on this order) of margin could be erased before payment; "
                "consider shorter terms or hedging.")
    return {
        "base": base.upper(), "quote": quote.upper(), "days": days,
        "rate": data["rate"], "volatility_pct": vol_pct, "exposure_pct": exposure_pct,
        "exposure_amount": exposure_amt if amount else None,
        "note": note, "source": data["source"],
    }
