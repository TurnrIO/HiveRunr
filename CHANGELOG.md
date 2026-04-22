# Changelog — HiveRunr

All notable changes are documented here, newest first.

---

## [0.3.0] — 2026-04-22 — Full React Canvas, Integrations & Workflow Intelligence

This release completes the Vite + React frontend migration (F-series), ships five new integration nodes, adds collaborative canvas features (multi-select, alignment, subflow extraction), introduces flow tagging & health badges, run annotations, and completes the flow analytics suite.

### Frontend migration complete (F-series)
- **Vite + React multi-page app** — all six pages (admin SPA, canvas, login, signup, reset, invite) are now fully React; the two monolithic `admin.html` / `canvas.html` files are deleted
- **Canvas rebuilt** in `CanvasApp.jsx` with full feature parity: SSE run streaming, real-time node state, autosave (30 s debounce), dirty-state badge, undo/redo, multi-select + clipboard, alignment toolbar, subflow extraction, `Ctrl+F` node search, minimap toggle, keyboard shortcuts modal
- **Shared component library** — `Toast`, `ConfirmModal`, `ReplayEditModal`, `TraceRow`, `StatusDot`, `RoleBadge`, `ViewerBanner`, `useFocusTrap` all in `frontend/src/components/`
- **Error boundaries** — `ErrorBoundary.jsx` wraps admin SPA (per-route) and canvas; dark-themed fallback with "Try again" / "Reload" and collapsible stack trace

### Canvas: power-user features
- **Multi-select + clipboard** (`Ctrl+A/C/V/D`) — `SelectionMode.Partial`, paste staggers nodes by +60 px
- **Alignment toolbar** — floating bar when ≥2 nodes selected; 8 ops: align left/centre/right/top/middle/bottom + distribute H/V; each op is undoable
- **Subflow extraction** — right-click → "Extract N nodes to subflow…"; creates a new flow via the API and replaces the selection with a `call_graph` node
- **Node search** (`Ctrl+F`) — floating bar with text filter + group chips; jump-to-node centres viewport

### New integration nodes
- **`action.mysql`** — pymysql DictCursor; host/port/user/pass/db or DSN; `last_insert_id` in output
- **`action.jira`** — Jira REST API v3; Basic auth (email + api_token); 8 operations: get/create/update/delete issue, add-comment, JQL search, get-transitions, transition-issue; ADF body wrapping
- **`action.wait_for_approval`** (N7) — human-in-the-loop gate; Celery polls Redis; styled HTML email with Approve/Reject buttons; public decision endpoints return themed result page
- **`action.redis`** — GET/SET/DEL/LPUSH/RPOP/INCR/EXPIRE; credential: connection URL
- **`action.graphql`** — query/mutation with variables; credential stores endpoint + Authorization header
- **`action.pdf`** — HTML → PDF via xhtml2pdf; output: `pdf_bytes` (base64)
- **`trigger.rss`** — RSS/Atom feed polling; lookback window + filter expression; output: `entries[]`
- **`action.airtable`** — Airtable REST API; list/get/create/update/delete-record

### Flow analytics (A2)
- **Metrics page** rebuilt with Overview + Per-flow tabs; 7/14/30/90 d range selector
- **Per-flow table** — sortable by total/succeeded/failed/error-rate/avg-ms/P95/P99
- **Daily chart** — stacked volume bars + SVG duration overlay
- **`GET /api/analytics/flows`** + **`GET /api/analytics/daily`** — server-side `PERCENTILE_CONT` aggregation

### Flow management
- **Flow tags** — `tags TEXT[]` column (migration 0013) + GIN index; inline chip editor in admin; tag filter bar on Flows page
- **Flow health badges** — colour-coded error-rate pill per flow (green ≤5%, amber ≤25%, red >25%); fetched from analytics API on page load
- **Run annotations** — `note TEXT` column (migration 0014); `PUT /api/runs/{id}/note` endpoint; inline note editor on every run row in Logs page

### Upgrade notes

**Database migrations required** — run Alembic before starting:
```
docker compose exec api alembic upgrade head
```

New migrations: `0012_approvals.py`, `0013_flow_tags.py`, `0014_run_notes.py`

**New Python dependencies** (already in `requirements.txt`):
- `pymysql` — MySQL/MariaDB support (`action.mysql`)
- `boto3` — S3 + AWS SDK (added in 0.2.0, unchanged)
- `xhtml2pdf` — HTML → PDF conversion (`action.pdf`)

**No new env vars** required for this release. All new features are opt-in or self-contained.

---

## [0.2.0] — 2026-04-20 — Resilience, Observability & Power-User Features

This release covers all work since 0.1.0: operations hardening, DB resilience, credential OAuth, nine new node types, full mobile + accessibility overhaul, canvas power-user features, and the webhook rate-limit config UI.

