"""Shared FastAPI dependencies — auth guards used across all routers."""
import logging
import os
from fastapi import HTTPException, Request
from fastapi.responses import RedirectResponse

from app.core.db import (
    users_exist, get_api_token_by_hash, touch_api_token,
    get_flow_permission, FLOW_ROLE_LEVELS,
)

ROLE_LEVELS = {"viewer": 0, "admin": 1, "owner": 2}

# API token scopes in ascending permission order.
# read   — GET endpoints only (no state mutations)
# run    — read + trigger runs / replay / cancel
# manage — full API access (equivalent to the old token behaviour)
TOKEN_SCOPE_LEVELS = {"read": 0, "run": 1, "manage": 2}

log = logging.getLogger(__name__)


def _extract_raw_token(request: Request) -> str:
    """Extract the raw API token from the request, in preference order.

    Preferred (safe): Authorization: Bearer <token> header or legacy x-api-token /
    x-admin-token headers.  Deprecated (leaks into server logs): ?token= query
    parameter — still accepted for backwards-compatibility but emits a warning so
    callers can migrate.
    """
    # 1. Standard Bearer header — recommended for all API clients
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()

    # 2. Legacy custom headers — safe (not exposed in URLs or logs)
    raw = request.headers.get("x-api-token") or request.headers.get("x-admin-token")
    if raw:
        return raw

    # 3. Query parameter — DEPRECATED: token appears in server logs and browser history
    raw = request.query_params.get("token", "")
    if raw:
        log.warning(
            "API token supplied via ?token= query parameter (deprecated). "
            "Switch to 'Authorization: Bearer <token>'. Path: %s",
            request.url.path,
        )
        return raw

    return ""


def _check_admin(request: Request):
    """Accept session cookie (browser) OR token via Authorization: Bearer / legacy headers."""
    from app.auth import get_current_user, hash_token
    user = get_current_user(request)
    if user:
        return user
    raw = _extract_raw_token(request)
    if raw:
        th = hash_token(raw)
        tok = get_api_token_by_hash(th)
        if tok:
            touch_api_token(th)
            scope = tok.get("scope", "manage")
            return {
                "id": 0,
                "username": f"api:{tok['name']}",
                "role": "owner",
                "token_scope": scope,
            }
    raise HTTPException(401, "Authentication required")


def _require_scope(request: Request, min_scope: str):
    """Require at least *min_scope* when authenticated via an API token.

    Session-cookie users (browser) always pass — scope only applies to tokens.
    """
    user = _check_admin(request)
    scope = user.get("token_scope")
    if scope is not None:
        # token-based auth — enforce scope
        if TOKEN_SCOPE_LEVELS.get(scope, 0) < TOKEN_SCOPE_LEVELS.get(min_scope, 0):
            raise HTTPException(
                403,
                f"This action requires token scope '{min_scope}' "
                f"(your token has scope '{scope}')",
            )
    return user


def _require_run_scope(request: Request):
    """Token must have at least 'run' scope (session users always pass)."""
    return _require_scope(request, "run")


def _require_manage_scope(request: Request):
    """Token must have 'manage' scope (session users always pass)."""
    return _require_scope(request, "manage")


def _require_writer(request: Request):
    """Authenticated + admin or owner role (viewers are read-only)."""
    user = _check_admin(request)
    if ROLE_LEVELS.get(user.get("role", "viewer"), 0) < 1:
        raise HTTPException(403, "This action requires admin or owner role")
    return user


def _require_owner(request: Request):
    """Authenticated + owner role only."""
    user = _check_admin(request)
    if user.get("role") != "owner":
        raise HTTPException(403, "This action requires owner role")
    return user


def _check_flow_access(request: Request, graph_id: int, required_role: str = "viewer"):
    """Enforce per-flow access control for viewer-role users.

    - admin / owner: always granted (skip per-flow check).
    - API token users: always granted (token-level scope already enforced).
    - viewer (global role): must have an explicit flow_permissions row with
      a role >= required_role.

    Returns the user dict on success; raises HTTP 403 otherwise.

    required_role must be one of: 'viewer', 'runner', 'editor'.
    """
    user = _check_admin(request)
    global_role = user.get("role", "viewer")

    # Admins, owners, and token-authenticated callers bypass per-flow checks.
    if global_role in ("admin", "owner") or user.get("id") == 0:
        return user

    # Viewer global role: check the flow_permissions table.
    fp = get_flow_permission(user["id"], graph_id)
    if fp is None:
        raise HTTPException(403, "You do not have access to this flow")

    granted_level  = FLOW_ROLE_LEVELS.get(fp["role"], 0)
    required_level = FLOW_ROLE_LEVELS.get(required_role, 0)
    if granted_level < required_level:
        raise HTTPException(
            403,
            f"This action requires '{required_role}' access to this flow "
            f"(you have '{fp['role']}')",
        )
    return user


def _auth_redirect(request: Request):
    """Returns a redirect to /setup or /login if the browser is not authenticated."""
    if not users_exist():
        return RedirectResponse("/setup", status_code=302)
    from app.auth import get_current_user
    if not get_current_user(request):
        next_path = request.url.path
        if request.url.query:
            next_path += "?" + request.url.query
        return RedirectResponse(f"/login?next={next_path}", status_code=302)
    return None
