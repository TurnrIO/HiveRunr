"""Tests for the permission / auth guard layer (app/deps.py).

All tests run in-process without a live database.  DB helpers and the
session-cookie lookup are monkey-patched so we can exercise every code
path in _check_admin, _require_scope, _require_writer, _require_owner,
and _check_flow_access cleanly.

Note: _check_admin lazily imports get_current_user from app.auth inside
the function body, so we patch app.auth.get_current_user, not app.deps.get_current_user.
"""
import pytest
from unittest.mock import patch, MagicMock
from fastapi import HTTPException
from starlette.requests import Request


# ── helpers ────────────────────────────────────────────────────────────────

def _mock_request(headers: dict = None, cookies: dict = None) -> Request:
    """Build a minimal Starlette Request with the given headers/cookies."""
    raw_headers = []
    for k, v in (headers or {}).items():
        raw_headers.append((k.lower().encode(), v.encode()))
    if cookies:
        cookie_str = "; ".join(f"{k}={v}" for k, v in cookies.items())
        raw_headers.append((b"cookie", cookie_str.encode()))

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "query_string": b"",
        "headers": raw_headers,
    }
    return Request(scope)


def _owner() -> dict:
    return {"id": 1, "username": "owner", "role": "owner"}


def _admin() -> dict:
    return {"id": 2, "username": "admin", "role": "admin"}


def _viewer() -> dict:
    return {"id": 3, "username": "viewer", "role": "viewer"}


# _check_admin imports get_current_user + hash_token locally from app.auth,
# but get_api_token_by_hash and touch_api_token are bound at module import time in app.deps.
_GCU   = "app.auth.get_current_user"   # local import inside _check_admin
_ATB   = "app.auth.hash_token"          # local import inside _check_admin
_TOKDB = "app.deps.get_api_token_by_hash"  # module-level import in deps.py
_TOUCH = "app.deps.touch_api_token"        # module-level import in deps.py


# ── _check_admin ───────────────────────────────────────────────────────────

class TestCheckAdmin:
    """_check_admin should resolve session users and token users."""

    def test_session_user_returned_directly(self):
        from app.deps import _check_admin
        req = _mock_request()
        with patch(_GCU, return_value=_owner()):
            user = _check_admin(req)
        assert user["role"] == "owner"

    def test_bearer_token_resolves(self):
        from app.deps import _check_admin
        req = _mock_request(headers={"Authorization": "Bearer tok123"})
        fake_token = {"name": "ci", "scope": "manage"}
        with patch(_GCU, return_value=None), \
             patch(_ATB, return_value="hashed"), \
             patch(_TOKDB, return_value=fake_token), \
             patch(_TOUCH):
            user = _check_admin(req)
        assert user["username"] == "api:ci"
        assert user["role"] == "owner"
        assert user["token_scope"] == "manage"

    def test_legacy_x_api_token_header(self):
        from app.deps import _check_admin
        req = _mock_request(headers={"x-api-token": "legacytok"})
        fake_token = {"name": "legacy", "scope": "read"}
        with patch(_GCU, return_value=None), \
             patch(_ATB, return_value="hashed"), \
             patch(_TOKDB, return_value=fake_token), \
             patch(_TOUCH):
            user = _check_admin(req)
        assert user["token_scope"] == "read"

    def test_no_credentials_raises_401(self):
        from app.deps import _check_admin
        req = _mock_request()
        with patch(_GCU, return_value=None), \
             patch(_ATB, return_value="x"), \
             patch(_TOKDB, return_value=None), \
             patch(_TOUCH):
            with pytest.raises(HTTPException) as exc_info:
                _check_admin(req)
        assert exc_info.value.status_code == 401

    def test_invalid_token_raises_401(self):
        from app.deps import _check_admin
        req = _mock_request(headers={"Authorization": "Bearer badtoken"})
        with patch(_GCU, return_value=None), \
             patch(_ATB, return_value="hashed"), \
             patch(_TOKDB, return_value=None), \
             patch(_TOUCH):
            with pytest.raises(HTTPException) as exc_info:
                _check_admin(req)
        assert exc_info.value.status_code == 401


