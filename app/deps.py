"""Shared FastAPI dependencies — auth guards used across all routers."""
import os
from fastapi import HTTPException, Request
from fastapi.responses import RedirectResponse

from app.core.db import users_exist, get_api_token_by_hash, touch_api_token

ROLE_LEVELS = {"viewer": 0, "admin": 1, "owner": 2}


def _check_admin(request: Request):
    """Accept session cookie (browser) OR x-api-token / x-admin-token header (API clients)."""
    from app.auth import get_current_user, hash_token
    user = get_current_user(request)
    if user:
        return user
    raw = (request.headers.get("x-api-token")
           or request.headers.get("x-admin-token")
           or request.query_params.get("token", ""))
    if raw:
        th = hash_token(raw)
        tok = get_api_token_by_hash(th)
        if tok:
            touch_api_token(th)
            return {"id": 0, "username": f"api:{tok['name']}", "role": "owner"}
    raise HTTPException(401, "Authentication required")


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
