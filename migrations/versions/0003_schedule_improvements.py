"""Schedule improvements — one-shot run_at support.

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-08

Changes:
  • schedules.cron  — drop NOT NULL constraint so one-shot rows can have cron=NULL
  • schedules.run_at — add nullable TIMESTAMPTZ for "run once at" scheduling
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    # Allow cron to be NULL (one-shot schedules have no cron expression)
    op.execute(sa.text(
        "ALTER TABLE schedules ALTER COLUMN cron DROP NOT NULL"
    ))

    # Add run_at column for one-shot scheduling — NULL means recurring (cron-based)
    op.execute(sa.text(
        "ALTER TABLE schedules "
        "ADD COLUMN IF NOT EXISTS run_at TIMESTAMPTZ DEFAULT NULL"
    ))


def downgrade():
    op.execute(sa.text("ALTER TABLE schedules DROP COLUMN IF EXISTS run_at"))
    op.execute(sa.text(
        "ALTER TABLE schedules ALTER COLUMN cron SET NOT NULL"
    ))
