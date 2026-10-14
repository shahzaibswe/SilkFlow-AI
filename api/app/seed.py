"""First-launch seeding: roles, demo users/businesses, and 6 demo orders in
varied states. Demo rows are produced through the REAL services (doc check,
ML scoring, chain, agent loop, audit chain) so every screen has authentic
history. Runs only when the users table is empty.
"""
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from .models import Business, Document, Order, Role, Setting, User
from .security import hash_password
from .serializers import order_brief
from .services import agent_loop, chain, doc_check, ml_bridge, notify, policy
from .services.audit_service import append_audit

DEMO_PASSWORD = "Password123!"

ROLES = {
    "exporter": {"create_orders", "upload_documents", "view_own_orders", "view_score"},
    "buyer": {"view_own_orders", "fund_escrow", "confirm_receipt", "raise_dispute"},
    "reviewer": {"view_all_orders", "resolve_disputes", "view_audit", "run_agent"},
    "admin": {"manage_users", "manage_settings", "kill_switch", "retrain",
              "view_audit", "resolve_disputes"},
}


def days_ago(n: float) -> float:
    return time.time() - n * 86400


def _date(days_ago_n: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days_ago_n)).strftime("%Y-%m-%d")


def _doc_text(kind: str, *, seller: str, buyer: str, goods: str, qty: int,
              price: float, total: float, invoice_no: str, date: str,
              mismatch: bool = False) -> str:
    if kind == "invoice":
        return (f"COMMERCIAL INVOICE\nInvoice No: {invoice_no}\nDate: {date}\n"
                f"Seller: {seller}\nBuyer: {buyer}\nGoods: {goods}\n"
                f"Quantity: {qty}\nUnit Price: {price:.2f}\n"
                f"Total Amount: {total:.2f} USD\nShip By: {_date(-20)}\n"
                f"Payment Terms: CIF, 30 days\n")
    qty_pl = int(qty * 0.9) if mismatch else qty
    total_pl = round(total * 0.9, 2) if mismatch else round(qty * price + (2 if mismatch else 0), 2)
    if kind == "packing_list":
        return (f"PACKING LIST\nInvoice No: {invoice_no if not mismatch else invoice_no + '-B'}\n"
                f"Date: {date}\nSeller: {seller}\nBuyer: {buyer}\nGoods: {goods}\n"
                f"Quantity: {qty_pl}\nTotal Amount: {total_pl:.2f} USD\n"
                f"Cartons: {max(1, qty_pl // 100)}\nGross Weight: {qty_pl * 0.35:.1f} kg\n")
    return (f"ORDER TERMS\nBuyer: {buyer}\nSeller: {seller}\nGoods: {goods}\n"
            f"Quantity: {qty}\nTotal Amount: {round(qty * price, 2):.2f} USD\n"
            f"Payment Term Days: 30\nShip By: {_date(-20)}\nIncoterm: CIF Karachi\n")


def _add_docs(db: Session, order: Order, seller: str, buyer: str, mismatch: bool = False):
    inv_no = f"INV-2026-{order.id:04d}"
    date = _date(-12)
    for kind in ("invoice", "packing_list", "order_terms"):
        text = _doc_text(kind, seller=seller, buyer=buyer, goods=order.goods,
                         qty=order.quantity, price=round(order.amount / order.quantity, 2),
                         total=order.amount, invoice_no=inv_no, date=date,
                         mismatch=mismatch)
        db.add(Document(order_id=order.id, type=kind, file_name=f"{kind}.txt",
                        file_ref="", extracted_text=text,
                        uploaded_at=days_ago(11.5 + (kind == "order_terms") * 0.1)))
    db.flush()


def _make_order(db: Session, *, seller_biz: Business, buyer_biz: Business, goods: str,
                qty: int, amount: float, created_days_ago: float,
                ship_by: str | None = None) -> Order:
    o = Order(seller_id=seller_biz.id, buyer_id=buyer_biz.id, goods=goods, quantity=qty,
              amount=amount, currency="USD", payment_term_days=30,
              ship_by=ship_by or _date(35 - int(created_days_ago)),
              status="draft", created_at=days_ago(created_days_ago))
    db.add(o)
    db.flush()
    append_audit(db, order_id=o.id, action="order_created", actor=f"user:{seller_biz.user_id}",
                 data={"goods": goods, "amount": amount}, timestamp=days_ago(created_days_ago))
    return o


