"""Shared ORM -> dict serializers matching API_SPEC §3 response shapes."""
from fastapi import HTTPException

from .models import (AgentAction, Business, CreditScore, Dispute, Document,
                     DocumentCheck, Escrow, Order, ShipmentEvent, User)
from .schemas import iso
from .services import chain, fx_service

ORDER_FIELDS = ("id", "seller_id", "buyer_id", "goods", "quantity", "amount",
                "currency", "payment_term_days", "ship_by", "status")


def order_brief(db, o: Order) -> dict:
    d = {k: getattr(o, k) for k in ORDER_FIELDS}
    d["seller_name"] = o.seller.legal_name if o.seller else ""
    d["buyer_name"] = o.buyer.legal_name if o.buyer else ""
    d["created_at"] = iso(o.created_at)
    score: CreditScore | None = db.query(CreditScore).filter(
        CreditScore.order_id == o.id).order_by(CreditScore.id.desc()).first()
    d["score"] = round(score.score, 1) if score else None
    d["risk_band"] = score.risk_band if score else None
    esc = db.query(Escrow).filter(Escrow.order_id == o.id).one_or_none()
    d["escrow_state"] = esc.state if esc else "None"
    return d


def escrow_dict(db, o: Order) -> dict | None:
    esc = db.query(Escrow).filter(Escrow.order_id == o.id).one_or_none()
    if esc is None:
        return None
    return {
        "contract_address": esc.contract_address, "amount": esc.amount, "token": esc.token,
        "state": esc.state, "buyer_wallet": esc.buyer_wallet, "seller_wallet": esc.seller_wallet,
        "tx_fund": esc.tx_fund, "tx_release": esc.tx_release, "tx_create": esc.tx_create,
        "tx_confirm": esc.tx_confirm, "tx_dispute": esc.tx_dispute, "tx_resolve": esc.tx_resolve,
        "explorer_url": (f"sim://tx/{esc.tx_release or esc.tx_fund or esc.tx_create}"
                         if chain.status()["mode"] == "simulated"
                         else (chain.status().get("escrow_address") or "") +
                              f"/tx/{esc.tx_release or esc.tx_fund or esc.tx_create}")
                        if (esc.tx_release or esc.tx_fund or esc.tx_create) else None,
    }


def dispute_dict(db, o: Order) -> dict | None:
    from sqlalchemy.orm import Session
    d: Dispute | None = db.query(Dispute).filter(Dispute.order_id == o.id).order_by(
        Dispute.id.desc()).first()
    if d is None:
        return None
    return {"id": d.id, "order_id": d.order_id, "raised_by": d.raised_by, "reason": d.reason,
            "status": d.status, "assigned_reviewer_id": d.assigned_reviewer_id,
            "resolution": d.resolution, "notes": d.notes, "tx_hash": d.tx_hash,
            "created_at": iso(d.created_at), "resolved_at": iso(d.resolved_at)}


def doc_check_dict(dc: DocumentCheck) -> dict:
    return {"result": dc.result, "checked_at": iso(dc.checked_at),
            "discrepancies": dc.discrepancies_json or [], "checker": dc.checker}


def credit_score_dict(cs: CreditScore) -> dict:
    return {"score": round(cs.score, 1), "risk_band": cs.risk_band,
            "model_version": cs.model_version, "suggested_terms": cs.suggested_terms_json or {},
            "top_features": cs.top_features_json or [],
            "anomaly": cs.anomaly_json or {}, "created_at": iso(cs.created_at)}


def order_detail(db, o: Order) -> dict:
    d = order_brief(db, o)
    d.pop("escrow_state")
    d["business_seller"] = {"id": o.seller.id, "legal_name": o.seller.legal_name,
                            "country": o.seller.country, "kyb_status": o.seller.kyb_status,
                            "wallet_address": o.seller.wallet_address} if o.seller else None
    d["business_buyer"] = {"id": o.buyer.id, "legal_name": o.buyer.legal_name,
                           "country": o.buyer.country, "kyb_status": o.buyer.kyb_status,
                           "wallet_address": o.buyer.wallet_address} if o.buyer else None
    d["documents"] = [{"id": doc.id, "type": doc.type, "file_name": doc.file_name,
                       "uploaded_at": iso(doc.uploaded_at)}
                      for doc in db.query(Document).filter(Document.order_id == o.id)
                      .order_by(Document.id).all()]
    dc = db.query(DocumentCheck).filter(DocumentCheck.order_id == o.id).order_by(
        DocumentCheck.id.desc()).first()
    d["document_check"] = doc_check_dict(dc) if dc else None
    cs = db.query(CreditScore).filter(CreditScore.order_id == o.id).order_by(
        CreditScore.id.desc()).first()
    d["credit_score"] = credit_score_dict(cs) if cs else None
    d["escrow"] = escrow_dict(db, o)
    d["shipment_events"] = [{"id": e.id, "event_type": e.event_type,
                             "received_at": iso(e.received_at), "payload": e.payload_json or {}}
                            for e in db.query(ShipmentEvent).filter(ShipmentEvent.order_id == o.id)
                            .order_by(ShipmentEvent.id).all()]
    d["agent_actions"] = [{"id": a.id, "order_id": a.order_id, "action": a.action,
                           "decision": a.decision,
                           "reason": a.reason, "policy_checks": a.policy_checks_json or [],
                           "tx_hash": a.tx_hash, "timestamp": iso(a.timestamp)}
                          for a in db.query(AgentAction).filter(AgentAction.order_id == o.id)
                          .order_by(AgentAction.id.desc()).all()]
    d["dispute"] = dispute_dict(db, o)
    try:
        from .services.ml_bridge import COUNTRY_CCY
        buyer_country = o.buyer.country if o.buyer else "PK"
        quote = COUNTRY_CCY.get(buyer_country or "PK", "PKR")
        d["fx_note"] = fx_service.fx_risk_note(db, o.currency or "USD", quote,
                                               max(o.payment_term_days, 7))
    except Exception:
        d["fx_note"] = None
    return d


def get_order_or_404(db, order_id: int) -> Order:
    o = db.get(Order, order_id)
    if o is None:
        raise HTTPException(404, "Order not found")
    return o


def assert_seller(user: User, o: Order):
    if user.role.name not in ("reviewer", "admin") and o.seller_id != user.business_id:
        raise HTTPException(403, "Not your order")


def assert_party(user: User, o: Order):
    if user.role.name in ("reviewer", "admin"):
        return
    if o.seller_id != user.business_id and o.buyer_id != user.business_id:
        raise HTTPException(403, "Not your order")


def scoped_orders(db, user: User):
    q = db.query(Order)
    role = user.role.name
    if role == "exporter":
        return q.filter(Order.seller_id == (user.business_id or 0))
    if role == "buyer":
        return q.filter(Order.buyer_id == (user.business_id or 0))
    return q
