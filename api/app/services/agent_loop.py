"""Agent orchestrator: observe -> decide -> policy-check -> act -> log (§8).

Decision vocabulary: approve_terms, request_info, release_funds, hold,
escalate, reject. Every run persists an `agent_actions` row (with reason +
per-rule policy checks) and an audit-chain entry. When the agent releases:
chain.confirm_shipment + chain.release run (live or simulated), the tx hash
is stored and the order becomes `settled`. Hard policy always gates the
release — the model can never override it.
"""
import logging

from sqlalchemy.orm import Session

from ..models import (AgentAction, CreditScore, DocumentCheck, Escrow, Order,
                      ShipmentEvent)
from . import chain, ml_bridge, notify, policy
from .audit_service import append_audit

log = logging.getLogger("silkflow.agent")


def record_action(db: Session, order: Order, *, action: str, decision: str, reason: str,
                  policy_checks: list[dict], tx_hash: str | None = None,
                  created_by: str = "agent", audit_action: str | None = None,
                  extra_data: dict | None = None) -> AgentAction:
    row = AgentAction(order_id=order.id, action=action, decision=decision, reason=reason,
                      policy_checks_json=policy_checks, tx_hash=tx_hash, created_by=created_by)
    db.add(row)
    db.flush()
    data = {"order_status": order.status, "action": action, "decision": decision,
            "reason": reason, "policy_checks": policy_checks}
    if extra_data:
        data.update(extra_data)
    append_audit(db, order_id=order.id, action=audit_action or f"agent_{action}",
                 actor=created_by, data=data, tx_hash=tx_hash)
    if decision == "escalate":
        from .cashflow_service import raise_alert
        raise_alert(db, order.seller_id, "escalation",
                    f"Agent escalated order #{order.id} to human review: {reason[:120]}",
                    "warning", order_id=order.id)
    return row


def observe(db: Session, order: Order) -> dict:
    doc_check = (db.query(DocumentCheck).filter(DocumentCheck.order_id == order.id)
                 .order_by(DocumentCheck.id.desc()).one_or_none())
    score = ml_bridge.latest_score(db, order.id)
    escrow = db.query(Escrow).filter(Escrow.order_id == order.id).one_or_none()
    delivery = (db.query(ShipmentEvent)
                .filter(ShipmentEvent.order_id == order.id,
                        ShipmentEvent.event_type == "delivery").one_or_none())
    n_events = db.query(ShipmentEvent).filter(ShipmentEvent.order_id == order.id).count()
    has_docs = db.query(DocumentCheck).filter(DocumentCheck.order_id == order.id).count() > 0 or \
        (order.documents and len(order.documents) > 0)
    return {"doc_check": doc_check, "score": score, "escrow": escrow,
            "delivery": delivery, "shipment_events": n_events, "has_docs": has_docs}