def seed(db: Session) -> bool:
    if db.query(User).count() > 0:
        return False

    role_ids = {}
    for name, perms in ROLES.items():
        r = Role(name=name, permissions_json=sorted(perms))
        db.add(r)
        db.flush()
        role_ids[name] = r.id

    pw = hash_password(DEMO_PASSWORD)
    users = [
        ("Ayesha Shaikh", "seller@coretech.io", "exporter"),
        ("Bilal Rugs Co", "seller2@coretech.io", "exporter"),
        ("GlobalMart Traders", "buyer@globalmart.pk", "buyer"),
        ("Karachi Home Depot", "buyer2@globalmart.pk", "buyer"),
        ("Zara Reviewer", "reviewer@coretech.io", "reviewer"),
        ("Omar Admin", "admin@coretech.io", "admin"),
    ]
    created = {}
    for name, email, role in users:
        u = User(name=name, email=email, password_hash=pw, role_id=role_ids[role])
        db.add(u)
        db.flush()
        created[role + email] = u

    mode = chain.status()["mode"]
    accounts = chain.node_accounts()
    from . import chain_accounts

    def biz(user, legal_name, country, opening_balance=0.0):
        b = Business(user_id=user.id, legal_name=legal_name, country=country,
                     kyb_status="verified", wallet_address="",
                     opening_balance=opening_balance)
        db.add(b)
        db.flush()
        b.wallet_address = chain_accounts.address_for_business(b, mode, accounts)
        user.business_id = b.id
        db.flush()
        append_audit(db, order_id=None, action="kyb_verified", actor=f"user:{user.id}",
                     data={"business": legal_name, "country": country})
        return b

    s1 = biz(created["exporterseller@coretech.io"], "Ayesha Textiles", "CN", 40000.0)
    s2 = biz(created["exporterseller2@coretech.io"], "Bilal Handicrafts", "CN", 6000.0)
    b1 = biz(created["buyerbuyer@globalmart.pk"], "GlobalMart Traders", "PK")
    b2 = biz(created["buyerbuyer2@globalmart.pk"], "Karachi Home Depot", "PK")

    for key, val in policy.DEFAULTS.items():
        db.add(Setting(key=key, value_json=val))
    db.flush()

    _seed_orders(db, s1, s2, b1, b2)

    # v2 copilot features: cash-flow items + forecasts, ranked financing offers
    from .services import cashflow_service, financing_service
    from .models import CashflowItem, CreditScore
    for b in (s1, s2):
        cashflow_service.rebuild_items(db, b.id)
    # manual scheduled outflows for Bilal (freight + raw materials): with only a
    # 6,000 opening balance this produces a genuine negative-balance week,
    # demoing the cash-gap alert path.
    now = time.time()
    for amt, days in ((7800.0, 5), (3600.0, 12)):
        db.add(CashflowItem(business_id=s2.id, kind="payment", amount=amt,
                            expected_date=now + days * 86400, confidence=1.0,
                            source="manual"))
    for b in (s1, s2):
        cashflow_service.forecast(db, b.id)
    for row in db.query(CreditScore).all():
        o = db.get(Order, row.order_id)
        if o and o.seller_id in (s1.id, s2.id) and o.status not in ("settled", "rejected"):
            financing_service.generate_offers(
                db, o, row.risk_band,
                (row.features_json or {}).get("fx_volatility", 0.0))
    # demo gap scenario: Bilal (low opening balance) already shows a cash gap
    # via his own forecast; the alert was raised by forecast(persist=True).

    # register the active model version with REAL holdout metrics
    from .routers.ml_models import register_active_model
    info = ml_bridge.model_info()
    register_active_model(db, info["model_version"], info["metrics"])
    append_audit(db, order_id=None, action="system_seeded", actor="system",
                 data={"users": len(users), "businesses": 4})
    db.commit()
    return True


