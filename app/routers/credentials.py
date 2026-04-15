"""Credentials router."""
import json
import logging
import time
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.deps import _check_admin, _resolve_workspace
from app.core.db import list_credentials, upsert_credential, update_credential, delete_credential

log = logging.getLogger(__name__)
router = APIRouter()


class CredCreate(BaseModel):
    name: str; type: str = "generic"; secret: str; note: str = ""


class CredUpdate(BaseModel):
    type: str = "generic"
    secret: Optional[str] = ""
    note: str = ""


@router.get("/api/credentials")
def api_creds(request: Request):
    user = _check_admin(request)
    workspace_id = _resolve_workspace(request, user)
    return list_credentials(workspace_id=workspace_id)


@router.post("/api/credentials")
def api_cred_create(body: CredCreate, request: Request):
    user = _check_admin(request)
    workspace_id = _resolve_workspace(request, user)
    return upsert_credential(body.name, body.type, body.secret, body.note, workspace_id=workspace_id)


@router.put("/api/credentials/{cred_id}")
def api_cred_update(cred_id: int, body: CredUpdate, request: Request):
    _check_admin(request)
    return update_credential(cred_id, body.type, body.secret or "", body.note)


@router.delete("/api/credentials/{cred_id}")
def api_cred_delete(cred_id: int, request: Request):
    _check_admin(request); delete_credential(cred_id); return {"deleted": True}


# ── Credential probe ──────────────────────────────────────────────────────────

def _probe_smtp(cred: dict) -> str:
    import smtplib, ssl as _ssl
    host     = cred.get("host", "") or cred.get("smtp_host", "")
    port     = int(cred.get("port", 587) or 587)
    user     = cred.get("user") or cred.get("username") or cred.get("smtp_user", "")
    password = cred.get("pass") or cred.get("password") or cred.get("smtp_pass", "")
    if not host:
        raise ValueError("SMTP: 'host' is required")
    if port == 465:
        ctx  = _ssl.create_default_context()
        smtp = smtplib.SMTP_SSL(host, port, timeout=10, context=ctx)
    else:
        smtp = smtplib.SMTP(host, port, timeout=10)
        smtp.ehlo()
        if port == 587:
            smtp.starttls()
            smtp.ehlo()
    try:
        if user and password:
            smtp.login(user, password)
            return f"Connected and authenticated to {host}:{port}"
        return f"Connected to {host}:{port} (no auth credentials — check user/pass fields)"
    finally:
        smtp.quit()


def _probe_sftp(cred: dict) -> str:
    import paramiko
    host     = cred.get("host", "")
    port     = int(cred.get("port", 22) or 22)
    username = cred.get("username", "")
    password = cred.get("password", "")
    key_pem  = cred.get("key", "")
    if not host:
        raise ValueError("SFTP: 'host' is required")
    transport = paramiko.Transport((host, port))
    transport.banner_timeout    = 10
    transport.handshake_timeout = 10
    try:
        pkey = None
        if key_pem:
            import io
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(key_pem))
        transport.connect(username=username or None, password=password or None, pkey=pkey)
        sftp = paramiko.SFTPClient.from_transport(transport)
        try:
            sftp.listdir("/")
        except Exception:
            pass   # permission denied is fine — we connected OK
        sftp.close()
    finally:
        transport.close()
    return f"SFTP connected to {host}:{port} as {username or '(anonymous)'}"


def _probe_ssh(cred: dict) -> str:
    import paramiko
    host     = cred.get("host", "")
    port     = int(cred.get("port", 22) or 22)
    username = cred.get("username", "")
    password = cred.get("password", "")
    key_pem  = cred.get("key", "")
    if not host:
        raise ValueError("SSH: 'host' is required")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = None
    if key_pem:
        import io
        pkey = paramiko.RSAKey.from_private_key(io.StringIO(key_pem))
    client.connect(host, port=port, username=username or None,
                   password=password or None, pkey=pkey,
                   timeout=10, allow_agent=False, look_for_keys=False)
    client.close()
    return f"SSH connected to {host}:{port} as {username or '(anonymous)'}"


