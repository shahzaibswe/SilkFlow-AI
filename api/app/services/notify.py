"""Notification service — in-app only (no real email/push).

Writes human-readable notifications into the audit trail (action='notification')
and the structured log so dashboards can surface them.
"""
import logging

from sqlalchemy.orm import Session

from .audit_service import append_audit

log = logging.getLogger("silkflow.notify")


def notify(db: Session, audience: str, message: str, order_id: int | None = None) -> None:
    log.info("notification [%s] order=%s: %s", audience, order_id, message)
    append_audit(
        db, order_id=order_id, action="notification", actor="system",
        data={"audience": audience, "message": message},
    )
