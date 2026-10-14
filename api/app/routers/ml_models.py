"""Model registry endpoints: versions, metrics, retrain trigger."""
import time

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_roles
from ..models import ModelVersion, User
from ..schemas import RetrainReq, iso
from ..services import ml_bridge
from ..services.audit_service import append_audit

router = APIRouter(prefix="/models", tags=["models"])


@router.get("")
def list_models(user: User = Depends(require_roles("reviewer", "admin")),
                db: Session = Depends(get_db)):
    rows = db.query(ModelVersion).order_by(ModelVersion.id.desc()).all()
    return {"models": [{"id": m.id, "version": m.version, "trained_on": m.trained_on,
                        "is_active": bool(m.is_active), "metrics": m.metrics_json or {},
                        "created_at": iso(m.created_at)} for m in rows],
            "ml_service_available": ml_bridge.ML_AVAILABLE}


@router.post("/retrain")
def retrain(req: RetrainReq, user: User = Depends(require_roles("admin")),
            db: Session = Depends(get_db)):
    result = ml_bridge.retrain(req.dataset_ref)
    db.query(ModelVersion).update({"is_active": 0})
    mv = ModelVersion(version=result.get("model_version", "unknown"),
                      trained_on=req.dataset_ref or "synthetic_trades.csv",
                      metrics_json=result.get("metrics", {}), is_active=1)
    db.add(mv)
    db.flush()
    append_audit(db, order_id=None, action="model_retrained", actor=f"user:{user.id}",
                 data={"job_id": result.get("job_id"),
                       "model_version": mv.version, "metrics": mv.metrics_json})
    db.commit()
    return {"job_id": result.get("job_id"), "status": result.get("status"),
            "model_version": mv.version, "metrics": mv.metrics_json, "id": mv.id}


def register_active_model(db: Session, version: str, metrics: dict) -> None:
    """Called at seed/startup so /models is never empty."""
    if db.query(ModelVersion).filter(ModelVersion.version == version).first():
        return
    db.add(ModelVersion(version=version, trained_on="synthetic_trades.csv",
                        metrics_json=metrics, is_active=1))
    db.commit()
