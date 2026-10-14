"""Order lifecycle endpoints: list/detail/create, documents, check, score, simulate."""
import re
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..config import UPLOAD_DIR
from ..db import get_db
from ..deps import require_roles
from ..models import Business, Document, Order, ShipmentEvent, User
from ..schemas import (DisputeReq, OrderCreateReq, SimulateDisputeReq,
                       SimulateShipmentReq, iso)
from ..serializers import (assert_party, assert_seller, get_order_or_404,
                           order_brief, order_detail, scoped_orders)
from ..services import agent_loop, chain, doc_check, ml_bridge, notify, policy
from ..services.audit_service import append_audit

router = APIRouter(prefix="/orders", tags=["orders"])

ALLOWED_EXT = {".pdf", ".txt", ".csv"}
DOC_TYPES = {"invoice", "packing_list", "order_terms"}


@router.get("")
def list_orders(status: str | None = None, date_from: str | None = None,
                date_to: str | None = None, limit: int = 0, offset: int = 0,
                user: User = Depends(require_roles("exporter", "buyer", "reviewer", "admin")),
                db: Session = Depends(get_db)):
    q = scoped_orders(db, user)
    if status:
        q = q.filter(Order.status == status)
    if date_from:
        q = q.filter(Order.created_at >= _parse_date(date_from))
    if date_to:
        q = q.filter(Order.created_at <= _parse_date(date_to, end=True))
    total = q.count()
    query = q.order_by(Order.id.desc())
    if limit:
        query = query.offset(max(offset, 0)).limit(min(limit, 200))
    return {"orders": [order_brief(db, o) for o in query.all()],
            "total": total, "limit": limit, "offset": offset}


def _parse_date(s: str, end: bool = False) -> float:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if not m:
        raise HTTPException(400, f"Bad date '{s}' (use YYYY-MM-DD)")
    import calendar
    day = int(m[3])
    if end:
        day += 1
    return calendar.timegm((int(m[1]), int(m[2]), day, 0, 0, 0)) - 86400 if end else \
        calendar.timegm((int(m[1]), int(m[2]), day, 0, 0, 0))


@router.get("/{order_id}")
def get_order(order_id: int, user: User = Depends(require_roles(
    "exporter", "buyer", "reviewer", "admin")), db: Session = Depends(get_db)):
    o = get_order_or_404(db, order_id)
    assert_party(user, o)
    return order_detail(db, o)


@router.post("", status_code=201)
def create_order(req: OrderCreateReq,
                 user: User = Depends(require_roles("exporter")),
                 db: Session = Depends(get_db)):
    if not user.business_id:
        raise HTTPException(400, "Create a business profile first (POST /api/businesses)")
    buyer = db.get(Business, req.buyer_id)
    if buyer is None:
        raise HTTPException(404, "Buyer business not found")
    if buyer.owner is None or buyer.owner.role.name != "buyer":
        raise HTTPException(400, "buyer_id must reference a buyer's business")
    o = Order(seller_id=user.business_id, buyer_id=buyer.id, goods=req.goods,
              quantity=req.quantity, amount=req.amount, currency=req.currency.upper(),
              payment_term_days=req.payment_term_days, ship_by=req.ship_by)
    db.add(o)
    db.flush()
    append_audit(db, order_id=o.id, action="order_created", actor=f"user:{user.id}",
                 data={"goods": o.goods, "amount": o.amount, "currency": o.currency,
                       "buyer_id": o.buyer_id})
    db.commit()
    return order_brief(db, o)


