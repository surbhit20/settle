"""Shared paths and settings for pipeline scripts.

Environment variables come from the repo-root `.env.local` (same file the Next.js app uses).
"""

import os
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "data" / "raw"  # cached raw API responses and downloads; build from here

load_dotenv(REPO_ROOT / ".env.local")

# The five v1 counties, keyed by 5-digit county FIPS code (state 06 = California).
COUNTIES: dict[str, str] = {
    "06075": "San Francisco",
    "06081": "San Mateo",
    "06085": "Santa Clara",
    "06001": "Alameda",
    "06013": "Contra Costa",
}


def require_env(name: str) -> str:
    """Return an environment variable or fail with a clear message."""
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is not set. Copy .env.example to .env.local and fill it in.")
    return value
