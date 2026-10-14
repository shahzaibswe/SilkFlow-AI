"""Cash-flow forecaster — deterministic Python arithmetic (no LLM involvement).

Model: an exporter business starts from `opening_balance`. Expected receipts
come from its own orders: amount lands on `ship_by + payment_term_days`
(falling back to created_at + term). Orders already settled count as landed
receipts in the past. Forecast = weekly (Monday-anchored, UTC) cumulative
balance over a horizon of N weeks; weeks where the projected balance goes
below zero are gap weeks and raise a `cash_gap` alert (one per business per
week, refreshed).

What-if scenarios delay a specific order's receipt by `delay_days` and are
computed on the fly WITHOUT persisting — the real forecast is never mutated.
"""
import calendar
import logging
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..models import Alert, Business, CashflowForecast, CashflowItem, Order
from .audit_service import append_audit

log = logging.getLogger("silkflow.cashflow")

WEEK = 7 * 86400
RECEIPT_STATUSES = ("awaiting_funding", "scored", "funded", "shipped", "released",
                    "disputed", "resolved", "settled")
CONFIDENCE = {"settled": 1.0, "released": 1.0, "resolved": 1.0, "shipped": 0.95,
              "funded": 0.9, "disputed": 0.4, "scored": 0.6, "awaiting_funding": 0.6,
              "docs_checked": 0.5, "draft": 0.4}


def _week_start(epoch: float) -> float:
    d = datetime.fromtimestamp(epoch, tz=timezone.utc)
    monday = (d - timedelta(days=d.weekday())).replace(hour=0, minute=0,
                                                       second=0, microsecond=0)
    return monday.timestamp()


def _ship_epoch(o: Order) -> float:
    try:
        return datetime.strptime(o.ship_by[:10], "%Y-%m-%d").replace(
            tzinfo=timezone.utc).timestamp()
    except Exception:
        return o.created_at


def _signed(item: CashflowItem) -> float:
    return -item.amount if item.kind == "payment" else item.amount


def rebuild_items(db: Session, business_id: int) -> int:
    """Regenerate this business's auto receipts from current order rows.

    Manual items (source="manual", e.g. scheduled freight/payment to
    suppliers) are preserved — they are entered by the exporter, not derived.
    """
    db.query(CashflowItem).filter(CashflowItem.business_id == business_id,
                                  CashflowItem.source == "auto").delete()
    b = db.get(Business, business_id)
    n = 0
    for o in db.query(Order).filter(Order.seller_id == business_id,
                                    Order.status.in_(RECEIPT_STATUSES)).all():
        landed = o.status in ("settled", "released", "resolved")
        expected = _ship_epoch(o) + o.payment_term_days * 86400
        if landed:
            expected = min(expected, time.time())  # already banked
        db.add(CashflowItem(business_id=business_id, order_id=o.id, kind="receipt",
                            amount=o.amount, expected_date=expected,
                            confidence=CONFIDENCE.get(o.status, 0.5), source="auto"))
        n += 1
    db.flush()
    log.debug("cashflow items rebuilt for business %s: %d receipts (opening %.2f)",
              business_id, n, b.opening_balance if b else 0)
    return n


def forecast(db: Session, business_id: int, weeks: int = 12,
             delays: dict[int, int] | None = None, persist: bool = True) -> dict:
    """Weekly projected balances. `delays` = {order_id: extra_days} for what-if."""
    delays = delays or {}
    b = db.get(Business, business_id)
    if b is None:
        raise ValueError("unknown business")
    this_week = _week_start(time.time())
    items = db.query(CashflowItem).filter(CashflowItem.business_id == business_id).all()

    landed = sum(_signed(i) for i in items
                 if i.expected_date < this_week and not delays.get(i.order_id or 0))
    current_balance = round(b.opening_balance + landed, 2)

    # bucket future flows by week (scenario delays push receipt dates out)
    buckets: dict[float, float] = {}
    for i in items:
        if i.expected_date < this_week:
            continue
        d = i.expected_date + delays.get(i.order_id or 0, 0) * 86400
        wk = _week_start(d)
        buckets[wk] = buckets.get(wk, 0.0) + _signed(i)

    rows, bal, lowest = [], current_balance, current_balance
    lowest_week = this_week
    if persist:
        db.query(CashflowForecast).filter(
            CashflowForecast.business_id == business_id).delete()
        db.flush()
    for w in range(weeks):
        wk = this_week + w * WEEK
        inflow = round(buckets.get(wk, 0.0), 2)
        bal = round(bal + inflow, 2)
        gap = bal < 0
        rows.append({"week_start": wk,
                     "week_label": datetime.fromtimestamp(wk, tz=timezone.utc)
                                   .strftime("%d %b"),
                     "receipts": inflow, "projected_balance": bal, "gap": gap})
        if bal < lowest:
            lowest, lowest_week = bal, wk
        if persist:
            db.add(CashflowForecast(business_id=business_id, week_start=wk,
                                   projected_balance=bal, gap_flag=1 if gap else 0))

    gap_weeks = [r for r in rows if r["gap"]]
    receipts_30d = round(sum(i.amount for i in items if i.kind == "receipt"
                             and this_week <= i.expected_date < this_week + 5 * WEEK), 2)
    if persist and gap_weeks:
        first = gap_weeks[0]
        raise_alert(db, business_id, "cash_gap",
                    f"Cash gap expected in week of {first['week_label']}: "
                    f"projected balance {first['projected_balance']:.0f} USD.",
                    "critical" if lowest < -10000 else "warning")
    return {
        "business_id": business_id, "opening_balance": b.opening_balance,
        "current_balance": current_balance, "horizon_weeks": weeks,
        "expected_receipts_30d": receipts_30d,
        "lowest_projected_balance": lowest,
        "lowest_week": datetime.fromtimestamp(lowest_week, tz=timezone.utc)
                        .strftime("%d %b %Y"),
        "gap_weeks": len(gap_weeks), "weeks": rows,
        "method": "deterministic weekly aggregation of scheduled receipts",
    }


def raise_alert(db: Session, business_id: int | None, alert_type: str,
                message: str, severity: str = "info",
                order_id: int | None = None) -> Alert:
    # de-dup: same message never repeats; an unread cash_gap also blocks a new one
    q = db.query(Alert).filter(Alert.business_id == business_id,
                               Alert.type == alert_type)
    existing = q.filter(Alert.message == message).first()
    if existing or (alert_type == "cash_gap" and q.filter(Alert.read_at.is_(None)).first()):
        return existing or q.filter(Alert.read_at.is_(None)).first()
    a = Alert(business_id=business_id, type=alert_type, message=message,
              severity=severity, order_id=order_id)
    db.add(a)
    db.flush()
    append_audit(db, order_id=order_id, action="alert", actor="system",
                 data={"alert_type": alert_type, "severity": severity,
                       "message": message, "business_id": business_id})
    return a


def alert_dict(a: Alert) -> dict:
    from ..schemas import iso
    return {"id": a.id, "business_id": a.business_id, "type": a.type,
            "message": a.message, "severity": a.severity, "order_id": a.order_id,
            "created_at": iso(a.created_at), "read_at": iso(a.read_at)}