@router.post("/{order_id}/documents")
async def upload_document(order_id: int, type: str = Form(...),
                          file: UploadFile | None = File(None),
                          text: str | None = Form(None),
                          user: User = Depends(require_roles("exporter", "reviewer", "admin")),
                          db: Session = Depends(get_db)):
    o = get_order_or_404(db, order_id)
    assert_seller(user, o)
    if type not in DOC_TYPES:
        raise HTTPException(400, f"type must be one of {sorted(DOC_TYPES)}")
    if file is None and not text:
        raise HTTPException(400, "Provide a file or pasted text")
    fname, raw = "", b""
    if file is not None:
        fname = file.filename or "upload"
        ext = Path(fname).suffix.lower()
        if ext not in ALLOWED_EXT:
            raise HTTPException(400, f"File type '{ext}' not allowed (pdf/txt/csv only)")
        raw = await file.read()
        if len(raw) > 5 * 1024 * 1024:
            raise HTTPException(413, "File too large (max 5 MB)")
        UPLOAD_DIR.mkdir(exist_ok=True)
        safe = f"{uuid.uuid4().hex}{ext}"
        ref = UPLOAD_DIR / safe
        ref.write_bytes(raw)
        extracted = doc_check.extract_text(ref, raw=raw)
    else:
        fname = f"{type}-pasted.txt"
        ref = None
        extracted = text or ""
    doc = Document(order_id=o.id, type=type, file_name=fname,
                   file_ref=str(ref) if ref else "", extracted_text=extracted)
    db.add(doc)
    db.flush()
    append_audit(db, order_id=o.id, action="document_uploaded", actor=f"user:{user.id}",
                 data={"document_type": type, "file_name": fname})
    db.commit()
    return {"id": doc.id, "type": doc.type, "file_name": doc.file_name,
            "uploaded_at": iso(doc.uploaded_at)}


@router.post("/{order_id}/check-documents")
def check_documents(order_id: int,
                    user: User = Depends(require_roles("exporter", "reviewer", "admin")),
                    db: Session = Depends(get_db)):
    o = get_order_or_404(db, order_id)
    assert_seller(user, o)
    if not o.documents:
        raise HTTPException(400, "Upload at least an invoice before checking")
    row = doc_check.run_check(db, o)
    if o.status == "draft":
        o.status = "docs_checked"
    append_audit(db, order_id=o.id, action="documents_checked", actor=f"user:{user.id}",
                 data={"result": row.result, "discrepancies": len(row.discrepancies_json or []),
                       "checker": row.checker})
    if row.result == "pass" and not _has_score(db, o):
        _run_scoring(db, o, actor=f"user:{user.id}")
    db.commit()
    return doc_check.check_to_dict(row)


def _has_score(db: Session, o: Order) -> bool:
    from ..models import CreditScore
    return db.query(CreditScore).filter(CreditScore.order_id == o.id).first() is not None


def _run_scoring(db: Session, o: Order, *, actor: str):
    from ..services import financing_service
    row = ml_bridge.score_order(db, o)
    financing_service.generate_offers(db, o, row.risk_band,
                                      (row.features_json or {}).get("fx_volatility", 0.0))
    decision = agent_loop.post_scoring_decision(db, o, row)
    if o.status not in ("rejected", "disputed"):
        o.status = "scored"
    append_audit(db, order_id=o.id, action="order_scored", actor=actor,
                 data={"score": row.score, "risk_band": row.risk_band,
                       "model_version": row.model_version,
                       "agent_decision": decision["decision"]})
    return row, decision


@router.post("/{order_id}/score")
def score(order_id: int, user: User = Depends(require_roles("exporter", "reviewer", "admin")),
          db: Session = Depends(get_db)):
    o = get_order_or_404(db, order_id)
    assert_seller(user, o)
    if not o.documents:
        raise HTTPException(400, "Order needs documents before scoring")
    from ..models import DocumentCheck
    dc = db.query(DocumentCheck).filter(DocumentCheck.order_id == o.id).order_by(
        DocumentCheck.id.desc()).first()
    if dc is None:
        doc_check.run_check(db, o)
    row, _ = _run_scoring(db, o, actor=f"user:{user.id}")
    db.commit()
    out = ml_bridge_latest_dict(db, o.id)
    out["anomaly"] = row.anomaly_json or {}
    return out


