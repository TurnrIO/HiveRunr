"""Templates router — serve built-in flow template bundles.

Templates are JSON files stored in app/templates/.  Each file must contain:
  {
    "name":        "Human-readable name",
    "description": "One-line description",
    "category":    "Monitoring | AI | Integrations | …",
    "tags":        ["tag1", "tag2", …],
    "graph_data":  { "nodes": […], "edges": […] }
  }

GET /api/templates   — list all templates (graph_data omitted for speed)
GET /api/templates/{slug}  — full bundle including graph_data
"""
import json
import pathlib
import logging
from fastapi import APIRouter, HTTPException, Request

from app.deps import _require_run_scope   # any authenticated user may read templates

log = logging.getLogger(__name__)
router = APIRouter()

TEMPLATES_DIR = pathlib.Path(__file__).parent.parent / "templates"


def _load_all() -> list[dict]:
    templates = []
    if not TEMPLATES_DIR.is_dir():
        return templates
    for path in sorted(TEMPLATES_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text())
            slug = path.stem
            templates.append({
                "id":          slug,   # alias used by admin Templates page
                "slug":        slug,
                "name":        data.get("name", slug),
                "description": data.get("description", ""),
                "category":    data.get("category", "General"),
                "tags":        data.get("tags", []),
                "node_count":  len(data.get("graph_data", {}).get("nodes", [])),
                "edge_count":  len(data.get("graph_data", {}).get("edges", [])),
            })
        except Exception as exc:
            log.warning("Failed to load template %s: %s", path.name, exc)
    return templates


@router.get("/api/templates")
def list_templates(request: Request):
    """Return metadata for all built-in templates (no graph_data payload)."""
    _require_run_scope(request)
    return _load_all()


@router.post("/api/templates/{slug}/use")
def use_template(slug: str, request: Request):
    """Create a new graph from a built-in template and return its id + name."""
    print(">>>USE_TEMPLATE slug=" + str(slug), flush=True)
    import sys; sys.stderr.write(">>>USE_TEMPLATE_STDERR slug=" + str(slug) + "\n"); sys.stderr.flush()
    return {"ok": True, "slug": slug}
    try:
        import traceback as _tb
        from app.deps import _check_admin, _resolve_workspace
        from app.core.db import create_graph, save_graph_version
        from app.routers.graphs import _sync_cron_triggers

        user = _check_admin(request)
        log.info("use_template: user=%s slug=%s", user.get("username"), slug)

        if not all(c.isalnum() or c in "-_" for c in slug):
            raise HTTPException(400, "Invalid template slug")
        path = TEMPLATES_DIR / f"{slug}.json"
        if not path.exists():
            raise HTTPException(404, f"Template '{slug}' not found")

        data = json.loads(path.read_text())
        name   = data.get("name", slug)
        desc   = data.get("description", "")
        gd     = data.get("graph_data", {})
        gd_str = json.dumps(gd)

        workspace_id = _resolve_workspace(request, user)
        log.info("use_template: workspace_id=%s", workspace_id)

        g = create_graph(name, desc, gd_str, workspace_id=workspace_id)
        log.info("use_template: created graph id=%s", g.get("id"))

        try:
            _sync_cron_triggers(g["id"], gd)
            save_graph_version(g["id"], name, gd_str, note=f"Created from template: {name}")
        except Exception as exc:
            log.warning("use_template: post-create steps failed: %s", exc)

        return {"id": g["id"], "name": g["name"], "slug": g.get("slug", "")}

    except HTTPException:
        raise
    except Exception as exc:
        log.error("use_template ERROR: %s\n%s", exc, _tb.format_exc())
        raise HTTPException(500, f"Failed to create flow from template: {exc}")


@router.get("/api/templates/{slug}")
def get_template(slug: str, request: Request):
    """Return a full template bundle including graph_data."""
    _require_run_scope(request)
    # Sanitise slug — only alphanumeric + hyphens/underscores
    if not all(c.isalnum() or c in "-_" for c in slug):
        raise HTTPException(400, "Invalid template slug")
    path = TEMPLATES_DIR / f"{slug}.json"
    if not path.exists():
        raise HTTPException(404, f"Template '{slug}' not found")
    try:
        data = json.loads(path.read_text())
        data["slug"] = slug
        return data
    except Exception as exc:
        log.error("Error reading template %s: %s", slug, exc)
        raise HTTPException(500, "Failed to load template")
