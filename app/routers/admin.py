"""Admin, maintenance, system status, metrics, scripts, nodes, and templates routers."""
import json
import re as _re
import uuid
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query, Request
from typing import Optional

from app.deps import _check_admin, _require_owner
from app.core.db import log_audit, get_audit_log

SCRIPTS_DIR   = Path(__file__).parent.parent / 'workflows'
TEMPLATES_DIR = Path(__file__).parent.parent / 'templates'

router = APIRouter()


# ── Prometheus /metrics ───────────────────────────────────────────────────────
@router.get("/metrics", include_in_schema=False)
def prometheus_metrics(request: Request):
    """Prometheus text exposition — auth-gated so metrics aren't public."""
    _check_admin(request)
    from app.observability import metrics_response
    return metrics_response()



# ── System status ─────────────────────────────────────────────────────────────
@router.get("/api/system/status")
def api_system_status(request: Request):
    """Rich system health + info for the Settings page."""
    import os, sys, platform, socket
    _check_admin(request)
    results = {}
    try:
        from app.core.db import get_conn
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM runs")
            run_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM graph_workflows")
            flow_count = cur.fetchone()[0]
            cur.execute("SELECT pg_size_pretty(pg_database_size(current_database())) AS sz")
            db_size = cur.fetchone()[0]
        results["db"] = {"status": "ok", "run_count": run_count, "flow_count": flow_count, "db_size": db_size}
    except Exception as e:
        results["db"] = {"status": "error", "error": str(e)}
    try:
        from app.worker import app as celery_app
        redis_url = celery_app.conf.broker_url or ""
        import redis as _redis
        r = _redis.from_url(redis_url, socket_connect_timeout=2)
        r.ping()
        results["redis"] = {"status": "ok", "url": redis_url.split("@")[-1]}
    except Exception as e:
        results["redis"] = {"status": "error", "error": str(e)}
    try:
        from app.worker import app as celery_app
        pong = celery_app.control.ping(timeout=2)
        worker_count = len(pong)
        results["worker"] = {"status": "ok" if worker_count else "warning", "workers": worker_count}
    except Exception as e:
        results["worker"] = {"status": "error", "error": str(e)}
    results["system"] = {
        "app_version":  "8",
        "python":       sys.version.split()[0],
        "platform":     platform.system() + " " + platform.release(),
        "hostname":     socket.gethostname(),
        "pid":          os.getpid(),
        "app_timezone": os.environ.get("APP_TIMEZONE", "UTC"),
    }
    return results


# ── Metrics ───────────────────────────────────────────────────────────────────
@router.get("/api/metrics")
def api_metrics(request: Request):
    from app.core.db import get_run_metrics
    _check_admin(request)
    return get_run_metrics()


# ── Run logs ──────────────────────────────────────────────────────────────────
RUNLOGS_DIR = Path("/app/runlogs")


@router.get("/api/runlogs")
def api_runlogs(request: Request):
    _check_admin(request)
    if not RUNLOGS_DIR.exists():
        return []
    return sorted([f.name for f in RUNLOGS_DIR.glob("*.log")], reverse=True)[:50]


@router.get("/api/runlogs/{filename}")
def api_runlog_file(filename: str, request: Request):
    _check_admin(request)
    p = RUNLOGS_DIR / filename
    if not p.exists() or not p.name.endswith(".log"):
        raise HTTPException(404)
    return {"content": p.read_text(errors="replace")[-8000:]}


# ── Admin reset + maintenance ─────────────────────────────────────────────────
@router.post("/api/admin/reset")
def api_reset(request: Request):
    user = _check_admin(request)
    from app.core.db import get_conn
    with get_conn() as conn:
        cur = conn.cursor()
        for t in ["runs", "schedules", "graph_versions", "graph_workflows", "workflows"]:
            cur.execute(f"DELETE FROM {t}")
    log_audit(user["username"], "admin.reset", None, None, {"tables": "runs,schedules,graph_versions,graph_workflows,workflows"},
              request.client.host if request.client else None)
    return {"reset": True}


@router.post("/api/maintenance/reset_sequences")
def api_reset_sequences(request: Request):
    """Reset all PostgreSQL SERIAL sequences back to 1."""
    user = _require_owner(request)
    from app.core.db import get_conn
    tables = [
        "runs", "workflows", "schedules", "graph_workflows",
        "credentials", "graph_versions", "users", "sessions", "api_tokens",
    ]
    with get_conn() as conn:
        cur = conn.cursor()
        for t in tables:
            cur.execute("SELECT setval(pg_get_serial_sequence(%s, 'id'), 1, false)", (t,))
    log_audit(user["username"], "admin.reset_sequences", None, None, None,
              request.client.host if request.client else None)
    return {"reset": True, "tables": tables}


# ── Node registry ─────────────────────────────────────────────────────────────
@router.get("/api/nodes")
def api_list_nodes(request: Request):
    _check_admin(request)
    from app.nodes import list_node_types
    return {"node_types": list_node_types()}


