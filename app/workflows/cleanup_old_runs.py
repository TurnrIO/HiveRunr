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


def cleanup(
    keep_days: int = KEEP_DAYS,
    dry_run: bool = DRY_RUN,
    workspace_id: int | None = None,
) -> dict:
    """
    Delete run records older than keep_days.

    Args:
        keep_days: delete runs older than this many days
        dry_run: if True, only count and report without deleting
        workspace_id: if set, only delete runs for this workspace

    Returns:
        dict with keys: deleted (int), remaining (int), oldest (str), newest (str)
    """
    workspace_filter = (
        "AND workspace_id = %s" if workspace_id is not None else ""
    )
    params = (keep_days,) if workspace_id is None else (keep_days, workspace_id)

    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
    except psycopg2.Error as exc:
        logger.error("Failed to connect to database: %s", exc)
        raise

    try:
        # Count how many rows would be affected
        cur.execute(
            f"""
            SELECT COUNT(*)
            FROM runs
            WHERE created_at < NOW() - INTERVAL '1 day' * %s
            {workspace_filter}
            """,
            params,
        )
        count = cur.fetchone()[0]

        if count == 0:
            logger.info(
                "Nothing to delete — all runs are within the last %s days.", keep_days
            )
        elif dry_run:
            print(f"DRY RUN: would delete {count} run(s) older than {keep_days} days.")
            print("Set DRY_RUN = False to actually delete them.")
        else:
            cur.execute(
                f"""
                DELETE FROM runs
                WHERE created_at < NOW() - INTERVAL '1 day' * %s
                {workspace_filter}
                """,
                params,
            )
            conn.commit()
            logger.info("Deleted %s run(s) older than %s days.", count, keep_days)

        # Show what remains
        cur.execute(
            f"""
            SELECT COUNT(*), MIN(created_at)::text, MAX(created_at)::text
            FROM runs
            WHERE workspace_id = %s
            """
            if workspace_id is not None
            else "SELECT COUNT(*), MIN(created_at)::text, MAX(created_at)::text FROM runs"
        )
        total, oldest, newest = cur.fetchone()
        logger.info(
            "Runs table now: %s record(s) | oldest: %s | newest: %s",
            total, oldest, newest,
        )

        return {
            "deleted": count if not dry_run else 0,
            "remaining": total,
            "oldest": oldest,
            "newest": newest,
        }

    except psycopg2.Error as exc:
        logger.error("Failed to clean up runs: %s", exc)
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    cleanup()