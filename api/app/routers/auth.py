"""Auth endpoints: register / login / refresh / logout (jti denylist)."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import Role, User
from ..ratelimit import check_auth_rate
from ..schemas import LoginReq, RefreshReq, RegisterReq
from ..security import (TokenError, decode_token, hash_password, make_access_token,
                        make_refresh_token, revoke, verify_password)

router = APIRouter(prefix="/auth", tags=["auth"])


def role_name(user: User) -> str:
    return user.role.name if user.role else ""


@router.post("/register", status_code=201)
def register(req: RegisterReq, request: Request,
             db: Session = Depends(get_db)):
    check_auth_rate(request)
    if db.query(User).filter(User.email == req.email.lower()).first():
        raise HTTPException(409, "Email already registered")
    role = db.query(Role).filter(Role.name == req.role).one_or_none()
    if role is None:
        raise HTTPException(400, f"Unknown role {req.role}")
    user = User(name=req.name, email=req.email.lower(),
                password_hash=hash_password(req.password), role_id=role.id)
    db.add(user)
    db.commit()
    return {"id": user.id, "email": user.email, "role": role.name}


@router.post("/login")
def login(req: LoginReq, request: Request, db: Session = Depends(get_db)):
    check_auth_rate(request)
    user = db.query(User).filter(User.email == req.email.lower()).one_or_none()
    if user is None or not verify_password(req.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    if user.status != "active":
        raise HTTPException(403, "Account suspended")
    role = role_name(user)
    access = make_access_token(user.id, role)
    refresh = make_refresh_token(user.id, role)
    return {
        "access_token": access["token"], "refresh_token": refresh["token"], "role": role,
        "user": {"id": user.id, "name": user.name, "email": user.email, "role": role},
    }


@router.post("/refresh")
def refresh(req: RefreshReq, request: Request, db: Session = Depends(get_db)):
    check_auth_rate(request)
    try:
        payload = decode_token(req.refresh_token)
    except TokenError as exc:
        raise HTTPException(401, str(exc))
    if payload.get("type") != "refresh":
        raise HTTPException(401, "Refresh token required")
    user = db.get(User, int(payload["sub"]))
    if user is None or user.status != "active":
        raise HTTPException(401, "User unavailable")
    return {"access_token": make_access_token(user.id, role_name(user))["token"]}


@router.post("/logout")
def logout(request: Request, req: RefreshReq | None = None,
           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # revoke the presented access token ...
    payload = getattr(request.state, "token_payload", None)
    if payload:
        revoke(payload["jti"], payload["exp"])
    # ... plus the refresh token when supplied in the body
    if req and req.refresh_token:
        try:
            rp = decode_token(req.refresh_token)
            revoke(rp["jti"], rp["exp"])
        except TokenError:
            pass
    return {"ok": True}
