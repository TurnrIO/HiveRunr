"""Schedules router."""
import logging
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel
from typing import Optional

from app.deps import _check_admin
from app.core.db import list_schedules, create_schedule, update_schedule, toggle_schedule, delete_schedule

log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/schedules")
def api_schedules(request: Request):
    _check_admin(request); return list_schedules()


class ScheduleCreate(BaseModel):
    name: str
    graph_id: Optional[int] = None
    workflow: Optional[str] = None
    cron: Optional[str] = None
    payload: dict = {}
    timezone: str = "UTC"
    run_at: Optional[str] = None   # ISO datetime string for one-shot schedules


class ScheduleUpdate(BaseModel):
    name: str
    graph_id: Optional[int] = None
    workflow: Optional[str] = None
    cron: Optional[str] = None
    payload: dict = {}
    timezone: str = "UTC"
    run_at: Optional[str] = None


@router.post("/api/schedules")
def api_create_schedule(body: ScheduleCreate, request: Request):
    _check_admin(request)
    return create_schedule(
        body.name, body.workflow, body.graph_id,
        body.cron, body.payload, body.timezone, body.run_at
    )


@router.put("/api/schedules/{sid}")
def api_update_schedule(sid: int, body: ScheduleUpdate, request: Request):
    _check_admin(request)
    row = update_schedule(
        sid, body.name, body.workflow, body.graph_id,
        body.cron, body.payload, body.timezone, body.run_at
    )
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return row


@router.post("/api/schedules/{sid}/toggle")
def api_toggle_schedule(sid: int, request: Request):
    _check_admin(request); return toggle_schedule(sid) or {"id": sid}


@router.delete("/api/schedules/{sid}")
def api_delete_schedule(sid: int, request: Request):
    _check_admin(request); delete_schedule(sid); return {"deleted": True}


@router.get("/api/schedules/next-run")
def api_cron_next_run(
    cron:     str = Query(..., description="5-part cron expression"),
    timezone: str = Query("UTC", description="IANA timezone name"),
    count:    int = Query(5, ge=1, le=20, description="How many future dates to return"),
):
    """Validate a cron expression and return the next N fire times.

    Returns {"valid": true, "next": ["ISO string", …]} on success or
    {"valid": false, "error": "message"} on an invalid expression.
    """
    try:
        from apscheduler.triggers.cron import CronTrigger
        import datetime as _dt
        import pytz

        # Validate timezone
        try:
            tz = pytz.timezone(timezone)
        except pytz.UnknownTimeZoneError:
            return {"valid": False, "error": f"Unknown timezone: {timezone}"}

        trigger = CronTrigger.from_crontab(cron, timezone=tz)

        now = _dt.datetime.now(_dt.timezone.utc)
        next_times = []
        t = now
        for _ in range(count):
            t = trigger.get_next_fire_time(None, t)
            if t is None:
                break
            next_times.append(t.isoformat())
            # advance by 1 second so next call returns a different time
            t = t + _dt.timedelta(seconds=1)

        return {"valid": True, "next": next_times}

    except Exception as exc:
        return {"valid": False, "error": str(exc)}
