"""Add alert_min_failures column to graph_workflows.

Revision ID: 0017
Revises: 0016
"""
from alembic import op

revision      = "0017"
down_revision = "0016"
branch_labels = None
depends_on    = None


def upgrade():
    op.execute("""
        ALTER TABLE graph_workflows
        ADD COLUMN IF NOT EXISTS alert_min_failures INTEGER NOT NULL DEFAULT 1
    """)


def downgrade():
    op.execute("ALTER TABLE graph_workflows DROP COLUMN IF EXISTS alert_min_failures")
