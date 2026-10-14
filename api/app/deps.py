"""FastAPI dependencies: current user resolution + role guards."""
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import Role, User
from .security import TokenError, decode_token

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = decode_token(creds.credentials)
    except TokenError as exc:
        raise HTTPException(401, str(exc))
    if payload.get("type") != "access":
        raise HTTPException(401, "Access token required")
    request.state.token_payload = payload
    user = db.get(User, int(payload["sub"]))
    if user is None:
        raise HTTPException(401, "User not found")
    if user.status != "active":
        raise HTTPException(403, "Account suspended")
    return user


def get_role_name(user: User) -> str:
    return user.role.name if user.role else ""


def require_roles(*roles: str):
    def guard(user: User = Depends(get_current_user)):
        if user.role.name not in roles:
            raise HTTPException(403, f"Requires role: {'/'.join(roles)}")
        return user
    return guard


def resolve_role(db: Session, name: str) -> Role | None:
    return db.query(Role).filter(Role.name == name).one_or_none()
