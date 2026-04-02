"""Initial schema — all tables for HiveRunr v12

Revision ID: 0001
Revises:
Create Date: 2026-04-02

This migration is idempotent (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
so it is safe to apply against a database that was created by the legacy
init_db() function in app/core/db.py.
"""
from typing import Sequence, Union
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── runs ─────────────────────────────────────────────────────────────────
    conn.execute(op.inline_literal("""
        CREATE TABLE IF NOT EXISTS runs (
            id              SERIAL PRIMARY KEY,
            task_id         TEXT,
            graph_id        INTEGER,
            workflow        TEXT,
            status          TEXT DEFAULT 'queued',
            result          JSONB DEFAULT '{}',
            traces          JSONB DEFAULT '[]',
            initial_payload JSONB DEFAULT '{}',
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
    """))
    for col, defn in [
        ("result",          "JSONB DEFAULT '{}'"),
        ("traces",          "JSONB DEFAULT '[]'"),
        ("initial_payload", "JSONB DEFAULT '{}'"),
        ("created_at",      "TIMESTAMPTZ DEFAULT NOW()"),
        ("updated_at",      "TIMESTAMPTZ DEFAULT NOW()"),
    ]:
        conn.execute(op.inline_literal(
            f"ALTER TABLE runs ADD COLUMN IF NOT EXISTS {col} {defn}"
        ))

    # ── workflows ─────────────────────────────────────────────────────────────
    conn.execute(op.inline_literal("""
        CREATE TABLE IF NOT EXISTS workflows (
            id      SERIAL PRIMARY KEY,
            name    TEXT UNIQUE NOT NULL,
            enabled BOOLEAN DEFAULT TRUE
        )
    """))

    # ── schedules ────────────────────────────────────────────────────────────
    conn.execute(op.inline_literal("""
        CREATE TABLE IF NOT EXISTS schedules (
            id       SERIAL PRIMARY KEY,
            name     TEXT NOT NULL,
            workflow TEXT,
            graph_id INTEGER,
            cron     TEXT NOT NULL,
            payload  JSONB DEFAULT '{}',
            timezone TEXT DEFAULT 'UTC',
            enabled  BOOLEAN DEFAULT TRUE
        )
    """))

    # ── graph_workflows ───────────────────────────────────────────────────────
    conn.execute(op.inline_literal("""
        CREATE TABLE IF NOT EXISTS graph_workflows (
            id            SERIAL PRIMARY KEY,
            name          TEXT NOT NULL,
            description   TEXT DEFAULT '',
            graph_json    TEXT DEFAULT '{}',
            enabled       BOOLEAN DEFAULT TRUE,
            webhook_token TEXT DEFAULT md5(random()::text),
            slug          VARCHAR(12) UNIQUE,
            created_at    TIMESTAMPTZ DEFAULT NOW(),
            updated_at    TIMESTAMPTZ DEFAULT NOW()
        )
    """))
    for col, defn in [
        ("description",  "TEXT DEFAULT ''"),
        ("graph_json",   "TEXT DEFAULT '{}'"),
        ("enabled",      "BOOLEAN DEFAULT TRUE"),
        ("webhook_token","TEXT DEFAULT md5(random()::text)"),
        ("created_at",   "TIMESTAMPTZ DEFAULT NOW()"),
        ("updated_at",   "TIMESTAMPTZ DEFAULT NOW()"),
    ]:
        conn.execute(op.inline_literal(
            f"ALTER TABLE graph_workflows ADD COLUMN IF NOT EXISTS {col} {defn}"
        ))
    # slug column + backfill
    conn.execute(op.inline_literal(
        "ALTER TABLE graph_workflows ADD COLUMN IF NOT EXISTS slug VARCHAR(12) UNIQUE"
    ))
    conn.execute(op.inline_literal("""
        UPDATE graph_workflows
        SET slug = substr(md5(random()::text), 1, 8)
        WHERE slug IS NULL
    """))

    # ── credentials ───────────────────────────────────────────────────────────
    conn.execute(op.inline_literal("""
        CREATE TABLE IF NOT EXISTS credentials (
            id         SERIAL PRIMARY KEY,
            name       TEXT UNIQUE NOT NULL,
            type       TEXT DEFAULT 'generic',
            secret     TEXT NOT NULL,
            note       TEXT DEFAULT '',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    """))

    # ── graph_versions ────────────────────────────────────────────────────────
    conn.execute(op.inline_literal("""
        CREATE TABLE IF NOT EXISTS graph_versions (
            id         SERIAL PRIMARY KEY,
            graph_id   INTEGER NOT NULL,
            version    INTEGER NOT NULL,
            name       TEXT NOT NULL,
            graph_json TEXT NOT NULL,
            note       TEXT DEFAULT '',
            saved_at   TIMESTAMPTZ DEFAULT NOW()
        )
    """))

    # ── users ─────────────────────────────────────────────────────────────────
    conn.execute(op.inline_literal("""
        CREATE TABLE IF NOT EXISTS users (
            id            SERIAL PRIMARY KEY,
            username      TEXT UNIQUE NOT NULL,
            email         TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role          TEXT DEFAULT 'owner',
            created_at    TIMESTAMPTZ DEFAULT NOW(),
            updated_at    TIMESTAMPTZ DEFAULT NOW()
        )
    """))

    # ── sessions ──────────────────────────────────────────────────────────────
    conn.execute(op.inline_literal("""
        CREATE TABLE IF NOT EXISTS sessions (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash TEXT UNIQUE NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            last_seen  TIMESTAMPTZ DEFAULT NOW(),
            expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
        )
    """))

    # ── api_tokens ────────────────────────────────────────────────────────────
    conn.execute(op.inline_literal("""
        CREATE TABLE IF NOT EXISTS api_tokens (
            id         SERIAL PRIMARY KEY,
            name       TEXT NOT NULL,
            token_hash TEXT UNIQUE NOT NULL,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            last_used  TIMESTAMPTZ
        )
    """))


def downgrade() -> None:
    conn = op.get_bind()
    # Drop in reverse dependency order
    for table in (
        "api_tokens", "sessions", "users",
        "graph_versions", "credentials",
        "graph_workflows", "schedules", "workflows", "runs",
    ):
        conn.execute(op.inline_literal(f"DROP TABLE IF EXISTS {table} CASCADE"))
