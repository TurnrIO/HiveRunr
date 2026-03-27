"""Authentication helpers — session-cookie based auth (v12)."""
import hashlib, secrets
from passlib.context import CryptContext
from fastapi import Request

from app.core.db import (
    get_user_by_id,
    get_session_by_token_hash,
    refresh_session,
)

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

SESSION_COOKIE = "hr_session"
SESSION_DAYS   = 30


def hash_password(password: str) -> str:
    return _pwd.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd.verify(plain, hashed)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def generate_token() -> str:
    return secrets.token_hex(32)


def get_current_user(request: Request):
    """Return the authenticated user dict, or None if not logged in."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    th = hash_token(token)
    session = get_session_by_token_hash(th)
    if not session:
        return None
    refresh_session(th)
    return get_user_by_id(session["user_id"])
