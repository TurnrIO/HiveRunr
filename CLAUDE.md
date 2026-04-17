# HiveRunr — Claude Context File

> Read this at the start of every session. Update the backlog section when a sprint ships.

---

## Stack

| Layer | Tech |
|-------|------|
| API | FastAPI + uvicorn (`--reload`), Python 3.11 |
| Workers | Celery + Redis (broker + result backend) |
| DB | PostgreSQL via psycopg2 (`RealDictCursor`) + Alembic migrations |
| Scheduler | APScheduler `BlockingScheduler` + Redis leader-lock |
| Frontend | Inline JSX/Babel (no build step) — single-file pages in `app/static/` |
| Reverse proxy | Caddy |
| Email | AgentMail.to REST API (`POST /v0/inboxes/{inbox_id}/messages/send`, Bearer auth) |
| Container | Docker Compose — bind-mount `./app:/app/app` so host files are live |

---

## Repo layout (key paths)

```
app/
  core/db.py          — all DB helpers (psycopg2, RealDictCursor)
  routers/            — FastAPI routers (auth, graphs, runs, nodes, tokens, …)
  static/             — HTML/JSX pages (admin.html, canvas.html, login.html, reset.html)
  worker.py           — Celery tasks, alert/webhook dispatch
  scheduler.py        — APScheduler entry point + nightly jobs
  email.py            — AgentMail.to send helpers
  main.py             — FastAPI app + middleware
  nodes/              — built-in node modules (one file per node type)
  nodes/custom/       — hot-reloadable custom nodes (no restart needed)
migrations/versions/  — Alembic migration files (0001 … 0005)
install.sh            — curl | bash one-liner installer
setup.sh              — interactive first-run configurator
```

---

## Node system

Each node is a Python module in `app/nodes/` that exports:
- `NODE_TYPE: str` — e.g. `"action.http_request"`
- `LABEL: str` — human-readable name
- `run(config, inp, context, logger, creds=None, **kwargs) -> dict`

The registry (`__init__.py`) auto-discovers all modules on startup. Custom nodes in `app/nodes/custom/` are hot-reloadable via the admin API.

Template rendering: `_render(text, context, creds)` in `_utils.py` resolves `{{node_id.field}}` and `{{creds.name.field}}` in any string config value.

**Canvas UI**: each node must also have an entry in `NODE_DEFS` in `app/static/canvas.html` (line ~286) with `label`, `icon`, `color`, `group`, and `fields[]` (each field: `{k, l, ph, mono?, textarea?, secret?, type?, options?}`). Special help panels below the fields can be added via `node.data.type === "action.xyz"` JSX blocks starting at line ~822.

### Trigger nodes

| NODE_TYPE | Description |
|-----------|-------------|
| `trigger.manual` | Pass-through; started from the UI |
| `trigger.cron` | APScheduler cron expression |
| `trigger.webhook` | HTTP POST trigger; payload becomes input |

### Action nodes — Control flow

| NODE_TYPE | Description | Key config |
|-----------|-------------|------------|
| `action.condition` | Binary branch (true/false handles) | `expression` (Python bool) |
| `action.switch` | Multi-way routing (N cases) | `value` expr, `cases` JSON array `[{match,label}]` |
| `action.loop` | Iterate over a list; body handle per item | `field`, `max_items` |
| `action.aggregate` | Collect loop-body results into one list | `field` (extract sub-field), `mode` (list/dict/concat) |
| `action.filter` | Keep list items matching a Python expression | `field`, `expression` (use `item`) |
| `action.merge` | Join outputs from multiple upstream nodes | `mode` (first/all/dict) |
| `action.delay` | Sleep N seconds | `seconds` |

### Action nodes — Data

| NODE_TYPE | Description | Key config |
|-----------|-------------|------------|
| `action.transform` | Evaluate Python expression; full `input` + `context` + `json` available | `expression` |
| `action.set_variable` | Write a key into the run context | `key`, `value` |
| `action.log` | Emit a message to the run log | `message` |
| `action.date` | Date/time operations | `operation` (now/format/add/subtract/parse/diff), `date`, `format`, `amount`, `unit` |
| `action.csv` | Parse CSV string → list of dicts, or list → CSV string | `operation` (parse/generate), `content`/`field`, `delimiter` |

### Action nodes — Network / Integration

