"""Auth primitives: pbkdf2-hmac password hashing (stdlib), JWT tokens, jti denylist.

PyJWT is used when available; otherwise a stdlib HS256-compatible fallback
(base64url header.payload.signature signed with HMAC-SHA256) is used so the
app always runs. Passwords: bcrypt is unavailable on this Python, so the
spec'd fallback pbkdf2-hmac-SHA256 is used.
"""
import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid

from .config import ACCESS_TOKEN_EXPIRE_MIN, REFRESH_TOKEN_EXPIRE_DAYS, SECRET_KEY

PBKDF2_ITERATIONS = 120_000

# --- jti denylist (token revocation on logout / incident) -------------------
# In-process set: jti -> expiry epoch. Sufficient for the single-process demo.
_denylist: dict[str, float] = {}


def revoke(jti: str, exp: float) -> None:
    _denylist[jti] = exp


def is_revoked(jti: str) -> bool:
    _sweep()
    return jti in _denylist


def _sweep() -> None:
    now = time.time()
    for k in [k for k, v in _denylist.items() if v < now]:
        _denylist.pop(k, None)


# --- passwords ---------------------------------------------------------------
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _algo, iters, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# --- tokens ------------------------------------------------------------------
def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sign(msg: bytes) -> bytes:
    return hmac.new(SECRET_KEY.encode(), msg, hashlib.sha256).digest()


def _encode_jwt(payload: dict) -> str:
    try:
        import jwt  # PyJWT
        return jwt.encode(payload, SECRET_KEY, algorithm="HS256")
    except ImportError:
        header = {"alg": "HS256", "typ": "JWT"}
        seg = _b64e(json.dumps(header, separators=(",", ":")).encode()) + "." + \
              _b64e(json.dumps(payload, separators=(",", ":")).encode())
        return seg + "." + _b64e(_sign(seg.encode()))


def _decode_jwt(token: str) -> dict:
    try:
        import jwt  # PyJWT
        return jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except ImportError:
        h, p, s = token.split(".")
        if not hmac.compare_digest(_b64e(_sign((h + "." + p).encode())), s):
            raise ValueError("bad signature")
        return json.loads(_b64d(p))
    # other decode errors (expired, bad sig) propagate as Exception


class TokenError(Exception):
    pass


def make_token(user_id: int, role: str, token_use: str, ttl_seconds: int) -> dict:
    now = time.time()
    exp = now + ttl_seconds
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": token_use,
        "jti": uuid.uuid4().hex,
        "iat": int(now),
        "exp": int(exp),
    }
    return {"token": _encode_jwt(payload), "jti": payload["jti"], "exp": exp}


def make_access_token(user_id: int, role: str) -> dict:
    return make_token(user_id, role, "access", ACCESS_TOKEN_EXPIRE_MIN * 60)


def make_refresh_token(user_id: int, role: str) -> dict:
    return make_token(user_id, role, "refresh", REFRESH_TOKEN_EXPIRE_DAYS * 86400)


def decode_token(token: str) -> dict:
    try:
        payload = _decode_jwt(token)
    except Exception as exc:
        raise TokenError(f"invalid token: {exc}") from exc
    if is_revoked(payload.get("jti", "")):
        raise TokenError("token revoked")
    return payload
