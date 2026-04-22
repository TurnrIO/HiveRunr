"""Add note column to runs table.

Revision ID: 0014
Revises: 0013
"""
from alembic import op

revision      = "0014"
down_revision = "0013"
branch_labels = None
depends_on    = None


def upgrade():
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS note TEXT")


def downgrade():
    op.execute("ALTER TABLE runs DROP COLUMN IF EXISTS note")
