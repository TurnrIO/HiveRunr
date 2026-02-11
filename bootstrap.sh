cat > bootstrap.sh <<'BASH'
#!/usr/bin/env bash
set -euo pipefail

PROJECT="automations"

rm -rf "$PROJECT"
mkdir -p "$PROJECT/app/workflows" "$PROJECT/app/core" "$PROJECT/caddy" "$PROJECT/runlogs"
: > "$PROJECT/app/__init__.py"
: > "$PROJECT/app/core/__init__.py"

cat > "$PROJECT/docker-compose.yml" <<'EOF'
services:
  api:
    build: .
    command: sh -lc "python -m app.core.wait && uvicorn app.main:app --host 0.0.0.0 --port 8000"
    env_file: .env
    depends_on: [db, redis]
    volumes:
      - ./app:/app/app:ro
      - ./runlogs:/app/runlogs
    restart: unless-stopped

  worker:
    build: .
    command: sh -lc "python -m app.core.wait && celery -A app.worker:celery_app worker --loglevel=INFO"
    env_file: .env
    depends_on: [db, redis]
    volumes:
      - ./app:/app/app:ro
      - ./runlogs:/app/runlogs
    restart: unless-stopped

  scheduler:
    build: .
    command: sh -lc "python -m app.core.wait && python -m app.scheduler"
    env_file: .env
    depends_on: [db, redis]
    volumes:
      - ./app:/app/app:ro
      - ./runlogs:/app/runlogs
    restart: unless-stopped

  flower:
    image: mher/flower
    command: celery --broker=${CELERY_BROKER_URL} flower --port=5555 --url_prefix=flower
    env_file: .env
    depends_on: [redis]
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: automations
      POSTGRES_USER: automations
      POSTGRES_PASSWORD: automations_pass
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [api, flower]
    restart: unless-stopped

volumes:
  redis_data:
  postgres_data:
  caddy_data:
  caddy_config:
EOF

