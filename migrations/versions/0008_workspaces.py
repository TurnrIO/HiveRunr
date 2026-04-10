"""Workspace foundation — multi-tenant namespace layer.

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-10

Changes:
  • workspaces        — one row per team/organisation (id, name, slug, plan, created_at)
  • workspace_members — maps users → workspaces with a per-workspace role
  • Backfill          — a "default" workspace is created and every existing user is
                        added as a member with their current global role (owner → owner,
                        admin → admin, viewer → viewer).

No existing tables are altered in this sprint; resource scoping (graphs, runs, etc.)
is handled in W2/W3.  The app continues to behave identically — the workspace tables
just sit idle until the middleware layer is wired in during W2.
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    # ── workspaces ────────────────────────────────────────────────────────────
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS workspaces (
            id          SERIAL PRIMARY KEY,
            name        TEXT NOT NULL,
            slug        TEXT NOT NULL UNIQUE,
            plan        TEXT NOT NULL DEFAULT 'free',
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
    """))
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS workspaces_slug_idx ON workspaces (slug)
    """))

    # ── workspace_members ─────────────────────────────────────────────────────
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS workspace_members (
            id              SERIAL PRIMARY KEY,
            workspace_id    INT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role            TEXT NOT NULL DEFAULT 'viewer'
                                CHECK (role IN ('owner','admin','viewer')),
            joined_at       TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (workspace_id, user_id)
        )
    """))
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS workspace_members_user_idx
            ON workspace_members (user_id)
    """))
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS workspace_members_workspace_idx
            ON workspace_members (workspace_id)
    """))

    # ── Backfill: create "default" workspace and add all existing users ────────
    op.execute(sa.text("""
        INSERT INTO workspaces (name, slug, plan, created_at, updated_at)
        VALUES ('Default', 'default', 'free', NOW(), NOW())
        ON CONFLICT (slug) DO NOTHING
    """))
    # Add every existing user as a member of the default workspace,
    # preserving their current global role.
    op.execute(sa.text("""
        INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
        SELECT
            (SELECT id FROM workspaces WHERE slug = 'default'),
            u.id,
            CASE
                WHEN u.role = 'owner' THEN 'owner'
                WHEN u.role = 'admin' THEN 'admin'
                ELSE 'viewer'
            END,
            NOW()
        FROM users u
        ON CONFLICT (workspace_id, user_id) DO NOTHING
    """))


def downgrade():
    op.execute(sa.text("DROP TABLE IF EXISTS workspace_members"))
    op.execute(sa.text("DROP TABLE IF EXISTS workspaces"))
