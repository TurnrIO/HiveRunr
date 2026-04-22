"""Approvals table for human-in-the-loop wait_for_approval node.

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-22

Changes:
  • approvals  — token, task_id, approver_email, status, timeout, timestamps
"""
from alembic import op
import sqlalchemy as sa

revision    = "0012"
down_revision = "0011"
branch_labels = None
depends_on  = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS approvals (
            id              SERIAL PRIMARY KEY,
            token           VARCHAR(64)  UNIQUE NOT NULL,
            task_id         VARCHAR(255) NOT NULL DEFAULT '',
            graph_name      VARCHAR(255) NOT NULL DEFAULT '',
            node_id         VARCHAR(255) NOT NULL DEFAULT '',
            approver_email  VARCHAR(255) NOT NULL,
            subject         VARCHAR(500) NOT NULL DEFAULT 'Action required: approval needed',
            message         TEXT         NOT NULL DEFAULT '',
            timeout_hours   INTEGER      NOT NULL DEFAULT 48,
            status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
            decision_note   TEXT,
            created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
            decided_at      TIMESTAMP
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_approvals_token    ON approvals (token)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_approvals_task_id  ON approvals (task_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_approvals_status   ON approvals (status)")


def downgrade():
    op.execute("DROP TABLE IF EXISTS approvals")
