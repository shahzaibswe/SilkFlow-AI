"""Agent loop endpoint: manual run of the decision cycle."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_roles
from ..models import User
from ..serializers import assert_party, get_order_or_404
from ..services import agent_loop

router = APIRouter(prefix="/orders", tags=["agent"])


@router.post("/{order_id}/agent/run")
def run_agent(order_id: int,
              user: User = Depends(require_roles("reviewer", "admin", "exporter", "buyer")),
              db: Session = Depends(get_db)):
    o = get_order_or_404(db, order_id)
    assert_party(user, o)
    result = agent_loop.run_agent(db, o, actor="agent", trigger=f"user:{user.id}")
    db.commit()
    return result
