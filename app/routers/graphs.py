"""Graphs, graph versions, and graph-run routers."""
import json
import logging
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

from app.deps import _check_admin
from app.core.db import (
    list_graphs, create_graph, get_graph, update_graph, delete_graph,
    get_graph_by_slug, get_graph_by_name,
    list_graph_versions, save_graph_version, get_graph_version,
    sync_graph_schedules,
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
    _check_admin(request)
    g = create_graph(body.name, body.description, json.dumps(body.graph_data))
    _sync_cron_triggers(g['id'], body.graph_data)
    save_graph_version(g['id'], body.name, json.dumps(body.graph_data), note="Initial version")
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
    _check_admin(request)
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
    return _graph_with_data(get_graph(graph_id))


@router.delete("/api/graphs/{graph_id}")
def api_graph_delete(graph_id: int, request: Request):
    _check_admin(request)
    if not get_graph(graph_id):
        raise HTTPException(404, "Graph not found")
    delete_graph(graph_id)
    return {"deleted": True, "id": graph_id}


@router.post("/api/graphs/reseed")
def api_graphs_reseed(request: Request):
    _check_admin(request)
    # Import seeding from main to avoid circular deps — seed logic lives on app startup
    from app.seeds import seed_example_graphs
    n = seed_example_graphs()
    return {"seeded": n, "message": f"Re-seeded {n} missing example flow(s)"}


# ── Graph run ─────────────────────────────────────────────────────────────────
@router.post("/api/graphs/{graph_id}/run")
async def api_graph_run(graph_id: int, request: Request):
    _check_admin(request)
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
    return {"queued": True, "task_id": task.id, "graph": g["name"]}


# ── Graph versions ────────────────────────────────────────────────────────────
@router.get("/api/graphs/{graph_id}/versions")
def api_graph_versions(graph_id: int, request: Request):
    _check_admin(request)
    if not get_graph(graph_id):
        raise HTTPException(404, "Graph not found")
    return list_graph_versions(graph_id)


@router.post("/api/graphs/{graph_id}/versions/{version_id}/restore")
def api_restore_version(graph_id: int, version_id: int, request: Request):
    _check_admin(request)
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
    return _graph_with_data(get_graph(graph_id))
