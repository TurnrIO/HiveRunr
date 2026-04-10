"""Runs router — list, delete, trim, replay."""
import json
import logging
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel
from typing import Optional

from app.deps import _check_admin, _require_run_scope, _require_manage_scope
from app.core.db import (
    list_runs, delete_run, clear_runs, get_run_by_task, update_run, get_graph,
    trim_runs_by_count, trim_runs_by_age,
    get_retention_policy, set_retention_policy,
    log_audit,
)

log = logging.getLogger(__name__)
router = APIRouter()


def _sync_stuck_runs():
    """Reconcile queued/running runs against the Celery result backend."""
    try:
        from app.core.db import get_conn
        import psycopg2.extras
        from celery.result import AsyncResult
        from app.worker import app as _celery_app
        with get_conn() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("""
                SELECT task_id, workflow, status,
                       EXTRACT(EPOCH FROM (NOW() - created_at)) AS age_seconds
                FROM runs
                WHERE status IN ('queued','running')
                  AND created_at < NOW() - INTERVAL '5 seconds'
            """)
            stuck = cur.fetchall()
        for row in stuck:
            try:
                res   = AsyncResult(row['task_id'], app=_celery_app)
                state = res.state
                age   = float(row['age_seconds'] or 0)
                if state == 'SUCCESS':
                    update_run(row['task_id'], 'succeeded',
                               result=res.result if isinstance(res.result, dict) else {'output': str(res.result)})
                elif state == 'FAILURE':
                    err = str(res.result) if res.result else 'Task failed (check worker logs)'
                    update_run(row['task_id'], 'failed', result={'error': err})
                elif state == 'REVOKED':
                    update_run(row['task_id'], 'cancelled', result={'cancelled_by': 'celery_revoke'})
                elif state == 'PENDING':
                    if age > 120:
                        update_run(row['task_id'], 'failed',
                                   result={'error': 'Task was lost — worker may have been restarting. Please re-run.'})
                    elif row['workflow']:
                        from app.worker import enqueue_script as _enqueue_script
                        _enqueue_script.apply_async(args=[row['workflow'], {}], task_id=row['task_id'])
                        log.info(f"Re-dispatched lost task {row['task_id']} for {row['workflow']}")
            except Exception:
                pass
    except Exception:
        pass


@router.get("/api/runs")
def api_runs(
    request: Request,
    page:      int            = Query(1,   ge=1,   description="Page number (1-based)"),
    page_size: int            = Query(50,  ge=1, le=200, description="Rows per page"),
    status:    Optional[str]  = Query(None, description="Filter by status"),
    flow_id:   Optional[int]  = Query(None, description="Filter by graph_workflows.id"),
    q:         Optional[str]  = Query(None, description="Search flow name / task_id"),
):
    _check_admin(request)
    _sync_stuck_runs()
    return list_runs(page=page, page_size=page_size, status=status, flow_id=flow_id, q=q)


