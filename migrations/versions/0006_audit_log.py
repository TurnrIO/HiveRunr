"""Audit log table — records key admin/owner actions.

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-09

Changes:
  • audit_log — append-only event log for admin actions
    (actor, action, target_type, target_id, detail JSON, ip, created_at)
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id          BIGSERIAL PRIMARY KEY,
            actor       TEXT NOT NULL,
            action      TEXT NOT NULL,
            target_type TEXT,
            target_id   TEXT,
            detail      JSONB,
            ip          TEXT,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    """))
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC)
    """))
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor)
    """))


def downgrade():
    op.execute(sa.text("DROP TABLE IF EXISTS audit_log"))
