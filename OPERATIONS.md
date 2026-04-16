# HiveRunr — Operations Runbook

This document covers day-to-day maintenance, common failure scenarios, and how to fix them without needing AI assistance.

---

## Quick health check

Open **Admin → System (🔧)** in the UI. Every subsystem shows green/amber/red with an exact fix instruction. If you can't reach the UI, use the CLI:

```bash
curl -s http://localhost:8000/health          # should return {"status":"ok"}
docker compose ps                             # check all containers are Up
docker compose logs --tail=50 api             # recent app logs
docker compose logs --tail=50 worker          # recent worker logs
docker compose logs --tail=50 scheduler       # recent scheduler logs
```

---

## Starting, stopping, restarting

```bash
docker compose up -d                          # start all services
docker compose down                           # stop all (data preserved in volumes)
docker compose restart api                    # restart just the API (picks up .env changes)
docker compose restart worker                 # restart just the Celery worker
docker compose restart scheduler              # restart just the APScheduler

# Rebuild after a code change that isn't hot-reloaded (e.g. requirements.txt):
docker compose build && docker compose up -d
```

> **Note:** The `./app` directory is bind-mounted, so Python file edits are picked up
> immediately by `uvicorn --reload` in the API container — no restart needed.
> Changes to `requirements.txt`, `Dockerfile`, or `docker-compose.yml` require a rebuild.

---

## Viewing logs

```bash
docker compose logs -f api                    # follow API logs in real time
docker compose logs -f worker                 # follow worker logs
docker compose logs --since=1h api            # last hour of API logs

# All services at once:
docker compose logs -f
```

Logs are structured JSON (one object per line). To extract error lines:
```bash
docker compose logs api 2>&1 | grep '"level":"error"'
```

---

## Database

### Connect to the database
```bash
docker compose exec db psql -U hiverunr -d hiverunr
```

### Run migrations manually
```bash
docker compose exec api alembic upgrade head
```

### Roll back one migration
```bash
docker compose exec api alembic downgrade -1
```

### Check current migration version
```bash
docker compose exec api alembic current
# or in psql:
SELECT * FROM alembic_version;
```

### Back up the database
```bash
docker compose exec db pg_dump -U hiverunr hiverunr > backup_$(date +%Y%m%d).sql
```

### Restore from backup
```bash
docker compose exec -T db psql -U hiverunr -d hiverunr < backup_20240101.sql
```

### Database is full / disk pressure
```bash
# Check DB size
docker compose exec db psql -U hiverunr -c "SELECT pg_size_pretty(pg_database_size('hiverunr'));"

# Trim old runs from the UI: Admin → Settings → Run Retention
# Or manually:
docker compose exec db psql -U hiverunr -c "DELETE FROM runs WHERE created_at < NOW() - INTERVAL '30 days';"
docker compose exec db psql -U hiverunr -c "VACUUM ANALYZE runs;"
```

---

## Reset the owner password

If you're locked out of the admin account:

```bash
# 1. Generate a bcrypt hash for your new password:
docker compose exec api python -c "
from passlib.context import CryptContext
ctx = CryptContext(schemes=['bcrypt'])
print(ctx.hash('your-new-password'))
"

# 2. Update it in the database (replace $HASH and $USERNAME):
docker compose exec db psql -U hiverunr -c \
  "UPDATE users SET password_hash='\$HASH' WHERE username='\$USERNAME';"
```

Alternatively, if email is configured, use the **Forgot password?** link on the login page.

---

## Workers

### No workers responding (flows queue but never run)

```bash
docker compose ps worker        # is the container running?
docker compose logs worker      # check for crash/import errors
docker compose restart worker   # restart it
```

### Scale up workers

```bash
# Add a second worker container:
docker compose up -d --scale worker=2
```

### Inspect queued / active tasks (Flower)

Flower is available at `http://localhost/flower` (proxied by Caddy). It shows all active, reserved, and failed Celery tasks.

---

## Scheduler

The scheduler uses a Redis leader lock (`hiverunr:scheduler:leader`). Only one scheduler instance holds the lock at a time — extras run in standby mode. The System page shows whether the lock is currently held.