### Credential OAuth flows (Sprint 18)
- **One-click OAuth connect** — `GET /api/oauth/{provider}/start` redirects to the provider; `GET /api/oauth/{provider}/callback` exchanges the code and saves the credential automatically
- Supported providers: **GitHub** (repo + read:user scopes), **Google** (Sheets + Drive, offline refresh token), **Notion** (Basic token exchange)
- `GET /api/oauth/providers` lists which providers have client credentials configured
- `OAuthConnectModal` in the admin Credentials page; success/error surfaced via toast + auto-navigate; `?oauth_success` / `?oauth_error` query params handled on mount
- New env vars: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` (all optional)

### System diagnostics & startup validation (S-A / S-B)
- **System page** (`GET /api/system/status`) — 9 subsystem checks: DB, Redis, Celery, scheduler leader, email, secrets, API key security, HTTPS, disk; each returns `{status, message, fix?}`; new **System** nav page with colour-coded checks and inline fix guidance, auto-refreshes every 30 s
- **Startup validation** — `_validate_config()` runs on startup; fatal checks (DB + Redis) call `sys.exit(1)` on failure with a clear error; warning checks (SECRET_KEY, API_KEY, APP_URL, AgentMail) log actionable messages

### Ops hardening (S-C)
- `OPERATIONS.md` runbook: health check, start/stop/restart, DB ops, worker/scheduler ops, common errors table, env vars reference
- `PrometheusMiddleware` rewritten as pure ASGI (no `BaseHTTPMiddleware`) — handler exceptions now propagate correctly to uvicorn's logger instead of being swallowed
- Two `email.py` bug fixes backported: `inbox_id` uses the full `AGENTMAIL_FROM` address; send endpoint corrected to `/messages/send`
- Inline `NOTE` comments added to `db.py`, `worker.py`, and `email.py` for operational clarity

### DB performance + Celery retry resilience (S-D)
- **Migration `0011_performance_indexes`** — adds `runs.retry_count INT DEFAULT 0`; new indexes on `runs(workspace_id, created_at DESC)`, `runs(status)`, `runs(graph_id, created_at DESC)`, `audit_log`, and `schedules`
- **Celery retry with backoff** — `enqueue_graph` now has `max_retries=3` with 30/60/120 s exponential backoff for transient DB/Redis failures
- **Run status lifecycle** gains `retrying` and `dead` states; Runs page shows **DEAD** and **RETRY N** badges; status filter adds Dead/Retrying options

### Runs page bulk-delete (Polish)
- Checkbox per row, select-all header checkbox, "Delete selected (N)" button using `POST /api/runs/bulk-delete`; checked rows highlighted in purple
- Ruff `--fix` cleanup: removed unused imports across 8 files

### Test coverage expansion (P2-20)
- `tests/test_permissions.py` — 26 tests covering `_check_admin`, token scope hierarchy, role guards, per-flow access, workspace resolution
- `tests/test_executor_failures.py` — 26 tests covering abort/continue/retry failure modes, condition branching, scheduler lock Lua helpers
- `tests/test_webhook_ratelimit.py` — 13 tests covering rate-limit pipeline logic, Redis fail-open, login brute-force lockout/clear
- `tests/integration/test_e2e_playwright.py` — Playwright E2E: login, dashboard, canvas create/save/run, logout (auto-skipped unless `HIVERUNR_BASE_URL` set)
- Total unit suite: 118 tests, all green

### Responsive & accessibility overhaul (P2-21 / P3-22 / P3-23)
- **Admin pages** — hamburger toggle + sidebar slide-in overlay (`≤1024px`); `useFocusTrap` hook; all modals get `role="dialog" aria-modal="true"`; icon buttons get `aria-label`; nav gets `role="navigation"` + keyboard navigation; Runs split-pane stacks on mobile; Credentials / Schedules / Audit Log tables convert to mobile card lists via `td::before { content:attr(data-label) }`
- **Canvas** — topbar collapses to icon-only at `≤768px`; sidebar becomes off-canvas overlay with hamburger; config panel hides on mobile; all modals get `role="dialog" aria-modal="true" aria-label="..."`; overlay wrappers `aria-hidden="true"`

### Canvas keyboard shortcuts & minimap (P3-24 / P3-25)
- **Shortcuts** — `Ctrl+S` save, `Ctrl+Z` undo, `Ctrl+Y`/`Ctrl+Shift+Z` redo, `Escape` deselect/close, `?` toggle cheatsheet; `kbRef = useRef({})` pattern prevents stale closures; `ShortcutsModal` with 4 sections / 15 entries; admin has its own `AdminShortcutsModal`
- **Minimap** — `<MiniMap>` pannable + zoomable with styled colours; toggle via topbar 🗺 button (desktop) and MoreMenu (mobile)

### Canvas search (P4-26)
- `Ctrl+F` floating `NodeSearchBar` with text filter + group chips; jump-to-node centres viewport via `setCenter`; 🔍 topbar button + MoreMenu item

### Run replay with payload override (P4-27)
- `GET /api/runs/{id}/payload` returns the original trigger payload
- `POST /api/runs/{id}/replay` accepts optional `{payload}` body to override
- `ReplayEditModal` pre-filled with the original payload in both the canvas run inspector and the admin Logs page
- Audit log records `payload_overridden` flag

### Flow templates gallery (P4-28)
- `app/routers/templates.py` — `GET /api/templates` and `GET /api/templates/{slug}`; 9 bundled JSON templates in `app/templates/`
- Canvas OpenModal gains a "Start from template" tab with category chips and 2-column cards; selecting a template calls the existing import endpoint

### Webhook trigger improvements (P4-29)
- **HMAC-SHA256 signature verification** — configurable shared secret; verifies `X-Hub-Signature-256` header (same convention as GitHub webhooks); rejects unsigned requests when a secret is set
- **Allowed-origins CORS** — configurable per-webhook origin allowlist; `OPTIONS` preflight handler added
- `WebhookUrlPanel` in NodeEditorModal with copy button; `secret` and `allowed_origins` fields added to NODE_DEFS

### Sticky note enhancements (P4-30)
- `NOTE_COLORS` palette: amber, blue, green, purple, red, slate (6 options)
- `StickyNote` component applies colour and `minWidth`/`minHeight` dynamically from config
- NODE_DEFS gains colour select, width, and height fields; hint panel shows inline colour swatches
- `zIndex: -1` set in all 4 node-load paths so notes always render behind other nodes

### New node types (P5)
- **`action.redis`** — GET/SET/DEL/LPUSH/RPOP/LRANGE/INCR/DECR/EXPIRE/TTL/EXISTS/KEYS/HGET/HSET/HDEL/HGETALL/SADD/SMEMBERS/SREM/PUBLISH operations; credential: `url` or `host`/`port`/`password`/`db`; useful for caching, counters, and cross-flow signalling
- **`action.graphql`** — GraphQL query/mutation via httpx; credential: endpoint + optional `Authorization` token + extra headers; template rendering in `query` and `variables_json`; output: `data`, `errors[]`, `has_errors`, `status_code`
- **`action.pdf`** — generate a PDF from an HTML template using xhtml2pdf (optional dep, gracefully disabled if absent); auto-wraps HTML fragments; output: `pdf_bytes` (base64), `size_bytes`, `filename`
- **`trigger.rss`** — poll an RSS 2.0 or Atom 1.0 feed using stdlib only (`xml.etree`, `urllib`); sliding `lookback_minutes` window; Python `filter_expression` (use `entry`); output: `entries[]`, `count`, `feed_title`, first-entry shortcuts
- **`action.airtable`** — Airtable REST API via httpx; credential: `api_key` (PAT) + `base_id`; operations: list_records, search, get_record, create_record, update_record, upsert_record, delete_record; auto-pagination on list/search; output: `records[]`, `record`, `id`, `deleted`

### Webhook rate-limit configuration UI (P6-36)
- Rate-limit config moved from compile-time constants to the `app_settings` KV store (live-readable via `get_ratelimit_policy()`)
- `GET /api/settings/ratelimit` returns current policy (`limit`, `window`) + live per-token Redis hit counters
- `PUT /api/settings/ratelimit` persists new values; `WEBHOOK_RATE_LIMIT` / `WEBHOOK_RATE_WINDOW` env vars remain as initial defaults
- **Rate Limits card** on the admin Settings page: editable limit + window inputs, Save button, Refresh button, live counter table per active token; `limit=0` disables checking

### Upgrade notes
- Run `docker compose pull && docker compose up -d --build`
- Apply pending Alembic migration: `docker compose exec api alembic upgrade head`
  - Migration `0011` adds `runs.retry_count` and performance indexes — safe to run against live data
- New **optional** env vars:
  - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — enable GitHub OAuth for credentials
  - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — enable Google OAuth for credentials
  - `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` — enable Notion OAuth for credentials
  - `WEBHOOK_RATE_LIMIT` / `WEBHOOK_RATE_WINDOW` — initial defaults for the rate-limit policy (can now be overridden at runtime via the Settings UI)
- xhtml2pdf (`action.pdf` node) is an optional dependency — install with `pip install xhtml2pdf` inside the container only if needed; the node gracefully disables itself if the library is absent
- boto3 remains required for `action.s3`; all other new nodes use stdlib or httpx (already a dependency)

---

## [0.1.0] — 2026-04-15 — First versioned release

This release consolidates all work from the initial commit through the P1 sprint series into the first tagged version of HiveRunr.

### Workspace multi-tenancy (W-series)
- **Workspace foundation** — `workspaces` + `workspace_members` tables; full CRUD API; default workspace seeded for existing installs
- **Scoped graphs + runs** — `workspace_id` FK on `graph_workflows` + `runs`; `_resolve_workspace()` helper (header → cookie → first workspace → default); canvas sends `X-Workspace-Id` header
- **Scoped credentials, schedules, tokens** — `workspace_id` FK on `credentials`, `schedules`, `api_tokens`; executor only loads the correct workspace's secrets at run time
- **Workspace management UI** — `WorkspacesPage` in admin.html: rename, member table with role dropdowns, super-admin all-workspaces view with create + delete
- **Self-serve onboarding** — `ALLOW_SIGNUP` gate; `POST /api/auth/signup` + `signup.html`; subdomain routing (`SUBDOMAIN_ROUTING` + `APP_DOMAIN`); plan limits + usage endpoint + progress bars in UI

### Security & reliability hardening (P0)
- API key fail-closed: disabled when unset, loud warning for `dev_api_key` default
- `is_secure_context()` drives `secure=True` on all session cookies when `APP_URL` starts with `https://`
- Startup exceptions logged instead of silently swallowed
- `GET /api/runs/stats` server-side aggregates replace fragile `?page_size=200` calls on Dashboard and Metrics pages

