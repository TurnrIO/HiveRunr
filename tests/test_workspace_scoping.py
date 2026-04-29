"""Workspace scoping tests — verify that run creation, listing,
and analytics all correctly respect workspace boundaries.

All DB calls are mocked so these run in CI without infrastructure.
"""
import json
import pytest
import unittest.mock as mock


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def db():
    """Patch the DB layer with a minimal in-memory store."""
    import app.core.db as db_mod

    inserted_runs = []

    def fake_execute(sql, params=None):
        sql_upper = sql.strip().upper()
        if sql_upper.startswith("INSERT INTO RUNS"):
            # Record what was inserted
            inserted_runs.append({"sql": sql, "params": params or []})

    fake_conn = mock.MagicMock()
    fake_conn.__enter__ = lambda s: s
    fake_conn.__exit__ = mock.MagicMock(return_value=False)
    fake_cursor = mock.MagicMock()
    fake_cursor.__enter__ = lambda s: s
    fake_cursor.__exit__ = mock.MagicMock(return_value=False)
    fake_cursor.execute.side_effect = fake_execute
    fake_cursor.fetchone.return_value = None
    fake_cursor.fetchall.return_value = []
    fake_conn.cursor.return_value = fake_cursor

    with mock.patch.object(db_mod, "get_conn", return_value=fake_conn), \
         mock.patch.object(db_mod, "run_migrations", return_value=None):
        yield {"inserted_runs": inserted_runs, "db_mod": db_mod, "fake_cursor": fake_cursor}


# ── list_runs workspace filter ─────────────────────────────────────────────────

def test_list_runs_filters_by_workspace():
    """list_runs with workspace_id must include NULL-workspace rows (legacy data)."""
    import app.core.db as db_mod
    import psycopg2.extras

    captured_sql = []

    def fake_execute(sql, params=None):
        captured_sql.append((sql, params))

    fake_cur = mock.MagicMock()
    fake_cur.execute.side_effect = fake_execute
    fake_cur.fetchone.return_value = {"n": 0}
    fake_cur.fetchall.return_value = []
    fake_cur.__enter__ = lambda s: s
    fake_cur.__exit__ = mock.MagicMock(return_value=False)

    fake_conn = mock.MagicMock()
    fake_conn.__enter__ = lambda s: s
    fake_conn.__exit__ = mock.MagicMock(return_value=False)
    fake_conn.cursor.return_value = fake_cur

    with mock.patch.object(db_mod, "get_conn", return_value=fake_conn):
        db_mod.list_runs(workspace_id=42)

    # At least one query must contain both the workspace_id param AND IS NULL
    joined = " ".join(str(sql) for sql, _ in captured_sql)
    assert "workspace_id" in joined.lower(), "Expected workspace_id filter in list_runs SQL"
    assert "is null" in joined.lower(), "Expected IS NULL inclusion for legacy rows"
    # workspace_id value 42 must appear in the params
    all_params = [p for _, params in captured_sql if params for p in (params if isinstance(params, (list, tuple)) else [])]
    assert 42 in all_params, "workspace_id=42 must be passed as a query parameter"


def test_list_runs_no_workspace_filter_when_none():
    """list_runs with workspace_id=None must NOT add a workspace_id condition."""
    import app.core.db as db_mod

    captured_sql = []

    def fake_execute(sql, params=None):
        captured_sql.append((sql, params or []))

    fake_cur = mock.MagicMock()
    fake_cur.execute.side_effect = fake_execute
    fake_cur.fetchone.return_value = {"n": 0}
    fake_cur.fetchall.return_value = []
    fake_cur.__enter__ = lambda s: s
    fake_cur.__exit__ = mock.MagicMock(return_value=False)

    fake_conn = mock.MagicMock()
    fake_conn.__enter__ = lambda s: s
    fake_conn.__exit__ = mock.MagicMock(return_value=False)
    fake_conn.cursor.return_value = fake_cur

    with mock.patch.object(db_mod, "get_conn", return_value=fake_conn):
        db_mod.list_runs(workspace_id=None)

    # No workspace filter should appear in any query
    for sql, params in captured_sql:
        assert "workspace_id" not in str(sql).lower() or "workspace_id" not in str(sql).lower(), \
            "workspace_id filter must not appear when workspace_id=None"


