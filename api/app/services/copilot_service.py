"""Copilot narrator — answers financial questions grounded in the caller's data.

Hard rules (per spec §7F):
* All figures are computed by cashflow_service / ml_bridge / order code and
  handed to the model as a fact sheet. The LLM only explains them; it never
  computes, invents, or authorises anything.
* Without an API key (or on any provider failure) a deterministic template
  engine answers from the SAME fact sheet, labelled mode="deterministic-demo".
* The fact sheet is scoped to the authenticated user's own business; answers
  refuse when the data needed is not present.
"""
import json
import logging
import time

import httpx
from sqlalchemy.orm import Session

from ..config import OPENAI_API_KEY, OPENAI_MODEL
from ..models import Alert, Business, CreditScore, FinancingOffer, Order
from . import cashflow_service

log = logging.getLogger("silkflow.copilot")

SYSTEM_PROMPT = (
    "You are the SilkFlow AI copilot for one exporter business. You are given a "
    "JSON fact sheet of ALREADY COMPUTED figures. Answer the question using ONLY "
    "those figures, cite them explicitly (balances, weeks, order ids, scores), "
    "distinguish computed values from assumptions, refuse to fabricate missing "
    "data, and never authorise payments or change numbers. Keep it under 120 words."
)


def fact_sheet(db: Session, business: Business) -> dict:
    """Everything the copilot is allowed to know — computed, not invented."""
    cashflow_service.rebuild_items(db, business.id)
    fc = cashflow_service.forecast(db, business.id, weeks=12, persist=True)
    orders = db.query(Order).filter(Order.seller_id == business.id).all()
    active = [o for o in orders if o.status not in ("settled", "rejected")]
    latest_scores = []
    for o in orders:
        cs = (db.query(CreditScore).filter(CreditScore.order_id == o.id)
              .order_by(CreditScore.id.desc()).first())
        if cs:
            latest_scores.append({"order_id": o.id, "goods": o.goods,
                                  "score": round(cs.score, 1),
                                  "risk_band": cs.risk_band})
    best_offer = (db.query(FinancingOffer)
                  .filter(FinancingOffer.business_id == business.id,
                          FinancingOffer.status == "available")
                  .order_by(FinancingOffer.rank).first())
    alerts = (db.query(Alert).filter(Alert.business_id == business.id,
                                     Alert.read_at.is_(None))
              .order_by(Alert.id.desc()).limit(5).all())
    return {
        "as_of": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "business": {"id": business.id, "name": business.legal_name,
                     "opening_balance": business.opening_balance},
        "current_balance": fc["current_balance"],
        "expected_receipts_30d": fc["expected_receipts_30d"],
        "lowest_projected_balance": fc["lowest_projected_balance"],
        "lowest_week": fc["lowest_week"],
        "gap_weeks": fc["gap_weeks"],
        "forecast": [{"week": w["week_label"], "balance": w["projected_balance"]}
                     for w in fc["weeks"][:8]],
        "orders": {"total": len(orders), "active": len(active),
                   "active_value": round(sum(o.amount for o in active), 2)},
        "scores": latest_scores[-5:],
        "top_financing_offer": ({
            "type": best_offer.offer_type, "amount": best_offer.amount,
            "fee_pct": best_offer.fee_pct, "term_days": best_offer.term_days,
            "reason": best_offer.reason, "simulated": True} if best_offer else None),
        "unread_alerts": [a.message for a in alerts],
    }


def _fmt_money(v) -> str:
    return f"${v:,.0f}"


