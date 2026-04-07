"""Auth, user management, and API token routers."""
import logging
import secrets as _sec
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response, RedirectResponse
from pydantic import BaseModel
from typing import Optional

from app.deps import _check_admin, _require_writer, _require_owner

log = logging.getLogger(__name__)

# ── Login brute-force protection ──────────────────────────────────────────────
_MAX_ATTEMPTS  = 5      # failed attempts before lockout
_LOCKOUT_S     = 900    # lockout duration in seconds (15 minutes)
_ATTEMPT_TTL_S = 3600   # sliding window for attempt counter (1 hour)


def _login_redis():
    """Return a Redis client, or None if Redis is unavailable."""
    try:
        import redis as _redis
        import os
        url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
        r = _redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
        r.ping()
        return r
    except Exception:
        return None


def _check_login_allowed(ip: str) -> None:
    """Raise HTTP 429 if this IP is currently locked out."""
    r = _login_redis()
    if r is None:
        return  # Redis unavailable — fail open rather than block all logins
    lockout_key = f"hiverunr:login:lockout:{ip}"
    if r.exists(lockout_key):
        ttl = r.ttl(lockout_key)
        raise HTTPException(
            429,
            f"Too many failed login attempts. Try again in {ttl // 60 + 1} minute(s).",
        )


def _record_login_failure(ip: str) -> None:
    """Increment the failure counter; lock out the IP after _MAX_ATTEMPTS."""
    r = _login_redis()
    if r is None:
        return
    attempt_key = f"hiverunr:login:attempts:{ip}"
    lockout_key = f"hiverunr:login:lockout:{ip}"
    count = r.incr(attempt_key)
    r.expire(attempt_key, _ATTEMPT_TTL_S)
    if count >= _MAX_ATTEMPTS:
        r.setex(lockout_key, _LOCKOUT_S, "1")
        r.delete(attempt_key)
        log.warning("Login lockout triggered for IP %s after %d failed attempts", ip, count)


def _clear_login_failures(ip: str) -> None:
    """Clear failure counters on successful login."""
    r = _login_redis()
    if r is None:
        return
    r.delete(f"hiverunr:login:attempts:{ip}")
    r.delete(f"hiverunr:login:lockout:{ip}")
from app.core.db import (
    users_exist, create_user, get_user_by_username, get_user_by_id, list_users,
    update_user_password, update_user_role, delete_user,
    create_session, delete_session_by_token_hash,
    create_api_token, list_api_tokens, get_api_token_by_hash, touch_api_token, delete_api_token,
)

router = APIRouter()


# ── Caddy forward_auth gate ───────────────────────────────────────────────────
@router.get("/api/auth/check", include_in_schema=False)
def auth_check(request: Request):
    """Called by Caddy forward_auth before proxying to Flower."""
    from app.auth import get_current_user, hash_token
    if get_current_user(request):
        return Response(status_code=200)
    raw = (request.headers.get("x-api-token")
           or request.headers.get("x-admin-token"))
    if raw:
        th = hash_token(raw)
        tok = get_api_token_by_hash(th)
        if tok:
            touch_api_token(th)
            return Response(status_code=200)
    next_path = request.headers.get("x-forwarded-uri", "/flower/")
    return RedirectResponse(f"/login?next={next_path}", status_code=302)


# ── Auth endpoints ────────────────────────────────────────────────────────────
@router.get("/api/auth/status")
def auth_status(request: Request):
    from app.auth import get_current_user
    from app.crypto import encryption_configured
    setup_needed = not users_exist()
    user = get_current_user(request)
    return {
        "setup_needed": setup_needed,
        "logged_in": user is not None,
        "encryption_configured": encryption_configured(),
        "user": {"id": user["id"], "username": user["username"],
                 "email": user["email"], "role": user["role"]} if user else None,
    }


class SetupBody(BaseModel):
    username: str
    email: str
    password: str


@router.post("/api/auth/setup")
def auth_setup(body: SetupBody):
    from app.auth import hash_password, hash_token, generate_token, SESSION_COOKIE, SESSION_DAYS
    if users_exist():
        raise HTTPException(400, "Setup already completed — an owner account already exists")
    if len(body.password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    user = create_user(body.username.strip(), body.email.strip().lower(),
                       hash_password(body.password), "owner")
    token = generate_token()
    create_session(user["id"], hash_token(token))
    resp = JSONResponse({"ok": True, "user": {"id": user["id"],
                         "username": user["username"], "role": user["role"]}})
    resp.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax",
                    max_age=SESSION_DAYS * 86400)
    return resp


class LoginBody(BaseModel):
    username: str
    password: str


@router.post("/api/auth/login")
def auth_login(body: LoginBody, request: Request):
    from app.auth import verify_password, hash_token, generate_token, SESSION_COOKIE, SESSION_DAYS
    # Prefer X-Forwarded-For (set by Caddy/nginx) so we rate-limit the real client
    ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
          or request.client.host
          or "unknown")
    _check_login_allowed(ip)
    user = get_user_by_username(body.username.strip())
    if not user or not verify_password(body.password, user["password_hash"]):
        _record_login_failure(ip)
        raise HTTPException(401, "Invalid username or password")
    _clear_login_failures(ip)
    token = generate_token()
    create_session(user["id"], hash_token(token))
    resp = JSONResponse({"ok": True, "user": {"id": user["id"],
                         "username": user["username"], "role": user["role"]}})
    resp.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax",
                    max_age=SESSION_DAYS * 86400)
    return resp