### Canvas improvements (P1-editor)
- **Dirty-state indicator + autosave** — amber "● Unsaved" badge; 30 s autosave timer resets on each edit; "✓ Saved" timestamp tooltip; node IDs upgraded to RFC 4122 v4 UUIDs
- **Node test button** — `POST /api/graphs/{id}/nodes/{node_id}/test`; collapsible Test panel with JSON input + pin-output; workspace credential isolation fixed
- **Version diff / restore** — `HistoryModal` two-pane layout; colour-coded `+`/`−`/`~`/`=` diff vs current; defaults to Diff tab; restore reloads canvas in-place
- **Flow import / export** — `GET /api/graphs/{id}/export` returns self-contained JSON bundle (credential slot names only, no secrets); `POST /api/graphs/import` creates graph in workspace with audit log entry

### New node types (P1-nodes)
- **`trigger.email`** — IMAP poller using stdlib `imaplib`; configurable search criteria, Python filter expression, mark-as-read; outputs `emails[]` list + first-email shortcuts
- **`action.postgres`** — SQL Query node; PostgreSQL (psycopg2), MySQL (pymysql), SQLite (stdlib); supports DSN string or individual host/port fields; parameterised queries; outputs `rows[]`, `count`, `row`, `columns`, `affected`
- **`action.s3`** — S3 Storage node via boto3; operations: get/put/list/delete/presigned_url/head/copy; compatible with AWS S3, MinIO, Cloudflare R2, Backblaze B4
- **`trigger.file_watch`** — polls local filesystem or SFTP for recently-modified files; glob pattern, `lookback_minutes` sliding window, `min_age_seconds` write-guard, recursive scan

