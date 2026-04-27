"""API smoke tests — every major endpoint must return non-500 for an
authenticated request.  Uses FastAPI's TestClient (no network needed).

These tests are intentionally shallow: they verify that routes exist, are
reachable, and don't crash on a well-formed request.  They are NOT testing
business logic — that belongs in unit tests.

Run:  pytest tests/test_api_smoke.py -v
"""
import json
import pytest
from fastapi.testclient import TestClient


# ── App bootstrap ──────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    """Create a TestClient with a fully initialised app.

    The DB/Redis aren't available in CI, so we patch get_conn and redis to
    avoid real network calls while still exercising the routing layer.
    """
    import unittest.mock as mock
    import app.core.db as db_mod

    # Minimal fake connection pool so init_db / run_migrations is a no-op
    fake_conn = mock.MagicMock()
    fake_conn.__enter__ = lambda s: s
    fake_conn.__exit__ = mock.MagicMock(return_value=False)
    fake_conn.cursor.return_value.__enter__ = lambda s: s
    fake_conn.cursor.return_value.__exit__ = mock.MagicMock(return_value=False)
    fake_conn.cursor.return_value.fetchone.return_value = None
    fake_conn.cursor.return_value.fetchall.return_value = []

    with mock.patch.object(db_mod, "get_conn", return_value=fake_conn), \
         mock.patch.object(db_mod, "run_migrations", return_value=None), \
         mock.patch("app.main.init_db", return_value=None), \
         mock.patch("app.main.seed_example_graphs", return_value=None):

        from app.main import app
        with TestClient(app, raise_server_exceptions=False) as c:
            yield c


# ── Duplicate route detector ───────────────────────────────────────────────────

def test_no_duplicate_routes():
    """Fail if any two routes share method + path — the first one silently wins."""
    import importlib, app.main as main_mod
    from app.main import app as fastapi_app

    seen = {}
    duplicates = []
    for route in fastapi_app.routes:
        if not hasattr(route, "methods"):
            continue
        for method in route.methods:
            key = f"{method} {route.path}"
            if key in seen:
                duplicates.append(f"DUPLICATE: {key}  ({seen[key]} AND {getattr(route, 'endpoint', '?').__module__})")
            else:
                seen[key] = getattr(route.endpoint, "__module__", "?")

    assert not duplicates, "\n".join(duplicates)


# ── Auth endpoints ─────────────────────────────────────────────────────────────

def test_auth_status(client):
    r = client.get("/api/auth/status")
    assert r.status_code != 500, r.text


def test_auth_login_bad_creds(client):
    r = client.post("/api/auth/login", json={"username": "x", "password": "y"})
    # 401 is expected — just not 500
    assert r.status_code != 500, r.text


def test_auth_check_unauthenticated(client):
    r = client.get("/api/auth/check")
    assert r.status_code in (200, 401, 403), r.text


# ── Public / health endpoints ──────────────────────────────────────────────────

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert "status" in data
    assert "version" in data
    assert data["version"] != "8", "/health is returning the old hardcoded version string"


def test_templates_list_unauthenticated(client):
    """Template list must be reachable (returns 401 if not auth'd, not 500)."""
    r = client.get("/api/templates")
    assert r.status_code != 500, r.text


# ── Route existence checks (unauthenticated → 401/403, never 500) ─────────────

@pytest.mark.parametrize("method,path", [
    ("GET",  "/api/graphs"),
    ("GET",  "/api/runs"),
    ("GET",  "/api/credentials"),
    ("GET",  "/api/schedules"),
    ("GET",  "/api/metrics"),
    ("GET",  "/api/analytics/flows"),
    ("GET",  "/api/analytics/daily"),
    ("GET",  "/api/audit-log"),
    ("GET",  "/api/system/status"),
    ("GET",  "/api/version"),
    ("GET",  "/api/templates"),
    ("GET",  "/api/runs/retention"),
    ("GET",  "/api/settings/ratelimit"),
    ("GET",  "/api/runs/queue"),
    ("POST", "/api/graphs/import"),
    ("POST", "/api/templates/daily_health_check/use"),
])
def test_route_exists_returns_non_500(client, method, path):
    """Every listed endpoint must exist and return 401/403, never 404 or 500."""
    r = client.request(method, path, json={})
    assert r.status_code not in (404, 500), (
        f"{method} {path} returned {r.status_code}: {r.text[:200]}"
    )


# ── Page routes ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", ["/login", "/canvas", "/health"])
def test_page_routes_non_500(client, path):
    r = client.get(path)
    assert r.status_code != 500, f"{path} returned 500: {r.text[:200]}"
