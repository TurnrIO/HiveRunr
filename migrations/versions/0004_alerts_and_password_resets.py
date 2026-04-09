"""Alerting + password reset token support.

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-09

Changes:
  • graph_workflows.alert_emails    — comma-separated recipient list (nullable)
  • graph_workflows.alert_webhook   — URL to POST JSON payload on run events (nullable)
  • graph_workflows.alert_on_success — also fire alert on successful runs (default FALSE)
  • password_resets table           — one-time tokens for owner forgot-password flow
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    # ── Per-flow alert configuration ──────────────────────────────────────────
    op.execute(sa.text(
        "ALTER TABLE graph_workflows "
        "ADD COLUMN IF NOT EXISTS alert_emails TEXT DEFAULT NULL"
    ))
    op.execute(sa.text(
        "ALTER TABLE graph_workflows "
        "ADD COLUMN IF NOT EXISTS alert_webhook TEXT DEFAULT NULL"
    ))
    op.execute(sa.text(
        "ALTER TABLE graph_workflows "
        "ADD COLUMN IF NOT EXISTS alert_on_success BOOLEAN DEFAULT FALSE"
    ))

    # ── Password reset tokens (owner forgot-password flow) ────────────────────
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS password_resets (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash TEXT UNIQUE NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            used       BOOLEAN DEFAULT FALSE
        )
    """))


def downgrade():
    op.execute(sa.text("DROP TABLE IF EXISTS password_resets"))
    op.execute(sa.text("ALTER TABLE graph_workflows DROP COLUMN IF EXISTS alert_on_success"))
    op.execute(sa.text("ALTER TABLE graph_workflows DROP COLUMN IF EXISTS alert_webhook"))
    op.execute(sa.text("ALTER TABLE graph_workflows DROP COLUMN IF EXISTS alert_emails"))