### Credential UX (P1-credentials)
- **Test connection button** — `POST /api/credentials/{id}/test`; auto-detects type (SMTP, SFTP, SSH, IMAP, PostgreSQL/MySQL/SQLite, S3/AWS, Telegram, OpenAI); returns `{ok, message, type, latency_ms}`; inline green/red pill result in admin UI

### Upgrade notes
- Run `docker compose pull && docker compose up -d --build` to get the new image
- Apply pending Alembic migrations: `docker compose exec api alembic upgrade head`
  - Migrations `0008` through `0010` add workspace tables and scope FKs; they include default-workspace backfills so existing data is preserved
- New env vars (all optional, safe to omit):
  - `ALLOW_SIGNUP` — enable public self-serve signup (default: off)
  - `SUBDOMAIN_ROUTING` + `APP_DOMAIN` — map `<slug>.domain` to workspaces
  - `APP_TIMEZONE` — server timezone for scheduler display (auto-detected if unset)
- boto3 is now a required dependency (previously commented out in `requirements.txt`); the Docker image build handles this automatically

---

## [Unreleased] — 2026-04-07 — Sprint 4: UX polish — duplicate flow, version preview, cron validation

### Duplicate/clone flow (#7)
- New `POST /api/graphs/{id}/duplicate` endpoint — server-side clone with smart naming: appends "(copy)", "(copy 2)", etc. until a unique name is found; replaces the previous client-side GET+POST workaround in the dashboard

### Version preview (#8)
- New `GET /api/graphs/{id}/versions/{vid}` endpoint returns full `graph_data` for any stored version without altering the live graph
- Version History modal now shows a side-by-side preview panel: click 👁 on any version to see its node list (type + label), edge count, optional note, and collapsible raw JSON diff — all before committing to a restore
- The "Restore" action is available directly from the preview panel for a single-click workflow

### Cron validation + next-run preview (#9)
- New `GET /api/schedules/next-run?cron=&timezone=&count=` endpoint uses APScheduler's own `CronTrigger.from_crontab()` for validation — same parser the scheduler uses, so the preview is always accurate
- **CronBuilder** now shows the next two upcoming fire times in green below the expression, or a red "⚠ invalid" error for bad expressions; updates debounced at 500 ms while typing in expression mode
- **Schedules table** gains a "Next run" column — each row fetches its own next fire time on render; paused schedules show "paused" rather than a date

---

## [Unreleased] — 2026-04-07 — Sprint 3: API token scoping + session cleanup

### API token expiry + permission scoping (#3)
- New columns `scope` (TEXT, default `manage`) and `expires_at` (TIMESTAMPTZ, nullable) on `api_tokens` — Alembic migration `0002` with `IF NOT EXISTS` guards; backwards-compatible (existing tokens inherit `manage` scope and no expiry)
- Three scopes in ascending order — **read** (GET only), **run** (read + trigger/cancel/replay runs), **manage** (full API access matching previous behaviour)
- `get_api_token_by_hash()` now checks `expires_at > NOW()` in SQL — expired tokens return `None` and yield HTTP 401
- New helpers in `deps.py`: `_require_run_scope()` and `_require_manage_scope()` enforce scope on state-changing endpoints; session-cookie users are never affected
- Scope applied across routers: delete/clear/trim runs → `manage`; cancel/replay/trigger runs → `run`; workflow toggle → `manage`; workflow run → `run`
- `POST /api/tokens` now accepts `scope` and `expires_days` (optional; `None` = never expires)
- Settings UI — token form gains a scope dropdown and optional expiry-in-days field; token table shows Scope badge, Expires column; reveal modal shows scope + expiry + preferred `Authorization: Bearer` usage hint
- Also fixes maturity item #18: Settings page now documents `Authorization: Bearer` as the preferred method

### Session cleanup nightly job (#5)
- `purge_expired_sessions()` was defined but never called; now wired into both the HA leader scheduler and the standalone fallback as a `CronTrigger(hour=2, minute=0)` job (fires at 02:00 server time every night)

---

## [Unreleased] — 2026-04-07 — Sprint 2: Run log pagination + backend filtering

### Run log pagination + backend filtering (#6)
- `list_runs()` in `db.py` now accepts `page`, `page_size` (max 200), `status`, `flow_id`, and `q` parameters; returns `{runs, total, page, pages}` instead of a bare array
- `GET /api/runs` router updated with typed `Query` params: `?page=`, `?page_size=`, `?status=`, `?flow_id=`, `?q=` — all optional, defaults to page 1 × 50 rows
- Search (`?q=`) matches against flow name (ILIKE), task_id (ILIKE), or exact run ID
- Frontend **Run Logs** panel replaced client-side `.filter()` with server-driven filtering: search field triggers a fresh API call on Enter / blur, status dropdown fires immediately, Prev/Next pagination controls appear when there is more than one page
- Dashboard and Metrics call sites updated to use `?page_size=200` and extract `.runs` from the response (backward-compatible `?? r` fallback)

---

## [Unreleased] — 2026-04-07 — Sprint 1: Cancel flows + login brute-force protection

### Cancel running flows
- New endpoint `POST /api/runs/{id}/cancel` — revokes the Celery task with `terminate=True` (sends SIGTERM to the worker process) and marks the run as `cancelled` in the database
- Only valid for runs in `queued` or `running` state; returns HTTP 400 for already-finished runs
- `_sync_stuck_runs` now correctly marks Celery-revoked tasks as `cancelled` instead of `failed`
- The Cancel button already existed in the Run Logs UI — it now works end-to-end

