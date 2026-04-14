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

from app.core.secrets import load_secrets
load_secrets()  # populate os.environ from provider BEFORE any other imports use env vars

from app.core.db import init_db, list_workflows, upsert_workflow
from app.worker import enqueue_workflow
from app.deps import _auth_redirect
from app.seeds import seed_example_graphs
from app.observability import configure_logging, PrometheusMiddleware

# ── Structured JSON logging (must run before any other log calls) ─────────────
configure_logging()

# ── Routers ───────────────────────────────────────────────────────────────────
from app.routers.auth        import router as auth_router
from app.routers.graphs      import router as graphs_router
from app.routers.runs        import router as runs_router
from app.routers.schedules   import router as schedules_router
from app.routers.credentials import router as credentials_router
from app.routers.webhooks    import router as webhooks_router
from app.routers.admin       import router as admin_router
from app.routers.workspaces  import router as workspaces_router

log          = logging.getLogger(__name__)
STATIC_DIR   = Path(__file__).parent / "static"
WORKFLOWS    = ["example"]

# ── Legacy webhook API key ────────────────────────────────────────────────────
# API_KEY gates the legacy /run/{workflow} endpoint only.
# If API_KEY is not set the endpoint is disabled (fail closed).
# The old default "dev_api_key" is no longer accepted — it must be set explicitly.
_raw_api_key = os.environ.get("API_KEY", "").strip()
if not _raw_api_key:
    log.warning(
        "API_KEY is not configured — the legacy /run/{workflow} endpoint is DISABLED. "
        "Set API_KEY in your .env to re-enable it."
    )
    API_KEY = None   # disables the endpoint
elif _raw_api_key == "dev_api_key":
    log.warning(
        "API_KEY is set to the insecure placeholder 'dev_api_key'. "
        "Replace it with a strong random secret before exposing this instance to the internet."
    )
    API_KEY = _raw_api_key
else:
    API_KEY = _raw_api_key

app = FastAPI(title="HiveRunr", docs_url=None, redoc_url=None, openapi_url=None)


# ── Subdomain workspace resolver middleware ───────────────────────────────────
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse


class SubdomainWorkspaceMiddleware(BaseHTTPMiddleware):
    """Resolve workspace from subdomain when SUBDOMAIN_ROUTING=true.

    If the inbound Host header is <slug>.<APP_DOMAIN>, look up the workspace
    by slug and stash its id in request.state.subdomain_workspace_id so that
    _resolve_workspace() in deps.py can pick it up with highest priority.
    """

    def __init__(self, app, app_domain: str):
        super().__init__(app)
        self.app_domain = app_domain.lstrip(".")  # e.g. "hiverunr.com"

    async def dispatch(self, request: StarletteRequest, call_next):
        request.state.subdomain_workspace_id = None
        if self.app_domain:
            host = (
                request.headers.get("x-forwarded-host")
                or request.headers.get("host", "")
            ).split(":")[0]  # strip port if present
            suffix = f".{self.app_domain}"
            if host.endswith(suffix):
                slug = host[: -len(suffix)]
                if slug and slug != "www":
                    try:
                        from app.core.db import get_workspace_by_slug
                        ws = get_workspace_by_slug(slug)
                        if ws:
                            request.state.subdomain_workspace_id = ws["id"]
                    except Exception:
                        pass
        return await call_next(request)


# ── Middleware ────────────────────────────────────────────────────────────────
app.add_middleware(PrometheusMiddleware)

_subdomain_routing = os.environ.get("SUBDOMAIN_ROUTING", "false").lower() == "true"
_app_domain = os.environ.get("APP_DOMAIN", "")
if _subdomain_routing and _app_domain:
    app.add_middleware(SubdomainWorkspaceMiddleware, app_domain=_app_domain)

# ── Include routers ───────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(graphs_router)
app.include_router(runs_router)
app.include_router(schedules_router)
app.include_router(credentials_router)
app.include_router(webhooks_router)
app.include_router(admin_router)
app.include_router(workspaces_router)

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
        except Exception as exc:
            log.warning("startup: upsert_workflow(%r) failed — %s", name, exc)


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


@app.get("/signup")
def signup_page(request: Request):
    from app.core.db import users_exist as _users_exist
    if not _users_exist():
        return RedirectResponse("/setup", status_code=302)
    from app.auth import get_current_user
    if get_current_user(request):
        return RedirectResponse("/", status_code=302)
    if os.environ.get("ALLOW_SIGNUP", "false").lower() != "true":
        return RedirectResponse("/login", status_code=302)
    return FileResponse(str(STATIC_DIR / "signup.html"), media_type="text/html")


@app.get("/reset-password")
def reset_password_page():
    return FileResponse(str(STATIC_DIR / "reset.html"), media_type="text/html")


@app.get("/invite/accept")
def invite_accept_page():
    return FileResponse(str(STATIC_DIR / "invite.html"), media_type="text/html")


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
    if API_KEY is None:
        raise HTTPException(503, "Legacy /run endpoint is disabled — API_KEY is not configured")
    if key != API_KEY:
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
    from app.deps import _require_manage_scope
    from app.core.db import toggle_workflow
    _require_manage_scope(request)
    return toggle_workflow(name) or {"name": name}


@app.post("/api/workflows/{name}/run")
async def api_run_workflow(name: str, request: Request):
    import uuid as _uuid
    from app.deps import _require_run_scope
    from app.core.db import get_conn, list_workflows
    from app.worker import enqueue_script
    _require_run_scope(request)
    # Check the workflow exists and is enabled
    workflows = {w["name"]: w for w in list_workflows()}
    if name not in workflows:
        raise HTTPException(404, f"Workflow '{name}' not found")
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            payload = {}
    except Exception:
        payload = {}
    task_id = str(_uuid.uuid4())
    with get_conn() as conn:
        conn.cursor().execute(
            "INSERT INTO runs(task_id, workflow, status) VALUES(%s, %s, 'queued')",
            (task_id, name)
        )
    enqueue_script.apply_async(args=[name, payload], task_id=task_id)
    return {"queued": True, "task_id": task_id, "workflow": name}
