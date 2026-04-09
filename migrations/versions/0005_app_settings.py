"""App-wide key/value settings table.

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-09

Changes:
  • app_settings — generic KV store for system configuration
    (used for run retention policy and future admin settings)
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS app_settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    """))


def downgrade():
    op.execute(sa.text("DROP TABLE IF EXISTS app_settings"))
