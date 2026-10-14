"""Pydantic request models + response helpers."""
from datetime import datetime, timezone

from pydantic import BaseModel, Field


def iso(epoch: float | None) -> str | None:
    if epoch is None:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat(timespec="seconds")


class RegisterReq(BaseModel):
    name: str
    email: str
    password: str
    role: str = Field(pattern="^(exporter|buyer|reviewer|admin)$")


class LoginReq(BaseModel):
    email: str
    password: str


class RefreshReq(BaseModel):
    refresh_token: str


class BusinessReq(BaseModel):
    legal_name: str
    country: str = "CN"
    wallet_address: str | None = None
    opening_balance: float = 0.0


class ScenarioReq(BaseModel):
    order_id: int
    delay_days: int = Field(ge=0, le=180)


class FinancingReq(BaseModel):
    offer_id: int


class CopilotAskReq(BaseModel):
    business_id: int | None = None
    question: str = Field(min_length=3, max_length=1000)


class OrderCreateReq(BaseModel):
    buyer_id: int
    goods: str
    quantity: int = 1
    amount: float
    currency: str = "USD"
    payment_term_days: int = 30
    ship_by: str


class FundReq(BaseModel):
    tx_hash: str | None = None


class DisputeReq(BaseModel):
    reason: str


class ResolveReq(BaseModel):
    decision: str = Field(pattern="^(release|refund|more_evidence)$")
    notes: str = ""


class SimulateShipmentReq(BaseModel):
    event_type: str | None = Field(default=None, pattern="^(dispatch|in_transit|delivery)$")


class SimulateDisputeReq(BaseModel):
    reason: str | None = None


class WebhookReq(BaseModel):
    order_id: int
    event_type: str = Field(pattern="^(dispatch|in_transit|delivery)$")
    timestamp: str | None = None
    payload: dict | None = None


class SettingsPatchReq(BaseModel):
    auto_release_limit: float | None = None
    kill_switch: bool | None = None
    reviewer_threshold_score: float | None = None
    max_release_per_order: int | None = None


class UserPatchReq(BaseModel):
    status: str = Field(pattern="^(active|suspended)$")


class RetrainReq(BaseModel):
    dataset_ref: str | None = None
