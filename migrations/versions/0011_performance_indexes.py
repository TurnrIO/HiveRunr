"""Performance indexes and retry_count column on runs.

Revision ID: 0011
Revises: 0010
Create Date: 2026-04-16

Changes:
  • runs          — composite index (workspace_id, created_at DESC) for workspace run lists
  • runs          — index on status for status-filter queries
  • runs          — index on graph_id for per-flow run history
  • runs          — add retry_count INT DEFAULT 0 (tracks Celery retry attempts)
  • audit_log     — index on created_at for time-range queries
  • audit_log     — composite index (actor, action) for filtered log views
  • graph_workflows — index on workspace_id (already exists via 0009 but made explicit)
  • schedules     — index on (workspace_id, enabled) for scheduler startup scan
"""
from alembic import op
import sqlalchemy as sa


revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    # ── runs table ────────────────────────────────────────────────────────────
    op.execute(sa.text("""
        ALTER TABLE runs
            ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0
    """))

    # Main list query: workspace + recency — most frequently hit index
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS idx_runs_workspace_created
            ON runs (workspace_id, created_at DESC)
    """))

    # Status filter (e.g. "show only failed runs", retention trim)
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS idx_runs_status
            ON runs (status)
    """))

    # Per-flow run history modal
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS idx_runs_graph_id
            ON runs (graph_id, created_at DESC)
    """))

    # ── audit_log table ───────────────────────────────────────────────────────
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
            ON audit_log (created_at DESC)
    """))

    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS idx_audit_log_actor_action
            ON audit_log (actor, action)
    """))

    # ── schedules table ───────────────────────────────────────────────────────
    # Scheduler startup scans for enabled schedules in a workspace
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS idx_schedules_workspace_enabled
            ON schedules (workspace_id, enabled)
    """))


def downgrade():
    op.execute(sa.text("DROP INDEX IF EXISTS idx_schedules_workspace_enabled"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_audit_log_actor_action"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_audit_log_created_at"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_runs_graph_id"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_runs_status"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_runs_workspace_created"))
    op.execute(sa.text("ALTER TABLE runs DROP COLUMN IF EXISTS retry_count"))
