# automation-platform
A small, self-hosted automation platform (n8n-like), but Python-first

This document describes what the **bootstrap + Docker setup** creates, what each service does, the available endpoints, and how to use the system day-to-day.

---

## 1) What this project is

A small, self-hosted automation platform (n8n-like), but **Python-first**:

- **FastAPI** provides the HTTP API + Admin UI (control panel)
- **Celery** executes workflows asynchronously (workers)
- A **DB-driven Scheduler** (Option C) reads cron schedules from Postgres and enqueues Celery jobs
- **PostgreSQL** stores run history + workflow/schedule state
- **Redis** is the Celery broker/result backend
- **Flower** is the Celery monitoring UI
- **Caddy** is the reverse proxy (single entrypoint on port 80)

Everything is created from scratch by `bootstrap.sh` and can be rebuilt repeatedly.

---

## 2) Bootstrap overview

### What `bootstrap.sh` does

When you run:

```bash
./bootstrap.sh
```

It will:

1. Create a fresh folder `automations/` (it removes any existing one)
2. Generate all project files (Dockerfile, compose, app code, config)
3. Run `docker compose config -q` to validate the YAML/compose
4. Print next steps

### Bring the stack up

```bash
cd automations
docker compose up -d --build
```

### Tear down (keep DB data)

```bash
docker compose down
```

### Tear down (wipe DB + Redis + Caddy volumes)

```bash
docker compose down -v
```

---

## 3) Services (what runs where)

### `caddy` — reverse proxy (front door)

- Listens on: **http://localhost:80**
- Routes:
  - `/flower/*` → Flower container
  - everything else → FastAPI container

Config:
- `caddy/Caddyfile`

---

### `api` — FastAPI (API + Admin UI)

- Runs the web app on port **8000** internally (Caddy proxies to it)
- Provides:
  - health check
  - Swagger docs
  - workflow trigger endpoint
  - Admin UI (control panel, schedules, logs, maintenance)

Code:
- `app/main.py`

Auth:
- API calls require `x-api-key` (from `.env`) if `API_KEY` is set
- Admin UI requires `token` query/form value (from `.env`)

---

### `worker` — Celery worker (executes jobs)

- Pulls tasks from Redis queue
- Executes workflows in Python
- Writes:
  - run metadata to Postgres (`runs` table)
  - per-run log file to `runlogs/<task_id>.log`

Code:
- `app/worker.py`

---

### `scheduler` — DB-driven cron scheduler (Option C)

- Polls Postgres for schedules that are **due**
- Atomically “claims” due schedules (prevents double enqueue)
- Enqueues Celery tasks for those schedules
- Calculates and stores `next_run_at`

Code:
- `app/scheduler.py`

Config:
- `.env` → `SCHEDULER_POLL_SECONDS`

---

### `db` — PostgreSQL

Stores:
- workflow enabled/disabled state
- run history
- cron schedules + next run timestamps

Tables:
- `workflows` — enabled/disabled flag per workflow name
- `runs` — run history (task_id, status, timestamps, result/error)
- `schedules` — cron schedules (workflow, cron, payload_json, next_run_at, enabled)

Code:
- `app/core/db.py`

---

### `redis` — broker/result backend

Used by Celery for:
- broker: queue of tasks
- result backend: task results (optional, but enabled)

You typically don’t interact with Redis directly.

---

### `flower` — Celery monitoring UI

- Shows workers, queues, task status, etc.
- Proxied via Caddy at `/flower/`

---

## 4) Key configuration files

| File | Purpose |
|---|---|
| `docker-compose.yml` | defines all containers and networking |
| `.env` | secrets + connection strings (API key, admin token, DB URL, Redis URLs) |
| `Dockerfile` | builds `api`, `worker`, `scheduler` images |
| `requirements.txt` | Python dependencies |
| `caddy/Caddyfile` | HTTP routing rules |
| `app/main.py` | FastAPI routes + Admin UI |
| `app/worker.py` | Celery task execution + per-run logs |
| `app/scheduler.py` | DB-driven cron scheduler |
| `app/core/db.py` | schema + all DB operations |
| `runlogs/` | per-run log files (mounted volume) |

---

## 5) URLs / Endpoints

Base URL is:

- **http://localhost** (Caddy)

### Public/diagnostic

- `GET /health`  
  Returns `{"ok": true}`