@router.post("/api/admin/reload_nodes")
def api_reload_nodes(request: Request):
    """Hot-reload custom nodes from app/nodes/custom/ without restarting."""
    _check_admin(request)
    from app.nodes import reload_custom, list_node_types
    reload_custom()
    return {"reloaded": True, "node_types": list_node_types()}


# ── Scripts ───────────────────────────────────────────────────────────────────
def _safe_script_name(name: str) -> str:
    if not _re.match(r'^[a-zA-Z][a-zA-Z0-9_]*$', name):
        raise HTTPException(400, "Script name must start with a letter and contain only letters, digits, underscores")
    if name.startswith('_'):
        raise HTTPException(400, "Script names starting with _ are reserved")
    return name


@router.get("/api/scripts")
def api_list_scripts(request: Request):
    _check_admin(request)
    scripts = []
    for p in sorted(SCRIPTS_DIR.glob("*.py")):
        if p.stem.startswith("_"):
            continue
        scripts.append({"name": p.stem, "size": p.stat().st_size, "modified": p.stat().st_mtime})
    return scripts


@router.get("/api/scripts/{name}")
def api_get_script(name: str, request: Request):
    _check_admin(request)
    _safe_script_name(name)
    p = SCRIPTS_DIR / f"{name}.py"
    if not p.exists():
        raise HTTPException(404, "Script not found")
    return {"name": name, "content": p.read_text(errors="replace")}


@router.post("/api/scripts")
async def api_create_script(request: Request):
    _check_admin(request)
    body = await request.json()
    name = _safe_script_name(body.get("name", ""))
    content = body.get("content", "# New script\n")
    p = SCRIPTS_DIR / f"{name}.py"
    if p.exists():
        raise HTTPException(409, "Script already exists")
    p.write_text(content)
    return {"name": name, "created": True}


@router.put("/api/scripts/{name}")
async def api_update_script(name: str, request: Request):
    _check_admin(request)
    _safe_script_name(name)
    body = await request.json()
    content = body.get("content", "")
    p = SCRIPTS_DIR / f"{name}.py"
    if not p.exists():
        raise HTTPException(404, "Script not found")
    p.write_text(content)
    return {"name": name, "saved": True}


@router.delete("/api/scripts/{name}")
def api_delete_script(name: str, request: Request):
    _check_admin(request)
    _safe_script_name(name)
    p = SCRIPTS_DIR / f"{name}.py"
    if not p.exists():
        raise HTTPException(404, "Script not found")
    p.unlink()
    return {"name": name, "deleted": True}


@router.post("/api/scripts/{name}/run")
async def api_run_script(name: str, request: Request):
    _check_admin(request)
    _safe_script_name(name)
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    from app.core.db import get_conn
    from app.worker import enqueue_script
    task_id = str(uuid.uuid4())
    with get_conn() as conn:
        conn.cursor().execute(
            "INSERT INTO runs(task_id,workflow,status) VALUES(%s,%s,'queued')",
            (task_id, name)
        )
    enqueue_script.apply_async(args=[name, payload], task_id=task_id)
    return {"task_id": task_id, "workflow": name}


# ── Workflow templates ────────────────────────────────────────────────────────
@router.get("/api/templates")
def api_list_templates(request: Request):
    _check_admin(request)
    TEMPLATES_DIR.mkdir(exist_ok=True)
    results = []
    for p in sorted(TEMPLATES_DIR.glob("*.json")):
        try:
            data = json.loads(p.read_text())
            results.append({
                "id":          p.stem,
                "name":        data.get("name", p.stem),
                "description": data.get("description", ""),
                "category":    data.get("category", "General"),
                "tags":        data.get("tags", []),
                "node_count":  len(data.get("graph_data", {}).get("nodes", [])),
            })
        except Exception:
            pass
    return results


@router.post("/api/templates/{template_id}/use")
def api_use_template(template_id: str, request: Request):
    """Instantiate a template as a new graph and return the created graph."""
    _check_admin(request)
    if not _re.match(r'^[a-zA-Z0-9_\-]+$', template_id):
        raise HTTPException(400, "Invalid template id")
    p = TEMPLATES_DIR / f"{template_id}.json"
    if not p.exists():
        raise HTTPException(404, f"Template '{template_id}' not found")
    data = json.loads(p.read_text())
    name = data.get("name", template_id)
    graph_data = data.get("graph_data", {"nodes": [], "edges": []})
    from app.core.db import create_graph
    g = create_graph(name, data.get("description", ""), graph_data)
    return g


# ── Audit log ─────────────────────────────────────────────────────────────────
@router.get("/api/audit-log")
def api_get_audit_log(
    request: Request,
    limit:  int           = Query(100, ge=1, le=500),
    offset: int           = Query(0,   ge=0),
    actor:  Optional[str] = Query(None),
    action: Optional[str] = Query(None),
):
    """Return audit log entries (owner only).  Newest first."""
    _require_owner(request)
    rows = get_audit_log(limit=limit, offset=offset, actor=actor, action=action)
    # Serialize datetime objects to ISO strings for JSON
    for r in rows:
        if r.get("created_at"):
            r["created_at"] = r["created_at"].isoformat()
    return rows
