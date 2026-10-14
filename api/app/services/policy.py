"""Policy engine — hard rules the agent can never override (handoff doc §8).

Settings are read live from the `settings` table:
  auto_release_limit (default 25000), kill_switch (false),
  reviewer_threshold_score (60), max_release_per_order (1).

Evidence required for autonomous release:
  delivery shipment event + document check not 'fail' + no unresolved anomaly
  + escrow funded/ShipmentConfirmed + exactly max N releases per order.

`evaluate()` returns per-rule check results so every run can log them.
"""
from sqlalchemy.orm import Session

from ..models import AgentAction, AuditEntry, DocumentCheck, Escrow, Setting, ShipmentEvent, Order
from . import ml_bridge

DEFAULTS = {
    "auto_release_limit": 25000,
    "kill_switch": False,
    "reviewer_threshold_score": 60,
    "max_release_per_order": 1,
}

SETTING_KEYS = tuple(DEFAULTS.keys())


def get_settings(db: Session) -> dict:
    rows = db.query(Setting).filter(Setting.key.in_(SETTING_KEYS)).all()
    out = dict(DEFAULTS)
    for r in rows:
        out[r.key] = r.value_json
    return out


def set_setting(db: Session, key: str, value) -> None:
    row = db.get(Setting, key)
    if row is None:
        db.add(Setting(key=key, value_json=value))
    else:
        row.value_json = value
    db.flush()


def evaluate(db: Session, order: Order) -> dict:
    """Evaluate all release rules. Returns {"checks": [...], "can_release": bool,
    "settings": {...}} — each check: {rule, passed, detail}."""
    s = get_settings(db)
    checks = []

    def add(rule, passed, detail):
        checks.append({"rule": rule, "passed": bool(passed), "detail": detail})

    add("kill_switch", not s["kill_switch"],
        "agent is ACTIVE" if not s["kill_switch"] else "KILL SWITCH ENGAGED — all autonomous releases blocked")

    escrow = db.query(Escrow).filter(Escrow.order_id == order.id).one_or_none()
    funded = escrow is not None and escrow.state in ("Funded", "ShipmentConfirmed")
    add("escrow_funded", funded,
        f"escrow state = {escrow.state if escrow else 'None'}")

    delivery = (db.query(ShipmentEvent)
                .filter(ShipmentEvent.order_id == order.id,
                        ShipmentEvent.event_type == "delivery").first())
    add("delivery_evidence", delivery is not None,
        "delivery event recorded" if delivery else "no delivery event — shipment evidence missing")

    check = (db.query(DocumentCheck).filter(DocumentCheck.order_id == order.id)
             .order_by(DocumentCheck.id.desc()).first())
    doc_ok = check is not None and check.result != "fail"
    add("document_check", doc_ok,
        f"document check = {check.result}" if check else "documents not checked yet")

    score_row = ml_bridge.latest_score(db, order.id)
    if score_row is None:
        add("risk_score_threshold", False, "order not scored yet")
        add("anomaly", True, "no score row — anomaly check not applicable")
    else:
        ok = score_row.score >= s["reviewer_threshold_score"]
        add("risk_score_threshold", ok,
            f"score {score_row.score} >= threshold {s['reviewer_threshold_score']}" if ok
            else f"score {score_row.score} < threshold {s['reviewer_threshold_score']} — needs human review")
        anomaly = score_row.anomaly_json or {}
        unresolved = bool(anomaly.get("is_anomaly"))
        add("anomaly", not unresolved,
            "no anomaly flagged" if not unresolved
            else f"anomaly flags unresolved: {', '.join(anomaly.get('flags', []))}")

    limit_ok = order.amount <= s["auto_release_limit"]
    add("auto_release_limit", limit_ok,
        f"{order.amount:g} ≤ {s['auto_release_limit']:g}" if limit_ok
        else f"{order.amount:g} > {s['auto_release_limit']:g} — above auto-release limit, needs human release")

    prior_releases = (db.query(AgentAction)
                      .filter(AgentAction.order_id == order.id,
                              AgentAction.action == "release_funds").count())
    releases_left = prior_releases < s["max_release_per_order"]
    add("max_release_per_order", releases_left,
        f"{prior_releases} release(s) so far, max {s['max_release_per_order']}")

    # dispute state is authoritative on order.status + escrow.state
    disputed = order.status == "disputed" or (escrow is not None and escrow.state == "Disputed")
    add("no_open_dispute", not disputed,
        "no open dispute" if not disputed else "order is under dispute — freeze autonomous action")

    can_release = all(c["passed"] for c in checks)
    return {"checks": checks, "can_release": can_release, "settings": s}