def ml_bridge_latest_dict(db, order_id: int) -> dict:
    from ..serializers import credit_score_dict
    from ..models import CreditScore
    cs = db.query(CreditScore).filter(CreditScore.order_id == order_id).order_by(
        CreditScore.id.desc()).first()
    return credit_score_dict(cs)


# ---- demo simulation helpers (reviewer/exporter convenience) ----------------
@router.post("/{order_id}/simulate/shipment")
def simulate_shipment(order_id: int, req: SimulateShipmentReq,
                      user: User = Depends(require_roles(
                          "exporter", "buyer", "reviewer", "admin")),
                      db: Session = Depends(get_db)):
    o = get_order_or_404(db, order_id)
    assert_party(user, o)
    seq = [req.event_type] if req.event_type else ["dispatch", "in_transit", "delivery"]
    events = []
    for et in seq:
        ev = ShipmentEvent(order_id=o.id, event_type=et,
                           payload_json={"source": "mock-logistics", "simulated_by": f"user:{user.id}"})
        db.add(ev)
        db.flush()
        events.append({"id": ev.id, "event_type": ev.event_type, "received_at": iso(ev.received_at)})
        append_audit(db, order_id=o.id, action=f"shipment_{et}", actor="mock-logistics",
                     data={"event_id": ev.id})
    if "delivery" in seq and o.status == "funded":
        o.status = "shipped"
    result = agent_loop.run_agent(db, o, actor="agent", trigger="shipment_event")
    db.commit()
    return {"ack": True, "events": events, "agent_result": result,
            "order": order_brief(db, o)}


@router.post("/{order_id}/simulate/dispute")
def simulate_dispute(order_id: int, req: SimulateDisputeReq,
                     user: User = Depends(require_roles("buyer", "exporter", "reviewer", "admin")),
                     db: Session = Depends(get_db)):
    o = get_order_or_404(db, order_id)
    from ..serializers import dispute_dict
    reason = req.reason or "Goods received with visible damage on multiple cartons"
    d = _create_dispute(db, o, raised_by="buyer", reason=reason, actor=f"user:{user.id}")
    db.commit()
    return dispute_dict(db, o)


def _create_dispute(db: Session, o: Order, *, raised_by: str, reason: str, actor: str):
    from ..models import Dispute, Escrow, Role, User as U
    existing = db.query(Dispute).filter(Dispute.order_id == o.id,
                                       Dispute.status == "open").first()
    if existing:
        raise HTTPException(409, "Order already has an open dispute")
    reviewer = (db.query(U).join(Role, U.role_id == Role.id)
                .filter(Role.name == "reviewer", U.status == "active").first())
    d = Dispute(order_id=o.id, raised_by=raised_by, reason=reason, status="open",
                assigned_reviewer_id=reviewer.id if reviewer else None)
    db.add(d)
    db.flush()
    esc = db.query(Escrow).filter_by(order_id=o.id).one_or_none()
    tx = None
    if esc is not None and esc.state in ("Funded", "ShipmentConfirmed"):
        res = chain.dispute(db, o)
        tx = res.get("tx_dispute")
        d.tx_hash = tx
    o.status = "disputed"
    append_audit(db, order_id=o.id, action="dispute_raised", actor=actor,
                 data={"raised_by": raised_by, "reason": reason}, tx_hash=tx)
    notify.notify(db, "reviewer", f"Dispute opened on order #{o.id}: {reason[:80]}", o.id)
    from ..services.cashflow_service import raise_alert
    raise_alert(db, o.seller_id, "escalation",
                f"Dispute raised on order #{o.id} — funds frozen pending reviewer decision",
                "critical", order_id=o.id)
    raise_alert(db, o.buyer_id, "escalation",
                f"Your dispute on order #{o.id} is queued for reviewer resolution",
                "warning", order_id=o.id)
    return d
