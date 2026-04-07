"""Database layer — v12
New: credentials vault, graph version history, node traces + initial_payload in runs.
Schema management is now handled by Alembic (see migrations/).
"""
import os, json, logging
from contextlib import contextmanager
import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)
DSN = os.environ.get("DATABASE_URL", "postgresql://hiverunr:hiverunr@db:5432/hiverunr")

@contextmanager
def get_conn():
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    try:
        yield conn
    finally:
        conn.close()

psycopg2.extras.register_uuid()

def run_migrations() -> None:
    """Apply all pending Alembic migrations (runs `alembic upgrade head`).

    Called at startup from main.py, worker.py, and scheduler.py in place of
    the legacy init_db().  Safe to call concurrently — Alembic's migration
    lock prevents duplicate execution.

    Falls back to the legacy CREATE TABLE IF NOT EXISTS approach if alembic is
    not installed or alembic.ini cannot be found (e.g. image not yet rebuilt).
    """
    import os as _os
    try:
        from alembic.config import Config as _Cfg
        from alembic import command as _cmd
    except ImportError:
        log.warning("alembic not installed — falling back to legacy init_db")
        _init_db_legacy()
        return

    # Resolve alembic.ini: try CWD first (Docker WORKDIR /app), then relative
    # to this file (two levels up = repo root)
    _here = _os.path.dirname(_os.path.abspath(__file__))
    _candidates = [
        _os.path.join(_os.getcwd(), "alembic.ini"),
        _os.path.join(_here, "..", "..", "alembic.ini"),
    ]
    _ini = next((p for p in _candidates if _os.path.isfile(p)), None)
    if _ini is None:
        log.warning("alembic.ini not found — falling back to legacy init_db")
        _init_db_legacy()
        return

    cfg = _Cfg(_ini)
    # Always override with the live DATABASE_URL so Docker env vars take effect
    cfg.set_main_option("sqlalchemy.url", DSN)
    _cmd.upgrade(cfg, "head")


def init_db():
    """Legacy wrapper — calls run_migrations().  Kept for back-compat."""
    run_migrations()