def run_agent(db: Session, order: Order, *, actor: str = "agent",
              trigger: str = "manual") -> dict:
    """One full decision loop. Returns the /agent/run response shape."""
    obs = observe(db, order)
    pol = policy.evaluate(db, order)
    checks = pol["checks"]
    settings = pol["settings"]
    failed = {c["rule"]: c["detail"] for c in checks if not c["passed"]}

    def result(action, decision, reason, tx_hash=None):
        row = record_action(db, order, action=action, decision=decision, reason=reason,
                            policy_checks=checks, tx_hash=tx_hash, created_by=actor,
                            extra_data={"trigger": trigger})
        log.info("agent order=%s trigger=%s -> %s: %s", order.id, trigger, action, reason)
        return {"decision": decision, "reason": reason, "policy_checks": checks,
                "action": action, "tx_hash": tx_hash, "agent_action_id": row.id}

    # 1. kill switch trumps everything
    if settings["kill_switch"]:
        notify.notify(db, "reviewer", f"Agent paused (kill switch): order #{order.id} action held", order.id)
        return result("hold", "hold", "Kill switch engaged — all autonomous actions paused")

    # 2. disputes freeze the agent
    if order.status == "disputed":
        return result("hold", "hold", "Order is under dispute — awaiting reviewer decision")

    # 3. missing inputs -> request information
    if not obs["has_docs"]:
        return result("request_info", "hold",
                      "No trade documents on file — requesting invoice and packing list")
    if obs["doc_check"] is None:
        return result("request_info", "hold", "Documents uploaded but not checked — running document check")
    if obs["score"] is None:
        return result("request_info", "hold", "Order not scored yet — scoring before deciding")

    # 4. hard risk signals -> escalate / reject
    if obs["doc_check"].result == "fail":
        reason = f"Document check FAILED ({len(obs['doc_check'].discrepancies_json or [])} discrepancies) — escalated to human reviewer"
        notify.notify(db, "reviewer", f"Order #{order.id}: {reason}", order.id)
        return result("escalate", "escalate", reason)
    anomaly = (obs["score"].anomaly_json or {})
    if anomaly.get("is_anomaly"):
        reason = f"Anomaly flags {', '.join(anomaly.get('flags', []))} with {obs['score'].risk_band} risk band — escalated to reviewer"
        notify.notify(db, "reviewer", f"Order #{order.id}: {reason}", order.id)
        return result("escalate", "escalate", reason)
    if obs["score"].score < settings["reviewer_threshold_score"]:
        reason = (f"Score {obs['score'].score} below reviewer threshold "
                  f"{settings['reviewer_threshold_score']} — escalated to human reviewer")
        notify.notify(db, "reviewer", f"Order #{order.id}: {reason}", order.id)
        return result("escalate", "escalate", reason)

    # 5. evidence gates -> hold
    if "escrow_funded" in failed:
        return result("hold", "hold", f"Escrow not funded yet ({failed['escrow_funded']}) — holding")
    if "delivery_evidence" in failed:
        return result("hold", "hold",
                      "No delivery evidence from logistics yet — holding funds release")
    if "document_check" in failed:
        return result("hold", "hold", "Document evidence missing — holding")

    # 6. above the auto-release limit -> human release required
    if "auto_release_limit" in failed:
        reason = (f"Amount {order.amount:,.0f} {order.currency} exceeds auto-release limit "
                  f"{settings['auto_release_limit']:,.0f} — escalated for human release")
        notify.notify(db, "reviewer", f"Order #{order.id}: {reason}", order.id)
        return result("escalate", "escalate", reason)

    if "max_release_per_order" in failed:
        return result("hold", "hold", "Release limit for this order already reached")

    # 7. everything green -> ACT: confirm shipment + release on chain
    if not pol["can_release"]:
        blocked = "; ".join(failed.values())
        return result("hold", "hold", f"Policy blocked release: {blocked}")

    if obs["escrow"].state == "Funded":
        chain.confirm_shipment(db, order)
    esc = chain.release(db, order)
    tx = esc["tx_release"]
    order.status = "settled"
    notify.notify(db, "seller", f"Order #{order.id} settled: funds released on-chain ({tx[:18]}…)", order.id)
    notify.notify(db, "buyer", f"Order #{order.id}: escrow released to seller", order.id)
    return result("release_funds", "release",
                  "All policy checks passed: docs verified, score above threshold, delivery "
                  "confirmed, amount within auto-release limit — funds released to seller",
                  tx_hash=tx)


def post_scoring_decision(db: Session, order: Order, score_row: CreditScore,
                          actor: str = "agent") -> dict:
    """Decision recorded right after /score (approve terms vs escalate vs reject).

    Stored in agent_actions per spec: awaiting_funding decision is
    approve/escalate; anomaly + high risk band -> rejected.
    """
    pol = policy.evaluate(db, order)
    checks = pol["checks"]
    settings = pol["settings"]
    anomaly = (score_row.anomaly_json or {})
    if anomaly.get("is_anomaly") and score_row.risk_band == "high":
        order.status = "rejected"
        reason = (f"Rejected: anomaly ({', '.join(anomaly.get('flags', []))}) combined with "
                  f"high risk band")
        record_action(db, order, action="reject", decision="reject", reason=reason,
                      policy_checks=checks, created_by=actor)
        return {"decision": "reject", "reason": reason}
    if score_row.score < settings["reviewer_threshold_score"]:
        reason = (f"Score {score_row.score} below threshold {settings['reviewer_threshold_score']} "
                  f"— awaiting human review before terms approval")
        record_action(db, order, action="escalate", decision="escalate", reason=reason,
                      policy_checks=checks, created_by=actor)
        notify.notify(db, "reviewer", f"Order #{order.id}: {reason}", order.id)
        return {"decision": "escalate", "reason": reason}
    reason = (f"Terms approved: score {score_row.score} ({score_row.risk_band} risk), "
              f"awaiting buyer escrow funding")
    record_action(db, order, action="approve_terms", decision="approve", reason=reason,
                  policy_checks=checks, created_by=actor)
    return {"decision": "approve", "reason": reason}
