"""In-memory token-bucket rate limiter for auth endpoints (per client IP)."""
import time

from fastapi import HTTPException, Request

# bucket key -> (tokens, last_refill)
_buckets: dict[str, list] = {}

CAPACITY = 10          # requests
REFILL_PER_SEC = 10 / 60  # 10 requests per minute


def check_auth_rate(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    key = f"auth:{ip}"
    now = time.time()
    bucket = _buckets.get(key)
    if bucket is None:
        bucket = [CAPACITY - 1, now]
        _buckets[key] = bucket
        return
    tokens, last = bucket
    tokens = min(CAPACITY, tokens + (now - last) * REFILL_PER_SEC)
    if tokens < 1:
        raise HTTPException(429, "Too many auth attempts — retry in a minute")
    bucket[0] = tokens - 1
    bucket[1] = now