def _init_db_legacy():
    """Original CREATE TABLE IF NOT EXISTS implementation — kept for reference only."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                id              SERIAL PRIMARY KEY,
                task_id         TEXT,
                graph_id        INTEGER,
                workflow        TEXT,
                status          TEXT DEFAULT 'queued',
                result          JSONB DEFAULT '{}',
                traces          JSONB DEFAULT '[]',
                initial_payload JSONB DEFAULT '{}',
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                updated_at      TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        # idempotent column additions for upgrades from any prior version
        for col, defn in [
            ("result",          "JSONB DEFAULT '{}'"),
            ("traces",          "JSONB DEFAULT '[]'"),
            ("initial_payload", "JSONB DEFAULT '{}'"),
            ("created_at",      "TIMESTAMPTZ DEFAULT NOW()"),
            ("updated_at",      "TIMESTAMPTZ DEFAULT NOW()"),
        ]:
            cur.execute(f"ALTER TABLE runs ADD COLUMN IF NOT EXISTS {col} {defn}")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS workflows (
                id      SERIAL PRIMARY KEY,
                name    TEXT UNIQUE NOT NULL,
                enabled BOOLEAN DEFAULT TRUE
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS schedules (
                id       SERIAL PRIMARY KEY,
                name     TEXT NOT NULL,
                workflow TEXT,
                graph_id INTEGER,
                cron     TEXT NOT NULL,
                payload  JSONB DEFAULT '{}',
                timezone TEXT DEFAULT 'UTC',
                enabled  BOOLEAN DEFAULT TRUE
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS graph_workflows (
                id            SERIAL PRIMARY KEY,
                name          TEXT NOT NULL,
                description   TEXT DEFAULT '',
                graph_json    TEXT DEFAULT '{}',
                enabled       BOOLEAN DEFAULT TRUE,
                webhook_token TEXT DEFAULT md5(random()::text),
                slug          VARCHAR(12) UNIQUE,
                created_at    TIMESTAMPTZ DEFAULT NOW(),
                updated_at    TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        # ── v7 new tables ──────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS credentials (
                id         SERIAL PRIMARY KEY,
                name       TEXT UNIQUE NOT NULL,
                type       TEXT DEFAULT 'generic',
                secret     TEXT NOT NULL,
                note       TEXT DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS graph_versions (
                id         SERIAL PRIMARY KEY,
                graph_id   INTEGER NOT NULL,
                version    INTEGER NOT NULL,
                name       TEXT NOT NULL,
                graph_json TEXT NOT NULL,
                note       TEXT DEFAULT '',
                saved_at   TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        # ── graph_workflows column migrations (idempotent for older installs)
        for col, defn in [
            ("description",   "TEXT DEFAULT ''"),
            ("graph_json",     "TEXT DEFAULT '{}'"),
            ("enabled",        "BOOLEAN DEFAULT TRUE"),
            ("webhook_token",  "TEXT DEFAULT md5(random()::text)"),
            ("created_at",     "TIMESTAMPTZ DEFAULT NOW()"),
            ("updated_at",     "TIMESTAMPTZ DEFAULT NOW()"),
        ]:
            cur.execute(f"ALTER TABLE graph_workflows ADD COLUMN IF NOT EXISTS {col} {defn}")
        # ── slug migration: add column + backfill existing rows ────────
        cur.execute("ALTER TABLE graph_workflows ADD COLUMN IF NOT EXISTS slug VARCHAR(12) UNIQUE")
        cur.execute("SELECT id FROM graph_workflows WHERE slug IS NULL")
        rows_needing_slug = cur.fetchall()
        if rows_needing_slug:
            import secrets as _sec
            for (rid,) in rows_needing_slug:
                while True:
                    candidate = _sec.token_hex(4)
                    cur.execute("SELECT 1 FROM graph_workflows WHERE slug=%s", (candidate,))
                    if not cur.fetchone():
                        break
                cur.execute("UPDATE graph_workflows SET slug=%s WHERE id=%s", (candidate, rid))

        # ── users + sessions (v12 auth) ────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id            SERIAL PRIMARY KEY,
                username      TEXT UNIQUE NOT NULL,
                email         TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role          TEXT DEFAULT 'owner',
                created_at    TIMESTAMPTZ DEFAULT NOW(),
                updated_at    TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id         SERIAL PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash TEXT UNIQUE NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                last_seen  TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS api_tokens (
                id         SERIAL PRIMARY KEY,
                name       TEXT NOT NULL,
                token_hash TEXT UNIQUE NOT NULL,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                last_used  TIMESTAMPTZ,
                scope      TEXT NOT NULL DEFAULT 'manage',
                expires_at TIMESTAMPTZ DEFAULT NULL
            )
        """)

# ── runs ──────────────────────────────────────────────────────────────────
def list_runs(page: int = 1, page_size: int = 50,
              status: str = None, flow_id: int = None, q: str = None):
    """Return a page of runs with optional filtering.

    Args:
        page:      1-based page number.
        page_size: rows per page (max 200).
        status:    filter to a single status string (e.g. "failed").
        flow_id:   filter to a specific graph_workflows.id.
        q:         case-insensitive substring match on flow name or task_id.

    Returns:
        dict with keys: runs (list), total (int), page (int), pages (int).
    """
    page      = max(1, int(page))
    page_size = max(1, min(200, int(page_size)))
    offset    = (page - 1) * page_size

    conditions = []
    params: list = []

    if status:
        conditions.append("r.status = %s")
        params.append(status)
    if flow_id:
        conditions.append("r.graph_id = %s")
        params.append(int(flow_id))
    if q:
        conditions.append(
            "(COALESCE(g.name, r.workflow) ILIKE %s OR r.task_id ILIKE %s OR CAST(r.id AS TEXT) = %s)"
        )
        like = f"%{q}%"
        params.extend([like, like, q.strip()])

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    base_query = f"""
        FROM runs r
        LEFT JOIN graph_workflows g ON r.graph_id = g.id
        {where}
    """

    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute(f"SELECT COUNT(*) {base_query}", params)
        total = cur.fetchone()[0]

        cur.execute(
            f"""SELECT r.*, COALESCE(g.name, r.workflow) AS flow_name
                {base_query}
                ORDER BY r.id DESC
                LIMIT %s OFFSET %s""",
            params + [page_size, offset],
        )
        runs = [dict(r) for r in cur.fetchall()]

    pages = max(1, (total + page_size - 1) // page_size)
    return {"runs": runs, "total": total, "page": page, "pages": pages}

def get_run_by_task(task_id):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM runs WHERE task_id=%s", (task_id,))
        row = cur.fetchone()
        return dict(row) if row else None

def update_run(task_id, status, result=None, traces=None):
    with get_conn() as conn:
        conn.cursor().execute(
            "UPDATE runs SET status=%s, result=%s, traces=%s, updated_at=NOW() WHERE task_id=%s",
            (status, json.dumps(result or {}), json.dumps(traces or []), task_id)
        )

def delete_run(run_id):
    with get_conn() as conn:
        conn.cursor().execute("DELETE FROM runs WHERE id=%s", (run_id,))

def clear_runs():
    with get_conn() as conn:
        conn.cursor().execute("DELETE FROM runs")

# ── workflows ─────────────────────────────────────────────────────────────
def list_workflows():
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM workflows ORDER BY id")
        return [dict(r) for r in cur.fetchall()]

def upsert_workflow(name):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "INSERT INTO workflows(name) VALUES(%s) ON CONFLICT(name) DO NOTHING RETURNING *",
            (name,)
        )
        row = cur.fetchone()
        if not row:
            cur.execute("SELECT * FROM workflows WHERE name=%s", (name,))
            row = cur.fetchone()
        return dict(row) if row else None