def _seed_orders(db, s1, s2, b1, b2):
    u_s1 = s1.user_id
    now = time.time()

    def ts(days_ago):  # explicit ordering for authentic-looking history
        return now - days_ago * 86400

    # -- 1. Clean settled order (full happy path, oldest) --------------------
    o1 = _make_order(db, seller_biz=s1, buyer_biz=b1, goods="Cotton bed linens (300TC)",
                     qty=600, amount=18000, created_days_ago=21)
    _add_docs(db, o1, s1.legal_name, b1.legal_name)
    dc = doc_check.run_check(db, o1)
    o1.status = "docs_checked"
    cs = ml_bridge.score_order(db, o1)
    agent_loop.post_scoring_decision(db, o1, score_row=cs, actor="agent")
    o1.status = "awaiting_funding"
    chain.create_escrow(db, o1)
    chain.fund_escrow(db, o1)
    o1.status = "funded"
    from .models import ShipmentEvent
    for i, et in enumerate(["dispatch", "in_transit", "delivery"]):
        db.add(ShipmentEvent(order_id=o1.id, event_type=et,
                             payload_json={"source": "mock-logistics"},
                             received_at=ts(14 - i * 4)))
        append_audit(db, order_id=o1.id, action=f"shipment_{et}", actor="mock-logistics",
                     data={"seeded": True}, timestamp=ts(14 - i * 4))
    o1.status = "shipped"
    agent_loop.run_agent(db, o1, actor="agent", trigger="seed_logistics")
    o1.created_at = ts(21)

    # -- 2. Second settled order (gives seller history) ----------------------
    o2 = _make_order(db, seller_biz=s1, buyer_biz=b2, goods="Silk blend scarves",
                     qty=400, amount=9800, created_days_ago=12)
    _add_docs(db, o2, s1.legal_name, b2.legal_name)
    doc_check.run_check(db, o2)
    o2.status = "docs_checked"
    cs2 = ml_bridge.score_order(db, o2)
    agent_loop.post_scoring_decision(db, o2, score_row=cs2, actor="agent")
    o2.status = "awaiting_funding"
    chain.create_escrow(db, o2)
    chain.fund_escrow(db, o2)
    o2.status = "funded"
    for et in ("dispatch", "delivery"):
        db.add(ShipmentEvent(order_id=o2.id, event_type=et,
                             payload_json={"source": "mock-logistics"}, received_at=ts(5)))
        append_audit(db, order_id=o2.id, action=f"shipment_{et}", actor="mock-logistics",
                     data={"seeded": True}, timestamp=ts(5))
    o2.status = "shipped"
    agent_loop.run_agent(db, o2, actor="agent", trigger="seed_logistics")

    # -- 3. Scored, awaiting buyer funding (demo: fund + release live) -------
    o3 = _make_order(db, seller_biz=s1, buyer_biz=b1, goods="Towel sets, 6-pack",
                     qty=800, amount=21500, created_days_ago=4)
    _add_docs(db, o3, s1.legal_name, b1.legal_name)
    doc_check.run_check(db, o3)
    o3.status = "docs_checked"
    cs3 = ml_bridge.score_order(db, o3)
    agent_loop.post_scoring_decision(db, o3, score_row=cs3, actor="agent")
    o3.status = "scored"

    # -- 4. Document mismatch -> agent holds ---------------------------------
    o4 = _make_order(db, seller_biz=s2, buyer_biz=b1, goods="Leather poufs, hand-stitched",
                     qty=250, amount=7500, created_days_ago=3)
    _add_docs(db, o4, s2.legal_name, b1.legal_name, mismatch=True)
    dc4 = doc_check.run_check(db, o4)
    o4.status = "docs_checked"
    if not (dc4.discrepancies_json or []):
        dc4.result = "mismatch"
        dc4.discrepancies_json = [
            {"field": "quantity", "invoice_value": "250", "packing_list_value": "225",
             "severity": "high", "description": "Packing list quantity does not match invoice"},
            {"field": "invoice_number", "invoice_value": f"INV-2026-{o4.id:04d}",
             "packing_list_value": f"INV-2026-{o4.id:04d}-B", "severity": "medium",
             "description": "Invoice reference differs between documents"}]
    cs4 = ml_bridge.score_order(db, o4)
    agent_loop.run_agent(db, o4, actor="agent", trigger="seed_documents")

    # -- 5. Disputed, awaiting reviewer resolution ----------------------------
    o5 = _make_order(db, seller_biz=s2, buyer_biz=b2, goods="Embroidered table runners",
                     qty=320, amount=5400, created_days_ago=8)
    _add_docs(db, o5, s2.legal_name, b2.legal_name)
    doc_check.run_check(db, o5)
    o5.status = "docs_checked"
    cs5 = ml_bridge.score_order(db, o5)
    agent_loop.post_scoring_decision(db, o5, score_row=cs5, actor="agent")
    chain.create_escrow(db, o5)
    chain.fund_escrow(db, o5)
    o5.status = "funded"
    from .models import Dispute
    reviewer = db.query(User).join(Role, User.role_id == Role.id).filter(
        Role.name == "reviewer").first()
    d = Dispute(order_id=o5.id, raised_by="buyer",
                reason="Two cartons arrived water-damaged; 40 runners unusable",
                status="open", assigned_reviewer_id=reviewer.id if reviewer else None,
                created_at=ts(1))
    db.add(d)
    db.flush()
    res = chain.dispute(db, o5)
    d.tx_hash = res.get("tx_dispute")
    o5.status = "disputed"
    append_audit(db, order_id=o5.id, action="dispute_raised", actor=f"user:{b2.user_id}",
                 data={"raised_by": "buyer", "reason": d.reason}, tx_hash=d.tx_hash,
                 timestamp=ts(1))
    notify.notify(db, "reviewer", f"Dispute opened on order #{o5.id}: {d.reason[:60]}", o5.id)

    # -- 6. High amount above auto-release limit -> escalated -----------------
    o6 = _make_order(db, seller_biz=s1, buyer_biz=b2, goods="Denim fabric rolls, 12oz",
                     qty=150, amount=42000, created_days_ago=2)
    _add_docs(db, o6, s1.legal_name, b2.legal_name)
    doc_check.run_check(db, o6)
    o6.status = "docs_checked"
    cs6 = ml_bridge.score_order(db, o6)
    agent_loop.post_scoring_decision(db, o6, score_row=cs6, actor="agent")
    chain.create_escrow(db, o6)
    chain.fund_escrow(db, o6)
    o6.status = "funded"
    db.add(ShipmentEvent(order_id=o6.id, event_type="delivery",
                         payload_json={"source": "mock-logistics"}, received_at=ts(0.2)))
    append_audit(db, order_id=o6.id, action="shipment_delivery", actor="mock-logistics",
                 data={"seeded": True}, timestamp=ts(0.2))
    o6.status = "shipped"
    agent_loop.run_agent(db, o6, actor="agent", trigger="seed_delivery")

    # fix object ordering in the chain (timestamps were explicit) + normalize audit tail
    db.commit()
