"""Add priority column to graph_workflows.

Revision ID: 0015
Revises: 0014
"""
from alembic import op

revision      = "0015"
down_revision = "0014"
branch_labels = None
depends_on    = None


def upgrade():
    op.execute("""
        ALTER TABLE graph_workflows
        ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 5
    """)


def downgrade():
    op.execute("ALTER TABLE graph_workflows DROP COLUMN IF EXISTS priority")
