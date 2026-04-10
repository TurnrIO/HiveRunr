"""Graphs, graph versions, and graph-run routers."""
import json
import logging
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

from app.deps import _check_admin
from app.core.db import (
    list_graphs, create_graph, get_graph, update_graph, delete_graph,
    get_graph_by_slug, get_graph_by_name, duplicate_graph,
    list_graph_versions, save_graph_version, get_graph_version,
    sync_graph_schedules,
    get_graph_alerts, update_graph_alerts,
    log_audit,
)
from app.worker import enqueue_graph

log = logging.getLogger(__name__)
router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────
def _graph_with_data(g):
    if not g:
        return None
    try:
        gd = json.loads(g.get('graph_json') or '{}')
    except Exception:
        gd = {}
    return {**{k: v for k, v in g.items() if k != 'graph_json'}, 'graph_data': gd}


def _sync_cron_triggers(graph_id: int, graph_data: dict):
    try:
        nodes = (graph_data or {}).get('nodes', [])
        sync_graph_schedules(graph_id, [n for n in nodes if n.get('type') == 'trigger.cron'])
    except Exception as e:
        log.warning(f"Could not sync schedules for graph {graph_id}: {e}")


# ── Graph CRUD ────────────────────────────────────────────────────────────────
class GraphCreate(BaseModel):
    name: str; description: str = ""; graph_data: dict = {}


class GraphUpdate(BaseModel):
    name: Optional[str] = None; description: Optional[str] = None
    graph_data: Optional[dict] = None; enabled: Optional[bool] = None


@router.get("/api/graphs")
def api_graphs(request: Request):
    _check_admin(request)
    return [_graph_with_data(g) for g in list_graphs()]


@router.post("/api/graphs")
def api_graph_create(body: GraphCreate, request: Request):
    user = _check_admin(request)
    g = create_graph(body.name, body.description, json.dumps(body.graph_data))
    _sync_cron_triggers(g['id'], body.graph_data)
    save_graph_version(g['id'], body.name, json.dumps(body.graph_data), note="Initial version")
    log_audit(user["username"], "graph.create", "graph", g["id"],
              {"name": body.name, "description": body.description},
              request.client.host if request.client else None)
    return _graph_with_data(g)


@router.get("/api/graphs/by-slug/{slug}")
def api_graph_by_slug(slug: str, request: Request):
    _check_admin(request)
    g = get_graph_by_slug(slug)
    if not g:
        raise HTTPException(404, "Graph not found")
    return _graph_with_data(g)


@router.get("/api/graphs/{graph_id}")
def api_graph_get(graph_id: int, request: Request):
    _check_admin(request)
    g = get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graph not found")
    return _graph_with_data(g)


@router.put("/api/graphs/{graph_id}")
def api_graph_update(graph_id: int, body: GraphUpdate, request: Request):
    user = _check_admin(request)
    g = get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graph not found")
    update_graph(graph_id, name=body.name, description=body.description,
                 graph_json=json.dumps(body.graph_data) if body.graph_data is not None else None,
                 enabled=body.enabled)
    if body.graph_data is not None:
        _sync_cron_triggers(graph_id, body.graph_data)
        gname = body.name or g['name']
        save_graph_version(graph_id, gname, json.dumps(body.graph_data))
    log_audit(user["username"], "graph.update", "graph", graph_id,
              {"name": body.name or g["name"]},
              request.client.host if request.client else None)
    return _graph_with_data(get_graph(graph_id))


@router.delete("/api/graphs/{graph_id}")
def api_graph_delete(graph_id: int, request: Request):
    user = _check_admin(request)
    g = get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graph not found")
    delete_graph(graph_id)
    log_audit(user["username"], "graph.delete", "graph", graph_id,
              {"name": g["name"]},
              request.client.host if request.client else None)
    return {"deleted": True, "id": graph_id}


@router.post("/api/graphs/reseed")
def api_graphs_reseed(request: Request):
    _check_admin(request)
    # Import seeding from main to avoid circular deps — seed logic lives on app startup
    from app.seeds import seed_example_graphs
    n = seed_example_graphs()
    return {"seeded": n, "message": f"Re-seeded {n} missing example flow(s)"}


# ── Single-node test ─────────────────────────────────────────────────────────
class NodeTestBody(BaseModel):
    input: dict = {}


