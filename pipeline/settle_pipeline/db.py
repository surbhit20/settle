"""Postgres connection helper for pipeline scripts."""

import psycopg

from settle_pipeline.config import require_env


def connect() -> psycopg.Connection:
    """Open a connection using DATABASE_URL from .env.local."""
    return psycopg.connect(require_env("DATABASE_URL"))
