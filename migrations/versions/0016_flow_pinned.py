"""Add pinned column to graph_workflows.

Revision ID: 0016
Revises: 0015
"""
from alembic import op

revision      = "0016"
down_revision = "0015"
branch_labels = None
depends_on    = None


def upgrade():
    op.execute("""
        ALTER TABLE graph_workflows
        ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false
    """)


def downgrade():
    op.execute("ALTER TABLE graph_workflows DROP COLUMN IF EXISTS pinned")
