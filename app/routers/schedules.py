"""Schedules router."""
from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import Optional

from app.deps import _check_admin
from app.core.db import list_schedules, create_schedule, toggle_schedule, delete_schedule

router = APIRouter()


@router.get("/api/schedules")
def api_schedules(request: Request):
    _check_admin(request); return list_schedules()


class ScheduleCreate(BaseModel):
    name: str; graph_id: Optional[int] = None; workflow: Optional[str] = None
    cron: str = "0 9 * * *"; payload: dict = {}; timezone: str = "UTC"


@router.post("/api/schedules")
def api_create_schedule(body: ScheduleCreate, request: Request):
    _check_admin(request)
    return create_schedule(body.name, body.workflow, body.graph_id, body.cron, body.payload, body.timezone)


@router.post("/api/schedules/{sid}/toggle")
def api_toggle_schedule(sid: int, request: Request):
    _check_admin(request); return toggle_schedule(sid) or {"id": sid}


@router.delete("/api/schedules/{sid}")
def api_delete_schedule(sid: int, request: Request):
    _check_admin(request); delete_schedule(sid); return {"deleted": True}
