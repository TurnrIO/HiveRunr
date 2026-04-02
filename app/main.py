"""HiveRunr — FastAPI application entry point.

All API routes live in app/routers/. This file wires together the app,
static files, page routes, and startup lifecycle only.
"""
import os
import logging
from pathlib import Path
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.core.db import init_db, list_workflows, upsert_workflow
from app.worker import enqueue_workflow
from app.deps import _auth_redirect
from app.seeds import seed_example_graphs

# ── Routers ───────────────────────────────────────────────────────────────────
from app.routers.auth        import router as auth_router
from app.routers.graphs      import router as graphs_router
from app.routers.runs        import router as runs_router
from app.routers.schedules   import router as schedules_router
from app.routers.credentials import router as credentials_router
from app.routers.webhooks    import router as webhooks_router
from app.routers.admin       import router as admin_router

log          = logging.getLogger(__name__)
STATIC_DIR   = Path(__file__).parent / "static"
WORKFLOWS    = ["example"]
API_KEY      = os.environ.get("API_KEY", "dev_api_key")

app = FastAPI(title="HiveRunr", docs_url=None, redoc_url=None, openapi_url=None)

# ── Include routers ───────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(graphs_router)
app.include_router(runs_router)
app.include_router(schedules_router)
app.include_router(credentials_router)
app.include_router(webhooks_router)
app.include_router(admin_router)

# ── Static files ──────────────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return RedirectResponse("/static/favicon.svg", status_code=302)


# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
def startup():
    init_db()
    seed_example_graphs()
    for name in WORKFLOWS:
        try:
            upsert_workflow(name)
        except Exception:
            pass


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "version": "8"}


# ── Page routes ───────────────────────────────────────────────────────────────
@app.get("/login")
def login_page(request: Request):
    from app.core.db import users_exist
    if not users_exist():
        return RedirectResponse("/setup", status_code=302)
    from app.auth import get_current_user
    if get_current_user(request):
        return RedirectResponse("/", status_code=302)
    return FileResponse(str(STATIC_DIR / "login.html"), media_type="text/html")


@app.get("/setup")
def setup_page(request: Request):
    from app.core.db import users_exist
    if users_exist():
        return RedirectResponse("/", status_code=302)
    return FileResponse(str(STATIC_DIR / "setup.html"), media_type="text/html")


@app.get("/")
def root(request: Request):
    redir = _auth_redirect(request)
    if redir:
        return redir
    return FileResponse(str(STATIC_DIR / "admin.html"), media_type="text/html")


@app.get("/admin")
@app.get("/admin/{rest:path}")
def admin_page(request: Request, rest: str = ""):
    redir = _auth_redirect(request)
    if redir:
        return redir
    return FileResponse(str(STATIC_DIR / "admin.html"), media_type="text/html")


@app.get("/canvas")
@app.get("/admin/canvas")
def canvas_page(request: Request):
    redir = _auth_redirect(request)
    if redir:
        return redir
    return FileResponse(str(STATIC_DIR / "canvas.html"), media_type="text/html")


# ── Auth-gated API docs ───────────────────────────────────────────────────────
@app.get("/openapi.json", include_in_schema=False)
def openapi_schema(request: Request):
    redir = _auth_redirect(request)
    if redir:
        return redir
    return JSONResponse(app.openapi())


@app.get("/docs", include_in_schema=False)
def docs_page(request: Request):
    redir = _auth_redirect(request)
    if redir:
        return redir
    from fastapi.openapi.docs import get_swagger_ui_html
    return get_swagger_ui_html(openapi_url="/openapi.json", title="HiveRunr API")


@app.get("/redoc", include_in_schema=False)
def redoc_page(request: Request):
    redir = _auth_redirect(request)
    if redir:
        return redir
    from fastapi.openapi.docs import get_redoc_html
    return get_redoc_html(openapi_url="/openapi.json", title="HiveRunr API")


# ── Legacy workflow trigger ───────────────────────────────────────────────────
def _check_api_key(key: str):
    if API_KEY and key != API_KEY:
        raise HTTPException(401, "Invalid API key")


class RunRequest(BaseModel):
    payload: dict = {}


@app.post("/run/{workflow}")
def run_workflow(workflow: str, req: RunRequest, x_api_key: str = Header(default="")):
    _check_api_key(x_api_key)
    if workflow not in WORKFLOWS:
        raise HTTPException(404, "Unknown workflow")
    task = enqueue_workflow.delay(workflow, req.payload)
    return {"queued": True, "task_id": task.id, "workflow": workflow}


# ── Workflows (legacy script runner) ─────────────────────────────────────────
@app.get("/api/workflows")
def api_workflows(request: Request):
    from app.deps import _check_admin
    _check_admin(request)
    return list_workflows()


@app.post("/api/workflows/{name}/toggle")
def api_toggle_workflow(name: str, request: Request):
    from app.deps import _check_admin
    from app.core.db import toggle_workflow
    _check_admin(request)
    return toggle_workflow(name) or {"name": name}