| NODE_TYPE | Description | Key config |
|-----------|-------------|------------|
| `action.http_request` | Generic HTTP call | `url`, `method`, `headers_json`, `body_json`, `credential`, `timeout`, `ignore_errors` |
| `action.llm_call` | OpenAI-compatible LLM API | `model`, `prompt`, `system`, `api_key`, `api_base` |
| `action.run_script` | Arbitrary Python (opt-in, `ENABLE_RUN_SCRIPT=true`) | `script` |
| `action.call_graph` | Run another flow as subroutine | `graph_id`, `payload` |
| `action.send_email` | SMTP email | `to`, `subject`, `body`, `credential` |
| `action.slack` | Slack incoming webhook | `credential`/`webhook_url`, `message`, `channel` |
| `action.discord` | Discord incoming webhook | `credential`/`webhook_url`, `message`, `username` |
| `action.telegram` | Telegram bot message | `bot_token`, `chat_id`, `text` |
| `action.github` | GitHub REST API | `credential`/`token`, `repo`, `action` |
| `action.notion` | Notion API | `credential`/`token`, `action`, `database_id` |
| `action.google_sheets` | Sheets API via service account | `credential`, `spreadsheet_id`, `action`, `range` |
| `action.sftp` | SFTP/FTP file operations | `credential`, `protocol`, `operation`, `remote_path` |
| `action.ssh` | SSH remote command | `credential`, `host`, `command` |

---

## Critical gotchas

- **RealDictCursor** — rows are dicts, never use `row[0]`; use column name `row["col"]`. Always alias `SELECT COUNT(*) AS n` etc.
- **BaseHTTPMiddleware swallows exceptions** — PrometheusMiddleware catches handler errors before they reach uvicorn's logger. A 500 may leave no log trace; check the response body directly (Network tab / curl).
- **Bind-mount + --reload** — editing host files takes effect immediately; no rebuild needed.
- **Alembic "Will assume transactional DDL"** — this is normal. It means Alembic connected and found nothing to migrate (already at head). Not a hang.
- **configure_logging() suppresses uvicorn access logs** — "Application startup complete" won't appear; check `/health` instead.
- **JSX Fragments `<>…</>`** — every opened `<>` needs a matching `</>` before the closing `);`. A missing close breaks the Babel parser for the entire remainder of the `<script>` block.
- **AgentMail.to** — `inbox_id` = full `AGENTMAIL_FROM` address (e.g. `alerts@agentmail.to`). Endpoint: `POST /v0/inboxes/{inbox_id}/messages/send`. Auth: `Authorization: Bearer <AGENTMAIL_API_KEY>`.
- **app_settings KV table** — generic key/value store for system config (added in 0005). Use `get_setting(key, default)` / `set_setting(key, value)` rather than adding new columns for simple scalar config.
- **NODE_DEFS in canvas.html** — every new node needs both a Python module in `app/nodes/` AND a `NODE_DEFS` entry + optional hint JSX block in `canvas.html`. There are TWO hint sections: ~line 822 (node edit panel) and ~line 1855 (history/detail panel). Both need the hint if it matters.

---

## .env variables (current full set)

```
DATABASE_URL=
REDIS_URL=
SECRET_KEY=
OWNER_USERNAME=
OWNER_PASSWORD=
APP_URL=http://localhost
AGENTMAIL_API_KEY=
AGENTMAIL_FROM=
OWNER_EMAIL=
```

---

## Completed sprints