- `GET /docs`  
  Swagger UI for the API

- `GET /workflows`  
  Lists workflows available (from `WORKFLOWS` in `app/main.py`)

### Trigger a workflow (API)

- `POST /run/{workflow}`  
  Header: `x-api-key: <API_KEY>`  
  Body:
  ```json
  { "payload": { "any": "json" } }
  ```

Example:

```bash
curl -sS -X POST "http://localhost/run/example"   -H "x-api-key: dev_api_key"   -H "Content-Type: application/json"   -d '{"payload":{"hello":"world"}}'
```

Response contains:

- `task_id` (Celery task ID)

---

## 6) Admin UI (what each page does)

All admin pages require:

- `token=<ADMIN_TOKEN>`

The default in v3 is:
- `ADMIN_TOKEN=dev_admin_token`

### Control Panel (workflows + runs)

- `GET /admin?token=...`

Features:
- toggle workflow enabled/disabled
- run workflow immediately
- see recent runs (DB)
- cancel queued/running runs
- restart a run (cancel + enqueue a new one)
- delete a single run record (and its log file)
- clear all run history (DB + log files), only if nothing is running

### Schedules (Cron UI)

- `GET /admin/schedules?token=...`

Features:
- create cron schedules (name, workflow, cron expression, timezone, payload JSON)
- enable/disable a schedule
- delete a schedule
- see `next_run_at` and `last_enqueued_at`

Notes:
- Scheduler reads schedules from DB and enqueues tasks.
- Cron expressions are parsed by `croniter`.

### Logs

- `GET /admin/logs?token=...`

Features:
- list run log files in `runlogs/`
- view a log
- delete a single log file
- clear all log files

Log file naming:
- `runlogs/<task_id>.log`

### Maintenance

- `GET /admin/maintenance?token=...`

Features:
- **Reset DB ID counters (sequences)**:
  - only allowed if `runs` and `schedules` are empty
  - resets `runs_id_seq` and `schedules_id_seq` back to 1

---

## 7) How the system works (request flow)

### Trigger via API

1. Client calls `POST /run/example`
2. FastAPI enqueues Celery task: `enqueue_workflow.delay(...)`
3. Celery worker pulls from Redis and runs the workflow code
4. Worker writes:
   - run status to Postgres (`runs`)
   - log file to `runlogs/`
5. Admin UI shows the run in “Recent Runs”

### Trigger via Cron Schedule

1. Scheduler polls DB for due schedules
2. Scheduler claims and enqueues tasks to Celery
3. Worker executes the workflow as above
4. Scheduler updates `next_run_at` in DB

---

## 8) Adding a new workflow (example)

A “workflow” is just a Python function.

### Step A — create the workflow file

Create: `app/workflows/hello.py`

```python
from datetime import datetime, timezone

def run_hello(payload: dict) -> dict:
    name = payload.get("name", "world")
    return {
        "message": f"Hello, {name}!",
        "time": datetime.now(timezone.utc).isoformat(),
    }
```

### Step B — register it in the worker

In `app/worker.py`, add:

```python
elif workflow == "hello":
    from app.workflows.hello import run_hello
    result = run_hello(payload)
```

### Step C — list it in the API

In `app/main.py`, add it to `WORKFLOWS`:

```python
WORKFLOWS = ["example", "hello"]
```

### Step D — rebuild

```bash
docker compose up -d --build
```

### Step E — run it

```bash
curl -sS -X POST "http://localhost/run/hello"   -H "x-api-key: dev_api_key"   -H "Content-Type: application/json"   -d '{"payload":{"name":"Danny"}}'
```

---

## 9) Common operations (CLI)

### View logs

```bash
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f scheduler
```

### Restart services

```bash
docker compose restart api worker scheduler
```

### See container status

```bash
docker compose ps
```

---

## 10) Security notes (quick)

- Change `ADMIN_TOKEN` and `API_KEY` for production.
- Put Caddy behind TLS (HTTPS) when exposing publicly.
- Consider:
  - IP allow-listing for admin routes
  - real auth (SSO/OIDC) later
  - moving secrets out of `.env` into a secret manager

---

## 11) “Source of truth” for v3

Your v3 platform is fully defined by:

- `bootstrap.sh` (generates everything)
- generated files inside `automations/`

If `bootstrap.sh` is in Git, you can recreate the platform anywhere with Docker.

