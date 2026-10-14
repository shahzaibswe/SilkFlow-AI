"""Business profile endpoints with mocked instant KYB."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import chain_accounts
from ..db import get_db
from ..deps import get_current_user
from ..models import Business, User
from ..schemas import BusinessReq
from ..services import chain

router = APIRouter(prefix="/businesses", tags=["businesses"])


def biz_to_dict(b: Business) -> dict:
    return {"id": b.id, "legal_name": b.legal_name, "country": b.country,
            "kyb_status": b.kyb_status, "wallet_address": b.wallet_address,
            "opening_balance": b.opening_balance}


@router.post("", status_code=201)
def create_business(req: BusinessReq, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    if user.business_id and db.get(Business, user.business_id):
        raise HTTPException(409, "User already has a business profile")
    b = Business(user_id=user.id, legal_name=req.legal_name,
                 country=(req.country or "CN").upper()[:2],
                 kyb_status="verified",
                 opening_balance=max(req.opening_balance, 0.0),
                 wallet_address=req.wallet_address or "")
    db.add(b)
    db.flush()
    if not b.wallet_address:
        b.wallet_address = chain_accounts.address_for_business(
            b, chain.status()["mode"], chain.node_accounts())
    user.business_id = b.id
    db.commit()
    return biz_to_dict(b)


@router.get("/me")
def my_business(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    b = db.get(Business, user.business_id) if user.business_id else None
    if b is None:
        raise HTTPException(404, "No business profile for this user")
    return biz_to_dict(b)


@router.get("")
def list_businesses(role: str | None = None, country: str | None = None,
                    user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    """Business directory — used by the New Order form to pick a buyer."""
    from ..models import Role
    q = db.query(Business).join(User, Business.user_id == User.id).join(
        Role, User.role_id == Role.id)
    if role:
        q = q.filter(Role.name == role)
    if country:
        q = q.filter(Business.country == country.upper())
    return {"businesses": [dict(biz_to_dict(b), country_name=b.country)
                           for b in q.order_by(Business.id).all()]}