| # | Summary |
|---|---------|
| Bugs | Fixed silent 500 on `/api/runs` (RealDictCursor `[0]` → `["n"]`); fixed canvas black screen (missing JSX Fragment close in `HistoryModal`) |
| 7 | Per-flow alerting (email recipients + webhook URL + alert-on-success toggle); forgot-password / reset-password flow for owner via AgentMail; login page updated with forgot-password form |
| Install | `curl … \| bash` installer (`install.sh` + updated `setup.sh` with AgentMail prompts, health-check loop, docker compose v1/v2 detection) |
| 8 | Run retention policy — `app_settings` KV table (migration 0005), `GET/PUT /api/runs/retention`, nightly `_auto_trim_runs()` scheduler job at 03:00, Settings UI card with enable toggle / mode selector (count vs age) / Save + Trim now buttons |
| 9 | New node types: `action.switch`, `action.aggregate`, `action.date`, `action.discord`, `action.csv`; improved `action.http_request` (credential, timeout, ignore_errors, returns status_code); updated NODE_DEFS + hint panels in canvas.html |
| 10 | Scheduler UI — `list_schedules()` now joins graph name + last-run status/time/duration; `GET /api/schedules` returns enriched rows; new `POST /api/schedules/{sid}/run-now` endpoint; Schedules page adds ▶ Run now button, Last run column, graph name display; fixed ruff F841 lint error in action_http_request.py |
| 10b | Scheduler fixes — bug: `list_schedules()` LATERAL query crashed because `duration_ms` is not a real column (must compute from `updated_at - created_at`); `DateTimePicker` split into separate `date` + `time` inputs with `colorScheme:"dark"` for native calendar/clock pickers; quick-pick shortcuts kept; `APP_TIMEZONE` env var added to `.env.example` + `setup.sh` prompt (auto-detects system tz); exposed as `system.app_timezone` in `/api/system/status`; Schedules page defaults timezone to server setting → browser `Intl` API → UTC |
| 11 | Audit log — migration `0006_audit_log.py` creates `audit_log` table (actor, action, target_type, target_id, detail JSONB, ip, created_at); `log_audit()` fire-and-forget helper + `get_audit_log()` query in `db.py`; 21 audit points hooked across routers: graph.create/update/delete/run/duplicate/restore_version (graphs.py), run.delete/clear_all/trim/cancel/replay + settings.retention (runs.py), user.create/update_role/reset_password/delete + token.create/delete (auth.py), admin.reset/reset_sequences (admin.py); `GET /api/audit-log` endpoint (owner-only, filterable by actor + action prefix, paginated); new **Audit Log** nav page in admin.html with colour-coded action badges, detail expansion, actor/action filters, and prev/next pagination |
| 13 | Flow versioning UI — `HistoryModal` rebuilt as two-pane layout: left side lists all versions with CURRENT badge on latest; right side shows preview (node count, edge count, scrollable node list with type labels) loaded from `GET /api/graphs/{id}/versions/{vid}`; Restore button triggers in-place canvas reload via `onRestored` callback (no page reload); restore is disabled when the current version is already selected |
| 12 | Real-time log streaming — `executor.py` gains `node_callback` hook (called after each node with `node_start`/`node_done` events, zero breaking changes); `worker.py` `enqueue_graph` creates `_make_run_publisher()` for Redis pub/sub on channel `run:{task_id}:stream`, passes `_streaming_logger` + `_node_callback` to `run_graph`; `GET /api/runs/{task_id}/stream` SSE endpoint in `runs.py` — subscribes to Redis, replays from DB traces if run already finished, DB-poll fallback every 3 s if pub/sub missed, 15 s heartbeat comments, `X-Accel-Buffering: no` header; canvas replaces 800 ms setInterval poll with `EventSource` — nodes flip to "running" pulse on `node_start`, colour in real time on `node_done`, finalises on `run_done`; full polling fallback kept for EventSource init failures |
| 14 | Role improvements — migration `0007_flow_permissions.py` adds `flow_permissions` table `(user_id, graph_id, role)` + `invite_tokens` table; `FLOW_ROLE_LEVELS` hierarchy (viewer < runner < editor) in `db.py`; `_check_flow_access(request, graph_id, required_role)` dep added to `deps.py`; `GET /api/graphs` filters list for viewers to only their permitted flows; graph endpoints enforce per-flow roles (view/run/edit); new `GET/PUT /api/graphs/{id}/permissions` + `DELETE /api/graphs/{id}/permissions/{uid}` endpoints (admin/owner only); `POST /api/graphs/{id}/invite` sends AgentMail invite or returns link if email unconfigured; `GET /api/invite/accept` + `POST /api/invite/signup` endpoints in `auth.py`; `invite.html` accept/signup page; `PermissionsModal` component in canvas.html (accessible via ⋯ menu for admin/owner) with user list + role dropdowns + invite-by-email form with copyable fallback link |
| W1 | Workspace foundation — migration `0008_workspaces.py` creates `workspaces` (id, name, slug, plan) + `workspace_members` (workspace_id, user_id, role) tables; backfill seeds a "default" workspace and adds all existing users as members preserving their global role; `WORKSPACE_ROLE_LEVELS` + full CRUD helpers in `db.py` (`create_workspace`, `get/list/update/delete_workspace`, `list/get/set/remove_workspace_member`, `list_user_workspaces`, `get_default_workspace`); `app/routers/workspaces.py` — `GET/POST /api/workspaces`, `GET/PATCH/DELETE /api/workspaces/{id}`, `GET/PUT /api/workspaces/{id}/members`, `DELETE /api/workspaces/{id}/members/{uid}`, `GET /api/workspaces/my/list`; workspace admin guard `_require_workspace_admin()`; registered in `main.py`; app behaviour unchanged — workspace tables sit idle until W2 |
| W2 | Scope graphs + runs to workspace — migration `0009_workspace_graphs_runs.py` adds `workspace_id` FK to `graph_workflows` + `runs` with default-workspace backfill + indexes; `list_graphs(workspace_id)`, `create_graph(..., workspace_id)`, `list_runs(..., workspace_id)`, `duplicate_graph` propagates workspace; `_resolve_workspace(request, user)` helper in `deps.py` (resolution order: `X-Workspace-Id` header → `hr_workspace` cookie → user's first workspace → default); `POST /api/workspaces/{id}/switch` sets `hr_workspace` cookie; `graphs.py` + `runs.py` resolve and pass workspace_id; run INSERT stamped with workspace_id; canvas `api()` helper sends `X-Workspace-Id` header + workspace indicator/switcher in topbar; admin `api()` helper workspace-aware + workspace selector in sidebar |
| W3 | Scope credentials, schedules, tokens to workspace — migration `0010_workspace_credentials_schedules_tokens.py` adds `workspace_id` FK + index to `credentials`, `schedules`, `api_tokens` with default-workspace backfill; `list_credentials(workspace_id)`, `load_all_credentials(workspace_id)`, `upsert_credential(..., workspace_id)`, `list_schedules(workspace_id)`, `create_schedule(..., workspace_id)`, `list_api_tokens(workspace_id)`, `create_api_token(..., workspace_id)` in `db.py`; `credentials.py` + `schedules.py` + `auth.py` resolve workspace and pass it; `executor.py` `run_graph(workspace_id=)` passes workspace to `load_all_credentials` so graphs only access their workspace's secrets; `worker.py` `enqueue_graph` passes `g.get('workspace_id')` to `run_graph`; `scheduler.py` `_make_job` pre-creates run record stamped with `workspace_id` when APScheduler auto-fires cron jobs |

| W4 | Workspace management UI — new `WorkspacesPage` component in admin.html; current workspace rename + members table with role dropdowns + add/remove member; all-workspaces super-admin table with create-new-workspace form, switch, and delete; sidebar workspace block gains ⚙ gear button (admin/owner) navigating to Workspaces page |
| W5 | Self-serve onboarding — `ALLOW_SIGNUP` env var gate; `POST /api/auth/signup` creates user (viewer) + personal workspace + workspace owner membership + session cookies; `GET /signup` page route + `app/static/signup.html` (dark-theme matching login.html); login page shows "Create one free" link when `allow_signup=true` in `/api/auth/status`; `SubdomainWorkspaceMiddleware` in `main.py` reads `APP_DOMAIN`+`SUBDOMAIN_ROUTING` env vars, resolves `<slug>.domain` → workspace; `_resolve_workspace` checks subdomain context first (priority 0); `PLAN_LIMITS` dict + `get_workspace_usage()` in `db.py`; `GET /api/workspaces/{id}/usage` endpoint; WorkspacesPage gains Plan & Usage card with progress bars per limit; `.env.example` + `setup.sh` updated with `ALLOW_SIGNUP`, `SUBDOMAIN_ROUTING`, `APP_DOMAIN` |
| Email fix | Fixed AgentMail send endpoint: `inbox_id` is now full `AGENTMAIL_FROM` address (not just local-part); endpoint changed from `/messages` to `/messages/send`; forgot-password handler now returns HTTP 503 when delivery fails instead of silently swallowing the error |
| P0 | Security + reliability hardening: API_KEY fail-closed (disabled when unset, warning for `dev_api_key`); `is_secure_context()` helper drives `secure=True` on all session cookies; startup exceptions now logged (no silent swallow); `GET /api/runs/stats` server-side aggregates replace client-side `?page_size=200` on Dashboard + Metrics pages |
| P1-9 | Canvas dirty-state + autosave: amber "● Unsaved" badge; autosave 30 s after last change (setTimeout, resets on each edit, existing graphs only); "✓ Saved" timestamp tooltip; Save button turns amber when dirty; `uid()` upgraded to RFC 4122 v4 UUID via `crypto.randomUUID()` |
| P1-10 | Canvas node test button: already implemented; fixed workspace isolation bug — `load_all_credentials()` now receives `workspace_id` so test runs only access the correct workspace's credentials |
| P1-11 | Canvas version diff: `HistoryModal` pre-loads latest version on open; non-current versions show tabbed "⚡ Diff vs current" / "📋 All nodes"; diff is colour-coded `+`/`−`/`~`/`=` with summary chip bar; defaults to Diff tab when selecting a non-current version |
| P1-12 | Flow import / export: `GET /api/graphs/{id}/export` returns self-contained JSON bundle (`hiverunr_export`, `schema_version`, `graph_data`, `credential_slots` — names only, never values, `exported_at`, `exported_by`) with `Content-Disposition: attachment` header; `POST /api/graphs/import` accepts full bundle or minimal `{name, description, graph_data}`, creates graph in workspace, saves initial version, logs audit; canvas `importFlow()` updated to POST to `/api/graphs/import` |
| P1-13 | New node `trigger.email` (IMAP) — `app/nodes/trigger_email.py`; uses stdlib `imaplib` + `email`; config: credential (host/port/username/password/use_ssl), folder, search_criteria (IMAP search string, default UNSEEN), filter_expression (Python eval with `email` + `re`), max_messages, mark_read; output: `emails[]` list + `count` + first-email shortcut fields at top level; NODE_DEFS entry + hint panels in both canvas.html sections |
| P1-14 | New node `action.postgres` (SQL Query) — `app/nodes/action_postgres.py`; supports PostgreSQL (psycopg2, built-in), MySQL (pymysql, optional), SQLite (stdlib); credential JSON with `dsn` string or individual host/port/username/password/database fields; config: credential, query (template-rendered), params (JSON array for parameterised queries), row_limit; output: `rows[]`, `count`, `row` (first-row shortcut), `columns`, `affected`; NODE_DEFS entry + hint panels in both canvas.html sections |
| P1-15 | New node `action.s3` (S3 Storage) — `app/nodes/action_s3.py`; uses boto3 (added to requirements.txt); credential JSON with `access_key`, `secret_key`, `region`, `endpoint_url` (S3-compatible services: MinIO, R2, B2, etc.); operations: get/put/list/delete/presigned_url/head/copy; config: credential, operation, bucket, key, content, prefix, source_key/dest_key, expires_in, max_keys; NODE_DEFS entry + hint panels in both canvas.html sections |
| P1-16 | New node `trigger.file_watch` (File Watch) — `app/nodes/trigger_file_watch.py`; polls local filesystem or SFTP for recently-modified files; config: path, pattern (glob), lookback_minutes (sliding window), min_age_seconds (write-guard), min_size_bytes, recursive, sftp_credential (blank = local); output: `files[]` list + `count` + first-file `path`/`name` shortcuts; NODE_DEFS entry + hint panels in both canvas.html sections |
| P1-17 | Credential test connection — `POST /api/credentials/{id}/test` in `credentials.py`; auto-detects credential type (SMTP, SFTP, SSH, IMAP, PostgreSQL/MySQL/SQLite, S3/AWS, Telegram, OpenAI) from `type` column then field-based heuristics; runs lightweight probe with 10s timeout; returns `{ok, message, type, latency_ms}`; admin.html Credentials page gains "🔌 Test" button per row; result shown inline as green/red pill with message and latency |
| P2-19 | Versioned releases — `[0.1.0]` CHANGELOG entry covering all W-series + P0 + P1 sprints with upgrade notes (migrations, new env vars, boto3 dep); `v0.1.0` git tag created |
| P2-20 | Test coverage expansion — `tests/test_permissions.py` (26 tests: `_check_admin`, token scope hierarchy, role guards, per-flow access, workspace resolution); `tests/test_executor_failures.py` (26 tests: abort/continue/retry failure modes, condition branching, scheduler lock Lua helpers, edge cases); `tests/test_webhook_ratelimit.py` (12 tests: webhook rate-limit pipeline logic, Redis fail-open, login brute-force lockout/clear); `tests/integration/test_e2e_playwright.py` (Playwright E2E: login flow, dashboard, canvas, logout — auto-skipped unless `HIVERUNR_BASE_URL` set); total unit suite 117 tests, all green |
| P2-21 | Responsive / accessibility pass — `admin.html`: hamburger toggle + sidebar slide-in overlay (`@media ≤1024px`), `useFocusTrap` hook, ConfirmModal/Toast/HistoryModal/AlertSettingsModal all get `role="dialog" aria-modal="true"`; `canvas.html`: `@media ≤1024px` + `@media ≤768px` breakpoints (sidebar/config-panel collapse), ConfirmModal + FlowsModal + TestPayloadModal + HistoryModal + EdgeLabelModal + ValidationModal + NioModal + PermissionsModal all get `role="dialog" aria-modal="true" aria-label="..."`, overlay wrappers `aria-hidden="true"`; icon-only buttons across both pages get descriptive `aria-label`; sidebar nav gets `role="navigation" aria-label="Main navigation"` + keyboard navigation |
| 18 | Credential OAuth flows — `app/routers/oauth.py`: `GET /api/oauth/providers` (which providers have client_id set), `GET /api/oauth/{provider}/start?cred_name=` (stores state in Redis, redirects to provider), `GET /api/oauth/{provider}/callback` (exchanges code, saves credential, redirects to /admin); supports GitHub (repo/read:user), Google (Sheets + Drive, offline access + refresh token), Notion (Basic-auth token exchange); credential secret stored as provider-typed JSON; `OAuthConnectModal` component in admin.html with credential-name input + redirect flow; "Connect via OAuth" card shown when ≥1 provider env var is set; `?oauth_success`/`?oauth_error` URL params handled on App mount with toast + auto-navigate to credentials page; `.env.example` + CLAUDE.md updated |
| S-A | System diagnostics page — `GET /api/system/status` returns 9 subsystem checks (DB, Redis, Celery, scheduler leader, email, secrets, API key security, HTTPS, disk); each check returns `{status, message, fix?}`; new **System** nav page in admin.html with colour-coded `Check` components, inline fix guidance, auto-refresh every 30 s |
| S-B | Startup validation — `_validate_config()` in `main.py` called on startup; fatal checks (DB + Redis connectivity) call `sys.exit(1)` on failure with clear error; warning checks (SECRET_KEY, API_KEY, APP_URL, AGENTMAIL) log actionable messages; errors surfaced loudly rather than swallowed |
| S-C | Ops hardening — `OPERATIONS.md` runbook (health check, start/stop/restart, DB ops, worker/scheduler ops, common errors table, env vars reference); inline NOTE comments in `db.py`, `worker.py`, `email.py`; `PrometheusMiddleware` rewritten as pure ASGI (no `BaseHTTPMiddleware`) so exceptions propagate correctly to uvicorn; email.py two bug fixes: `inbox_id` = full address, endpoint `/messages/send` |
| S-D | DB performance + retry resilience — migration `0011_performance_indexes.py`: `runs.retry_count INT DEFAULT 0`, indexes on `(workspace_id, created_at DESC)`, `status`, `(graph_id, created_at DESC)`, audit_log indexes, schedules index; `enqueue_graph` Celery task gets `max_retries=3` + exponential backoff (30/60/120 s) for `_TRANSIENT_EXCEPTIONS`; run status lifecycle adds `retrying` + `dead`; admin.html Runs page shows DEAD/RETRY N badges, status filter adds Dead/Retrying options |
| Polish | Runs page bulk-delete — checkbox per row, select-all header checkbox, "Delete selected (N)" button using `POST /api/runs/bulk-delete`; checked rows highlighted purple; ruff --fix: removed unused imports across 8 files; `secrets.py` unused `ClientError` import removed |
| P3-22 | Mobile canvas layout — topbar collapses to icon-only (`≤768px`); `.topbar-secondary` wrapper uses `display:contents` desktop / `display:none !important` mobile; sidebar becomes off-canvas overlay with hamburger toggle (📦 button in topbar); config panel hidden on mobile; `mobileSidebarOpen` state drives overlay |
| P3-23 | Mobile admin layout — Runs page `.runs-split` grid stacks to single column; `.mobile-cards` CSS transforms Credentials / Schedules / Audit Log tables into card lists (`display:block` on all table elements + `td::before { content:attr(data-label) }` for column labels); `data-label` attrs added to all `<td>` cells |
| P3-24 | Keyboard shortcuts — canvas: `Ctrl+S` save, `Ctrl+Z` undo, `Ctrl+Y`/`Ctrl+Shift+Z` redo, `Escape` deselect/close, `?` toggle cheatsheet; `kbRef = useRef({})` pattern avoids stale closures; `ShortcutsModal` 4-section / 15-entry cheatsheet; admin: `?`/`Escape` + `AdminShortcutsModal` with `useFocusTrap`; "⌨️ Keyboard shortcuts" button in sidebar footer |
| P3-25 | Canvas minimap — `<MiniMap>` pannable + zoomable with styled colours; toggle via topbar 🗺 button (desktop) and MoreMenu (mobile); floating Panel button removed (was crashing on UMD undefined) |
| P3-fix | Canvas bug fixes — removed `Panel` from ReactFlow UMD destructure (undefined → React crash); removed overlapping floating Panel button; replaced `useFocusTrap` call in `ShortcutsModal` (not defined in canvas) with manual Escape `useEffect`; fixed overlay click guard to `target===currentTarget`; expanded shortcuts from 5 to 15 entries across 4 sections |

---

## Active backlog (priority order)

Pick the next item off the top. Cross it off and add a "Completed sprints" row when done.

1. ~~**W2 — Scope graphs + runs to workspace**~~ ✓ Done
2. ~~**W3 — Scope credentials, schedules, tokens**~~ ✓ Done
3. ~~**W4 — Workspace management UI**~~ ✓ Done
4. ~~**W5 — Self-serve onboarding (SaaS)**~~ ✓ Done

---

### 🔴 P0 — Hardening ✅ Done

5. ~~**Security: remove unsafe API key default**~~ ✓ — `API_KEY` with no value disables the legacy endpoint; `"dev_api_key"` logs a loud warning but is no longer the silent default.

6. ~~**Security: env-driven `secure=True` on session cookies**~~ ✓ — `is_secure_context()` helper in `app/auth.py`; all `set_cookie` calls (login, setup, signup, invite) now pass `secure=True` when `APP_URL` starts with `https://`.

7. ~~**Reliability: log startup failures loudly**~~ ✓ — `except Exception: pass` replaced with `except Exception as exc: log.warning(...)`.

8. ~~**Metrics accuracy: server-side run aggregates**~~ ✓ — `GET /api/runs/stats` endpoint in `runs.py` returns DB-accurate counts, top-5 failing flows, and 10 recent runs; Dashboard and Metrics page both switched from `?page_size=200` to this endpoint.

---

### 🟠 P1 — Editor & debugging experience

9. ~~**Canvas: dirty-state indicator + autosave**~~ ✓ — amber "● Unsaved" badge in topbar; autosave 30 s after last change (setTimeout resets on each new change, only fires for existing graphs); "✓ Saved" confirmation with last-save timestamp tooltip; Save button turns amber when dirty; `uid()` upgraded to RFC 4122 v4 UUID via `crypto.randomUUID()` with Math.random fallback.

10. ~~**Canvas: node test button**~~ ✓ — already fully implemented: `POST /api/graphs/{id}/nodes/{node_id}/test` endpoint in `graphs.py`; NodeEditorModal has a collapsible Test panel with JSON input textarea, Run button, output display, and 📌 pin-output button; fixed workspace isolation bug (credentials now scoped to workspace_id).

11. ~~**Canvas: version diff / restore UX**~~ ✓ — `HistoryModal` now pre-loads the latest version on open; non-current versions show a tabbed "⚡ Diff vs current" / "📋 All nodes" view; diff shows colour-coded `+` restored (green), `−` removed (red), `~` reverted (amber), `=` unchanged (muted) node rows with a summary chip bar; tab defaults to Diff when selecting a version.

12. ~~**Flow import / export**~~ ✓ Done

---

### 🟠 P1 — New nodes & connectors

13. ~~**New node: `trigger.email` (IMAP)**~~ ✓ Done

14. ~~**New node: `action.postgres`**~~ ✓ Done

15. ~~**New node: `action.s3`**~~ ✓ Done

16. ~~**New node: `trigger.file_watch`**~~ ✓ Done

---

### 🟠 P1 — Credential UX

17. ~~**Credential "test connection" button**~~ ✓ Done

18. ~~**Credential OAuth flows**~~ ✓ Done

---

### 🟡 P2 — Platform maturity

19. ~~**Versioned releases + upgrade notes**~~ ✓ Done — `[0.1.0]` entry added to `CHANGELOG.md` covering all W-series, P0, and P1 sprints with upgrade notes; `v0.1.0` tag created locally (push pending network restore).

20. ~~**Test coverage expansion**~~ ✓ Done — added `tests/test_permissions.py` (26 tests: `_check_admin`, `_require_scope`, role guards, `_check_flow_access`, `_resolve_workspace`); `tests/test_executor_failures.py` (26 tests: abort/continue failure modes, retry logic, condition branching, scheduler lock helpers, edge cases); `tests/test_webhook_ratelimit.py` (12 tests: webhook rate-limit counter logic, Redis fail-open, login brute-force lockout/clear); `tests/integration/test_e2e_playwright.py` (Playwright E2E: login flow, dashboard, canvas create/save/run, logout — auto-skipped unless `HIVERUNR_BASE_URL` set). Total unit suite: 117 tests, all passing.

21. ~~**Responsive / accessibility pass**~~ ✓ Done

---

### 🟢 P3 — Polish / UX ✅ Done

22. ~~**Mobile layout — canvas**~~ ✓ Done

23. ~~**Mobile layout — admin pages**~~ ✓ Done

24. ~~**Keyboard shortcuts**~~ ✓ Done

25. ~~**Canvas minimap**~~ ✓ Done

---

### 🔵 P4 — Power user features

26. **Canvas search / filter** — `Ctrl+F` opens an inline search bar that highlights nodes matching by label or type; filter chips for node group (Trigger / Control / Data / Network); "jump to node" centres the viewport on a clicked result. No new API needed — pure client-side filter over `nodes[]`.

27. **Run replay with payload override** — existing Replay button re-enqueues with the original trigger payload; add a "Replay with edits" option that opens `TestPayloadModal` pre-filled with the original payload so the user can tweak it before re-running. Extend `POST /api/runs/{task_id}/replay` to accept optional `payload` body.

28. **Flow templates gallery** — new `GET /api/templates` endpoint returning a curated list of built-in flow templates (JSON bundles stored in `app/templates/`); canvas "New flow" dialog gains a "Start from template" tab with category filter + preview cards; selecting a template calls `POST /api/graphs/import` (reuses existing import endpoint).

29. **Webhook trigger improvements** — `trigger.webhook` currently accepts any POST; add optional HMAC-SHA256 signature validation (`secret` credential field, `X-Hub-Signature-256` header, same convention as GitHub webhooks); add configurable allowed-origins CORS header; expose the per-flow webhook URL in the canvas hint panel with a copy button.

30. **Canvas node grouping / labels** — allow users to draw a free-form label / comment box on the canvas (new node type `canvas.note` — stored in graph_data but skipped by executor); note nodes render as a coloured sticky-note rectangle behind other nodes; config: text, colour, width, height.

---

### 🟣 P5 — Integrations & ecosystem

31. **New node: `action.redis`** — GET/SET/DEL/LPUSH/RPOP/INCR/EXPIRE operations against a Redis instance (credential: `url`); useful for caching, counters, and cross-flow signalling without a DB.

32. **New node: `action.graphql`** — send a GraphQL query/mutation with variables; credential stores endpoint + optional Authorization header; output: `data`, `errors[]`; supports template rendering in query + variables.

33. **New node: `action.pdf`** — generate a PDF from an HTML template (uses `weasyprint` or `pdfkit`); config: `html` (template-rendered), `filename`; output: `pdf_bytes` (base64) + `size_bytes`; pairs well with `action.s3` or `action.send_email` to attach.

34. **New node: `trigger.rss`** — poll an RSS/Atom feed URL; config: `url`, `lookback_minutes`, `filter_expression` (Python eval with `entry` dict); output: `entries[]` list with `title`, `link`, `published`, `summary`; uses stdlib `xml.etree` — no extra deps.

35. **New node: `action.airtable`** — Airtable REST API; credential: `api_key` + `base_id`; operations: list-records, get-record, create-record, update-record, delete-record; config: `table`, `filter_formula`, `fields_json`; output: `records[]`, `record`, `id`.

---

### 🟤 P6 — Platform & ops

36. **Webhook rate-limit UI** — expose the per-IP rate-limit window + max-calls config (currently hardcoded in `main.py`) via `GET/PUT /api/settings/ratelimit`; add a Rate Limits card to the Settings page with current counters visible.

37. **CHANGELOG + `v0.2.0` release tag** — document P3, P4, P5 in `CHANGELOG.md`; bump version in any version string / `__version__`; create `v0.2.0` git tag.

38. **Observability: OpenTelemetry traces** — wrap `run_graph` and each node `run()` call with OTEL spans (use `opentelemetry-sdk`; export to stdout OTLP or Jaeger if `OTEL_EXPORTER_OTLP_ENDPOINT` is set); add `OTEL_SERVICE_NAME` to `.env.example`; zero-overhead when env var is unset.

39. **DB connection pool tuning** — replace `psycopg2.connect()` one-shot connections with `psycopg2.pool.ThreadedConnectionPool` (min 2, max 10, configurable via `DB_POOL_MIN`/`DB_POOL_MAX`); expose pool stats in `GET /api/system/status`.

40. **Multi-region / DR runbook** — extend `OPERATIONS.md` with PostgreSQL streaming-replication setup, Redis Sentinel failover config, Celery multi-region worker targeting, and a DR checklist; add `docker-compose.ha.yml` example.

---

## Conventions

- **Migration naming**: `000N_short_description.py`, `down_revision` must chain correctly.
- **New scalar config**: add to `app_settings` via `get_setting`/`set_setting` — no new migration columns.
- **Alert dispatch**: always goes through `_send_run_alert()` in `worker.py` — do not add ad-hoc email calls elsewhere.
- **API auth**: all `/api/` routes require session cookie or `Authorization: Bearer <token>` header (or legacy `x-api-token`).
- **Frontend toasts**: call `showToast(message, "error"|"success")` passed as prop — do not use `alert()`.
- **Confirm dialogs**: set `confirmState({message, confirmLabel, fn})` — the `ConfirmModal` handles the rest.
- **New node**: create `app/nodes/action_xyz.py` with `NODE_TYPE`, `LABEL`, `run()`; add `NODE_DEFS` entry and hint JSX to both panels in `canvas.html`.