@router.get("/api/runs/by-task/{task_id}")
def api_run_by_task(task_id: str, request: Request):
    """Lightweight single-run polling endpoint — used by canvas during execution."""
    _check_admin(request)
    run = get_run_by_task(task_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@router.delete("/api/runs/{run_id}")
def api_delete_run(run_id: int, request: Request):
    user = _require_manage_scope(request)
    delete_run(run_id)
    log_audit(user["username"], "run.delete", "run", run_id, None,
              request.client.host if request.client else None)
    return {"deleted": True}


@router.delete("/api/runs")
def api_clear_runs(request: Request):
    user = _require_manage_scope(request)
    clear_runs()
    log_audit(user["username"], "run.clear_all", None, None, None,
              request.client.host if request.client else None)
    return {"cleared": True}


class TrimRunsBody(BaseModel):
    keep: int = 100
    days: Optional[int] = None   # if set, trim by age instead of count


@router.post("/api/runs/trim")
def api_trim_runs(body: TrimRunsBody, request: Request):
    """Trim run history.

    - `keep` (default 100): keep the N most recent runs, delete the rest.
    - `days`: delete runs older than N days (takes precedence over `keep` when set).
    """
    user = _require_manage_scope(request)
    if body.days is not None:
        deleted = trim_runs_by_age(body.days)
        log_audit(user["username"], "run.trim", None, None,
                  {"mode": "age", "older_than_days": body.days, "deleted": deleted},
                  request.client.host if request.client else None)
        return {"deleted": deleted, "mode": "age", "older_than_days": body.days}
    else:
        deleted = trim_runs_by_count(body.keep)
        log_audit(user["username"], "run.trim", None, None,
                  {"mode": "count", "kept": body.keep, "deleted": deleted},
                  request.client.host if request.client else None)
        return {"deleted": deleted, "mode": "count", "kept": body.keep}


# ── Retention policy settings ─────────────────────────────────────────────────
@router.get("/api/runs/retention")
def api_get_retention(request: Request):
    _require_manage_scope(request)
    return get_retention_policy()


class RetentionBody(BaseModel):
    enabled: bool = False
    mode:    str  = "count"   # "count" | "age"
    count:   int  = 500
    days:    int  = 30


@router.put("/api/runs/retention")
def api_set_retention(body: RetentionBody, request: Request):
    user = _require_manage_scope(request)
    if body.mode not in ("count", "age"):
        raise HTTPException(422, "mode must be 'count' or 'age'")
    if body.count < 1:
        raise HTTPException(422, "count must be ≥ 1")
    if body.days < 1:
        raise HTTPException(422, "days must be ≥ 1")
    set_retention_policy(body.enabled, body.mode, body.count, body.days)
    log_audit(user["username"], "settings.retention", None, None,
              {"enabled": body.enabled, "mode": body.mode,
               "count": body.count, "days": body.days},
              request.client.host if request.client else None)
    return get_retention_policy()


@router.post("/api/runs/{run_id}/cancel")
def api_cancel_run(run_id: int, request: Request):
    """Revoke a queued or running Celery task and mark it cancelled.

    Uses terminate=True so an already-executing task is sent SIGTERM and
    stopped immediately.  Safe to call on a task that has already finished —
    Celery silently ignores the revoke in that case, and we only update the
    DB row if the run is still in a cancellable state.
    """
    user = _require_run_scope(request)
    from app.core.db import get_conn
    import psycopg2.extras
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT task_id, status FROM runs WHERE id=%s", (run_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, f"Run {run_id} not found")
    if row["status"] not in ("queued", "running"):
        raise HTTPException(400, f"Run is already {row['status']} — cannot cancel")
    task_id = row["task_id"]
    try:
        from celery.result import AsyncResult
        from app.worker import app as _celery_app
        AsyncResult(task_id, app=_celery_app).revoke(terminate=True, signal="SIGTERM")
    except Exception as exc:
        log.warning("Could not revoke Celery task %s: %s", task_id, exc)
    update_run(task_id, "cancelled", result={"cancelled_by": "user"})
    log_audit(user["username"], "run.cancel", "run", run_id,
              {"task_id": task_id},
              request.client.host if request.client else None)
    return {"cancelled": True, "run_id": run_id, "task_id": task_id}


@router.post("/api/runs/{run_id}/replay")
def api_replay_run(run_id: int, request: Request):
    """Re-enqueue a past run using its stored initial_payload."""
    user = _require_run_scope(request)
    from app.core.db import get_conn
    from app.worker import enqueue_graph
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT graph_id, initial_payload FROM runs WHERE id=%s", (run_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, f"Run {run_id} not found")
    graph_id, initial_payload = row
    if not graph_id:
        raise HTTPException(400, "Run is not associated with a graph (script run?)")
    g = get_graph(graph_id)
    if not g:
        raise HTTPException(404, f"Graph {graph_id} not found")
    try:
        payload = json.loads(initial_payload) if initial_payload else {}
    except Exception:
        payload = {}
    task = enqueue_graph.delay(graph_id, payload)
    with get_conn() as conn:
        conn.cursor().execute(
            "INSERT INTO runs(task_id, graph_id, status, initial_payload) VALUES(%s,%s,'queued',%s)",
            (task.id, graph_id, json.dumps(payload))
        )
    log_audit(user["username"], "run.replay", "graph", graph_id,
              {"replayed_run_id": run_id, "task_id": task.id, "graph": g["name"]},
              request.client.host if request.client else None)
    return {"queued": True, "task_id": task.id, "graph": g["name"], "replayed_run_id": run_id}