@router.post("/api/graphs/{graph_id}/nodes/{node_id}/test")
def api_test_node(graph_id: int, node_id: str, body: NodeTestBody, request: Request):
    """Execute a single node synchronously and return its output.

    Loads the graph and credentials, finds the node, and calls its handler
    directly with the provided input.  No Celery task, no run record — just
    an instant test invocation that populates the NodeIOPanel in the canvas.
    """
    _check_admin(request)
    g = get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graph not found")

    try:
        graph_data = json.loads(g.get('graph_json') or '{}')
    except Exception:
        graph_data = {}

    nodes_map = {n['id']: n for n in graph_data.get('nodes', [])}
    edges     = graph_data.get('edges', [])
    node      = nodes_map.get(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found in graph")

    ntype = node.get('type', node.get('data', {}).get('type', ''))
    if ntype in ('note',):
        raise HTTPException(400, "Cannot test UI-only nodes")

    try:
        from app.core.db import load_all_credentials
        creds = load_all_credentials()
    except Exception:
        creds = {}

    from app.core.executor import run_one_node

    messages = []
    result = run_one_node(
        node=node,
        inp=body.input,
        context={node_id: body.input},
        creds=creds,
        logger=messages.append,
        edges=edges,
        nodes_map=nodes_map,
    )
    result["node_id"]   = node_id
    result["node_type"] = ntype
    result["logs"]      = messages
    return result


# ── Graph run ─────────────────────────────────────────────────────────────────
@router.post("/api/graphs/{graph_id}/run")
async def api_graph_run(graph_id: int, request: Request):
    user = _check_admin(request)
    g = get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graph not found")
    try:
        body = await request.json()
    except Exception:
        body = {}
    payload = body or {"source": "api"}
    task = enqueue_graph.delay(graph_id, payload)
    try:
        from app.core.db import get_conn
        with get_conn() as conn:
            conn.cursor().execute(
                "INSERT INTO runs(task_id, graph_id, status, initial_payload) VALUES(%s,%s,'queued',%s)",
                (task.id, graph_id, json.dumps(payload))
            )
    except Exception as e:
        log.warning(f"Could not pre-create run record: {e}")
    log_audit(user["username"], "graph.run", "graph", graph_id,
              {"name": g["name"], "task_id": task.id},
              request.client.host if request.client else None)
    return {"queued": True, "task_id": task.id, "graph": g["name"]}


# ── Graph versions ────────────────────────────────────────────────────────────
@router.get("/api/graphs/{graph_id}/versions")
def api_graph_versions(graph_id: int, request: Request):
    _check_admin(request)
    if not get_graph(graph_id):
        raise HTTPException(404, "Graph not found")
    return list_graph_versions(graph_id)


@router.post("/api/graphs/{graph_id}/duplicate")
def api_duplicate_graph(graph_id: int, request: Request):
    """Clone a graph with a unique '(copy)' name suffix."""
    user = _check_admin(request)
    try:
        new_g = duplicate_graph(graph_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    log_audit(user["username"], "graph.duplicate", "graph", graph_id,
              {"new_id": new_g["id"], "new_name": new_g["name"]},
              request.client.host if request.client else None)
    return _graph_with_data(new_g)


@router.get("/api/graphs/{graph_id}/versions/{version_id}")
def api_get_graph_version(graph_id: int, version_id: int, request: Request):
    """Return the full graph_json for a specific version (read-only preview)."""
    _check_admin(request)
    if not get_graph(graph_id):
        raise HTTPException(404, "Graph not found")
    v = get_graph_version(version_id)
    if not v or v['graph_id'] != graph_id:
        raise HTTPException(404, "Version not found")
    try:
        gd = json.loads(v.get('graph_json') or '{}')
    except Exception:
        gd = {}
    return {**{k: val for k, val in v.items() if k != 'graph_json'}, 'graph_data': gd}


@router.post("/api/graphs/{graph_id}/versions/{version_id}/restore")
def api_restore_version(graph_id: int, version_id: int, request: Request):
    user = _check_admin(request)
    g = get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graph not found")
    v = get_graph_version(version_id)
    if not v or v['graph_id'] != graph_id:
        raise HTTPException(404, "Version not found")
    update_graph(graph_id, graph_json=v['graph_json'])
    try:
        gd = json.loads(v['graph_json'])
    except Exception:
        gd = {}
    _sync_cron_triggers(graph_id, gd)
    save_graph_version(graph_id, g['name'], v['graph_json'], note=f"Restored from v{v['version']}")
    log_audit(user["username"], "graph.restore_version", "graph", graph_id,
              {"name": g["name"], "version_id": version_id, "version": v.get("version")},
              request.client.host if request.client else None)
    return _graph_with_data(get_graph(graph_id))


# ── Per-flow alert configuration ──────────────────────────────────────────────
class AlertConfig(BaseModel):
    alert_emails:     Optional[str]  = None   # comma-separated
    alert_webhook:    Optional[str]  = None
    alert_on_success: bool           = False


@router.get("/api/graphs/{graph_id}/alerts")
def api_get_alerts(graph_id: int, request: Request):
    _check_admin(request)
    if not get_graph(graph_id):
        raise HTTPException(404, "Graph not found")
    cfg = get_graph_alerts(graph_id)
    if cfg is None:
        raise HTTPException(404, "Graph not found")
    return cfg


@router.put("/api/graphs/{graph_id}/alerts")
def api_update_alerts(graph_id: int, body: AlertConfig, request: Request):
    _check_admin(request)
    if not get_graph(graph_id):
        raise HTTPException(404, "Graph not found")
    update_graph_alerts(
        graph_id,
        alert_emails=body.alert_emails,
        alert_webhook=body.alert_webhook,
        alert_on_success=body.alert_on_success,
    )
    return get_graph_alerts(graph_id)
