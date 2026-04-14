"""Scope credentials, schedules, and api_tokens to a workspace.

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-10

Changes:
  • credentials  — add workspace_id INT FK → workspaces(id) ON DELETE SET NULL
  • schedules    — add workspace_id INT FK → workspaces(id) ON DELETE SET NULL
  • api_tokens   — add workspace_id INT FK → workspaces(id) ON DELETE SET NULL
  • Backfill     — all existing rows assigned to the "default" workspace.
  • Indexes      — workspace_id on all three tables.

After this migration credentials/schedules/tokens are workspace-isolated.
The executor uses workspace-scoped credentials so graphs in one workspace
cannot accidentally access secrets from another.
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

_TABLES = ("credentials", "schedules", "api_tokens")


def upgrade():
    for table in _TABLES:
        op.execute(sa.text(f"""
            ALTER TABLE {table}
            ADD COLUMN IF NOT EXISTS workspace_id INT
                REFERENCES workspaces(id) ON DELETE SET NULL
        """))
        op.execute(sa.text(f"""
            UPDATE {table}
            SET workspace_id = (SELECT id FROM workspaces WHERE slug = 'default')
            WHERE workspace_id IS NULL
        """))
        op.execute(sa.text(f"""
            CREATE INDEX IF NOT EXISTS {table}_workspace_idx
                ON {table} (workspace_id)
        """))


def downgrade():
    for table in reversed(_TABLES):
        op.execute(sa.text(f"DROP INDEX IF EXISTS {table}_workspace_idx"))
        op.execute(sa.text(f"ALTER TABLE {table} DROP COLUMN IF EXISTS workspace_id"))
