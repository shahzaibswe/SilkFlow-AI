"""SQLAlchemy models: the 15 tables from handoff doc §4 + settings key/value table."""
import time
from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

ORDER_STATUSES = [
    "draft", "docs_checked", "scored", "awaiting_funding", "funded", "shipped",
    "released", "settled", "disputed", "resolved", "rejected",
]
ESCROW_STATES = ["None", "Created", "Funded", "ShipmentConfirmed", "Released", "Disputed", "Refunded"]


def now_epoch() -> float:
    return time.time()


class Role(Base):
    __tablename__ = "roles"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(32), unique=True)
    permissions_json: Mapped[dict] = mapped_column(JSON, default=dict)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(190), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))
    business_id: Mapped[int | None] = mapped_column(ForeignKey("businesses.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="active")
    created_at: Mapped[float] = mapped_column(Float, default=now_epoch)

    role: Mapped[Role] = relationship()


class Business(Base):
    __tablename__ = "businesses"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    legal_name: Mapped[str] = mapped_column(String(190))
    country: Mapped[str] = mapped_column(String(2), default="CN")
    kyb_status: Mapped[str] = mapped_column(String(16), default="verified")
    wallet_address: Mapped[str] = mapped_column(String(42), default="")
    opening_balance: Mapped[float] = mapped_column(Float, default=0.0)

    owner: Mapped[User] = relationship(foreign_keys=[user_id])


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    seller_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"))
    buyer_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"))
    goods: Mapped[str] = mapped_column(String(240))
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    payment_term_days: Mapped[int] = mapped_column(Integer, default=30)
    ship_by: Mapped[str] = mapped_column(String(32), default="")
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    created_at: Mapped[float] = mapped_column(Float, default=now_epoch)

    seller: Mapped[Business] = relationship(foreign_keys=[seller_id])
    buyer: Mapped[Business] = relationship(foreign_keys=[buyer_id])
    documents: Mapped[list["Document"]] = relationship(back_populates="order")
    escrow: Mapped["Escrow | None"] = relationship(back_populates="order", uselist=False)


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    type: Mapped[str] = mapped_column(String(24))  # invoice | packing_list | order_terms
    file_name: Mapped[str] = mapped_column(String(240))
    file_ref: Mapped[str] = mapped_column(String(400), default="")
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    uploaded_at: Mapped[float] = mapped_column(Float, default=now_epoch)

    order: Mapped[Order] = relationship(back_populates="documents")


class DocumentCheck(Base):
    __tablename__ = "document_checks"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    result: Mapped[str] = mapped_column(String(16))  # pass | mismatch | fail
    discrepancies_json: Mapped[list] = mapped_column(JSON, default=list)
    checker: Mapped[str] = mapped_column(String(8), default="rules")
    checked_at: Mapped[float] = mapped_column(Float, default=now_epoch)


class CreditScore(Base):
    __tablename__ = "credit_scores"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    model_version: Mapped[str] = mapped_column(String(32))
    score: Mapped[float] = mapped_column(Float)
    risk_band: Mapped[str] = mapped_column(String(8))
    top_features_json: Mapped[list] = mapped_column(JSON, default=list)
    suggested_terms_json: Mapped[dict] = mapped_column(JSON, default=dict)
    anomaly_json: Mapped[dict] = mapped_column(JSON, default=dict)
    features_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[float] = mapped_column(Float, default=now_epoch)


class Escrow(Base):
    __tablename__ = "escrows"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), unique=True)
    contract_address: Mapped[str] = mapped_column(String(42), default="")
    tx_create: Mapped[str | None] = mapped_column(String(66), nullable=True)
    tx_fund: Mapped[str | None] = mapped_column(String(66), nullable=True)
    tx_confirm: Mapped[str | None] = mapped_column(String(66), nullable=True)
    tx_release: Mapped[str | None] = mapped_column(String(66), nullable=True)
    tx_dispute: Mapped[str | None] = mapped_column(String(66), nullable=True)
    tx_resolve: Mapped[str | None] = mapped_column(String(66), nullable=True)
    state: Mapped[str] = mapped_column(String(24), default="None")
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    token: Mapped[str] = mapped_column(String(12), default="sUSD")
    buyer_wallet: Mapped[str] = mapped_column(String(42), default="")
    seller_wallet: Mapped[str] = mapped_column(String(42), default="")

    order: Mapped[Order] = relationship(back_populates="escrow")


