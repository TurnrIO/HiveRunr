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
            templates.append({
                "slug":        path.stem,
                "name":        data.get("name", path.stem),
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
