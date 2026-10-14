"""Admin endpoints: users, settings, kill switch, live stats."""
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_roles
from ..models import (AgentAction, AuditEntry, Dispute, Order, Role, User)
from ..schemas import SettingsPatchReq, UserPatchReq, iso
from ..services import chain, policy
from ..services.audit_service import append_audit

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
def list_users(user: User = Depends(require_roles("admin", "reviewer")),
               db: Session = Depends(get_db)):
    rows = db.query(User).order_by(User.id).all()
    return {"users": [{"id": u.id, "name": u.name, "email": u.email,
                       "role": u.role.name, "status": u.status,
                       "business_id": u.business_id, "created_at": iso(u.created_at)}
                      for u in rows]}


@router.patch("/users/{user_id}")
def patch_user(user_id: int, req: UserPatchReq,
               user: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User not found")
    if u.id == user.id:
        raise HTTPException(400, "Cannot change your own status")
    u.status = req.status
    append_audit(db, order_id=None, action=f"user_{req.status}", actor=f"user:{user.id}",
                 data={"target_user": u.email})
    db.commit()
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role.name,
            "status": u.status, "created_at": iso(u.created_at)}


@router.get("/settings")
def get_settings(user: User = Depends(require_roles("reviewer", "admin")),
                 db: Session = Depends(get_db)):
    s = policy.get_settings(db)
    s["agent_state"] = "paused" if s["kill_switch"] else "active"
    s["chain_mode"] = chain.status()["mode"]
    return s


@router.put("/settings")
def patch_settings(req: SettingsPatchReq, user: User = Depends(require_roles("admin")),
                   db: Session = Depends(get_db)):
    changed = {}
    for key in ("auto_release_limit", "kill_switch", "reviewer_threshold_score",
                "max_release_per_order"):
        val = getattr(req, key)
        if val is not None:
            policy.set_setting(db, key, val)
            changed[key] = val
    append_audit(db, order_id=None, action="settings_updated", actor=f"user:{user.id}",
                 data={"changed": changed})
    db.commit()
    s = policy.get_settings(db)
    s["agent_state"] = "paused" if s["kill_switch"] else "active"
    s["chain_mode"] = chain.status()["mode"]
    return s


@router.post("/agent/pause")
def pause_agent(user: User = Depends(require_roles("reviewer", "admin")),
                db: Session = Depends(get_db)):
    policy.set_setting(db, "kill_switch", True)
    append_audit(db, order_id=None, action="agent_killed", actor=f"user:{user.id}",
                 data={"kill_switch": True})
    db.commit()
    return {"agent_state": "paused", "kill_switch": True}


@router.post("/agent/resume")
def resume_agent(user: User = Depends(require_roles("reviewer", "admin")),
                 db: Session = Depends(get_db)):
    policy.set_setting(db, "kill_switch", False)
    append_audit(db, order_id=None, action="agent_resumed", actor=f"user:{user.id}",
                 data={"kill_switch": False})
    db.commit()
    return {"agent_state": "active", "kill_switch": False}


@router.get("/agent/state")
def agent_state(user: User = Depends(require_roles("reviewer", "admin")),
                db: Session = Depends(get_db)):
    s = policy.get_settings(db)
    return {"agent_state": "paused" if s["kill_switch"] else "active",
            "chain": chain.status()}
