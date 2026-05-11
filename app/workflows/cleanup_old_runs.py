"""
Cleanup Old Runs — deletes run records older than KEEP_DAYS.

Useful as a scheduled maintenance task to keep the runs table lean.
Run via the Scripts page or wire up a daily trigger.cron in the canvas.
"""

import os
import logging
import psycopg2

# ── Configuration ──────────────────────────────────────────────────────────────
KEEP_DAYS = 30   # delete runs older than this many days
DRY_RUN   = False  # set True to preview without deleting
# ───────────────────────────────────────────────────────────────────────────────

logger = logging.getLogger(__name__)
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://hiverunr:hiverunr@db:5432/hiverunr")

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur  = conn.cursor()
except psycopg2.Error as exc:
    logger.error("Failed to connect to database: %s", exc)
    raise

# Count how many rows would be affected
try:
    cur.execute(
        "SELECT COUNT(*) FROM runs WHERE created_at < NOW() - INTERVAL '1 day' * %s",
        (KEEP_DAYS,)
    )
    count = cur.fetchone()[0]
except psycopg2.Error as exc:
    logger.error("Failed to count old runs: %s", exc)
    cur.close()
    conn.close()
    raise

if count == 0:
    logger.info("Nothing to delete — all runs are within the last %s days.", KEEP_DAYS)
elif DRY_RUN:
    print(f"DRY RUN: would delete {count} run(s) older than {KEEP_DAYS} days.")
    print("Set DRY_RUN = False to actually delete them.")
else:
    try:
        cur.execute(
            "DELETE FROM runs WHERE created_at < NOW() - INTERVAL '1 day' * %s",
            (KEEP_DAYS,)
        )
        conn.commit()
        logger.info("Deleted %s run(s) older than %s days.", count, KEEP_DAYS)
    except psycopg2.Error as exc:
        logger.error("Failed to delete old runs: %s", exc)
        conn.rollback()
        cur.close()
        conn.close()
        raise

# Show what remains
try:
    cur.execute("SELECT COUNT(*), MIN(created_at)::text, MAX(created_at)::text FROM runs")
    total, oldest, newest = cur.fetchone()
    logger.info("Runs table now: %s record(s) | oldest: %s | newest: %s",
                total, oldest, newest)
except psycopg2.Error as exc:
    logger.error("Failed to query runs table stats: %s", exc)
    cur.close()
    conn.close()
    raise

cur.close()
conn.close()
