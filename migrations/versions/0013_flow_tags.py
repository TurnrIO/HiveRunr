"""Add tags array column to graph_workflows.

Revision ID: 0013
Revises: 0012
"""
from alembic import op
import sqlalchemy as sa

revision    = "0013"
down_revision = "0012"
branch_labels = None
depends_on    = None


def upgrade():
    op.execute("""
        ALTER TABLE graph_workflows
        ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_graph_workflows_tags
        ON graph_workflows USING GIN (tags)
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_graph_workflows_tags")
    op.execute("ALTER TABLE graph_workflows DROP COLUMN IF EXISTS tags")