def toggle_workflow(name):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("UPDATE workflows SET enabled=NOT enabled WHERE name=%s RETURNING *", (name,))
        row = cur.fetchone()
        return dict(row) if row else None

# ── schedules ─────────────────────────────────────────────────────────────
def list_schedules():
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM schedules ORDER BY id")
        return [dict(r) for r in cur.fetchall()]

def create_schedule(name, workflow=None, graph_id=None, cron="0 * * * *", payload=None, timezone="UTC"):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "INSERT INTO schedules(name,workflow,graph_id,cron,payload,timezone) VALUES(%s,%s,%s,%s,%s,%s) RETURNING *",
            (name, workflow, graph_id, cron, json.dumps(payload or {}), timezone)
        )
        return dict(cur.fetchone())

def toggle_schedule(sid):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("UPDATE schedules SET enabled=NOT enabled WHERE id=%s RETURNING *", (sid,))
        row = cur.fetchone()
        return dict(row) if row else None

def delete_schedule(sid):
    with get_conn() as conn:
        conn.cursor().execute("DELETE FROM schedules WHERE id=%s", (sid,))

def sync_graph_schedules(graph_id: int, cron_nodes: list):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM schedules WHERE graph_id=%s", (graph_id,))
        for node in cron_nodes:
            cfg  = node.get('data', {}).get('config', {})
            cron = (cfg.get('cron') or '0 9 * * *').strip()
            tz   = (cfg.get('timezone') or 'UTC').strip() or 'UTC'
            name = (node.get('data', {}).get('label') or 'Cron Trigger').strip()
            cur.execute(
                "INSERT INTO schedules(name,graph_id,cron,timezone,payload,enabled) VALUES(%s,%s,%s,%s,%s,%s)",
                (name, graph_id, cron, tz, json.dumps({}), True)
            )

# ── graph_workflows ───────────────────────────────────────────────────────
def list_graphs():
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM graph_workflows ORDER BY id")
        return [dict(r) for r in cur.fetchall()]

def create_graph(name, description, graph_json):
    import secrets as _sec
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # Generate a unique 8-char hex slug
        while True:
            slug = _sec.token_hex(4)
            cur.execute("SELECT 1 FROM graph_workflows WHERE slug=%s", (slug,))
            if not cur.fetchone():
                break
        cur.execute(
            "INSERT INTO graph_workflows(name,description,graph_json,slug) VALUES(%s,%s,%s,%s) RETURNING *",
            (name, description, graph_json, slug)
        )
        return dict(cur.fetchone())

def get_graph(graph_id):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM graph_workflows WHERE id=%s", (graph_id,))
        row = cur.fetchone()
        return dict(row) if row else None

