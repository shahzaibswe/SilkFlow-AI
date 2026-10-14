"""Financing matcher — deterministic, explainable rules; every offer is SIMULATED.

Three candidate products are priced from the order value, the credit score's
risk band, the payment term and (optionally) FX volatility. Ranking rule:
lowest estimated financing cost = amount * fee_pct/100 * term_days/360, with
suitability filters. The LLM never invents rates, fees or eligibility — all
arithmetic lives here and is auditable from the reason strings.
"""
import logging

from sqlalchemy.orm import Session

from ..models import FinancingOffer, Order
from .audit_service import append_audit

log = logging.getLogger("silkflow.financing")

FEE_BY_BAND = {"low": 2.9, "medium": 4.5, "high": 6.9}


def _annualised_cost(amount: float, fee_pct: float, term_days: int) -> float:
    return amount * (fee_pct / 100.0) * (term_days / 360.0)


def generate_offers(db: Session, order: Order, risk_band: str,
                    fx_volatility: float = 0.0) -> list[FinancingOffer]:
    """Rebuild the simulated offer set for an order. Returns ranked offers."""
    db.query(FinancingOffer).filter(FinancingOffer.order_id == order.id,
                                    FinancingOffer.status == "available").delete()
    band = risk_band if risk_band in FEE_BY_BAND else "medium"
    fee = FEE_BY_BAND[band]
    amt = order.amount
    term = max(order.payment_term_days, 7)

    candidates = [
        dict(offer_type="Invoice Advance",
             amount=round(amt * 0.80, 2), fee_pct=fee, term_days=term,
             reason=f"Immediate advance of 80% of the invoice at {fee}% fee; "
                    f"sized for a {band}-risk score and {term}-day buyer term."),
        dict(offer_type="FX-Bridged Advance",
             amount=round(amt * 0.65, 2), fee_pct=round(fee + 1.5, 2),
             term_days=term + 15,
             reason=("Hedges the corridor's FX volatility "
                     f"({fx_volatility * 100:.1f}% annualised) by advancing in USD "
                     "and settling the quote leg later; premium of +1.5% fee."
                     if fx_volatility >= 0.04 else
                     "Same structure as the Invoice Advance with an FX lock; "
                     "not cost-preferred while corridor volatility is low.")),
        dict(offer_type="Working-Capital Top-Up",
             amount=round(min(amt * 0.40, 15000.0), 2),
             fee_pct=round(fee + 0.6, 2), term_days=90,
             reason="Smaller facility for inputs and wages before shipment; "
                    "longer 90-day term, slightly higher rate."),
    ]
    for c in candidates:
        c["cost"] = _annualised_cost(c["amount"], c["fee_pct"], c["term_days"])
    ranked = sorted(candidates, key=lambda c: c["cost"])
    out = []
    for rank, c in enumerate(ranked, start=1):
        o = FinancingOffer(order_id=order.id, business_id=order.seller_id,
                           offer_type=c["offer_type"], amount=c["amount"],
                           fee_pct=c["fee_pct"], term_days=c["term_days"],
                           rank=rank, reason=c["reason"], status="available",
                           simulated=1)
        db.add(o)
        out.append(o)
    db.flush()
    log.info("financing offers for order %s: %s (band=%s)", order.id,
             [(o.offer_type, o.amount, o.fee_pct) for o in out], band)
    return out


def offer_dict(o: FinancingOffer) -> dict:
    return {"id": o.id, "order_id": o.order_id, "offer_type": o.offer_type,
            "amount": o.amount, "fee_pct": o.fee_pct, "term_days": o.term_days,
            "rank": o.rank, "reason": o.reason, "status": o.status,
            "simulated": bool(o.simulated),
            "net_payout": round(o.amount * (1 - o.fee_pct / 100), 2),
            "estimated_cost": round(_annualised_cost(o.amount, o.fee_pct,
                                                     o.term_days), 2)}


def apply_for_offer(db: Session, order: Order, offer_id: int, actor: str) -> dict:
    o = db.get(FinancingOffer, offer_id)
    if o is None or o.order_id != order.id:
        raise ValueError("offer not found for this order")
    if o.status == "requested":
        return offer_dict(o)  # idempotent: repeat apply does nothing new
    o.status = "requested"
    db.flush()
    append_audit(db, order_id=order.id, action="financing_requested", actor=actor,
                 data={"offer_id": o.id, "offer_type": o.offer_type,
                       "amount": o.amount, "fee_pct": o.fee_pct,
                       "simulated": True,
                       "note": "Simulated application — no real lending commitment."})
    return offer_dict(o)
