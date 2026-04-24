"""Webhook trigger router + rate limiting."""
import hashlib
import hmac
import json
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app.core.db import get_graph_by_token, get_ratelimit_policy
from app.worker import enqueue_graph

router = APIRouter()


def _check_webhook_rate(token: str) -> tuple[bool, int, int]:
    """Returns (allowed, limit, window). Reads config live from app_settings."""
    policy = get_ratelimit_policy()
    limit  = policy["limit"]
    window = policy["window"]
    if limit <= 0:
        return True, limit, window
    try:
        import redis as _redis
        r = _redis.from_url(os.environ.get("REDIS_URL", "redis://redis:6379/0"))
        key = f"wh_rate:{token}"
        pipe = r.pipeline()
        pipe.incr(key)
        pipe.expire(key, window)
        count, _ = pipe.execute()
        return count <= limit, limit, window
    except Exception:
        return True, limit, window


def _get_webhook_trigger_config(g: dict) -> dict:
    """Extract the config of the first trigger.webhook node from graph_data."""
    try:
        graph_data = g.get("graph_data") or {}
        if isinstance(graph_data, str):
            graph_data = json.loads(graph_data)
        nodes = graph_data.get("nodes", [])
        for node in nodes:
            if node.get("type") == "trigger.webhook" or node.get("data", {}).get("type") == "trigger.webhook":
                return node.get("data", {}).get("config", {})
    except Exception:
        pass
    return {}


def _verify_hmac(secret: str, body: bytes, signature_header: str) -> bool:
    """Verify X-Hub-Signature-256 header (same convention as GitHub webhooks)."""
    if not signature_header:
        return False
    expected = "sha256=" + hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)


@router.post("/webhook/{token}")
async def webhook_trigger(token: str, request: Request):
    g = get_graph_by_token(token)
    if not g:
        raise HTTPException(404, "Unknown webhook token")
    if not g.get("enabled"):
        raise HTTPException(403, "Graph is disabled")

    allowed, limit, window = _check_webhook_rate(token)
    if not allowed:
        raise HTTPException(429, f"Rate limit exceeded — max {limit} calls per {window}s")

    cfg = _get_webhook_trigger_config(g)

    # ── CORS / allowed origins ─────────────────────────────────────────────
    allowed_origins_raw = cfg.get("allowed_origins", "").strip()
    origin = request.headers.get("origin", "")
    if allowed_origins_raw and origin:
        allowed_list = [o.strip() for o in allowed_origins_raw.splitlines() if o.strip()]
        if allowed_list and origin not in allowed_list and "*" not in allowed_list:
            raise HTTPException(403, f"Origin '{origin}' is not allowed")

    # ── Read raw body (needed for HMAC verification before parsing JSON) ───
    body = await request.body()

    # ── HMAC-SHA256 signature verification ────────────────────────────────
    secret = cfg.get("secret", "").strip()
    if secret:
        sig_header = request.headers.get("x-hub-signature-256", "")
        if not sig_header:
            raise HTTPException(401, "Missing X-Hub-Signature-256 header (HMAC secret configured)")
        if not _verify_hmac(secret, body, sig_header):
            raise HTTPException(401, "Invalid webhook signature")

    # ── Parse payload ──────────────────────────────────────────────────────
    try:
        payload = json.loads(body) if body else {}
    except Exception:
        payload = {}

    task = enqueue_graph.delay(g["id"], payload)
    try:
        from app.core.db import get_conn
        with get_conn() as conn:
            conn.cursor().execute(
                "INSERT INTO runs(task_id, graph_id, status, initial_payload) VALUES(%s,%s,'queued',%s)",
                (task.id, g["id"], json.dumps(payload))
            )
    except Exception:
        pass

    # ── CORS response headers ──────────────────────────────────────────────
    headers = {}
    if allowed_origins_raw and origin:
        headers["Access-Control-Allow-Origin"] = origin
    elif not allowed_origins_raw:
        headers["Access-Control-Allow-Origin"] = "*"

    return JSONResponse(
        {"queued": True, "task_id": task.id, "graph": g["name"]},
        headers=headers,
    )


@router.options("/webhook/{token}")
async def webhook_preflight(token: str, request: Request):
    """Handle CORS preflight for webhook endpoints."""
    g = get_graph_by_token(token)
    cfg = _get_webhook_trigger_config(g) if g else {}
    allowed_origins_raw = cfg.get("allowed_origins", "").strip()
    origin = request.headers.get("origin", "*")

    allow_origin = "*"
    if allowed_origins_raw:
        allowed = [o.strip() for o in allowed_origins_raw.splitlines() if o.strip()]
        allow_origin = origin if origin in allowed or "*" in allowed else "null"

    return JSONResponse(
        {},
        headers={
            "Access-Control-Allow-Origin":  allow_origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Hub-Signature-256",
            "Access-Control-Max-Age":       "86400",
        },
    )