def get_graph_by_slug(slug):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM graph_workflows WHERE slug=%s", (slug,))
        row = cur.fetchone()
        return dict(row) if row else None

def get_graph_by_name(name):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM graph_workflows WHERE name=%s", (name,))
        row = cur.fetchone()
        return dict(row) if row else None

def get_graph_by_token(token):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM graph_workflows WHERE webhook_token=%s", (token,))
        row = cur.fetchone()
        return dict(row) if row else None

def update_graph(graph_id, name=None, description=None, graph_json=None, enabled=None):
    with get_conn() as conn:
        cur = conn.cursor()
        if name        is not None: cur.execute("UPDATE graph_workflows SET name=%s,        updated_at=NOW() WHERE id=%s", (name,        graph_id))
        if description is not None: cur.execute("UPDATE graph_workflows SET description=%s, updated_at=NOW() WHERE id=%s", (description, graph_id))
        if graph_json  is not None: cur.execute("UPDATE graph_workflows SET graph_json=%s,  updated_at=NOW() WHERE id=%s", (graph_json,  graph_id))
        if enabled     is not None: cur.execute("UPDATE graph_workflows SET enabled=%s,      updated_at=NOW() WHERE id=%s", (enabled,     graph_id))

def duplicate_graph(graph_id: int) -> dict:
    """Clone a graph, appending ' (copy)' to the name and generating a fresh slug."""
    src = get_graph(graph_id)
    if not src:
        raise ValueError(f"Graph {graph_id} not found")
    import re as _re
    base = _re.sub(r'\s*\(copy(?:\s+\d+)?\)\s*$', '', src['name']).strip()
    # Find a unique name: "Name (copy)", "Name (copy 2)", …
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        candidate = f"{base} (copy)"
        cur.execute("SELECT 1 FROM graph_workflows WHERE name=%s", (candidate,))
        n = 2
        while cur.fetchone():
            candidate = f"{base} (copy {n})"
            cur.execute("SELECT 1 FROM graph_workflows WHERE name=%s", (candidate,))
            n += 1
    return create_graph(candidate, src.get('description', ''), src.get('graph_json') or '{}')


def delete_graph(graph_id):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM schedules      WHERE graph_id=%s", (graph_id,))
        cur.execute("DELETE FROM graph_versions WHERE graph_id=%s", (graph_id,))
        cur.execute("DELETE FROM graph_workflows WHERE id=%s",      (graph_id,))

# ── credentials ───────────────────────────────────────────────────────────
def list_credentials():
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # never return secret values in the list
        cur.execute("SELECT id, name, type, note, created_at, updated_at FROM credentials ORDER BY name")
        return [dict(r) for r in cur.fetchall()]

def get_credential_secret(name):
    """Fetch the decrypted secret for a named credential. Used by executor only."""
    from app.crypto import decrypt
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT secret FROM credentials WHERE name=%s", (name,))
        row = cur.fetchone()
        if row is None:
            return None
        return decrypt(row['secret'])

def load_all_credentials():
    """Return name→decrypted-secret mapping. Called once per graph run."""
    from app.crypto import decrypt
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT name, secret FROM credentials")
        return {r['name']: decrypt(r['secret']) for r in cur.fetchall()}