# ── _require_scope ─────────────────────────────────────────────────────────

class TestRequireScope:
    """Token scope hierarchy: read < run < manage."""

    @staticmethod
    def _with_token(scope: str):
        return {"name": "t", "scope": scope}

    def test_manage_token_passes_manage(self):
        from app.deps import _require_scope
        req = _mock_request(headers={"Authorization": "Bearer tok"})
        with patch(_GCU, return_value=None), \
             patch(_ATB, return_value="h"), \
             patch(_TOKDB, return_value=self._with_token("manage")), \
             patch(_TOUCH):
            user = _require_scope(req, "manage")
        assert user["token_scope"] == "manage"

    def test_run_token_passes_run(self):
        from app.deps import _require_scope
        req = _mock_request(headers={"Authorization": "Bearer tok"})
        with patch(_GCU, return_value=None), \
             patch(_ATB, return_value="h"), \
             patch(_TOKDB, return_value=self._with_token("run")), \
             patch(_TOUCH):
            user = _require_scope(req, "run")
        assert user is not None

    def test_read_token_blocked_by_run_scope(self):
        from app.deps import _require_scope
        req = _mock_request(headers={"Authorization": "Bearer tok"})
        with patch(_GCU, return_value=None), \
             patch(_ATB, return_value="h"), \
             patch(_TOKDB, return_value=self._with_token("read")), \
             patch(_TOUCH):
            with pytest.raises(HTTPException) as exc_info:
                _require_scope(req, "run")
        assert exc_info.value.status_code == 403

    def test_read_token_blocked_by_manage_scope(self):
        from app.deps import _require_scope
        req = _mock_request(headers={"Authorization": "Bearer tok"})
        with patch(_GCU, return_value=None), \
             patch(_ATB, return_value="h"), \
             patch(_TOKDB, return_value=self._with_token("read")), \
             patch(_TOUCH):
            with pytest.raises(HTTPException) as exc_info:
                _require_scope(req, "manage")
        assert exc_info.value.status_code == 403

    def test_session_user_bypasses_scope(self):
        """Browser session users are never blocked by token scope."""
        from app.deps import _require_scope
        req = _mock_request()
        with patch(_GCU, return_value=_owner()):
            user = _require_scope(req, "manage")
        assert user["role"] == "owner"


# ── _require_writer / _require_owner ───────────────────────────────────────

class TestRoleGuards:
    def test_owner_passes_writer(self):
        from app.deps import _require_writer
        req = _mock_request()
        with patch(_GCU, return_value=_owner()):
            user = _require_writer(req)
        assert user["role"] == "owner"

    def test_admin_passes_writer(self):
        from app.deps import _require_writer
        req = _mock_request()
        with patch(_GCU, return_value=_admin()):
            user = _require_writer(req)
        assert user["role"] == "admin"

    def test_viewer_blocked_by_writer(self):
        from app.deps import _require_writer
        req = _mock_request()
        with patch(_GCU, return_value=_viewer()):
            with pytest.raises(HTTPException) as exc_info:
                _require_writer(req)
        assert exc_info.value.status_code == 403

    def test_owner_passes_owner_guard(self):
        from app.deps import _require_owner
        req = _mock_request()
        with patch(_GCU, return_value=_owner()):
            user = _require_owner(req)
        assert user["role"] == "owner"

    def test_admin_blocked_by_owner_guard(self):
        from app.deps import _require_owner
        req = _mock_request()
        with patch(_GCU, return_value=_admin()):
            with pytest.raises(HTTPException) as exc_info:
                _require_owner(req)
        assert exc_info.value.status_code == 403

    def test_viewer_blocked_by_owner_guard(self):
        from app.deps import _require_owner
        req = _mock_request()
        with patch(_GCU, return_value=_viewer()):
            with pytest.raises(HTTPException) as exc_info:
                _require_owner(req)
        assert exc_info.value.status_code == 403


# ── _check_flow_access ─────────────────────────────────────────────────────

