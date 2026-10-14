"""Audit hash-chain service.

entry_hash = sha256hex(previous_hash + str(order_id or 0) + data_hash + str(timestamp))
Genesis previous_hash = 64 zeros. data_hash = sha256hex(canonical JSON of payload data).
"""
import hashlib
import json
import time

from sqlalchemy.orm import Session

from ..models import AuditEntry

GENESIS = "0" * 64


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def compute_data_hash(data: dict) -> str:
    return _sha256(json.dumps(data, sort_keys=True, separators=(",", ":"), default=str))


def compute_entry_hash(previous_hash: str, order_id, data_hash: str, timestamp) -> str:
    return _sha256(previous_hash + str(order_id or 0) + data_hash + str(timestamp))


def append_audit(db: Session, *, order_id: int | None, action: str, actor: str = "system",
                 data: dict | None = None, tx_hash: str | None = None,
                 timestamp: float | None = None) -> AuditEntry:
    """Append a new entry to the tail of the chain."""
    last = db.query(AuditEntry).order_by(AuditEntry.id.desc()).first()
    previous_hash = last.entry_hash if last else GENESIS
    ts = timestamp if timestamp is not None else time.time()
    data = data or {}
    data_hash = compute_data_hash(data)
    entry_hash = compute_entry_hash(previous_hash, order_id, data_hash, ts)
    entry = AuditEntry(
        order_id=order_id, action=action, actor=actor, data_json=data,
        data_hash=data_hash, previous_hash=previous_hash, entry_hash=entry_hash,
        tx_hash=tx_hash, timestamp=ts,
    )
    db.add(entry)
    db.flush()
    return entry


def verify_chain(db: Session) -> dict:
    entries = db.query(AuditEntry).order_by(AuditEntry.id.asc()).all()
    expected_prev = GENESIS
    for e in entries:
        if compute_data_hash(e.data_json or {}) != e.data_hash:
            return {"valid": False, "checked": len(entries), "broken_entry_id": e.id}
        if e.previous_hash != expected_prev:
            return {"valid": False, "checked": len(entries), "broken_entry_id": e.id}
        if compute_entry_hash(e.previous_hash, e.order_id, e.data_hash, e.timestamp) != e.entry_hash:
            return {"valid": False, "checked": len(entries), "broken_entry_id": e.id}
        expected_prev = e.entry_hash
    return {"valid": True, "checked": len(entries), "broken_entry_id": None}
