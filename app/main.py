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
from app.routers.oauth       import router as oauth_router

log          = logging.getLogger(__name__)
STATIC_DIR   = Path(__file__).parent / "static"
WORKFLOWS    = ["example"]
API_KEY      = os.environ.get("API_KEY", "dev_api_key")

app = FastAPI(title="HiveRunr", docs_url=None, redoc_url=None, openapi_url=None)

# ── Middleware ────────────────────────────────────────────────────────────────
app.add_middleware(PrometheusMiddleware)

# ── Include routers ───────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(graphs_router)
app.include_router(runs_router)
app.include_router(schedules_router)
app.include_router(credentials_router)
app.include_router(webhooks_router)
app.include_router(admin_router)
app.include_router(workspaces_router)
app.include_router(oauth_router)

# ── Static files ──────────────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return RedirectResponse("/static/favicon.svg", status_code=302)


# ── Startup validation ────────────────────────────────────────────────────────
def _validate_config() -> None:
    """Check critical env vars and dependencies at startup.

    Logs a clear actionable WARNING for every problem found.
    Raises RuntimeError for anything that will make the app non-functional
    (missing DB or Redis).  All other issues are warnings only — the app
    still starts so you can use the System page to diagnose them.
    """
    import sys

    # ── Fatal: Database ───────────────────────────────────────────────────────
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        raise RuntimeError(
            "DATABASE_URL is not set. "
            "Add it to .env, e.g.: DATABASE_URL=postgresql://user:pass@db:5432/hiverunr"
        )
    try:
        from app.core.db import get_conn
        with get_conn() as conn:
            conn.cursor().execute("SELECT 1")
        log.info("startup: database connection OK")
    except Exception as exc:
        raise RuntimeError(
            f"Cannot connect to the database: {exc}. "
            "Check DATABASE_URL in .env and ensure the postgres container is running."
        ) from exc

    # ── Fatal: Redis ──────────────────────────────────────────────────────────
    redis_url = os.environ.get("REDIS_URL", "")
    if not redis_url:
        raise RuntimeError(
            "REDIS_URL is not set. "
            "Add it to .env, e.g.: REDIS_URL=redis://redis:6379/0"
        )
    try:
        import redis as _redis
        _redis.from_url(redis_url, socket_connect_timeout=3).ping()
        log.info("startup: Redis connection OK")
    except Exception as exc:
        raise RuntimeError(
            f"Cannot connect to Redis: {exc}. "
            "Check REDIS_URL in .env and ensure the redis container is running."
        ) from exc

    # ── Warning: SECRET_KEY ───────────────────────────────────────────────────
    if not os.environ.get("SECRET_KEY", "").strip():
        log.warning(
            "startup: SECRET_KEY is not set — credentials are stored with a weak "
            "fallback key. Generate one with: "
            "python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
            " then set SECRET_KEY in .env."
        )

    # ── Warning: API_KEY ──────────────────────────────────────────────────────
    unsafe_keys = {"dev_api_key", "change-me-before-deployment", ""}
    if os.environ.get("API_KEY", "dev_api_key") in unsafe_keys:
        log.warning(
            "startup: API_KEY is set to an unsafe default. "
            "Set API_KEY to a random secret in .env before exposing this instance publicly."
        )

    # ── Warning: APP_URL ──────────────────────────────────────────────────────
    app_url = os.environ.get("APP_URL", "http://localhost")
    if not app_url.startswith("https://"):
        log.warning(
            "startup: APP_URL is '%s' (not https). "
            "Session cookies will not be Secure-flagged. "
            "Set APP_URL=https://yourdomain.com in .env for production use.", app_url
        )

    # ── Warning: Email ────────────────────────────────────────────────────────
    if not os.environ.get("AGENTMAIL_API_KEY", "").strip():
        log.warning(
            "startup: AGENTMAIL_API_KEY is not set — email alerts and "
            "password reset are disabled. Sign up at agentmail.to to enable them."
        )

    # ── Warning: OWNER_EMAIL ──────────────────────────────────────────────────
    if not os.environ.get("OWNER_EMAIL", "").strip():
        log.warning(
            "startup: OWNER_EMAIL is not set — flow failure alerts will not be delivered. "
            "Set OWNER_EMAIL in .env."
        )


# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
def startup():
    try:
        _validate_config()
    except RuntimeError as exc:
        log.error("startup: FATAL — %s", exc)
        import sys; sys.exit(1)
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
