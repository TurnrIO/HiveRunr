"""Per-flow access control and invite tokens.

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-10

Changes:
  • flow_permissions — maps (user_id, graph_id) → role (viewer/runner/editor)
  • invite_tokens    — one-time email invite links scoped to a flow + role
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS flow_permissions (
            id          SERIAL PRIMARY KEY,
            user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            graph_id    INT NOT NULL REFERENCES graph_workflows(id) ON DELETE CASCADE,
            role        TEXT NOT NULL CHECK (role IN ('viewer','runner','editor')),
            granted_by  INT REFERENCES users(id) ON DELETE SET NULL,
            granted_at  TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (user_id, graph_id)
        )
    """))
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS flow_permissions_graph_idx
            ON flow_permissions (graph_id)
    """))
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS flow_permissions_user_idx
            ON flow_permissions (user_id)
    """))
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS invite_tokens (
            id          SERIAL PRIMARY KEY,
            token_hash  TEXT NOT NULL UNIQUE,
            email       TEXT NOT NULL,
            graph_id    INT REFERENCES graph_workflows(id) ON DELETE CASCADE,
            role        TEXT NOT NULL DEFAULT 'viewer'
                            CHECK (role IN ('viewer','runner','editor')),
            invited_by  INT REFERENCES users(id) ON DELETE SET NULL,
            expires_at  TIMESTAMPTZ NOT NULL,
            used_at     TIMESTAMPTZ
        )
    """))
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS invite_tokens_email_idx ON invite_tokens (email)
    """))


def downgrade():
    op.execute(sa.text("DROP TABLE IF EXISTS invite_tokens"))
    op.execute(sa.text("DROP TABLE IF EXISTS flow_permissions"))
