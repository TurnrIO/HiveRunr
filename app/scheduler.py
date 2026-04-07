"""HiveRunr scheduler — cron-driven workflow dispatcher.

HA / leader-election design
───────────────────────────
Multiple scheduler replicas can run simultaneously; only the one that
holds the Redis leader lock will actually fire jobs.  The others sit in
standby and take over within one lock TTL if the leader crashes or is
restarted.

Lock mechanics (Redis SET NX PX):
  • Lock key:      hiverunr:scheduler:leader
  • TTL:           SCHEDULER_LOCK_TTL_MS  (default 45 000 ms = 45 s)
  • Refresh every: SCHEDULER_LOCK_REFRESH_S (default 15 s)
  • Standby poll:  SCHEDULER_STANDBY_POLL_S (default 10 s)

Each replica generates a unique token on startup and uses that token as
the lock value.  Only the process whose token matches the stored value is
allowed to refresh or release the lock — preventing a slow process from
accidentally releasing a lock already taken over by a new leader.

Failover latency ≤ lock TTL (45 s by default).  For tighter failover,
lower SCHEDULER_LOCK_TTL_MS but keep refresh_period < TTL/2 to avoid
accidental expiry under normal load.

Graceful fallback: if Redis is unreachable at startup the scheduler runs
in single-instance mode (no HA, same behaviour as before this change).
"""
import os
import time
import logging
import secrets as _secrets

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

# Load secrets before DB connection (DATABASE_URL may come from provider)
from app.core.secrets import load_secrets
load_secrets()

from app.core.db import init_db, list_schedules

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# ── tuning knobs ──────────────────────────────────────────────────────────────
_LOCK_KEY       = "hiverunr:scheduler:leader"
_LOCK_TTL_MS    = int(os.environ.get("SCHEDULER_LOCK_TTL_MS",    "45000"))  # 45 s
_REFRESH_S      = int(os.environ.get("SCHEDULER_LOCK_REFRESH_S", "15"))     # refresh every 15 s
_STANDBY_POLL_S = int(os.environ.get("SCHEDULER_STANDBY_POLL_S", "10"))     # standby check every 10 s
_INSTANCE_ID    = _secrets.token_hex(8)   # unique identity for this process


def _redis_client():
    """Return a Redis client using REDIS_URL (same broker URL as Celery)."""
    import redis as _redis
    url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    return _redis.from_url(url, socket_connect_timeout=5, socket_timeout=5)


def _try_acquire(r) -> bool:
    """Attempt to acquire the leader lock. Returns True if this instance won."""
    result = r.set(_LOCK_KEY, _INSTANCE_ID, px=_LOCK_TTL_MS, nx=True)
    return result is True


# Lua script: extend TTL only if this instance still owns the lock.
_REFRESH_SCRIPT = """
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
    return 0
end
"""

# Lua script: delete the key only if this instance still owns it.
_RELEASE_SCRIPT = """
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
else
    return 0
end
"""


def _try_refresh(r) -> bool:
    """Extend the lock TTL atomically. Returns False if lock was lost."""
    result = r.eval(_REFRESH_SCRIPT, 1, _LOCK_KEY, _INSTANCE_ID, _LOCK_TTL_MS)
    return bool(result)


def _release(r):
    """Release the lock atomically (no-op if we no longer own it)."""
    r.eval(_RELEASE_SCRIPT, 1, _LOCK_KEY, _INSTANCE_ID)


# ── job factory ───────────────────────────────────────────────────────────────
def _make_job(sched):
    def job():
        from app.worker import enqueue_workflow, enqueue_graph, enqueue_script
        import json
        payload = (
            json.loads(sched["payload"])
            if isinstance(sched["payload"], str)
            else (sched["payload"] or {})
        )
        if sched.get("graph_id"):
            enqueue_graph.delay(sched["graph_id"], payload)
        elif sched.get("workflow", "").startswith("script:"):
            script_name = sched["workflow"][len("script:"):]
            enqueue_script.delay(script_name, payload)
        elif sched.get("workflow"):
            enqueue_workflow.delay(sched["workflow"], payload)
    return job


# ── schedule sync ─────────────────────────────────────────────────────────────
def _sync_schedules(scheduler, known: dict):
    """Add/remove APScheduler jobs to match the enabled rows in the DB."""
    schedules = list_schedules()
    current_ids = {s["id"] for s in schedules if s["enabled"]}

    # Remove stale jobs
    for sid in list(known):
        if sid not in current_ids:
            try:
                scheduler.remove_job(str(sid))
            except Exception:
                pass
            del known[sid]

    # Add new jobs
    for s in schedules:
        if not s["enabled"]:
            continue
        sid = s["id"]
        if sid not in known:
            try:
                scheduler.add_job(
                    _make_job(s),
                    CronTrigger.from_crontab(s["cron"], timezone=s.get("timezone", "UTC")),
                    id=str(sid),
                    replace_existing=True,
                )
                known[sid] = s
                log.info("Scheduled: %s (%s)", s["name"], s["cron"])
            except Exception as e:
                log.error("Failed to schedule %s: %s", s["name"], e)


# ── leader execution ──────────────────────────────────────────────────────────
def _run_as_leader(r):
    """Run APScheduler for as long as we hold the lock.

    On each refresh tick we both extend the lock TTL and re-sync the
    schedule table, so changes made in the UI take effect within
    SCHEDULER_LOCK_REFRESH_S seconds.
    """
    log.info("Scheduler [%s] became LEADER — starting job execution", _INSTANCE_ID)
    scheduler = BlockingScheduler()
    known: dict = {}

    def refresh_and_sync():
        if not _try_refresh(r):
            log.warning(
                "Scheduler [%s] lost the leader lock — yielding to new leader",
                _INSTANCE_ID,
            )
            scheduler.shutdown(wait=False)
            return
        _sync_schedules(scheduler, known)

    _sync_schedules(scheduler, known)
    scheduler.add_job(
        refresh_and_sync, "interval", seconds=_REFRESH_S, id="__leader_refresh__"
    )

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        _release(r)
        log.info("Scheduler [%s] released leader lock", _INSTANCE_ID)


# ── fallback: no Redis ─────────────────────────────────────────────────────────
def _run_standalone():
    """Single-instance fallback when Redis is unavailable."""
    log.info("Scheduler [%s] running in standalone mode (no HA)", _INSTANCE_ID)
    scheduler = BlockingScheduler()
    known: dict = {}

    def refresh():
        _sync_schedules(scheduler, known)

    _sync_schedules(scheduler, known)
    scheduler.add_job(refresh, "interval", seconds=30, id="__refresh__")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        pass


# ── entry point ───────────────────────────────────────────────────────────────
def main():
    init_db()
    log.info(
        "Scheduler [%s] starting (lock_ttl=%dms refresh=%ds standby_poll=%ds)",
        _INSTANCE_ID, _LOCK_TTL_MS, _REFRESH_S, _STANDBY_POLL_S,
    )

    try:
        r = _redis_client()
        r.ping()
    except Exception as exc:
        log.warning(
            "Redis unavailable (%s) — running in standalone mode (no HA)", exc
        )
        _run_standalone()
        return

    while True:
        if _try_acquire(r):
            _run_as_leader(r)
            # Lost the lock or was shut down — wait before trying again
            time.sleep(_STANDBY_POLL_S)
        else:
            owner = r.get(_LOCK_KEY)
            owner_str = owner.decode() if owner else "unknown"
            log.debug(
                "Scheduler [%s] standby — current leader: %s", _INSTANCE_ID, owner_str
            )
            time.sleep(_STANDBY_POLL_S)


if __name__ == "__main__":
    main()