@router.post("/api/auth/logout")
def auth_logout(request: Request):
    from app.auth import SESSION_COOKIE, hash_token
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        delete_session_by_token_hash(hash_token(token))
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE)
    return resp


@router.get("/api/auth/me")
def auth_me(request: Request):
    user = _check_admin(request)
    return {"id": user["id"], "username": user["username"],
            "email": user.get("email", ""), "role": user["role"]}


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


@router.post("/api/auth/change-password")
def auth_change_password(body: ChangePasswordBody, request: Request):
    from app.auth import verify_password, hash_password
    user = _check_admin(request)
    if user["id"] == 0:
        raise HTTPException(400, "Token-based admin cannot change password here")
    db_user = get_user_by_id(user["id"])
    if not verify_password(body.current_password, db_user["password_hash"]):
        raise HTTPException(401, "Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(422, "New password must be at least 8 characters")
    update_user_password(user["id"], hash_password(body.new_password))
    return {"ok": True}


# ── User management ───────────────────────────────────────────────────────────
@router.get("/api/users")
def api_list_users(request: Request):
    _require_writer(request)
    return list_users()


class CreateUserBody(BaseModel):
    username: str
    email: str
    password: str
    role: str = "viewer"


@router.post("/api/users")
def api_create_user(body: CreateUserBody, request: Request):
    from app.auth import hash_password
    actor = _require_writer(request)
    if body.role == "owner":
        raise HTTPException(400, "Cannot create another owner account")
    if body.role == "admin" and actor.get("role") != "owner":
        raise HTTPException(403, "Only owner can create admin accounts")
    if body.role not in ("viewer", "admin"):
        raise HTTPException(422, f"Invalid role '{body.role}'")
    if len(body.password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    try:
        user = create_user(body.username.strip(), body.email.strip().lower(),
                           hash_password(body.password), body.role)
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"id": user["id"], "username": user["username"],
            "email": user["email"], "role": user["role"]}


class UpdateRoleBody(BaseModel):
    role: str


@router.patch("/api/users/{user_id}/role")
def api_update_user_role(user_id: int, body: UpdateRoleBody, request: Request):
    _require_owner(request)
    target = get_user_by_id(user_id)
    if not target:
        raise HTTPException(404, "User not found")
    if target["role"] == "owner":
        raise HTTPException(400, "Cannot change the owner's role")
    if body.role == "owner":
        raise HTTPException(400, "Cannot promote to owner")
    if body.role not in ("viewer", "admin"):
        raise HTTPException(422, f"Invalid role '{body.role}'")
    update_user_role(user_id, body.role)
    return {"ok": True}


class ResetPasswordBody(BaseModel):
    new_password: str


@router.post("/api/users/{user_id}/reset-password")
def api_reset_user_password(user_id: int, body: ResetPasswordBody, request: Request):
    from app.auth import hash_password
    actor = _require_writer(request)
    target = get_user_by_id(user_id)
    if not target:
        raise HTTPException(404, "User not found")
    if target["role"] == "owner" and actor.get("role") != "owner":
        raise HTTPException(403, "Only owner can reset the owner's password")
    if len(body.new_password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    update_user_password(user_id, hash_password(body.new_password))
    return {"ok": True}


@router.delete("/api/users/{user_id}")
def api_delete_user(user_id: int, request: Request):
    actor = _require_writer(request)
    target = get_user_by_id(user_id)
    if not target:
        raise HTTPException(404, "User not found")
    if target["role"] == "owner":
        raise HTTPException(400, "Cannot delete the owner account")
    if actor.get("id") == user_id:
        raise HTTPException(400, "Cannot delete your own account")
    delete_user(user_id)
    return {"ok": True}


# ── API token management ──────────────────────────────────────────────────────
@router.get("/api/tokens")
def api_list_tokens(request: Request):
    _require_owner(request)
    return list_api_tokens()


class CreateTokenBody(BaseModel):
    name: str
    scope: str = "manage"
    expires_days: int | None = None   # None = never expires


@router.post("/api/tokens")
def api_create_token(body: CreateTokenBody, request: Request):
    from app.auth import hash_token
    from app.core.db import API_TOKEN_SCOPES
    import datetime as _dt
    actor = _require_owner(request)
    if not body.name.strip():
        raise HTTPException(422, "Token name is required")
    if body.scope not in API_TOKEN_SCOPES:
        raise HTTPException(422, f"scope must be one of {list(API_TOKEN_SCOPES)}")
    expires_at = None
    if body.expires_days is not None:
        if body.expires_days < 1:
            raise HTTPException(422, "expires_days must be at least 1")
        expires_at = _dt.datetime.utcnow() + _dt.timedelta(days=body.expires_days)
    raw = "hr_" + _sec.token_hex(32)
    th  = hash_token(raw)
    tok = create_api_token(body.name.strip(), th, actor.get("id") or None,
                           scope=body.scope, expires_at=expires_at)
    return {
        "id": tok["id"], "name": tok["name"],
        "created_at": tok["created_at"],
        "scope": tok["scope"],
        "expires_at": tok["expires_at"],
        "token": raw,
    }


@router.delete("/api/tokens/{token_id}")
def api_delete_token(token_id: int, request: Request):
    _require_owner(request)
    delete_api_token(token_id)
    return {"ok": True}