### Login brute-force protection
- `POST /api/auth/login` now tracks failed attempts per client IP in Redis
- After **5 consecutive failures** the IP is locked out for **15 minutes**; the response is HTTP 429 with the remaining wait time in the message
- A successful login immediately clears the failure counter
- Uses `X-Forwarded-For` when present (Caddy proxy sets this) so the real client IP is tracked rather than the proxy address
- Fails open if Redis is unavailable — logins still work, protection is simply suspended

---

## [Unreleased] — 2026-04-07 — Production hardening + HA scheduler (P3)

### Production deployment profile
- **Non-root Docker user** — `Dockerfile` now creates a `hiverunr` user (UID 1001) and switches to it before the `CMD`; the process can no longer write to the image filesystem or escalate privileges if a dependency is compromised
- **`docker-compose.prod.yml` overlay** — merge on top of the default compose file to get a production-safe stack:
  - API runs `uvicorn --workers 2` (no `--reload`)
  - Source-code volume mounts removed — code is baked into the image at build time
  - CPU + memory resource limits on all services (api: 1 CPU / 512 MB, worker: 2 CPU / 1 GB, scheduler/flower: 0.25 CPU / 128 MB)
  - `restart: unless-stopped` on all services
  - Usage: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`

### HA scheduler with leader election
- **Redis distributed lock** (`SET NX PX`) prevents duplicate job firing when multiple `scheduler` replicas run side-by-side
- Each replica generates a unique instance ID on startup; only the replica that holds the lock executes jobs — others sit in standby and poll every `SCHEDULER_STANDBY_POLL_S` seconds (default 10 s)
- The leader atomically refreshes its lock TTL every `SCHEDULER_LOCK_REFRESH_S` seconds (default 15 s) using a Lua script, so a stale/dead leader's lock expires within `SCHEDULER_LOCK_TTL_MS` (default 45 s) and a standby takes over
- Lock release uses a Lua compare-and-delete so a slow process can never accidentally release a lock already claimed by a new leader
- **Graceful fallback** — if Redis is unreachable at startup the scheduler falls back to the previous single-instance behaviour with no HA; existing deployments are unaffected
- Tunable via env vars: `SCHEDULER_LOCK_TTL_MS`, `SCHEDULER_LOCK_REFRESH_S`, `SCHEDULER_STANDBY_POLL_S`

---

## [Unreleased] — 2026-04-02 — Security hardening (Critical fixes)

### Error handling
- **Replaced all 15 bare `except:` clauses** across node handler files with specific exception types (`json.JSONDecodeError`, `ValueError`, `TypeError`) — prevents accidental swallowing of `KeyboardInterrupt`, `SystemExit`, and other non-error exceptions, and makes failures easier to trace in logs
- Files updated: `action_http_request.py`, `action_notion.py`, `action_github.py`, `action_call_graph.py`, `action_google_sheets.py`

### Authentication
- **`Authorization: Bearer <token>` header** is now the recommended and highest-priority authentication method for API clients — safer than query parameters because it never appears in server access logs or browser history
- Legacy `x-api-token` / `x-admin-token` headers continue to work unchanged
- `?token=` query parameter is still accepted for backwards-compatibility but now emits a `WARNING` log line on every use with the request path, making it easy to find and migrate callers
- Logic extracted into a standalone `_extract_raw_token()` helper in `deps.py` for clarity and future testability

---

## [Unreleased] — 2026-04-02 — Alembic migrations (P3)

### Database schema management
- **Alembic** replaces the hand-rolled `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN IF NOT EXISTS` block in `init_db()` with proper versioned migrations under `migrations/`
- `migrations/versions/0001_initial_schema.py` — initial migration capturing the full v12 schema; uses `IF NOT EXISTS` throughout so it is safe to run against a database that was already created by the legacy `init_db()`
- `app/core/db.py` — new `run_migrations()` function calls `alembic upgrade head` via the Python API at startup; `init_db()` is now a one-line wrapper that calls `run_migrations()` for backwards compatibility; the original implementation is preserved as `_init_db_legacy()` for reference
- All three process entry points (`main.py`, `worker.py`, `scheduler.py`) continue to call `init_db()` unchanged — they transparently get Alembic
- `alembic.ini` + `migrations/env.py` configured to read `DATABASE_URL` from the environment — no credentials in source control
- Future schema changes: add a new file in `migrations/versions/` with `alembic revision --autogenerate -m "description"` and deploy as usual
- `alembic>=1.13.0` added to `requirements.txt`

---

## [Unreleased] — 2026-04-02 — External secrets provider (P3)

### External secrets provider
- `app/core/secrets.py` — lightweight adapter that fetches secrets from an external provider at startup and merges them into `os.environ`; existing env vars always take precedence so local `.env` overrides keep working
- **AWS Secrets Manager** (`SECRETS_PROVIDER=aws`): fetches a JSON secret by `AWS_SECRET_NAME`; credentials resolved automatically via IAM role, `~/.aws`, or standard AWS env vars; requires `boto3` (optional, not in default `requirements.txt`)
- **HashiCorp Vault KV v2** (`SECRETS_PROVIDER=vault`): reads from `VAULT_SECRET_PATH` (default `secret/data/hiverunr`) using either a static `VAULT_TOKEN` or AppRole (`VAULT_ROLE_ID` + `VAULT_SECRET_ID`); uses `httpx` which is already a HiveRunr dependency — no extra package needed
- `load_secrets()` wired into `app/main.py`, `app/worker.py`, and `app/scheduler.py` before any env-var reads — covers all three process entry points
- Both providers fail gracefully (log error, continue with env vars) so a provider outage never prevents the app from starting
- `.env.example` extended with all new provider variables and inline comments

---

## [Unreleased] — 2026-04-02 — SMTP fix + Observability

### SMTP STARTTLS / SSL fix
- Extracted `app/core/smtp.py` — single `send_message()` helper that auto-selects the connection mode by port: 587 → STARTTLS, 465 → implicit TLS (SMTP_SSL), 25/other → plain
- `action_send_email.py` and `worker.py` both use the shared helper; inline `smtplib.SMTP_SSL` hardcoding removed
- Default port changed from 465 to 587 (matching `.env.example` and the vast majority of modern providers)
- `.env.example` updated with a comment explaining each port's connection mode

### Observability: Prometheus metrics + structured JSON logging
- `app/observability.py` — single module housing all observability concerns
- **Structured logging**: `configure_logging()` replaces the root handler with a JSON formatter (`python-json-logger`); every log line is a single parseable JSON object with `service`, `level`, `name`, `message`, and timestamp fields; falls back to plain logging if the library is absent
- **HTTP metrics** via `PrometheusMiddleware` (Starlette `BaseHTTPMiddleware`): tracks `hiverunr_http_requests_total` (counter, labels: method / path template / status_code) and `hiverunr_http_request_duration_seconds` (histogram); path is normalised to the route template to prevent per-ID cardinality explosion
- **Run-count metrics** via `_RunMetricsCollector` (custom Prometheus collector): queries PostgreSQL on each scrape to expose `hiverunr_runs_total{status}` — avoids multi-process counter sync issues between the API and Celery worker processes
- `/metrics` endpoint added (auth-gated) — returns standard Prometheus text exposition
- `prometheus_client>=0.20.0` and `python-json-logger>=2.0.7` added to `requirements.txt`

---

## [Unreleased] — 2026-04-02 — Codebase refactor

### Router / services split
- `app/main.py` reduced from ~1100 lines to ~130 lines — now contains only app wiring, static mounts, page routes, health, and startup lifecycle
- `app/deps.py` — shared auth guards (`_check_admin`, `_require_writer`, `_require_owner`, `_auth_redirect`) extracted into one place
- `app/seeds.py` — example graph seed data and `seed_example_graphs()` function extracted from main
- `app/routers/auth.py` — auth, user management, and API token endpoints
- `app/routers/graphs.py` — graph CRUD, graph versions, graph-run endpoint; helpers `_graph_with_data` and `_sync_cron_triggers` co-located
- `app/routers/runs.py` — run list/delete/trim/replay and `_sync_stuck_runs` reconciliation logic
- `app/routers/schedules.py` — schedule CRUD + toggle
- `app/routers/credentials.py` — credential CRUD
- `app/routers/webhooks.py` — webhook trigger + per-token Redis rate limiting
- `app/routers/admin.py` — system status, metrics, run logs, admin reset, maintenance, node registry, scripts, and workflow templates
- All 53 unit tests pass; ruff reports zero violations across the new files

---

## [v12] — 2026-04-01 — Auth · Encryption · Security Hardening

### Session-based authentication
- Replaced token-in-URL auth with session cookies (`hr_session`, 30-day rolling window, SHA-256 hash stored in DB)
- First-run setup wizard at `/setup` — creates the owner account before any other route is accessible
- Login page at `/login` with username + password; redirects preserve the intended destination via `?next=`
- All protected routes (`/`, `/admin`, `/canvas`, `/docs`, `/flower/*`) redirect to `/login` if unauthenticated

### Role system
- Three roles: `owner` > `admin` > `viewer`
- Viewer role is read-only across all pages (no create/edit/run/delete)
- Role badge and user avatar in sidebar footer
- Role documentation card on the Users page

### User management
- Owner-only Users page: create users, change roles, reset passwords, delete users
- Inline role-change dropdown; one-time password reset modal

### API tokens
- Owners generate named API tokens from Settings (replaces `ADMIN_TOKEN` env var)
- Tokens have `hr_` prefix, stored as SHA-256 hashes — shown only once at creation
- Accepted via `x-api-token` header for CI/CD and service-to-service calls

### Credential encryption-at-rest
- All credentials now encrypted using **Fernet** (AES-128-CBC + HMAC-SHA256) via the `cryptography` library
- `SECRET_KEY` env var holds the master key; `setup.sh` auto-generates a unique key on first install
- Transparent migration: existing plaintext credentials are read normally and re-encrypted on next save
- Credentials page shows 🔒 green badge when `SECRET_KEY` is set, ⚠️ amber banner when it is not
- `encryption_configured` flag exposed in `/api/auth/status`

### Flower and API docs protected
- `/flower/*` gated via Caddy `forward_auth` calling `/api/auth/check` — unauthenticated requests redirect to `/login`
- `/docs`, `/redoc`, `/openapi.json` replaced with auth-gated equivalents (FastAPI auto-routes disabled)

### setup.sh replaces bootstrap.sh
- `bootstrap.sh` removed — it was 10k lines and substantially out of date with the codebase
- New `setup.sh` (35 lines): copies `.env.example` → `.env` and generates a unique `SECRET_KEY`
- Quick Start is now: `git clone` → `bash setup.sh` → `docker compose up -d --build`

### CI pipeline + unit tests
- `.github/workflows/ci.yml` with four jobs: **lint** (ruff), **audit** (pip-audit), **test** (pytest), **build** (docker build), and a non-blocking **scan** (Trivy CRITICAL/HIGH CVEs)
- Integration smoke test in `tests/integration/test_smoke.py` — auto-skipped unless `HIVERUNR_BASE_URL` is set; runs as a separate CI job on push to main (spins up docker compose, waits for health, exercises auth → graph create → run → trace assertions)
- 53 unit tests across `tests/test_executor.py`, `tests/test_crypto.py`, `tests/test_run_script.py`, `tests/test_utils.py`
- `pyproject.toml` with ruff config (select E/F/W/I/UP, ignore E501/E402) and pytest config (`pythonpath = ["."]`)
- pyright omitted for now — too noisy without full stub coverage; tracked as future P2 item
- `/api/admin/reload_nodes` confirmed working — hot-reloads `app/nodes/custom/` without restart

### Run Script node — feature flag + audit logging
- `action.run_script` is now **disabled by default** — set `ENABLE_RUN_SCRIPT=true` in `.env` to allow execution
- Every execution writes two audit log entries (before and after) to the `audit` Python logger at `WARNING` level, capturing a SHA-256 hash and 120-character preview of the script
- Run log messages also include the audit entry so it appears inline in run traces
- Canvas warning boxes replaced with red ⚠️ danger banners explaining the risk and the feature flag
- `.env.example` documents `ENABLE_RUN_SCRIPT=false` with a threat model note

### Housekeeping — HiveRunr rename complete
- All remaining `automations`/`auto` DSN fallbacks replaced with `hiverunr` across `db.py`, `.env.example`, workflow scripts
- Health check User-Agent updated to `hiverunr-health-check/1.0`
- Added HiveRunr favicon (`app/static/favicon.svg` — purple hexagon + lightning bolt) served on all pages and `/favicon.ico`

### Bug fixes
- Canvas black screen: removed stale `getToken()` call left over from auth migration
- Note nodes (`type:"note"`) no longer crash graph execution — skipped silently by the executor
- Login redirect now preserves destination via `?next=` (previously always sent to `/` after login)
- Removed false "stored encrypted" claim from Credentials UI copy

### Docs / config
- README rewritten: auth model, roles, API tokens, credential encryption, setup flow
- `ADMIN_TOKEN` removed from `.env.example` and all documentation
- `CHANGELOG`, `README`, and `.env.example` aligned with actual codebase behaviour

---

## [v11] — 2026-03-26 — Modular Nodes · HiveRunr Brand · Run Logs · URL Persistence

### Platform rename
- Project renamed from "Automations" to **HiveRunr**
- All UI titles, email notifications, and API docs updated to reflect the new name
- Flow URLs now use brand-consistent slugs: `#flow-a3f2e1c9` instead of `#graph-42`

### Modular node filesystem
- All 23 node types extracted from `executor.py` into individual files under `app/nodes/`
- Auto-discovering registry in `app/nodes/__init__.py` — add a file, it's available instantly
- Shared `_render()` template helper in `app/nodes/_utils.py`
- `app/nodes/custom/` — hot-loadable directory; drop a `.py` file and call `POST /api/admin/reload_nodes`, no restart needed
- `executor.py` reduced to ~200 lines of pure orchestration

### New nodes
- `action.merge` — merges outputs from multiple upstream nodes (modes: `dict`, `all`, `first`)
- `action.github` — GitHub API integration (issues, PRs, releases)
- `action.google_sheets` — read/write Google Sheets rows
- `action.notion` — create/update Notion pages

### Continue-on-error
- Per-node `fail_mode` setting: `abort` (default) or `continue`
- In `continue` mode, errors are stored in context and the flow keeps running
- Canvas shows a warning when `continue` mode is selected

### Run replay
- `POST /api/runs/{id}/replay` re-enqueues a run using its original payload
- ▶ Replay button in the dashboard

### Webhook rate limiting
- Redis token-bucket rate limiting per webhook token
- Configurable via `WEBHOOK_RATE_LIMIT` and `WEBHOOK_RATE_WINDOW` env vars

### Run Logs page (rebuilt)
- Previous file-based log viewer replaced with a DB-backed run trace viewer
- Per-node execution trace: status, duration, retry count, collapsible input/output/error inspector
- Filterable by status, searchable by flow name or run ID

### URL state persistence
- Admin dashboard: hash-based routing — `#dashboard`, `#logs`, `#metrics`, etc. — survives refresh and browser back/forward
- Canvas: open flow is reflected in the URL (`#flow-{slug}`), restored on refresh

### Flow slugs
- Each flow gets a unique 8-character hex slug on creation (e.g. `a3f2e1c9`)
- `GET /api/graphs/by-slug/{slug}` endpoint for slug-based lookup
- Automatic migration backfills slugs for existing flows on first startup

### Bug fixes
- SFTP `list` operation: fixed `module 'paramiko' has no attribute 'S_ISDIR'` — corrected to `stat.S_ISDIR` from Python stdlib
- Metrics/Dashboard: flows now show their actual name instead of `graph #12` — fixed via `LEFT JOIN graph_workflows` in `list_runs()`

---

## [v10] — 2026-03-25 — Integration Nodes · Live Data Inspector · Flow Templates

### New nodes
- `action.github` — GitHub API (issues, PRs, releases)
- `action.google_sheets` — Google Sheets read/write
- `action.notion` — Notion page creation/update

### Live data inspector
- "🔬 Inspect run…" dropdown in the canvas topbar
- Select any past run to overlay per-node input and output directly on the config panel
- Shows duration, attempt count, and truncation warning for large payloads

### Node input in traces
- Each trace record now stores the node's input alongside its output
- Inputs larger than 2000 characters are stored as a `__truncated` marker

### Flow templates
- `GET /api/templates` — lists available templates
- `POST /api/templates/{id}/use` — instantiates a template as a new flow
- Templates UI page in the admin dashboard with category grouping and tag badges
- Six built-in templates: Daily Health Check, GitHub Issue → Slack, Notion Daily Log, Sheets → Slack Report, LLM Summariser, Webhook → Notion

---

## [v9] — 2026-03-25 — True If/Else Branching · Run Output Viewer · Failure Notifications

### True If/Else branching
- The Condition node now genuinely branches — nodes on the un-taken handle are skipped
- BFS from each handle computes which nodes belong to each branch
- Nodes reachable from both handles (convergence points) always execute
- Skipped nodes appear in the trace with `status: "skipped"` for visibility

### Run output viewer
- Expanding a run in the dashboard now shows its output or error inline
- Script runs show full `stdout` in a monospace box
- Fixed "Invalid Date" in the Started column

### Failure notifications
- `_notify_failure()` helper in `worker.py`
- Sends Slack message and/or email when any run fails
- Configurable via `NOTIFY_SLACK_WEBHOOK` and `NOTIFY_EMAIL` env vars

---

## [v8] — 2026-03-24 — Sub-flows · Slack Node · Export/Import · Edge Labels · Pre-run Validation

### Sub-flow composition
- `action.call_graph` — invoke another flow and receive its output as a node result
- Circular dependency detection prevents infinite loops

### Slack node
- `action.slack` — post messages to Slack via incoming webhook
- Supports templated message body

### Flow export/import
- Export any flow as a JSON file from the canvas toolbar
- Import JSON to create a new flow — nodes and edges fully restored

### Edge labels
- Click any edge to add a label (shown on the canvas)
- Labels are saved with the flow

### Pre-run validation
- "▶ Validate" button checks for disconnected nodes, missing required fields, and invalid configs before running
- Validation issues shown in a panel with jump-to-node links

### Auto-layout
- One-click Dagre-based automatic graph layout

---

## [v7] — 2026-03-24 — SSH/SFTP · Loop Node · Credentials Store · Undo/Redo

### SSH and SFTP nodes
- `action.ssh` — execute commands on remote servers over SSH
- `action.sftp` — upload, download, list files over SFTP
- Both nodes support credential store references

### Loop node
- `action.loop` — iterate over an array, running downstream nodes once per item
- Loop context available in each iteration as `{{loop.item}}` and `{{loop.index}}`

### Credentials store
- Encrypted credential storage in the database
- Credentials panel in the admin UI — add/edit/delete credentials by name and type
- Nodes can reference credentials by name via `{{cred.name}}`

### Undo/redo
- Full undo/redo history in the canvas (Ctrl+Z / Ctrl+Shift+Z)
- History is reset when a new flow is loaded

### Node disable/enable
- Toggle individual nodes off without deleting them
- Disabled nodes are skipped during execution and shown greyed-out on the canvas

---

## [v6] — 2026-03-23 — LLM Node · Telegram Node · Script Manager · Version History

### LLM call node
- `action.llm_call` — OpenAI chat completion
- Configurable model, system prompt, and user prompt with `{{variable}}` templating

### Telegram node
- `action.telegram` — send messages to a Telegram chat via bot token

### Script manager
- Scripts page in the admin UI — create, edit, and delete Python scripts
- Scripts are executed by `action.run_script` nodes

### Version history
- Save named snapshots of any flow from the canvas toolbar
- Restore any previous version with one click
- Version list shows timestamp and optional note

---

## [v5] — 2026-03-23 — Metrics Dashboard · Retry Policy · Filter Node · Set Variable Node

### Metrics dashboard
- Run volume chart (7-day bar chart, success/failure split)
- Top failing flows
- Recent runs table
- Key stats: total runs, success rate, active runs, avg duration

### Retry policy
- Per-node retry configuration: max attempts and delay between retries
- Retry state visible in the run trace

### Filter node
- `action.filter` — evaluates a condition; stops flow execution if false

### Set variable node
- `action.set_variable` — stores a value in flow context for use by downstream nodes

---

## [v4] — 2026-03-22 — Canvas Flow Editor · React Flow · Graph Persistence

### Visual canvas editor
- Full React Flow v11 integration
- Drag-and-drop node placement, edge drawing, node deletion
- Flows saved to PostgreSQL as JSON

### Node types (initial)
- `trigger.manual`, `trigger.webhook`, `trigger.cron`
- `action.http_request`, `action.transform`, `action.condition`
- `action.log`, `action.delay`, `action.run_script`, `action.send_email`

### Graph API
- `GET/POST /api/graphs` — list and create flows
- `GET/PUT/DELETE /api/graphs/{id}` — read, update, delete a flow
- `POST /api/graphs/{id}/run` — trigger a flow run

---

## [v3] — 2026-03-21 — Admin UI · Schedules · Log Viewer

### Admin UI
- Single-page React admin dashboard
- Workflow enable/disable toggle
- Manual workflow trigger
- Recent runs table with cancel and delete

### Schedules
- Cron schedule manager with timezone support
- DB-driven scheduler (`app/scheduler.py`) polls for due schedules and enqueues tasks
- `next_run_at` calculated and stored after each enqueue

### Log viewer
- Per-run log files written to `runlogs/`
- Log list + viewer in the admin UI

---

## [v2] — 2026-03-20 — PostgreSQL · Run History · Celery Result Backend

### PostgreSQL integration
- Replaced in-memory state with PostgreSQL
- `runs` table stores task ID, status, result, timestamps
- `workflows` table stores enabled/disabled state

### Run history
- All runs persisted — survives worker restarts
- API endpoints to list, cancel, and delete runs

### Celery result backend
- Redis configured as both broker and result backend

---

## [v1] — 2026-03-19 — Initial Release

### Foundation
- FastAPI API server with `/run/{workflow}` trigger endpoint
- Celery + Redis task queue
- Example `health_check` and `daily_summary` workflows
- `docker-compose.yml` with Caddy reverse proxy
- Bootstrap script generates all files from scratch
- Flower worker monitor at `/flower/`