class TestCheckFlowAccess:
    """Per-flow permission table enforcement for viewer-role users."""

    GRAPH_ID = 42

    def test_owner_always_granted(self):
        from app.deps import _check_flow_access
        req = _mock_request()
        with patch(_GCU, return_value=_owner()), \
             patch("app.core.db.get_flow_permission") as mock_fp:
            user = _check_flow_access(req, self.GRAPH_ID, "editor")
        mock_fp.assert_not_called()  # owners skip per-flow table
        assert user["role"] == "owner"

    def test_admin_always_granted(self):
        from app.deps import _check_flow_access
        req = _mock_request()
        with patch(_GCU, return_value=_admin()), \
             patch("app.core.db.get_flow_permission") as mock_fp:
            _check_flow_access(req, self.GRAPH_ID, "editor")
        mock_fp.assert_not_called()

    def test_viewer_with_editor_permission_granted(self):
        from app.deps import _check_flow_access
        req = _mock_request()
        with patch(_GCU, return_value=_viewer()), \
             patch("app.deps.get_flow_permission", return_value={"role": "editor"}):
            user = _check_flow_access(req, self.GRAPH_ID, "viewer")
        assert user["role"] == "viewer"

    def test_viewer_with_viewer_permission_blocked_for_runner(self):
        from app.deps import _check_flow_access
        req = _mock_request()
        with patch(_GCU, return_value=_viewer()), \
             patch("app.deps.get_flow_permission", return_value={"role": "viewer"}):
            with pytest.raises(HTTPException) as exc_info:
                _check_flow_access(req, self.GRAPH_ID, "runner")
        assert exc_info.value.status_code == 403

    def test_viewer_with_no_permission_row_blocked(self):
        from app.deps import _check_flow_access
        req = _mock_request()
        with patch(_GCU, return_value=_viewer()), \
             patch("app.deps.get_flow_permission", return_value=None):
            with pytest.raises(HTTPException) as exc_info:
                _check_flow_access(req, self.GRAPH_ID, "viewer")
        assert exc_info.value.status_code == 403

    def test_api_token_user_bypasses_flow_check(self):
        """Token-authenticated callers (id=0) skip per-flow table."""
        from app.deps import _check_flow_access
        req = _mock_request(headers={"Authorization": "Bearer tok"})
        with patch(_GCU, return_value=None), \
             patch(_ATB, return_value="h"), \
             patch(_TOKDB, return_value={"name": "ci", "scope": "manage"}), \
             patch(_TOUCH), \
             patch("app.deps.get_flow_permission") as mock_fp:
            _check_flow_access(req, self.GRAPH_ID, "editor")
        mock_fp.assert_not_called()


# ── _resolve_workspace ─────────────────────────────────────────────────────

class TestResolveWorkspace:
    """Workspace resolution order: header > cookie > memberships > default."""

    def test_header_takes_priority(self):
        from app.deps import _resolve_workspace
        req = _mock_request(headers={"X-Workspace-Id": "7"})
        fake_ws = {"id": 7, "name": "test"}
        with patch("app.deps.get_workspace", return_value=fake_ws), \
             patch("app.deps.get_workspace_member", return_value={"role": "admin"}):
            result = _resolve_workspace(req, _admin())
        assert result == 7

    def test_cookie_used_when_no_header(self):
        from app.deps import _resolve_workspace
        req = _mock_request(cookies={"hr_workspace": "5"})
        with patch("app.deps.get_workspace", return_value={"id": 5}), \
             patch("app.deps.get_workspace_member", return_value={"role": "viewer"}):
            result = _resolve_workspace(req, _viewer())
        assert result == 5

    def test_falls_back_to_default_workspace(self):
        from app.deps import _resolve_workspace
        req = _mock_request()
        with patch("app.deps.get_workspace", return_value=None), \
             patch("app.deps.list_user_workspaces", return_value=[]), \
             patch("app.deps.get_default_workspace", return_value={"id": 1}):
            result = _resolve_workspace(req, _viewer())
        assert result == 1

    def test_owner_bypasses_membership_check(self):
        from app.deps import _resolve_workspace
        req = _mock_request(headers={"X-Workspace-Id": "99"})
        with patch("app.deps.get_workspace", return_value={"id": 99}):
            result = _resolve_workspace(req, _owner())
        assert result == 99
