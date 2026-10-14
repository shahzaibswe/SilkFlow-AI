"""Escrow endpoints: register on chain + record buyer funding."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_roles
from ..models import Order, User
from ..schemas import FundReq
from ..serializers import assert_party, assert_seller, escrow_dict, get_order_or_404
from ..services import chain
from ..services.audit_service import append_audit

router = APIRouter(prefix="/orders", tags=["escrow"])


@router.post("/{order_id}/escrow/create")
def create_escrow(order_id: int,
                  user: User = Depends(require_roles("buyer", "exporter", "reviewer", "admin")),
                  db: Session = Depends(get_db)):
    o = get_order_or_404(db, order_id)
    assert_party(user, o)
    if o.status in ("rejected",):
        raise HTTPException(400, "Order was rejected by the agent")
    res = chain.create_escrow(db, o)
    if o.status in ("draft", "docs_checked", "scored"):
        o.status = "awaiting_funding"
    append_audit(db, order_id=o.id, action="escrow_created", actor=f"user:{user.id}",
                 data={"amount": o.amount, "state": res["state"]}, tx_hash=res.get("tx_create"))
    db.commit()
    return escrow_dict(db, o)


@router.post("/{order_id}/escrow/fund")
def fund_escrow(order_id: int, req: FundReq,
                user: User = Depends(require_roles("buyer", "reviewer", "admin")),
                db: Session = Depends(get_db)):
    o = get_order_or_404(db, order_id)
    if user.role.name == "buyer":
        if o.buyer_id != user.business_id:
            raise HTTPException(403, "Not your order")
    if o.status == "rejected":
        raise HTTPException(400, "Order was rejected by the agent")
    esc = chain.fund_escrow(db, o, tx_hash=req.tx_hash)
    if esc["state"] == "Funded":
        o.status = "funded"
        append_audit(db, order_id=o.id, action="escrow_funded", actor=f"user:{user.id}",
                     data={"amount": o.amount}, tx_hash=esc.get("tx_fund"))
        from ..services.cashflow_service import raise_alert
        raise_alert(db, o.seller_id, "funding",
                    f"Buyer funded the escrow for order #{o.id} (${o.amount:,.0f}) — "
                    f"release is pending shipment evidence", "info", order_id=o.id)
        db.commit()
        return escrow_dict(db, o)
    raise HTTPException(400, f"Escrow in state {esc['state']} cannot be funded")