def _deterministic_answer(f: dict, question: str) -> str:
    q = question.lower()
    gap = (f"Cash-flow outlook: current balance {_fmt_money(f['current_balance'])}, "
           f"lowest projected {_fmt_money(f['lowest_projected_balance'])} in the week "
           f"of {f['lowest_week']}, {f['gap_weeks']} gap week(s) in the 12-week forecast.")
    if "gap" in q or "cash" in q or "forecast" in q or "week" in q:
        if f["gap_weeks"]:
            late = next((w for w in f["forecast"] if w["balance"] < 0), None)
            return (f"Yes — the forecast turns negative in the week of "
                    f"{f['lowest_week']} at {_fmt_money(f['lowest_projected_balance'])}. "
                    f"Expected receipts in 30 days are {_fmt_money(f['expected_receipts_30d'])}. "
                    f"A delayed buyer payment (10+ days) would deepen the gap by roughly "
                    f"the same receipt amount — run the what-if scenario on the Cash Flow "
                    f"page to see it. {('Consider the simulated ' + f['top_financing_offer']['type'] + ' offer.') if f['top_financing_offer'] else ''}"
                    ).replace("  ", " ")
        return gap + (" No negative weeks are projected with current data, so no "
                      "cash-gap alert is active.")
    if "balance" in q or "receipt" in q or "money" in q:
        return (f"Current balance {_fmt_money(f['current_balance'])} (opening "
                f"{_fmt_money(f['business']['opening_balance'])} plus settled receipts). "
                f"Expected receipts within 30 days: {_fmt_money(f['expected_receipts_30d'])}. "
                f"Active orders: {f['orders']['active']} worth "
                f"{_fmt_money(f['orders']['active_value'])}.")
    if "financ" in q or "offer" in q or "advance" in q or "loan" in q:
        o = f["top_financing_offer"]
        if not o:
            return ("No financing offers are available yet — they are generated once "
                    "an order is scored. Score an order first.")
        return (f"Top simulated option: {o['type']} for {_fmt_money(o['amount'])} at "
                f"{o['fee_pct']}% over {o['term_days']} days. Why: {o['reason']} "
                f"All offers are simulated for the prototype — not a lending commitment.")
    if "score" in q or "risk" in q:
        if not f["scores"]:
            return "No credit scores exist yet — run scoring on an order to generate one."
        lines = "; ".join(f"order #{s['order_id']} {s['score']} ({s['risk_band']})"
                          for s in f["scores"])
        return f"Recent trade scores: {lines}. Scores come from the XGBoost scorer with SHAP reasons; see each order's 'Why this score' chart for drivers."
    if "alert" in q:
        return ("Unread alerts: " + ("; ".join(f["unread_alerts"])
                if f["unread_alerts"] else "none"))
    return (f"Here is your snapshot: balance {_fmt_money(f['current_balance'])}, "
            f"{f['gap_weeks']} gap week(s), lowest projection "
            f"{_fmt_money(f['lowest_projected_balance'])} ({f['lowest_week']}), "
            f"{f['orders']['active']} active orders worth "
            f"{_fmt_money(f['orders']['active_value'])}. Ask about cash gaps, "
            f"receipts, risk scores or financing.")


def _llm_answer(facts: dict, question: str) -> str | None:
    try:
        r = httpx.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}",
                     "Content-Type": "application/json"},
            json={"model": OPENAI_MODEL, "temperature": 0.2, "max_tokens": 300,
                  "messages": [
                      {"role": "system", "content": SYSTEM_PROMPT},
                      {"role": "user", "content": json.dumps(facts)[:6000]
                       + "\n\nQuestion: " + question[:500]}]},
            timeout=20.0)
        if r.status_code != 200:
            log.warning("copilot LLM http %s — using deterministic fallback",
                        r.status_code)
            return None
        return r.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        log.warning("copilot LLM unavailable (%s) — deterministic fallback", exc)
        return None


def ask(db: Session, business: Business, question: str) -> dict:
    facts = fact_sheet(db, business)
    mode = "llm:" + OPENAI_MODEL if OPENAI_API_KEY else "deterministic-demo"
    answer = _llm_answer(facts, question) if OPENAI_API_KEY else None
    if answer is None:
        answer = _deterministic_answer(facts, question)
        mode = "deterministic-demo"
    return {"answer": answer, "mode": mode, "cited_figures": {
        "current_balance": facts["current_balance"],
        "expected_receipts_30d": facts["expected_receipts_30d"],
        "lowest_projected_balance": facts["lowest_projected_balance"],
        "lowest_week": facts["lowest_week"], "gap_weeks": facts["gap_weeks"]},
        "disclaimer": "Figures computed by the deterministic forecaster; "
                      "the copilot only explains them. Simulated offers are not "
                      "lending commitments."}
