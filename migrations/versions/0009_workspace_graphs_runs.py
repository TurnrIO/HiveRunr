"""Scope graph_workflows and runs to a workspace.

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-10

Changes:
  • graph_workflows — add workspace_id INT FK → workspaces(id) ON DELETE SET NULL
  • runs            — add workspace_id INT FK → workspaces(id) ON DELETE SET NULL
  • Backfill        — all existing rows are assigned to the "default" workspace.
  • Indexes         — workspace_id on both tables for fast per-workspace queries.

After this migration list_graphs() and list_runs() are workspace-aware; all
existing flows and runs continue to appear under the "default" workspace so
nothing is lost.
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    # ── graph_workflows.workspace_id ─────────────────────────────────────────
    op.execute(sa.text("""
        ALTER TABLE graph_workflows
        ADD COLUMN IF NOT EXISTS workspace_id INT
            REFERENCES workspaces(id) ON DELETE SET NULL
    """))
    op.execute(sa.text("""
        UPDATE graph_workflows
        SET workspace_id = (SELECT id FROM workspaces WHERE slug = 'default')
        WHERE workspace_id IS NULL
    """))
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS graph_workflows_workspace_idx
            ON graph_workflows (workspace_id)
    """))

    # ── runs.workspace_id ─────────────────────────────────────────────────────
    op.execute(sa.text("""
        ALTER TABLE runs
        ADD COLUMN IF NOT EXISTS workspace_id INT
            REFERENCES workspaces(id) ON DELETE SET NULL
    """))
    op.execute(sa.text("""
        UPDATE runs
        SET workspace_id = (SELECT id FROM workspaces WHERE slug = 'default')
        WHERE workspace_id IS NULL
    """))
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS runs_workspace_idx
            ON runs (workspace_id)
    """))


def downgrade():
    op.execute(sa.text("DROP INDEX IF EXISTS runs_workspace_idx"))
    op.execute(sa.text("ALTER TABLE runs DROP COLUMN IF EXISTS workspace_id"))
    op.execute(sa.text("DROP INDEX IF EXISTS graph_workflows_workspace_idx"))
    op.execute(sa.text("ALTER TABLE graph_workflows DROP COLUMN IF EXISTS workspace_id"))