class ShipmentEvent(Base):
    __tablename__ = "shipment_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(24))  # dispatch | in_transit | delivery
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    received_at: Mapped[float] = mapped_column(Float, default=now_epoch)


class AgentAction(Base):
    __tablename__ = "agent_actions"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    action: Mapped[str] = mapped_column(String(32))
    decision: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str] = mapped_column(Text, default="")
    policy_checks_json: Mapped[list] = mapped_column(JSON, default=list)
    tx_hash: Mapped[str | None] = mapped_column(String(66), nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="agent")
    timestamp: Mapped[float] = mapped_column(Float, default=now_epoch)


class Dispute(Base):
    __tablename__ = "disputes"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    raised_by: Mapped[str] = mapped_column(String(16))  # buyer | seller
    reason: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | resolved
    assigned_reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(24), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    tx_hash: Mapped[str | None] = mapped_column(String(66), nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=now_epoch)
    resolved_at: Mapped[float | None] = mapped_column(Float, nullable=True)


class FxSnapshot(Base):
    __tablename__ = "fx_snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    pair: Mapped[str] = mapped_column(String(12), index=True)
    rate: Mapped[float] = mapped_column(Float)
    volatility: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(12), default="synthetic")
    captured_at: Mapped[float] = mapped_column(Float, default=now_epoch)


class AuditEntry(Base):
    __tablename__ = "audit_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(64))
    actor: Mapped[str] = mapped_column(String(64), default="system")
    data_json: Mapped[dict] = mapped_column(JSON, default=dict)
    data_hash: Mapped[str] = mapped_column(String(64))
    previous_hash: Mapped[str] = mapped_column(String(64))
    entry_hash: Mapped[str] = mapped_column(String(64), index=True)
    tx_hash: Mapped[str | None] = mapped_column(String(66), nullable=True)
    timestamp: Mapped[float] = mapped_column(Float, default=now_epoch)


class ModelVersion(Base):
    __tablename__ = "models"
    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(String(32))
    trained_on: Mapped[str] = mapped_column(String(190), default="synthetic_trades.csv")
    metrics_json: Mapped[dict] = mapped_column(JSON, default=dict)
    is_active: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[float] = mapped_column(Float, default=now_epoch)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value_json: Mapped[object] = mapped_column(JSON)


class CashflowItem(Base):
    __tablename__ = "cashflow_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(12), default="receipt")  # receipt | payment
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    expected_date: Mapped[float] = mapped_column(Float)               # epoch seconds
    confidence: Mapped[float] = mapped_column(Float, default=1.0)     # 0..1
    source: Mapped[str] = mapped_column(String(16), default="auto")   # auto | manual
    created_at: Mapped[float] = mapped_column(Float, default=now_epoch)


class CashflowForecast(Base):
    __tablename__ = "cashflow_forecasts"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    week_start: Mapped[float] = mapped_column(Float)                  # epoch of Monday 00:00 UTC
    projected_balance: Mapped[float] = mapped_column(Float)
    gap_flag: Mapped[int] = mapped_column(Integer, default=0)
    generated_at: Mapped[float] = mapped_column(Float, default=now_epoch)


class FinancingOffer(Base):
    __tablename__ = "financing_offers"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), index=True)
    offer_type: Mapped[str] = mapped_column(String(32))
    amount: Mapped[float] = mapped_column(Float)
    fee_pct: Mapped[float] = mapped_column(Float)
    term_days: Mapped[int] = mapped_column(Integer)
    rank: Mapped[int] = mapped_column(Integer, default=1)
    reason: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="available")  # available | requested
    simulated: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[float] = mapped_column(Float, default=now_epoch)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int | None] = mapped_column(ForeignKey("businesses.id"),
                                                    nullable=True, index=True)
    type: Mapped[str] = mapped_column(String(32))   # cash_gap | shipment | funding | release | escalation
    message: Mapped[str] = mapped_column(Text, default="")
    severity: Mapped[str] = mapped_column(String(12), default="info")  # info | warning | critical
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=now_epoch)
    read_at: Mapped[float | None] = mapped_column(Float, nullable=True)