def upsert_credential(name, type_, secret, note=""):
    from app.crypto import encrypt
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            INSERT INTO credentials(name, type, secret, note)
            VALUES(%s, %s, %s, %s)
            ON CONFLICT(name) DO UPDATE
              SET type=EXCLUDED.type, secret=EXCLUDED.secret,
                  note=EXCLUDED.note, updated_at=NOW()
            RETURNING id, name, type, note, created_at, updated_at
        """, (name, type_, encrypt(secret), note))
        return dict(cur.fetchone())

def delete_credential(cred_id):
    with get_conn() as conn:
        conn.cursor().execute("DELETE FROM credentials WHERE id=%s", (cred_id,))

# ── graph_versions ────────────────────────────────────────────────────────
def list_graph_versions(graph_id):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id, graph_id, version, name, note, saved_at FROM graph_versions WHERE graph_id=%s ORDER BY version DESC LIMIT 20",
            (graph_id,)
        )
        return [dict(r) for r in cur.fetchall()]

def save_graph_version(graph_id, name, graph_json, note=""):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT COALESCE(MAX(version),0)+1 AS nxt FROM graph_versions WHERE graph_id=%s",
            (graph_id,)
        )
        nxt = cur.fetchone()['nxt']
        cur.execute(
            "INSERT INTO graph_versions(graph_id,version,name,graph_json,note) VALUES(%s,%s,%s,%s,%s) RETURNING *",
            (graph_id, nxt, name, graph_json, note)
        )
        row = dict(cur.fetchone())
        # keep only the 20 most recent per graph
        cur.execute("""
            DELETE FROM graph_versions WHERE graph_id=%s AND id NOT IN (
                SELECT id FROM graph_versions WHERE graph_id=%s ORDER BY version DESC LIMIT 20
            )
        """, (graph_id, graph_id))
        return row

def get_graph_version(version_id):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM graph_versions WHERE id=%s", (version_id,))
        row = cur.fetchone()
        return dict(row) if row else None

# ── metrics ───────────────────────────────────────────────────────────────
def get_run_metrics():
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # 30-day summary
        cur.execute("""
            SELECT
                COUNT(*)                                                        AS total,
                SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END)            AS succeeded,
                SUM(CASE WHEN status='failed'    THEN 1 ELSE 0 END)            AS failed,
                ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))*1000)) AS avg_ms
            FROM runs
            WHERE created_at >= NOW() - INTERVAL '30 days'
        """)
        s = dict(cur.fetchone())

        # Daily counts for the last 14 days (fill gaps with zeros)
        cur.execute("""
            WITH days AS (
                SELECT generate_series(
                    CURRENT_DATE - 13, CURRENT_DATE, '1 day'::interval
                )::date AS day
            )
            SELECT days.day::text,
                   COALESCE(SUM(CASE WHEN r.status='succeeded' THEN 1 ELSE 0 END), 0) AS succeeded,
                   COALESCE(SUM(CASE WHEN r.status='failed'    THEN 1 ELSE 0 END), 0) AS failed,
                   COALESCE(COUNT(r.id), 0) AS total
            FROM days
            LEFT JOIN runs r ON DATE(r.created_at) = days.day
            GROUP BY days.day
            ORDER BY days.day
        """)
        daily = [
            {'day': r['day'], 'succeeded': int(r['succeeded']), 'failed': int(r['failed']), 'total': int(r['total'])}
            for r in cur.fetchall()
        ]

        # Top 5 failing flows (last 30 days)
        cur.execute("""
            SELECT COALESCE(g.name, 'legacy:' || r.workflow) AS name,
                   COUNT(*) AS failures
            FROM runs r
            LEFT JOIN graph_workflows g ON r.graph_id = g.id
            WHERE r.status = 'failed'
              AND r.created_at >= NOW() - INTERVAL '30 days'
            GROUP BY 1
            ORDER BY 2 DESC
            LIMIT 5
        """)
        top_failing = [{'name': r['name'], 'failures': int(r['failures'])} for r in cur.fetchall()]

        # Last 10 runs for the activity feed
        cur.execute("""
            SELECT r.id, r.status,
                   r.created_at::text AS created_at,
                   COALESCE(g.name, r.workflow, 'unknown') AS flow_name,
                   GREATEST(ROUND(EXTRACT(EPOCH FROM (r.updated_at - r.created_at))*1000), 0)::int AS duration_ms
            FROM runs r
            LEFT JOIN graph_workflows g ON r.graph_id = g.id
            ORDER BY r.id DESC LIMIT 10
        """)
        recent = [dict(r) for r in cur.fetchall()]

        total     = int(s['total']     or 0)
        succeeded = int(s['succeeded'] or 0)
        return {
            'total':        total,
            'succeeded':    succeeded,
            'failed':       int(s['failed'] or 0),
            'success_rate': round(succeeded / max(total, 1) * 100, 1),
            'avg_ms':       int(s['avg_ms'] or 0),
            'daily':        daily,
            'top_failing':  top_failing,
            'recent':       recent,
        }

# ── users ──────────────────────────────────────────────────────────────────
def users_exist() -> bool:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM users LIMIT 1")
        return cur.fetchone() is not None

def create_user(username: str, email: str, password_hash: str, role: str = 'owner') -> dict:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "INSERT INTO users (username, email, password_hash, role) VALUES (%s, %s, %s, %s) RETURNING *",
            (username, email, password_hash, role)
        )
        return dict(cur.fetchone())

def get_user_by_username(username: str):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM users WHERE username=%s", (username,))
        row = cur.fetchone()
        return dict(row) if row else None

def get_user_by_id(user_id: int):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM users WHERE id=%s", (user_id,))
        row = cur.fetchone()
        return dict(row) if row else None

def list_users() -> list:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id, username, email, role, created_at FROM users ORDER BY id")
        return [dict(r) for r in cur.fetchall()]

def update_user_password(user_id: int, password_hash: str):
    with get_conn() as conn:
        conn.cursor().execute(
            "UPDATE users SET password_hash=%s, updated_at=NOW() WHERE id=%s",
            (password_hash, user_id)
        )

def update_user_role(user_id: int, role: str):
    with get_conn() as conn:
        conn.cursor().execute(
            "UPDATE users SET role=%s, updated_at=NOW() WHERE id=%s",
            (role, user_id)
        )

def delete_user(user_id: int):
    with get_conn() as conn:
        conn.cursor().execute("DELETE FROM users WHERE id=%s", (user_id,))

# ── sessions ───────────────────────────────────────────────────────────────
def create_session(user_id: int, token_hash: str):
    with get_conn() as conn:
        conn.cursor().execute(
            "INSERT INTO sessions (user_id, token_hash) VALUES (%s, %s)",
            (user_id, token_hash)
        )

def get_session_by_token_hash(token_hash: str):
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM sessions WHERE token_hash=%s AND expires_at > NOW()",
            (token_hash,)
        )
        row = cur.fetchone()
        return dict(row) if row else None

def refresh_session(token_hash: str):
    with get_conn() as conn:
        conn.cursor().execute(
            "UPDATE sessions SET last_seen=NOW(), expires_at=NOW() + INTERVAL '30 days' WHERE token_hash=%s",
            (token_hash,)
        )

def delete_session_by_token_hash(token_hash: str):
    with get_conn() as conn:
        conn.cursor().execute("DELETE FROM sessions WHERE token_hash=%s", (token_hash,))

def purge_expired_sessions():
    with get_conn() as conn:
        conn.cursor().execute("DELETE FROM sessions WHERE expires_at < NOW()")

# ── api_tokens ─────────────────────────────────────────────────────────────

# Valid scopes in ascending permission order.
API_TOKEN_SCOPES = ("read", "run", "manage")

def create_api_token(name: str, token_hash: str, created_by: int,
                     scope: str = "manage", expires_at=None) -> dict:
    if scope not in API_TOKEN_SCOPES:
        raise ValueError(f"scope must be one of {API_TOKEN_SCOPES}")
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """INSERT INTO api_tokens (name, token_hash, created_by, scope, expires_at)
               VALUES (%s, %s, %s, %s, %s)
               RETURNING id, name, created_at, scope, expires_at""",
            (name, token_hash, created_by, scope, expires_at)
        )
        return dict(cur.fetchone())

def list_api_tokens() -> list:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT t.id, t.name, t.created_at, t.last_used,
                   t.scope, t.expires_at,
                   u.username AS created_by_username
            FROM api_tokens t LEFT JOIN users u ON t.created_by = u.id
            ORDER BY t.created_at DESC
        """)
        return [dict(r) for r in cur.fetchall()]

def get_api_token_by_hash(token_hash: str):
    """Return the token row if it exists and has not expired; else None."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM api_tokens WHERE token_hash=%s"
            " AND (expires_at IS NULL OR expires_at > NOW())",
            (token_hash,),
        )
        row = cur.fetchone()
        return dict(row) if row else None

def touch_api_token(token_hash: str):
    with get_conn() as conn:
        conn.cursor().execute(
            "UPDATE api_tokens SET last_used=NOW() WHERE token_hash=%s", (token_hash,)
        )

def delete_api_token(token_id: int):
    with get_conn() as conn:
        conn.cursor().execute("DELETE FROM api_tokens WHERE id=%s", (token_id,))