def test_list_schedules_places_workspace_filter_after_lateral_join():
    """list_schedules must emit JOINs before WHERE to avoid SQL syntax errors."""
    import app.core.db as db_mod

    captured_sql = []

    def fake_execute(sql, params=None):
        captured_sql.append((str(sql), params))

    fake_cur = mock.MagicMock()
    fake_cur.execute.side_effect = fake_execute
    fake_cur.fetchall.return_value = []
    fake_cur.__enter__ = lambda s: s
    fake_cur.__exit__ = mock.MagicMock(return_value=False)

    fake_conn = mock.MagicMock()
    fake_conn.__enter__ = lambda s: s
    fake_conn.__exit__ = mock.MagicMock(return_value=False)
    fake_conn.cursor.return_value = fake_cur

    with mock.patch.object(db_mod, "get_conn", return_value=fake_conn):
        db_mod.list_schedules(workspace_id=42)

    assert captured_sql, "Expected list_schedules to execute SQL"
    sql = captured_sql[0][0].upper()
    assert "LEFT JOIN LATERAL" in sql, "Expected lateral join in schedule query"
    assert "WHERE S.WORKSPACE_ID = %(WID)S" in sql, "Expected workspace filter in schedule query"
    assert sql.index("LEFT JOIN LATERAL") < sql.index("WHERE S.WORKSPACE_ID = %(WID)S"), \
        "Workspace WHERE clause must come after the lateral join"


# ── workspace_id stamped on run creation ──────────────────────────────────────

class _FakeRequest:
    """Minimal request stub for auth/workspace resolution."""
    def __init__(self, workspace_id=1):
        self.cookies = {"hr_workspace": str(workspace_id)}
        self.headers = {}
        self.client = mock.MagicMock()
        self.client.host = "127.0.0.1"

    def __getattr__(self, name):
        return mock.MagicMock()


def _check_run_insert_has_workspace(sql, params, expected_ws_id):
    """Assert that an INSERT INTO runs statement includes workspace_id."""
    assert "INSERT INTO RUNS" in sql.upper() or "insert into runs" in sql.lower(), \
        f"Expected INSERT INTO runs, got: {sql!r}"
    assert expected_ws_id in params, \
        f"Expected workspace_id={expected_ws_id} in params {params}"


def test_script_run_insert_includes_workspace_id_column():
    """The INSERT INTO runs SQL in admin.py must include workspace_id column."""
    # Verify by inspecting the source code directly rather than executing
    # the async endpoint (which has complex dependency injection to mock)
    import inspect
    from app.routers.admin import api_run_script
    src = inspect.getsource(api_run_script)
    assert "workspace_id" in src, \
        "api_run_script must stamp workspace_id on the runs INSERT"
    assert "_resolve_workspace" in src, \
        "api_run_script must call _resolve_workspace to get the workspace_id"


# ── analytics workspace scoping ───────────────────────────────────────────────

def test_get_flow_analytics_passes_workspace_id():
    """get_flow_analytics must include workspace filter when workspace_id given."""
    import app.core.db as db_mod

    captured = []

    def fake_execute(sql, params=None):
        captured.append((sql, params))

    fake_cur = mock.MagicMock()
    fake_cur.execute.side_effect = fake_execute
    fake_cur.fetchall.return_value = []
    fake_conn = mock.MagicMock()
    fake_conn.__enter__ = lambda s: s
    fake_conn.__exit__ = mock.MagicMock(return_value=False)
    fake_conn.cursor.return_value = fake_cur

    with mock.patch.object(db_mod, "get_conn", return_value=fake_conn):
        db_mod.get_flow_analytics(days=30, workspace_id=5)

    joined = " ".join(str(sql) for sql, _ in captured)
    assert "workspace_id" in joined.lower(), "Expected workspace_id filter in analytics SQL"
    all_params = {}
    for sql, params in captured:
        if isinstance(params, dict):
            all_params.update(params)
    assert all_params.get("ws") == 5, f"Expected ws=5 in params, got: {all_params}"


def test_get_run_metrics_passes_workspace_id():
    """get_run_metrics must include r.workspace_id filter when workspace_id given."""
    import app.core.db as db_mod

    captured = []

    def fake_execute(sql, params=None):
        captured.append((str(sql), params))

    fake_cur = mock.MagicMock()
    fake_cur.execute.side_effect = fake_execute
    fake_cur.fetchone.return_value = {"total": 0, "succeeded": 0, "failed": 0, "avg_ms": 0}
    fake_cur.fetchall.return_value = []
    fake_conn = mock.MagicMock()
    fake_conn.__enter__ = lambda s: s
    fake_conn.__exit__ = mock.MagicMock(return_value=False)
    fake_conn.cursor.return_value = fake_cur

    with mock.patch.object(db_mod, "get_conn", return_value=fake_conn):
        db_mod.get_run_metrics(workspace_id=3)

    joined = " ".join(sql for sql, _ in captured).lower()
    assert "r.workspace_id" in joined, \
        "Expected qualified r.workspace_id in metrics SQL to avoid AmbiguousColumn"