def _probe_imap(cred: dict) -> str:
    import imaplib
    host     = cred.get("host", "")
    port     = int(cred.get("port", 993) or 993)
    username = cred.get("username", "")
    password = cred.get("password", "")
    use_ssl  = str(cred.get("use_ssl", "true")).lower() not in ("false", "0", "no")
    if not host:
        raise ValueError("IMAP: 'host' is required")
    conn = imaplib.IMAP4_SSL(host, port) if use_ssl else imaplib.IMAP4(host, port)
    try:
        conn.login(username, password)
        conn.logout()
    except Exception:
        conn.logout()
        raise
    return f"IMAP authenticated at {host}:{port} as {username}"


def _probe_sql(cred: dict) -> str:
    dsn    = cred.get("dsn", "").strip()
    driver = cred.get("driver", "").lower()
    if not driver and dsn:
        if dsn.startswith(("postgresql://", "postgres://")):
            driver = "postgresql"
        elif dsn.lower().startswith("mysql"):
            driver = "mysql"
        elif dsn.lower().startswith("sqlite"):
            driver = "sqlite"
        else:
            driver = "postgresql"
    if not driver:
        driver = "postgresql"

    if driver == "sqlite":
        import sqlite3
        db_path = dsn.replace("sqlite:///", "") or cred.get("database", "")
        conn = sqlite3.connect(db_path, timeout=10)
        conn.execute("SELECT 1")
        conn.close()
        return f"SQLite connected to {db_path}"

    if driver == "mysql":
        try:
            import pymysql
        except ImportError:
            raise RuntimeError("MySQL requires pymysql: pip install pymysql")
        conn = pymysql.connect(
            host=cred.get("host", "localhost"),
            user=cred.get("username") or cred.get("user", ""),
            passwd=cred.get("password") or cred.get("pass", ""),
            db=cred.get("database", ""),
            port=int(cred.get("port", 3306) or 3306),
            connect_timeout=10,
        )
        conn.close()
        return f"MySQL connected to {cred.get('host')}:{cred.get('port', 3306)}"

    # PostgreSQL
    import psycopg2
    if dsn:
        conn = psycopg2.connect(dsn, connect_timeout=10)
    else:
        conn = psycopg2.connect(
            host=cred.get("host", "localhost"),
            user=cred.get("username") or cred.get("user", ""),
            password=cred.get("password") or cred.get("pass", ""),
            dbname=cred.get("database", ""),
            port=int(cred.get("port", 5432) or 5432),
            connect_timeout=10,
        )
    try:
        conn.cursor().execute("SELECT 1")
    finally:
        conn.close()
    return f"PostgreSQL connected to {cred.get('host') or dsn}"


def _probe_s3(cred: dict) -> str:
    try:
        import boto3
    except ImportError:
        raise RuntimeError("S3 probe requires boto3: pip install boto3")
    access_key = cred.get("access_key") or cred.get("access_key_id", "")
    secret_key = cred.get("secret_key") or cred.get("secret_access_key", "")
    region     = cred.get("region", "us-east-1")
    endpoint   = cred.get("endpoint_url", "").strip() or None
    kw = dict(aws_access_key_id=access_key, aws_secret_access_key=secret_key,
              region_name=region)
    if endpoint:
        kw["endpoint_url"] = endpoint
    # STS get-caller-identity is a lightweight credential check for real AWS
    if not endpoint:
        sts = boto3.client("sts", **kw)
        identity = sts.get_caller_identity()
        return f"AWS credentials valid — account {identity.get('Account')}, ARN: {identity.get('Arn')}"
    # For S3-compatible services (MinIO etc.) do a lightweight list_buckets
    s3 = boto3.client("s3", **kw)
    resp = s3.list_buckets()
    count = len(resp.get("Buckets", []))
    return f"S3-compatible endpoint reachable — {count} bucket(s) accessible"


def _probe_telegram(cred: dict) -> str:
    import httpx
    token = cred.get("secret") or cred.get("bot_token", "")
    if not token:
        raise ValueError("Telegram: 'secret' (bot token) is required")
    resp = httpx.get(f"https://api.telegram.org/bot{token}/getMe", timeout=10)
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(data.get("description", "Telegram rejected the token"))
    bot = data.get("result", {})
    return f"Telegram bot @{bot.get('username')} ({bot.get('first_name')}) is active"