```bash
# Check if the lock exists in Redis:
docker compose exec redis redis-cli GET hiverunr:scheduler:leader

# Scheduler crashed and lock is stuck (TTL is 45 s, so wait or force-release):
docker compose exec redis redis-cli DEL hiverunr:scheduler:leader
docker compose restart scheduler
```

---

## Email / alerts not sending

1. Check **Admin → System** — the Email row shows exactly which env vars are missing.
2. Verify `AGENTMAIL_API_KEY`, `AGENTMAIL_FROM`, and `OWNER_EMAIL` are all set in `.env`.
3. `AGENTMAIL_FROM` must be the **full inbox address** (e.g. `alerts@agentmail.to`), not just the local part.
4. Test by triggering a flow failure or using the "Send test" option in alert settings.
5. Check API logs for `email: AgentMail returned` errors.

---

## Credential encryption

Credentials are encrypted with Fernet (AES-128-CBC + HMAC-SHA256) using `SECRET_KEY`.

**If SECRET_KEY is not set:** credentials are still stored, but with a weak fallback key. The System page shows a warning. Set `SECRET_KEY` and restart — existing credentials will remain readable with the old key until you re-save them.

**If you change SECRET_KEY:** existing credentials become unreadable. Before rotating the key, export all credentials (or note their values), then re-enter them after the restart.

```bash
# Generate a new key:
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

---

## Adding a new node type

1. Create `app/nodes/action_xyz.py` exporting `NODE_TYPE`, `LABEL`, and `run(config, inp, context, logger, creds=None, **kwargs) -> dict`.
2. The node registry (`app/nodes/__init__.py`) auto-discovers it on next reload — no registration needed.
3. Add a `NODE_DEFS` entry in `app/static/canvas.html` (search for `NODE_DEFS` — around line 286). Include `label`, `icon`, `color`, `group`, and `fields[]`.
4. Add hint JSX panels in **two** places in `canvas.html`: the node edit panel (~line 822) and the history/detail panel (~line 1855). Search for `action.slack` for a complete example.
5. Custom nodes in `app/nodes/custom/` can be hot-reloaded via **Admin → Nodes → Reload** without restarting.

---

## Common error patterns

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Flow runs queue but never execute | Worker down | `docker compose restart worker` |
| `RealDictCursor` `TypeError: string indices must be integers` | `row[0]` used instead of `row["col"]` | Change to column name access |
| 500 errors with no log trace | Used to be `BaseHTTPMiddleware` swallowing exceptions; now fixed in `app/observability.py` | Check `docker compose logs api` — errors now propagate to uvicorn |
| `alembic: Will assume transactional DDL` | Normal Alembic output — means it connected and is already at head | Not a problem, ignore |
| Scheduler shows warning on System page | Scheduler container not running, or just restarted (lock TTL 45 s) | Wait 45 s then refresh; or `docker compose restart scheduler` |
| Emails not delivered | Wrong `inbox_id` format or endpoint | `inbox_id` = full `AGENTMAIL_FROM` address; endpoint is `/messages/send` |
| Canvas goes black after editing | JSX Fragment `<>` not closed | Find unclosed `<>` near the edit; every `<>` needs `</>` |

---

## Updating HiveRunr

```bash
git pull origin main
docker compose build
docker compose up -d
# Migrations run automatically at startup via Alembic
```

To check what changed: `git log --oneline origin/main` and review `CHANGELOG.md`.

---

## Environment variables reference

See `.env.example` for the full annotated list. Critical ones:

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | ✅ Fatal | PostgreSQL connection string |
| `REDIS_URL` | ✅ Fatal | Redis connection (Celery broker + result backend) |
| `SECRET_KEY` | ⚠ Warning | Fernet key for credential encryption |
| `APP_URL` | ⚠ Warning | Public base URL — must be `https://` in production |
| `API_KEY` | ⚠ Warning | Gates webhook endpoints — change from default |
| `AGENTMAIL_API_KEY` | Optional | Email alerts and password reset |
| `AGENTMAIL_FROM` | Optional | Sender address (full inbox address) |
| `OWNER_EMAIL` | Optional | Receives flow failure alerts |
| `APP_TIMEZONE` | Optional | Display timezone for scheduler UI (default UTC) |
| `ALLOW_SIGNUP` | Optional | Enable self-serve signup (default false) |
