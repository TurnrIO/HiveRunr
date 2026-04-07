"""Add expires_at + scope columns to api_tokens.

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-07
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    # Add scope column (read | run | manage) — default 'manage' keeps all
    # existing tokens at full access so behaviour is unchanged on upgrade.
    op.execute(sa.text(
        "ALTER TABLE api_tokens "
        "ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'manage'"
    ))

    # Add optional expiry — NULL means "never expires" (backwards-compat).
    op.execute(sa.text(
        "ALTER TABLE api_tokens "
        "ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL"
    ))


def downgrade():
    op.execute(sa.text("ALTER TABLE api_tokens DROP COLUMN IF EXISTS expires_at"))
    op.execute(sa.text("ALTER TABLE api_tokens DROP COLUMN IF EXISTS scope"))