def _probe_openai(cred: dict) -> str:
    import httpx
    api_key  = cred.get("secret") or cred.get("key", "")
    base_url = (cred.get("base_url") or "https://api.openai.com/v1").rstrip("/")
    if not api_key:
        raise ValueError("OpenAI: 'secret' (API key) is required")
    resp = httpx.get(f"{base_url}/models", headers={"Authorization": f"Bearer {api_key}"}, timeout=10)
    if resp.status_code == 401:
        raise RuntimeError("Invalid API key (401 Unauthorized)")
    if resp.status_code not in (200, 206):
        raise RuntimeError(f"HTTP {resp.status_code} from {base_url}")
    count = len(resp.json().get("data", []))
    return f"API key valid — {count} model(s) accessible at {base_url}"


def _detect_and_probe(type_col: str, cred: dict) -> tuple:
    """Return (detected_type, message). Raises on probe failure."""
    # Type-column-first for unambiguous types
    if type_col == "smtp":
        return "smtp", _probe_smtp(cred)
    if type_col == "sftp":
        return "sftp", _probe_sftp(cred)
    if type_col == "ssh":
        return "ssh", _probe_ssh(cred)
    if type_col == "aws":
        return "aws", _probe_s3(cred)
    if type_col == "telegram":
        return "telegram", _probe_telegram(cred)
    if type_col == "openai_api":
        return "openai_api", _probe_openai(cred)

    # Field-based detection for generic / database / custom types
    if cred.get("access_key") and cred.get("secret_key"):
        return "s3", _probe_s3(cred)
    if cred.get("access_key_id") and cred.get("secret_access_key"):
        return "aws", _probe_s3(cred)
    if cred.get("dsn") or (cred.get("database") and cred.get("host")):
        return "sql", _probe_sql(cred)
    if cred.get("host") and (cred.get("user") or cred.get("smtp_user")):
        port = int(cred.get("port", 587) or 587)
        if port in (25, 465, 587, 2525):
            return "smtp", _probe_smtp(cred)
    if cred.get("host") and cred.get("username"):
        port = int(cred.get("port", 22) or 22)
        use_ssl = str(cred.get("use_ssl", "")).lower() in ("true", "1")
        if port in (143, 993) or use_ssl:
            return "imap", _probe_imap(cred)
        if port == 22 and cred.get("key"):
            return "ssh", _probe_ssh(cred)
        return "sftp", _probe_sftp(cred)
    secret = str(cred.get("secret", ""))
    if secret.startswith("sk-") or cred.get("base_url", "").startswith("http"):
        return "openai_api", _probe_openai(cred)
    if cred.get("chat_id") or (secret and ":" in secret):
        return "telegram", _probe_telegram(cred)

    # Generic — just confirm it's valid, non-empty JSON
    if not cred:
        return "generic", "Credential is empty"
    fields = ", ".join(list(cred.keys())[:5])
    return "generic", f"Valid credential JSON ({fields}{'…' if len(cred) > 5 else ''})"


@router.post("/api/credentials/{cred_id}/test")
def api_cred_test(cred_id: int, request: Request):
    """Probe the credential to verify it works against its target service."""
    _check_admin(request)

    from app.core.db import get_conn
    from app.crypto import decrypt
    import psycopg2.extras

    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id, name, type, secret FROM credentials WHERE id=%s", (cred_id,))
        row = cur.fetchone()

    if not row:
        raise HTTPException(404, "Credential not found")

    type_col = row.get("type", "generic") or "generic"
    try:
        raw  = decrypt(row["secret"])
        cred = json.loads(raw) if raw and raw.strip().startswith("{") else {"secret": raw}
    except Exception:
        cred = {}

    t0 = time.monotonic()
    try:
        detected_type, message = _detect_and_probe(type_col, cred)
        ok = True
    except Exception as exc:
        detected_type = type_col
        message = str(exc)
        ok = False
        log.info("Credential test failed for id=%s: %s", cred_id, exc)

    latency_ms = int((time.monotonic() - t0) * 1000)
    return {
        "ok":         ok,
        "message":    message,
        "type":       detected_type,
        "latency_ms": latency_ms,
    }
