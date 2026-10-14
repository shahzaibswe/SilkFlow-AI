"""FX risk endpoint."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import User
from ..services import fx_service

router = APIRouter(prefix="/fx", tags=["fx"])


@router.get("/risk")
def fx_risk(base: str = "USD", quote: str = "PKR", days: int = 30,
            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return fx_service.fx_risk_note(db, base.upper(), quote.upper(), max(days, 1))
