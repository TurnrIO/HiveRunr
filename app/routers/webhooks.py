"""Webhook trigger router + rate limiting."""
import json
import os
from fastapi import APIRouter, HTTPException, Request

from app.core.db import get_graph_by_token
from app.worker import enqueue_graph

router = APIRouter()

_WEBHOOK_RATE_LIMIT  = int(os.environ.get("WEBHOOK_RATE_LIMIT", "60"))
_WEBHOOK_RATE_WINDOW = int(os.environ.get("WEBHOOK_RATE_WINDOW", "60"))


def _check_webhook_rate(token: str) -> bool:
    """Returns True if the request is allowed, False if rate-limited."""
    if _WEBHOOK_RATE_LIMIT <= 0:
        return True
    try:
        import redis as _redis
        r = _redis.from_url(os.environ.get("CELERY_BROKER_URL", "redis://redis:6379/0"))
        key = f"wh_rate:{token}"
        pipe = r.pipeline()
        pipe.incr(key)
        pipe.expire(key, _WEBHOOK_RATE_WINDOW)
        count, _ = pipe.execute()
        return count <= _WEBHOOK_RATE_LIMIT
    except Exception:
        return True


@router.post("/webhook/{token}")
async def webhook_trigger(token: str, request: Request):
    g = get_graph_by_token(token)
    if not g:
        raise HTTPException(404, "Unknown webhook token")
    if not g.get('enabled'):
        raise HTTPException(403, "Graph is disabled")
    if not _check_webhook_rate(token):
        raise HTTPException(429, f"Rate limit exceeded — max {_WEBHOOK_RATE_LIMIT} calls per {_WEBHOOK_RATE_WINDOW}s")
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    task = enqueue_graph.delay(g['id'], payload)
    try:
        from app.core.db import get_conn
        with get_conn() as conn:
            conn.cursor().execute(
                "INSERT INTO runs(task_id, graph_id, status, initial_payload) VALUES(%s,%s,'queued',%s)",
                (task.id, g['id'], json.dumps(payload))
            )
    except Exception:
        pass
    return {"queued": True, "task_id": task.id, "graph": g["name"]}
