"""Live stats + summary reports for the reviewer feed and payments screens."""
import time

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_roles
from ..models import (AgentAction, Dispute, Escrow, Order, User)
from ..serializers import order_brief
from ..services import chain

router = APIRouter(tags=["stats"])


@router.get("/stats/live")
def live_stats(user: User = Depends(require_roles("reviewer", "admin")),
               db: Session = Depends(get_db)):
    total = db.query(Order).count()
    open_disputes = db.query(Dispute).filter(Dispute.status == "open").count()
    disputed = db.query(Order).filter(Order.status == "disputed").count()
    escalated_ids = (db.query(AgentAction.order_id)
                     .filter(AgentAction.decision == "escalate").distinct().subquery())
    awaiting_review = (db.query(Order)
                       .filter(Order.id.in_(escalated_ids),
                               Order.status.notin_(["settled", "resolved", "rejected"]))
                       .count()) + disputed + open_disputes
    day_ago = time.time() - 86400
    released_today = (db.query(AgentAction)
                      .filter(AgentAction.action == "release_funds",
                              AgentAction.timestamp >= day_ago).count())
    return {"orders_total": total, "awaiting_review": awaiting_review,
            "open_disputes": open_disputes, "released_today": released_today,
            "chain_mode": chain.status()["mode"],
            "agent_state": "paused" if _kill(db) else "active",
            "recent_orders": [order_brief(db, o) for o in
                              db.query(Order).order_by(Order.id.desc()).limit(8).all()],
            "recent_actions": [
                {"id": a.id, "order_id": a.order_id, "action": a.action,
                 "decision": a.decision, "reason": a.reason, "tx_hash": a.tx_hash,
                 "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                            time.gmtime(a.timestamp))}
                for a in db.query(AgentAction).order_by(AgentAction.id.desc()).limit(10).all()]}


def _kill(db) -> bool:
    from ..services.policy import get_settings
    return bool(get_settings(db)["kill_switch"])


@router.get("/reports/summary")
def report_summary(date_from: str | None = None, date_to: str | None = None,
                   user: User = Depends(require_roles("reviewer", "admin", "exporter")),
                   db: Session = Depends(get_db)):
    q = db.query(Order)
    if user.role.name == "exporter":
        q = q.filter(Order.seller_id == (user.business_id or 0))
    orders = q.all()
    settled = [o for o in orders if o.status in ("settled", "released", "resolved")]
    disputes = db.query(Dispute).count()
    scores = [o for o in orders if o.status not in ("draft",)]
    avg_score = None
    from ..models import CreditScore
    cs_rows = db.query(CreditScore).all()
    if cs_rows:
        avg_score = round(sum(c.score for c in cs_rows) / len(cs_rows), 1)
    by_status: dict[str, int] = {}
    by_band: dict[str, int] = {}
    for o in orders:
        by_status[o.status] = by_status.get(o.status, 0) + 1
    for c in cs_rows:
        by_band[c.risk_band] = by_band.get(c.risk_band, 0) + 1
    return {
        "totals": {"orders": len(orders),
                   "settled_value": round(sum(o.amount for o in settled), 2),
                   "released_count": len([o for o in orders if o.status == "settled"]),
                   "disputes": disputes,
                   "dispute_rate": round(disputes / len(orders), 3) if orders else 0.0,
                   "avg_score": avg_score},
        "by_status": by_status,
        "by_risk_band": by_band,
        "recent": [order_brief(db, o) for o in sorted(orders, key=lambda o: -o.id)[:15]],
    }
