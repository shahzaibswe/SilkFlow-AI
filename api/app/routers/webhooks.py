"""Mock logistics webhook: shipment events trigger the agent loop."""
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..config import WEBHOOK_SECRET
from ..db import get_db
from ..models import Order, ShipmentEvent
from ..schemas import WebhookReq, iso
from ..services import agent_loop
from ..services.audit_service import append_audit

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/logistics")
def logistics(req: WebhookReq, x_webhook_secret: str = Header(default=""),
              db: Session = Depends(get_db)):
    if x_webhook_secret != WEBHOOK_SECRET:
        raise HTTPException(401, "Bad webhook secret")
    o = db.get(Order, req.order_id)
    if o is None:
        raise HTTPException(404, "Unknown order_id")
    if o.status in ("settled", "released", "resolved", "rejected"):
        return {"ack": True, "event_id": None, "agent_decision": "noop",
                "detail": f"order already in state {o.status}"}
    existing = [e.event_type for e in db.query(ShipmentEvent).filter(
        ShipmentEvent.order_id == o.id).all()]
    if req.event_type in existing:
        raise HTTPException(409, f"Duplicate {req.event_type} event for order {o.id}")
    if req.event_type != "dispatch" and "dispatch" not in existing:
        raise HTTPException(400, "Out-of-order event: dispatch not received yet")
    ev = ShipmentEvent(order_id=o.id, event_type=req.event_type,
                       payload_json=req.payload or {"source": "logistics-api"})
    db.add(ev)
    db.flush()
    append_audit(db, order_id=o.id, action=f"shipment_{req.event_type}",
                 actor="mock-logistics", data={"event_id": ev.id, "payload": req.payload or {}})
    if req.event_type == "delivery" and o.status == "funded":
        o.status = "shipped"
    from ..services.cashflow_service import raise_alert
    raise_alert(db, o.seller_id, "shipment",
                f"Logistics (mock carrier feed): order #{o.id} {req.event_type}",
                "info", order_id=o.id)
    result = agent_loop.run_agent(db, o, actor="agent", trigger="logistics_webhook")
    db.commit()
    return {"ack": True, "event_id": ev.id, "agent_decision": result["decision"],
            "received_at": iso(ev.received_at)}
