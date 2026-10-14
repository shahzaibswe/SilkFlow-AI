"""v2 SME-copilot endpoints: cash-flow forecast, what-if scenario, financing
offers/requests, alerts, copilot.

Authorization rule per spec: exporters only touch their own business;
reviewer/admin may read any; buyers only their alerts. Hiding buttons in the
UI is not authorization — every route re-checks server-side.
"""
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, require_roles
from ..models import Alert, Business, CreditScore, FinancingOffer, User
from ..schemas import CopilotAskReq, FinancingReq, ScenarioReq
from ..serializers import assert_party, get_order_or_404
from ..services import cashflow_service, copilot_service, financing_service
from ..services.audit_service import append_audit

router = APIRouter(tags=["finance copilot"])


def _guard_business(user: User, business_id: int, db: Session) -> Business:
    b = db.get(Business, business_id)
    if b is None:
        raise HTTPException(404, "Business not found")
    if user.role.name in ("reviewer", "admin"):
        return b
    if user.business_id != b.id:
        raise HTTPException(403, "Not your business")
    return b


@router.get("/businesses/{business_id}/cashflow")
def get_cashflow(business_id: int, weeks: int = 12,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    b = _guard_business(user, business_id, db)
    cashflow_service.rebuild_items(db, b.id)
    fc = cashflow_service.forecast(db, b.id, weeks=min(max(weeks, 4), 26),
                                   persist=True)
    db.commit()
    alerts = (db.query(Alert).filter(Alert.business_id == b.id,
                                     Alert.read_at.is_(None))
              .order_by(Alert.id.desc()).limit(10).all())
    fc["alerts"] = [cashflow_service.alert_dict(a) for a in alerts]
    return fc


@router.post("/businesses/{business_id}/cashflow/scenario")
def cashflow_scenario(business_id: int, req: ScenarioReq,
                      user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    b = _guard_business(user, business_id, db)
    order = get_order_or_404(db, req.order_id)
    if order.seller_id != b.id:
        raise HTTPException(403, "Order does not belong to this business")
    base = cashflow_service.forecast(db, b.id, persist=False)
    scen = cashflow_service.forecast(db, b.id,
                                     delays={order.id: req.delay_days},
                                     persist=False)
    gap_delta = scen["gap_weeks"] - base["gap_weeks"]
    return {"scenario": {"order_id": order.id, "delay_days": req.delay_days},
            "forecast": scen,
            "delta": {"gap_weeks": gap_delta,
                      "lowest_balance_change": round(scen["lowest_projected_balance"]
                                                     - base["lowest_projected_balance"], 2)},
            "note": "What-if only — the persisted forecast is unchanged."}


@router.get("/orders/{order_id}/financing-options")
def financing_options(order_id: int, user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    o = get_order_or_404(db, order_id)
    assert_party(user, o)
    offers = (db.query(FinancingOffer).filter(FinancingOffer.order_id == o.id)
              .order_by(FinancingOffer.rank).all())
    if not offers:
        cs = (db.query(CreditScore).filter(CreditScore.order_id == o.id)
              .order_by(CreditScore.id.desc()).first())
        if cs is None:
            raise HTTPException(409, "Order must be scored before financing options")
        from ..services.ml_bridge import latest_score
        fxv = (cs.features_json or {}).get("fx_volatility", 0.0)
        financing_service.generate_offers(db, o, cs.risk_band, fxv)
        db.commit()
        offers = (db.query(FinancingOffer)
                  .filter(FinancingOffer.order_id == o.id)
                  .order_by(FinancingOffer.rank).all())
    return {"order_id": o.id, "simulated": True,
            "disclaimer": "Prototype offers only — not a real lending commitment.",
            "offers": [financing_service.offer_dict(x) for x in offers]}


@router.post("/orders/{order_id}/financing-requests", status_code=201)
def financing_request(order_id: int, req: FinancingReq, request: Request,
                      user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    o = get_order_or_404(db, order_id)
    if user.role.name != "exporter" or user.business_id != o.seller_id:
        raise HTTPException(403, "Only the selling exporter may apply")
    try:
        offer = financing_service.apply_for_offer(db, o, req.offer_id,
                                                  actor=f"user:{user.id}")
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    cashflow_service.raise_alert(db, o.seller_id, "funding",
                                 f"Simulated financing requested: {offer['offer_type']} "
                                 f"for order #{order_id} (prototype only)", "info",
                                 order_id=order_id)
    db.commit()
    return offer


@router.get("/alerts")
def list_alerts(unread: bool = False, business_id: int | None = None,
                limit: int = 50, offset: int = 0,
                user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(Alert)
    if user.role.name in ("reviewer", "admin"):
        if business_id:
            q = q.filter(Alert.business_id == business_id)
    else:
        if not user.business_id:
            return {"alerts": [], "total": 0}
        q = q.filter(Alert.business_id == user.business_id)
    if unread:
        q = q.filter(Alert.read_at.is_(None))
    total = q.count()
    rows = q.order_by(Alert.id.desc()).offset(max(offset, 0)).limit(
        min(max(limit, 1), 200)).all()
    uq = db.query(Alert).filter(Alert.read_at.is_(None))
    if user.role.name not in ("reviewer", "admin"):
        uq = uq.filter(Alert.business_id == (user.business_id or 0))
    return {"alerts": [cashflow_service.alert_dict(a) for a in rows],
            "total": total, "limit": limit, "offset": offset,
            "unread": uq.count()}


@router.post("/alerts/{alert_id}/read")
def read_alert(alert_id: int, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    a = db.get(Alert, alert_id)
    if a is None:
        raise HTTPException(404, "Alert not found")
    if user.role.name not in ("reviewer", "admin") and a.business_id != user.business_id:
        raise HTTPException(403, "Not your alert")
    a.read_at = time.time()
    db.commit()
    return cashflow_service.alert_dict(a)


@router.post("/copilot/ask")
def copilot_ask(req: CopilotAskReq, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    if user.role.name in ("reviewer", "admin"):
        if not req.business_id:
            raise HTTPException(400, "Reviewer/admin must pass business_id")
        b = _guard_business(user, req.business_id, db)
    else:
        b = db.get(Business, req.business_id or user.business_id)
        if b is None or (user.business_id and b.id != user.business_id):
            raise HTTPException(403, "Not your business")
    result = copilot_service.ask(db, b, req.question)
    append_audit(db, order_id=None, action="copilot_ask", actor=f"user:{user.id}",
                 data={"business_id": b.id, "question": req.question[:200],
                       "mode": result["mode"]})
    db.commit()
    return result
