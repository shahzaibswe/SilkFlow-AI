"""Central configuration & path helpers for the SilkFlow API package."""
import os
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]          # silkflow/api
ROOT_DIR = API_DIR.parent                              # silkflow/
UPLOAD_DIR = API_DIR / "uploads"
DB_PATH = API_DIR / "silkflow.db"
DEPLOYMENT_FILE = ROOT_DIR / "contracts" / "deployments" / "latest.json"

VERSION = "1.0.0"


def load_env() -> None:
    """Load .env from repo root or api dir (repo root wins)."""
    try:
        from dotenv import load_dotenv
        for candidate in (ROOT_DIR / ".env", API_DIR / ".env"):
            if candidate.exists():
                load_dotenv(candidate, override=False)
    except ImportError:
        pass


load_env()

SECRET_KEY = os.getenv("SECRET_KEY", "silkflow-dev-secret-change-me")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "silkflow-demo")
ACCESS_TOKEN_EXPIRE_MIN = int(os.getenv("ACCESS_TOKEN_EXPIRE_MIN", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = 7
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
