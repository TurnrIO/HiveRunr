"""Credentials router."""
from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.deps import _check_admin
from app.core.db import list_credentials, upsert_credential, delete_credential

router = APIRouter()


class CredCreate(BaseModel):
    name: str; type: str = "generic"; secret: str; note: str = ""


@router.get("/api/credentials")
def api_creds(request: Request):
    _check_admin(request); return list_credentials()


@router.post("/api/credentials")
def api_cred_create(body: CredCreate, request: Request):
    _check_admin(request)
    return upsert_credential(body.name, body.type, body.secret, body.note)


@router.put("/api/credentials/{cred_id}")
def api_cred_update(cred_id: int, body: CredCreate, request: Request):
    _check_admin(request)
    return upsert_credential(body.name, body.type, body.secret, body.note)


@router.delete("/api/credentials/{cred_id}")
def api_cred_delete(cred_id: int, request: Request):
    _check_admin(request); delete_credential(cred_id); return {"deleted": True}
