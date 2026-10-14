"""SilkFlow AI backend (FastAPI). Run from api/: uvicorn app.main:app --port 8000"""
import logging
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from . import seed as seed_module
from .config import VERSION
from .db import Base, SessionLocal, engine
from .routers import (admin, agent, audit, auth, businesses, disputes, escrow,
                      finance, fx, ml_models, orders, stats, webhooks)
from .serializers import order_brief
from .services import chain, ml_bridge, policy
from .services.audit_service import verify_chain

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s: %(message)s")
log = logging.getLogger("silkflow.main")

app = FastAPI(title="SilkFlow AI API", version=VERSION,
              description="AI agent for cross-border trade finance: explainable "
                          "scoring, on-chain escrow, policy-limited settlement.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth.router, businesses.router, orders.router, escrow.router,
          agent.router, disputes.router, fx.router, audit.router,
          webhooks.router, admin.router, ml_models.router,
          stats.router, finance.router):
    app.include_router(r, prefix="/api")


@app.middleware("http")
async def request_logging(request: Request, call_next):
    t0 = time.time()
    response = await call_next(request)
    ms = (time.time() - t0) * 1000
    if request.url.path.startswith("/api"):
        log.info("%s %s -> %s (%.0f ms)", request.method, request.url.path,
                 response.status_code, ms)
    return response


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(engine)
    chain.init()
    db = SessionLocal()
    try:
        if seed_module.seed(db):
            log.info("demo data seeded (users, businesses, 6 orders) — password: %s",
                     seed_module.DEMO_PASSWORD)
        s = policy.get_settings(db)
        log.info("agent state=%s chain=%s ml_service=%s auto_release_limit=%s",
                 "paused" if s["kill_switch"] else "active",
                 chain.status()["mode"],
                 "real" if ml_bridge.ML_AVAILABLE else "fallback",
                 s["auto_release_limit"])
    finally:
        db.close()


@app.get("/api/health")
def health():
    db = SessionLocal()
    try:
        from .models import AuditEntry
        audit_ok = verify_chain(db)["valid"] if db.query(AuditEntry).first() else True
    finally:
        db.close()
    return {"status": "ok", "chain": chain.status()["mode"],
            "models_loaded": ml_bridge.ML_AVAILABLE, "audit_valid": audit_ok,
            "version": VERSION}
