"""Audit trail endpoints: list, verify, tamper (demo)."""
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_roles
from ..models import AuditEntry, User
from ..schemas import iso
from ..services.audit_service import verify_chain

router = APIRouter(prefix="/audit-trail", tags=["audit"])


@router.get("")
def list_entries(order_id: int | None = None, date_from: str | None = None,
                 date_to: str | None = None, q: str | None = None,
                 limit: int = 100, offset: int = 0,
                 user: User = Depends(require_roles("reviewer", "admin")),
                 db: Session = Depends(get_db)):
    query = db.query(AuditEntry)
    if order_id is not None:
        query = query.filter(AuditEntry.order_id == order_id)
    if date_from and re.match(r"^\d{4}-\d{2}-\d{2}", date_from):
        import calendar
        y, m, d = map(int, date_from[:10].split("-"))
        query = query.filter(AuditEntry.timestamp >= calendar.timegm((y, m, d, 0, 0, 0)))
    if date_to and re.match(r"^\d{4}-\d{2}-\d{2}", date_to):
        import calendar
        y, m, d = map(int, date_to[:10].split("-"))
        query = query.filter(AuditEntry.timestamp < calendar.timegm((y, m, d, 0, 0, 0)) + 86400)
    if q:
        like = f"%{q}%"
        query = query.filter(
            (AuditEntry.action.like(like)) | (AuditEntry.actor.like(like)) |
            (AuditEntry.entry_hash.like(like)) | (AuditEntry.tx_hash.like(like)))
    total = query.count()
    rows = (query.order_by(AuditEntry.id.desc())
            .offset(max(0, offset)).limit(min(max(1, limit), 500)).all())
    return {"total": total, "entries": [_entry_dict(e) for e in rows]}


def _entry_dict(e: AuditEntry) -> dict:
    return {"id": e.id, "order_id": e.order_id,
            "order_ref": f"#{e.order_id}" if e.order_id else "—",
            "action": e.action, "actor": e.actor, "data": e.data_json or {},
            "data_hash": e.data_hash, "previous_hash": e.previous_hash,
            "entry_hash": e.entry_hash, "tx_hash": e.tx_hash,
            "timestamp": iso(e.timestamp)}


@router.get("/verify")
def verify(user: User = Depends(require_roles("reviewer", "admin")),
           db: Session = Depends(get_db)):
    return verify_chain(db)


@router.post("/tamper/{entry_id}")
def tamper(entry_id: int, user: User = Depends(require_roles("admin")),
           db: Session = Depends(get_db)):
    """Demo helper: mutate one stored hash so the integrity check fails."""
    e = db.get(AuditEntry, entry_id)
    if e is None:
        raise HTTPException(404, "Audit entry not found")
    flips = {"0": "1", "1": "0"}
    h = e.entry_hash
    pos = 5 if h[5] in flips else next(i for i, c in enumerate(h) if c in flips)
    e.entry_hash = h[:pos] + flips[h[pos]] + h[pos + 1:]
    db.commit()
    return {"ok": True, "entry_id": entry_id, "new_entry_hash": e.entry_hash}