cat > "$PROJECT/caddy/Caddyfile" <<'EOF'
:80 {
  encode zstd gzip

  handle /flower/* {
    reverse_proxy flower:5555
  }

  reverse_proxy api:8000
}
EOF

cat > "$PROJECT/.env" <<'EOF'
POSTGRES_PASSWORD=automations_pass
DATABASE_URL=postgresql://automations:automations_pass@db:5432/automations

CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/1

API_KEY=dev_api_key
ADMIN_TOKEN=dev_admin_token

SCHEDULER_POLL_SECONDS=5
EOF

cat > "$PROJECT/Dockerfile" <<'EOF'
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app /app/app
EOF

cat > "$PROJECT/requirements.txt" <<'EOF'
fastapi
uvicorn[standard]
celery
redis
psycopg[binary]
python-multipart
croniter
EOF

cat > "$PROJECT/app/core/wait.py" <<'EOF'
import os, time, sys
import psycopg

def wait_for_db(timeout_seconds: int = 90) -> None:
    dsn = os.getenv("DATABASE_URL", "")
    if not dsn:
        print("DATABASE_URL is not set", file=sys.stderr)
        raise SystemExit(1)

    start = time.time()
    last_err = None
    while time.time() - start < timeout_seconds:
        try:
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1;")
            return
        except Exception as e:
            last_err = e
            time.sleep(1)

    print(f"DB not ready after {timeout_seconds}s: {last_err}", file=sys.stderr)
    raise SystemExit(1)

if __name__ == "__main__":
    wait_for_db()
EOF

cat > "$PROJECT/app/core/db.py" <<'EOF'
import os
import json
from typing import Any, Optional
from datetime import datetime
import psycopg

DATABASE_URL = os.getenv("DATABASE_URL", "")

def get_conn():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set")
    return psycopg.connect(DATABASE_URL)

def init_db() -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "CREATE TABLE IF NOT EXISTS workflows ("
                "name TEXT PRIMARY KEY, "
                "enabled BOOLEAN NOT NULL DEFAULT TRUE, "
                "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
                ");"
            )

            cur.execute(
                "CREATE TABLE IF NOT EXISTS runs ("
                "id BIGSERIAL PRIMARY KEY, "
                "task_id TEXT UNIQUE, "
                "workflow TEXT NOT NULL, "
                "status TEXT NOT NULL, "
                "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), "
                "started_at TIMESTAMPTZ, "
                "finished_at TIMESTAMPTZ, "
                "result_json TEXT, "
                "error TEXT"
                ");"
            )

            cur.execute(
                "CREATE TABLE IF NOT EXISTS schedules ("
                "id BIGSERIAL PRIMARY KEY, "
                "name TEXT NOT NULL, "
                "workflow TEXT NOT NULL, "
                "cron TEXT NOT NULL, "
                "timezone TEXT NOT NULL DEFAULT 'Europe/Berlin', "
                "payload_json TEXT NOT NULL DEFAULT '{}', "
                "enabled BOOLEAN NOT NULL DEFAULT TRUE, "
                "next_run_at TIMESTAMPTZ, "
                "last_enqueued_at TIMESTAMPTZ, "
                "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
                ");"
            )
        conn.commit()

# workflows enabled/disabled
def ensure_workflow_row(name: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO workflows (name, enabled) VALUES (%s, TRUE) "
                "ON CONFLICT (name) DO NOTHING;",
                (name,),
            )
        conn.commit()

def list_workflows_state(names: list[str]) -> dict[str, bool]:
    if not names:
        return {}
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, enabled FROM workflows WHERE name = ANY(%s)", (names,))
            rows = cur.fetchall()
    found = {n: bool(e) for n, e in rows}
    for n in names:
        found.setdefault(n, True)
    return found

def set_workflow_enabled(name: str, enabled: bool) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO workflows (name, enabled, updated_at) VALUES (%s, %s, NOW()) "
                "ON CONFLICT (name) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW();",
                (name, enabled),
            )
        conn.commit()

# runs
def create_run(task_id: str, workflow: str, status: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO runs (task_id, workflow, status) VALUES (%s, %s, %s) "
                "ON CONFLICT (task_id) DO NOTHING;",
                (task_id, workflow, status),
            )
        conn.commit()

def update_run(task_id: str, *, status: Optional[str] = None, started: bool = False,
               finished: bool = False, result_json: Optional[str] = None, error: Optional[str] = None) -> None:
    fields: list[str] = []
    params: list[Any] = []
    if status is not None:
        fields.append("status=%s"); params.append(status)
    if started:
        fields.append("started_at = COALESCE(started_at, NOW())")
    if finished:
        fields.append("finished_at = NOW()")
    if result_json is not None:
        fields.append("result_json=%s"); params.append(result_json)
    if error is not None:
        fields.append("error=%s"); params.append(error)
    if not fields:
        return
    q = "UPDATE runs SET " + ", ".join(fields) + " WHERE task_id=%s"
    params.append(task_id)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q, params)
        conn.commit()

def recent_runs(limit: int = 50) -> list[dict[str, Any]]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT task_id, workflow, status, created_at, started_at, finished_at, result_json, error "
                "FROM runs ORDER BY created_at DESC LIMIT %s",
                (limit,),
            )
            rows = cur.fetchall()
    return [{
        "task_id": r[0],
        "workflow": r[1],
        "status": r[2],
        "created_at": str(r[3]) if r[3] else "",
        "started_at": str(r[4]) if r[4] else "",
        "finished_at": str(r[5]) if r[5] else "",
        "result_json": r[6] or "",
        "error": r[7] or "",
    } for r in rows]

def has_active_runs() -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM runs WHERE status IN ('queued','running');")
            n = cur.fetchone()[0]
    return n > 0

def delete_run(task_id: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM runs WHERE task_id=%s", (task_id,))
        conn.commit()

def clear_runs_if_safe() -> tuple[bool, str]:
    if has_active_runs():
        return (False, "Refused: there are queued/running runs. Cancel them first.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM runs;")
        conn.commit()
    return (True, "OK: cleared run history.")

# schedules
def list_schedules() -> list[dict[str, Any]]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, workflow, cron, timezone, payload_json, enabled, next_run_at, last_enqueued_at "
                "FROM schedules ORDER BY id DESC"
            )
            rows = cur.fetchall()
    out = []
    for r in rows:
        out.append({
            "id": r[0],
            "name": r[1],
            "workflow": r[2],
            "cron": r[3],
            "timezone": r[4],
            "payload_json": r[5] or "{}",
            "enabled": bool(r[6]),
            "next_run_at": str(r[7]) if r[7] else "",
            "last_enqueued_at": str(r[8]) if r[8] else "",
        })
    return out

def create_schedule(name: str, workflow: str, cron: str, timezone_str: str, payload_json: str) -> None:
    try:
        json.loads(payload_json or "{}")
    except Exception:
        payload_json = "{}"

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO schedules (name, workflow, cron, timezone, payload_json, enabled) "
                "VALUES (%s, %s, %s, %s, %s, TRUE)",
                (name, workflow, cron, timezone_str, payload_json or "{}"),
            )
        conn.commit()

def set_schedule_enabled(schedule_id: int, enabled: bool) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE schedules SET enabled=%s WHERE id=%s", (enabled, schedule_id))
        conn.commit()

def delete_schedule(schedule_id: int) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM schedules WHERE id=%s", (schedule_id,))
        conn.commit()

def claim_due_schedules(now_utc: datetime, limit: int = 50) -> list[dict[str, Any]]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "WITH due AS ("
                "  SELECT id FROM schedules "
                "  WHERE enabled=TRUE AND (next_run_at IS NULL OR next_run_at <= %s) "
                "  ORDER BY id ASC "
                "  LIMIT %s "
                "  FOR UPDATE SKIP LOCKED"
                ") "
                "UPDATE schedules s "
                "SET last_enqueued_at = NOW() "
                "FROM due "
                "WHERE s.id = due.id "
                "RETURNING s.id, s.workflow, s.cron, s.timezone, s.payload_json, s.next_run_at;",
                (now_utc, limit),
            )
            rows = cur.fetchall()
        conn.commit()

    return [{
        "id": r[0],
        "workflow": r[1],
        "cron": r[2],
        "timezone": r[3],
        "payload_json": r[4] or "{}",
        "next_run_at": r[5],
    } for r in rows]

def set_next_run(schedule_id: int, next_run_at: datetime) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE schedules SET next_run_at=%s WHERE id=%s", (next_run_at, schedule_id))
        conn.commit()

# maintenance
def db_is_empty_for_reset() -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM runs;")
            runs_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM schedules;")
            schedules_count = cur.fetchone()[0]
    return runs_count == 0 and schedules_count == 0

def reset_sequences_if_empty() -> tuple[bool, str]:
    if not db_is_empty_for_reset():
        return (False, "Refused: runs/schedules not empty. Delete entries first.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("ALTER SEQUENCE IF EXISTS runs_id_seq RESTART WITH 1;")
            cur.execute("ALTER SEQUENCE IF EXISTS schedules_id_seq RESTART WITH 1;")
        conn.commit()
    return (True, "OK: sequences reset (runs_id_seq, schedules_id_seq) restarted at 1.")
EOF

cat > "$PROJECT/app/workflows/example.py" <<'EOF'
from datetime import datetime, timezone
import time

def run_example(payload: dict) -> dict:
    time.sleep(1)
    return {
        "status": "done",
        "time": datetime.now(timezone.utc).isoformat(),
        "payload": payload,
    }
EOF

cat > "$PROJECT/app/worker.py" <<'EOF'
import os, json, traceback
from datetime import datetime, timezone
from celery import Celery
from app.core.db import init_db, ensure_workflow_row, list_workflows_state, create_run, update_run

celery_app = Celery(
    "automations",
    broker=os.getenv("CELERY_BROKER_URL"),
    backend=os.getenv("CELERY_RESULT_BACKEND"),
)

LOG_DIR = "/app/runlogs"

def _log_path(task_id: str) -> str:
    return os.path.join(LOG_DIR, f"{task_id}.log")

def _append_log(task_id: str, line: str) -> None:
    os.makedirs(LOG_DIR, exist_ok=True)
    ts = datetime.now(timezone.utc).isoformat()
    with open(_log_path(task_id), "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {line}\n")

@celery_app.task(bind=True, name="enqueue_workflow")
def enqueue_workflow(self, workflow: str, payload: dict):
    init_db()
    ensure_workflow_row(workflow)

    task_id = self.request.id
    create_run(task_id, workflow, "queued")
    _append_log(task_id, f"queued workflow={workflow} payload={json.dumps(payload, ensure_ascii=False)}")

    if not list_workflows_state([workflow]).get(workflow, True):
        update_run(task_id, status="disabled", finished=True)
        _append_log(task_id, "workflow disabled -> exiting")
        return {"status": "disabled", "workflow": workflow}

    update_run(task_id, status="running", started=True)
    _append_log(task_id, "started")

    try:
        if workflow == "example":
            from app.workflows.example import run_example
            result = run_example(payload)
        else:
            raise ValueError(f"Unknown workflow: {workflow}")

        update_run(task_id, status="succeeded", finished=True, result_json=json.dumps(result))
        _append_log(task_id, f"succeeded result={json.dumps(result, ensure_ascii=False)}")
        return result
    except Exception as e:
        tb = traceback.format_exc()
        update_run(task_id, status="failed", finished=True, error=str(e))
        _append_log(task_id, f"failed error={e}")
        _append_log(task_id, tb)
        raise
EOF

cat > "$PROJECT/app/scheduler.py" <<'EOF'
import os
import json
import time
from datetime import datetime, timezone
from croniter import croniter

from app.core.db import init_db, claim_due_schedules, set_next_run
from app.worker import enqueue_workflow

POLL_SECONDS = int(os.getenv("SCHEDULER_POLL_SECONDS", "5"))

def compute_next(cron_expr: str, base_utc: datetime) -> datetime:
    it = croniter(cron_expr, base_utc)
    nxt = it.get_next(datetime)
    if nxt.tzinfo is None:
        nxt = nxt.replace(tzinfo=timezone.utc)
    return nxt.astimezone(timezone.utc)

def main() -> None:
    init_db()
    while True:
        now = datetime.now(timezone.utc)

        claimed = claim_due_schedules(now, limit=50)
        for s in claimed:
            workflow = s["workflow"]
            try:
                payload = json.loads(s["payload_json"] or "{}")
            except Exception:
                payload = {}

            enqueue_workflow.delay(workflow, payload)

            try:
                next_run = compute_next(s["cron"], now)
            except Exception:
                next_run = now.replace(year=now.year + 10)
            set_next_run(s["id"], next_run)

        time.sleep(POLL_SECONDS)

if __name__ == "__main__":
    main()
EOF

cat > "$PROJECT/app/main.py" <<'EOF'
import os
from pathlib import Path
from fastapi import FastAPI, Header, HTTPException, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from app.worker import enqueue_workflow
from app.core.db import (
    init_db,
    list_workflows_state,
    set_workflow_enabled,
    recent_runs,
    list_schedules,
    create_schedule,
    set_schedule_enabled,
    delete_schedule,
    reset_sequences_if_empty,
    delete_run,
    clear_runs_if_safe,
)

app = FastAPI(title="Automations API + Control Panel")

API_KEY = os.getenv("API_KEY", "")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

WORKFLOWS = ["example"]

class RunRequest(BaseModel):
    payload: dict = {}

LOG_DIR = Path("/app/runlogs")

def _log_file_for_task(task_id: str) -> Path:
    return LOG_DIR / f"{task_id}.log"

def list_log_files() -> list[str]:
    if not LOG_DIR.exists():
        return []
    files = [p.name for p in LOG_DIR.iterdir() if p.is_file() and p.name.endswith(".log")]
    files.sort(reverse=True)
    return files

@app.on_event("startup")
def _startup():
    init_db()

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/workflows")
def workflows():
    return {"workflows": WORKFLOWS}

@app.post("/run/{workflow}")
def run_workflow(workflow: str, req: RunRequest, x_api_key: str = Header(default="")):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if workflow not in WORKFLOWS:
        raise HTTPException(status_code=404, detail="Unknown workflow")
    task = enqueue_workflow.delay(workflow, req.payload)
    return {"queued": True, "task_id": task.id}

def require_admin(token: str | None):
    if not ADMIN_TOKEN:
        raise HTTPException(status_code=500, detail="ADMIN_TOKEN not configured")
    if not token or token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Admin token required")

@app.get("/admin", response_class=HTMLResponse)
def admin_home(token: str | None = None):
    require_admin(token)

    states = list_workflows_state(WORKFLOWS)
    runs = recent_runs(50)

    wf_rows = []
    for w in WORKFLOWS:
        enabled = states.get(w, True)
        wf_rows.append(f"""
          <tr>
            <td><code>{w}</code></td>
            <td>{"✅ enabled" if enabled else "⛔ disabled"}</td>
            <td style="white-space:nowrap;">
              <form method="post" action="/admin/workflows/{w}/toggle" style="display:inline;">
                <input type="hidden" name="token" value="{token}">
                <button type="submit">toggle</button>
              </form>
              <form method="post" action="/admin/workflows/{w}/run" style="display:inline; margin-left:6px;">
                <input type="hidden" name="token" value="{token}">
                <button type="submit">run now</button>
              </form>
            </td>
          </tr>
        """)

    run_rows = []
    for r in runs:
        actions = ""
        if r["status"] in ("queued", "running"):
            actions += f"""
              <form method="post" action="/admin/runs/{r["task_id"]}/cancel" style="display:inline;">
                <input type="hidden" name="token" value="{token}">
                <button type="submit">cancel</button>
              </form>
              <form method="post" action="/admin/workflows/{r["workflow"]}/restart" style="display:inline; margin-left:6px;">
                <input type="hidden" name="token" value="{token}">
                <input type="hidden" name="task_id" value="{r["task_id"]}">
                <button type="submit">restart</button>
              </form>
            """
        actions += f"""
          <form method="post" action="/admin/runs/{r["task_id"]}/delete" style="display:inline; margin-left:6px;">
            <input type="hidden" name="token" value="{token}">
            <button type="submit">delete</button>
          </form>
        """

        run_rows.append(f"""
          <tr>
            <td><code>{r["task_id"]}</code></td>
            <td><code>{r["workflow"]}</code></td>
            <td>{r["status"]}</td>
            <td><small>{r["created_at"]}</small></td>
            <td><small>{r["started_at"]}</small></td>
            <td><small>{r["finished_at"]}</small></td>
            <td style="max-width:420px; overflow:auto;"><small>{r["error"]}</small></td>
            <td style="white-space:nowrap;">{actions}</td>
          </tr>
        """)

    html = f"""
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Automations Control Panel</title>
  <style>
    body {{ font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 16px; }}
    table {{ border-collapse: collapse; width: 100%; }}
    th, td {{ border: 1px solid #ddd; padding: 8px; vertical-align: top; }}
    th {{ background: #f6f6f6; text-align: left; }}
    code {{ background: #f2f2f2; padding: 2px 4px; border-radius: 4px; }}
    .links a {{ margin-right: 12px; }}
  </style>
</head>
<body>
  <h2>Automations Control Panel</h2>
  <div class="links">
    <a href="/docs" target="_blank">Swagger /docs</a>
    <a href="/flower/" target="_blank">Flower /flower</a>
    <a href="/admin/schedules?token={token}">Schedules</a>
    <a href="/admin/logs?token={token}">Logs</a>
    <a href="/admin/maintenance?token={token}">Maintenance</a>
    <a href="/admin?token={token}">refresh</a>
  </div>

  <h3>Workflows</h3>
  <table>
    <thead><tr><th>workflow</th><th>state</th><th>actions</th></tr></thead>
    <tbody>
      {"".join(wf_rows)}
    </tbody>
  </table>

  <h3 style="margin-top:24px;">Recent Runs</h3>

  <form method="post" action="/admin/runs/clear_all" style="margin: 12px 0;">
    <input type="hidden" name="token" value="{token}">
    <button type="submit">Clear run history (DB + runlogs/*.log)</button>
  </form>

  <table>
    <thead>
      <tr>
        <th>task_id</th><th>workflow</th><th>status</th>
        <th>created</th><th>started</th><th>finished</th>
        <th>error</th><th>actions</th>
      </tr>
    </thead>
    <tbody>
      {"".join(run_rows) if run_rows else "<tr><td colspan=8><em>No runs yet.</em></td></tr>"}
    </tbody>
  </table>
</body>
</html>
"""
    return HTMLResponse(html)

@app.get("/admin/schedules", response_class=HTMLResponse)
def admin_schedules(token: str | None = None):
    require_admin(token)
    schedules = list_schedules()

    rows = []
    for s in schedules:
        enabled = "✅ enabled" if s["enabled"] else "⛔ disabled"
        toggle_label = "disable" if s["enabled"] else "enable"
        rows.append(f"""
        <tr>
          <td><code>{s["id"]}</code></td>
          <td>{s["name"]}</td>
          <td><code>{s["workflow"]}</code></td>
          <td><code>{s["cron"]}</code></td>
          <td>{enabled}</td>
          <td><small>{s["next_run_at"]}</small></td>
          <td><small>{s["last_enqueued_at"]}</small></td>
          <td style="max-width:420px; overflow:auto;"><small><code>{s["payload_json"]}</code></small></td>
          <td style="white-space:nowrap;">
            <form method="post" action="/admin/schedules/{s["id"]}/toggle" style="display:inline;">
              <input type="hidden" name="token" value="{token}">
              <button type="submit">{toggle_label}</button>
            </form>
            <form method="post" action="/admin/schedules/{s["id"]}/delete" style="display:inline; margin-left:6px;">
              <input type="hidden" name="token" value="{token}">
              <button type="submit">delete</button>
            </form>
          </td>
        </tr>
        """)

    # IMPORTANT: default JSON uses escaped braces so f-string doesn't crash
    default_payload = '{{"source":"cron"}}'

    html = f"""
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Schedules</title>
  <style>
    body {{ font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 16px; }}
    table {{ border-collapse: collapse; width: 100%; }}
    th, td {{ border: 1px solid #ddd; padding: 8px; vertical-align: top; }}
    th {{ background: #f6f6f6; text-align: left; }}
    code {{ background: #f2f2f2; padding: 2px 4px; border-radius: 4px; }}
    input[type=text] {{ width: 100%; }}
    textarea {{ width: 100%; height: 90px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }}
    .links a {{ margin-right: 12px; }}
  </style>
</head>
<body>
  <h2>Schedules</h2>
  <div class="links">
    <a href="/admin?token={token}">Back to Control Panel</a>
    <a href="/admin/schedules?token={token}">refresh</a>
  </div>

  <h3>Create schedule</h3>
  <form method="post" action="/admin/schedules/create">
    <input type="hidden" name="token" value="{token}">
    <table>
      <tr><th style="width:160px;">name</th><td><input name="name" type="text" placeholder="e.g. Example every 5 min" required></td></tr>
      <tr><th>workflow</th><td><input name="workflow" type="text" value="example" required></td></tr>
      <tr><th>cron</th><td><input name="cron" type="text" value="*/5 * * * *" required></td></tr>
      <tr><th>timezone</th><td><input name="timezone" type="text" value="Europe/Berlin" required></td></tr>
      <tr><th>payload (JSON)</th><td><textarea name="payload_json">{default_payload}</textarea></td></tr>
    </table>
    <p><button type="submit">Create</button></p>
  </form>

  <h3>Existing schedules</h3>
  <table>
    <thead>
      <tr>
        <th>id</th><th>name</th><th>workflow</th><th>cron</th><th>state</th>
        <th>next_run</th><th>last_enqueued</th><th>payload</th><th>actions</th>
      </tr>
    </thead>
    <tbody>
      {"".join(rows) if rows else "<tr><td colspan=9><em>No schedules yet.</em></td></tr>"}
    </tbody>
  </table>

  <p style="margin-top:16px;">
    <small>Cron runs are enqueued by the scheduler service and executed by the Celery worker.</small>
  </p>
</body>
</html>
"""
    return HTMLResponse(html)

@app.post("/admin/schedules/create")
def admin_schedules_create(
    token: str = Form(...),
    name: str = Form(...),
    workflow: str = Form(...),
    cron: str = Form(...),
    timezone: str = Form(...),
    payload_json: str = Form(default="{}"),
):
    require_admin(token)
    if workflow not in WORKFLOWS:
        raise HTTPException(status_code=400, detail="Unknown workflow (add it to WORKFLOWS first)")
    create_schedule(name=name, workflow=workflow, cron=cron, timezone_str=timezone, payload_json=payload_json)
    return RedirectResponse(url=f"/admin/schedules?token={token}", status_code=303)

@app.post("/admin/schedules/{schedule_id}/toggle")
def admin_schedule_toggle(schedule_id: int, token: str = Form(...)):
    require_admin(token)
    schedules = list_schedules()
    current = next((s for s in schedules if s["id"] == schedule_id), None)
    if not current:
        raise HTTPException(status_code=404, detail="Schedule not found")
    set_schedule_enabled(schedule_id, not current["enabled"])
    return RedirectResponse(url=f"/admin/schedules?token={token}", status_code=303)

@app.post("/admin/schedules/{schedule_id}/delete")
def admin_schedule_delete(schedule_id: int, token: str = Form(...)):
    require_admin(token)
    delete_schedule(schedule_id)
    return RedirectResponse(url=f"/admin/schedules?token={token}", status_code=303)

@app.get("/admin/logs", response_class=HTMLResponse)
def admin_logs(token: str | None = None):
    require_admin(token)
    logs = list_log_files()

    rows = []
    for name in logs:
        rows.append(f"""
        <tr>
          <td><code>{name}</code></td>
          <td style="white-space:nowrap;">
            <a href="/admin/logs/view/{name}?token={token}" target="_blank">view</a>
          </td>
          <td style="white-space:nowrap;">
            <form method="post" action="/admin/logs/delete/{name}" style="display:inline;">
              <input type="hidden" name="token" value="{token}">
              <button type="submit">delete</button>
            </form>
          </td>
        </tr>
        """)

    return HTMLResponse(f"""
    <html><head><meta charset="utf-8"/>
    <style>
      body {{ font-family: system-ui; padding: 16px; }}
      table {{ border-collapse: collapse; width: 100%; }}
      th, td {{ border: 1px solid #ddd; padding: 8px; }}
      th {{ background: #f6f6f6; text-align: left; }}
      code {{ background: #f2f2f2; padding: 2px 4px; border-radius: 4px; }}
      .links a {{ margin-right: 12px; }}
    </style></head><body>
      <h2>Logs</h2>
      <div class="links">
        <a href="/admin?token={token}">Back</a>
        <a href="/admin/logs?token={token}">refresh</a>
      </div>

      <form method="post" action="/admin/logs/clear_all" style="margin: 12px 0;">
        <input type="hidden" name="token" value="{token}">
        <button type="submit">Clear ALL logs</button>
      </form>

      <table>
        <thead><tr><th>file</th><th>view</th><th>delete</th></tr></thead>
        <tbody>
          {''.join(rows) if rows else '<tr><td colspan="3"><em>No logs yet.</em></td></tr>'}
        </tbody>
      </table>
    </body></html>
    """)

@app.get("/admin/logs/view/{filename}", response_class=HTMLResponse)
def admin_logs_view(filename: str, token: str | None = None):
    require_admin(token)
    if "/" in filename or "\\" in filename or not filename.endswith(".log"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    p = LOG_DIR / filename
    if not p.exists():
        raise HTTPException(status_code=404, detail="Log not found")

    content = p.read_text(encoding="utf-8", errors="replace")
    content = content[-20000:]

    return HTMLResponse(f"""
    <html><head><meta charset="utf-8"/>
    <style>
      body {{ font-family: system-ui; padding: 16px; }}
      pre {{ background: #f6f6f6; padding: 12px; border-radius: 8px; overflow:auto; }}
      .links a {{ margin-right: 12px; }}
    </style></head><body>
      <div class="links">
        <a href="/admin/logs?token={token}">Back to logs</a>
      </div>
      <h3><code>{filename}</code></h3>
      <pre>{content}</pre>
    </body></html>
    """)

@app.post("/admin/logs/delete/{filename}")
def admin_logs_delete(filename: str, token: str = Form(...)):
    require_admin(token)
    if "/" in filename or "\\" in filename or not filename.endswith(".log"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    p = LOG_DIR / filename
    if p.exists():
        p.unlink()
    return RedirectResponse(url=f"/admin/logs?token={token}", status_code=303)

@app.post("/admin/logs/clear_all")
def admin_logs_clear_all(token: str = Form(...)):
    require_admin(token)
    if LOG_DIR.exists():
        for p in LOG_DIR.iterdir():
            if p.is_file() and p.name.endswith(".log"):
                p.unlink()
    return RedirectResponse(url=f"/admin/logs?token={token}", status_code=303)

@app.get("/admin/maintenance", response_class=HTMLResponse)
def admin_maintenance(token: str | None = None):
    require_admin(token)
    return HTMLResponse(f"""
    <html><head><meta charset="utf-8"/>
    <style>
      body {{ font-family: system-ui; padding: 16px; }}
      .links a {{ margin-right: 12px; }}
      .danger {{ margin-top: 12px; padding: 12px; border: 1px solid #f0c0c0; background: #fff5f5; border-radius: 8px; }}
    </style></head><body>
      <h2>Maintenance</h2>
      <div class="links">
        <a href="/admin?token={token}">Back</a>
        <a href="/admin/maintenance?token={token}">refresh</a>
      </div>

      <div class="danger">
        <h3>Reset DB ID counters (safe-guarded)</h3>
        <p>This will ONLY work if <code>runs</code> and <code>schedules</code> tables are empty.</p>
        <form method="post" action="/admin/db/reset_sequences">
          <input type="hidden" name="token" value="{token}">
          <button type="submit">Reset sequences</button>
        </form>
      </div>
    </body></html>
    """)

@app.post("/admin/db/reset_sequences")
def admin_reset_sequences(token: str = Form(...)):
    require_admin(token)
    ok, msg = reset_sequences_if_empty()
    return HTMLResponse(f"""
    <html><head><meta charset="utf-8"/></head><body style="font-family:system-ui;padding:16px;">
      <h3>{'✅' if ok else '⛔'} {msg}</h3>
      <p><a href="/admin/maintenance?token={token}">Back</a></p>
    </body></html>
    """)

@app.post("/admin/runs/{task_id}/delete")
def admin_run_delete(task_id: str, token: str = Form(...)):
    require_admin(token)
    delete_run(task_id)
    lf = _log_file_for_task(task_id)
    if lf.exists():
        lf.unlink()
    return RedirectResponse(url=f"/admin?token={token}", status_code=303)

@app.post("/admin/runs/clear_all")
def admin_runs_clear_all(token: str = Form(...)):
    require_admin(token)
    ok, msg = clear_runs_if_safe()
    if ok:
        # also clear runlogs/*.log
        if LOG_DIR.exists():
            for p in LOG_DIR.iterdir():
                if p.is_file() and p.name.endswith(".log"):
                    p.unlink()
    return HTMLResponse(f"""
    <html><head><meta charset="utf-8"/></head><body style="font-family:system-ui;padding:16px;">
      <h3>{'✅' if ok else '⛔'} {msg}</h3>
      <p><a href="/admin?token={token}">Back</a></p>
    </body></html>
    """)

@app.post("/admin/workflows/{workflow}/toggle")
def admin_toggle_workflow(workflow: str, token: str = Form(...)):
    require_admin(token)
    if workflow not in WORKFLOWS:
        raise HTTPException(status_code=404, detail="Unknown workflow")
    current = list_workflows_state([workflow]).get(workflow, True)
    set_workflow_enabled(workflow, not current)
    return RedirectResponse(url=f"/admin?token={token}", status_code=303)

@app.post("/admin/workflows/{workflow}/run")
def admin_run_workflow(workflow: str, token: str = Form(...)):
    require_admin(token)
    if workflow not in WORKFLOWS:
        raise HTTPException(status_code=404, detail="Unknown workflow")
    enqueue_workflow.delay(workflow, {"source": "admin"})
    return RedirectResponse(url=f"/admin?token={token}", status_code=303)

@app.post("/admin/runs/{task_id}/cancel")
def admin_cancel_run(task_id: str, token: str = Form(...)):
    require_admin(token)
    enqueue_workflow.app.control.revoke(task_id, terminate=True, signal="SIGTERM")
    return RedirectResponse(url=f"/admin?token={token}", status_code=303)

@app.post("/admin/workflows/{workflow}/restart")
def admin_restart_workflow(workflow: str, token: str = Form(...), task_id: str = Form(...)):
    require_admin(token)
    if workflow not in WORKFLOWS:
        raise HTTPException(status_code=404, detail="Unknown workflow")
    enqueue_workflow.app.control.revoke(task_id, terminate=True, signal="SIGTERM")
    enqueue_workflow.delay(workflow, {"source": "admin-restart", "restarted_from": task_id})
    return RedirectResponse(url=f"/admin?token={token}", status_code=303)
EOF

cd "$PROJECT"
docker compose config -q

echo "✅ Bootstrap complete and docker-compose.yml verified."
echo "Next:"
echo "  cd $PROJECT"
echo "  docker compose up -d --build"
echo ""
echo "URLs:"
echo "  http://<server>/admin?token=dev_admin_token"
echo "  http://<server>/admin/schedules?token=dev_admin_token"
echo "  http://<server>/admin/logs?token=dev_admin_token"
echo "  http://<server>/admin/maintenance?token=dev_admin_token"
echo "  http://<server>/flower/"
BASH

chmod +x bootstrap.sh
./bootstrap.sh
