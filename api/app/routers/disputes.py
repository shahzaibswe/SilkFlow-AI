"""Dispute endpoints: raise (party-scoped) and reviewer resolution."""
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_roles
from ..models import Dispute, User
from ..schemas import DisputeReq, ResolveReq
from ..serializers import dispute_dict, get_order_or_404
from ..services import chain, notify
from ..services.audit_service import append_audit
from .orders import _create_dispute

router = APIRouter(tags=["disputes"])


@router.post("/orders/{order_id}/disputes", status_code=201)
def raise_dispute(order_id: int, req: DisputeReq,
                  user: User = Depends(require_roles("buyer", "exporter")),
                  db: Session = Depends(get_db)):
    o = get_order_or_404(db, order_id)
    if user.business_id not in (o.seller_id, o.buyer_id):
        raise HTTPException(403, "Not your order")
    raised_by = "buyer" if user.business_id == o.buyer_id else "seller"
    _create_dispute(db, o, raised_by=raised_by, reason=req.reason, actor=f"user:{user.id}")
    db.commit()
    return dispute_dict(db, o)


@router.post("/disputes/{dispute_id}/resolve")
def resolve_dispute(dispute_id: int, req: ResolveReq,
                    user: User = Depends(require_roles("reviewer", "admin")),
                    db: Session = Depends(get_db)):
    d = db.get(Dispute, dispute_id)
    if d is None:
        raise HTTPException(404, "Dispute not found")
    if d.status == "resolved":
        raise HTTPException(409, "Dispute already resolved")
    o = get_order_or_404(db, d.order_id)
    if req.decision == "more_evidence":
        d.notes = req.notes or d.notes
        append_audit(db, order_id=o.id, action="dispute_more_evidence",
                     actor=f"user:{user.id}", data={"notes": req.notes})
        notify.notify(db, "buyer", f"Order #{o.id}: reviewer requested more evidence", o.id)
        notify.notify(db, "seller", f"Order #{o.id}: reviewer requested more evidence", o.id)
        db.commit()
        return {"dispute": dispute_dict(db, o),
                "audit_entry": _last_audit(db, o.id, "dispute_more_evidence")}
    decision = "release" if req.decision == "release" else "refund"
    esc_res = chain.resolve(db, o, decision)
    tx = esc_res.get("tx_resolve")
    d.status = "resolved"
    d.resolution = decision
    d.notes = req.notes or ""
    d.tx_hash = tx
    d.resolved_at = time.time()
    o.status = "resolved"
    entry = append_audit(db, order_id=o.id, action=f"dispute_resolved_{decision}",
                         actor=f"user:{user.id}",
                         data={"decision": decision, "notes": req.notes,
                               "escrow_state": esc_res["state"]}, tx_hash=tx)
    notify.notify(db, "buyer", f"Order #{o.id}: dispute resolved — {decision}", o.id)
    notify.notify(db, "seller", f"Order #{o.id}: dispute resolved — {decision}", o.id)
    db.commit()
    return {"dispute": dispute_dict(db, o),
            "audit_entry": {"id": entry.id, "entry_hash": entry.entry_hash,
                            "tx_hash": tx}}


def _last_audit(db, order_id: int, action: str) -> dict:
    from ..models import AuditEntry
    e = (db.query(AuditEntry).filter(AuditEntry.order_id == order_id,
                                     AuditEntry.action == action)
         .order_by(AuditEntry.id.desc()).first())
    return {"id": e.id, "entry_hash": e.entry_hash, "tx_hash": e.tx_hash} if e else {}
