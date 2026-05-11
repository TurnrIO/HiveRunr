"""HubSpot CRM REST API v3 node."""
import logging
import json
import time
import urllib.request
import urllib.error
from json import JSONDecodeError
from app.nodes._utils import _render

logger = logging.getLogger(__name__)
NODE_TYPE = "action.hubspot"
LABEL     = "HubSpot"

_BASE = "https://api.hubapi.com"


def _req(method, path, token, body=None):
    url  = _BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req  = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type",  "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode()
        try:    detail = json.loads(body_txt).get("message", body_txt)
        except JSONDecodeError: detail = body_txt
        raise RuntimeError(f"HubSpot {e.code}: {detail}")


def _flatten(obj):
    """Return {id, ...properties} for a HubSpot object dict."""
    if not obj:
        return {}
    out = {"id": obj.get("id"), "created_at": obj.get("createdAt"), "updated_at": obj.get("updatedAt")}
    out.update(obj.get("properties", {}))
    return out


def run(config, inp, context, logger, creds=None, **kwargs):
    cred_name = config.get("credential", "")
    token     = ""
    if cred_name and creds:
        raw = creds.get(cred_name, {})
        if isinstance(raw, str):
            try:   raw = json.loads(raw)
            except JSONDecodeError: raw = {}
        token = raw.get("access_token", raw.get("token", ""))
    if not token:
        token = _render(config.get("access_token", ""), context, creds)
    if not token:
        raise ValueError("HubSpot: access_token is required (set via credential or access_token field)")

    op          = _render(config.get("operation", "get_contact"), context, creds)
    object_type = _render(config.get("object_type", "contacts"), context, creds)
    logger.info("HubSpot: op=%s object_type=%s", op, object_type)

    # ── get contact / company / deal ──────────────────────────────────────
    if op in ("get_contact", "get_object"):
        obj_id   = _render(config.get("object_id", ""), context, creds)
        props    = _render(config.get("properties", ""), context, creds)
        qs       = f"?properties={props}" if props else ""
        result   = _req("GET", f"/crm/v3/objects/{object_type}/{obj_id}{qs}", token)
        flat     = _flatten(result)
        return {"object": flat, "id": flat.get("id"), "properties": result.get("properties", {}), "raw": result}

    # ── create contact / company / deal ───────────────────────────────────
    elif op in ("create_contact", "create_object"):
        logger.info("HubSpot: creating %s", object_type)
        props_raw = _render(config.get("properties", "{}"), context, creds)
        try:   props = json.loads(props_raw) if isinstance(props_raw, str) else props_raw
        except JSONDecodeError: raise ValueError(f"HubSpot create: properties must be valid JSON, got: {props_raw!r}")
        result = _req("POST", f"/crm/v3/objects/{object_type}", token, {"properties": props})
        flat   = _flatten(result)
        return {"object": flat, "id": flat.get("id"), "properties": result.get("properties", {}), "raw": result}

    # ── update contact / company / deal ───────────────────────────────────
    elif op in ("update_contact", "update_object"):
        obj_id    = _render(config.get("object_id", ""), context, creds)
        logger.info("HubSpot: updating %s id=%s", object_type, obj_id)
        props_raw = _render(config.get("properties", "{}"), context, creds)
        try:   props = json.loads(props_raw) if isinstance(props_raw, str) else props_raw
        except JSONDecodeError: raise ValueError(f"HubSpot update: properties must be valid JSON, got: {props_raw!r}")
        result = _req("PATCH", f"/crm/v3/objects/{object_type}/{obj_id}", token, {"properties": props})
        flat   = _flatten(result)
        return {"object": flat, "id": flat.get("id"), "properties": result.get("properties", {}), "raw": result}

    # ── search contacts / companies / deals ───────────────────────────────
    elif op == "search":
        logger.info("HubSpot: search %s", object_type)
        filters_raw  = _render(config.get("filters", "[]"), context, creds)
        props_str    = _render(config.get("properties", ""), context, creds)
        try: limit = int(_render(config.get("limit", "20"), context, creds))
        except (ValueError, TypeError): limit = 20
        after_cursor = _render(config.get("after", ""), context, creds)
        try:   filters = json.loads(filters_raw) if isinstance(filters_raw, str) else filters_raw
        except JSONDecodeError: filters = []
        body = {"filterGroups": [{"filters": filters}], "limit": min(limit, 200)}
        if props_str:
            body["properties"] = [p.strip() for p in props_str.split(",") if p.strip()]
        if after_cursor:
            body["after"] = after_cursor
        result  = _req("POST", f"/crm/v3/objects/{object_type}/search", token, body)
        results = [_flatten(r) for r in result.get("results", [])]
        paging  = result.get("paging", {})
        return {
            "results":  results,
            "count":    len(results),
            "total":    result.get("total", len(results)),
            "after":    paging.get("next", {}).get("after"),
            "has_more": bool(paging.get("next")),
            "raw":      result,
        }

    # ── get deal ──────────────────────────────────────────────────────────
    elif op == "get_deal":
        deal_id = _render(config.get("deal_id", ""), context, creds)
        logger.info("HubSpot: get_deal id=%s", deal_id)
        result  = _req("GET", f"/crm/v3/objects/deals/{deal_id}?properties=dealname,amount,dealstage,closedate,pipeline", token)
        flat    = _flatten(result)
        return {"object": flat, "id": flat.get("id"), "properties": result.get("properties", {}), "raw": result}

    # ── create deal ───────────────────────────────────────────────────────
    elif op == "create_deal":
        logger.info("HubSpot: create_deal")
        props_raw = _render(config.get("properties", "{}"), context, creds)
        try:   props = json.loads(props_raw) if isinstance(props_raw, str) else props_raw
        except JSONDecodeError: raise ValueError("HubSpot create_deal: properties must be valid JSON")
        result = _req("POST", "/crm/v3/objects/deals", token, {"properties": props})
        flat   = _flatten(result)
        return {"object": flat, "id": flat.get("id"), "properties": result.get("properties", {}), "raw": result}

    # ── associate objects (e.g. contact ↔ deal) ───────────────────────────
    elif op == "associate":
        from_type  = _render(config.get("from_type", "contacts"), context, creds)
        from_id    = _render(config.get("from_id", ""), context, creds)
        to_type    = _render(config.get("to_type", "deals"), context, creds)
        to_id      = _render(config.get("to_id", ""), context, creds)
        assoc_type = _render(config.get("association_type", ""), context, creds)
        logger.info("HubSpot: associate %s/%s -> %s/%s", from_type, from_id, to_type, to_id)
        # default association type labels
        if not assoc_type:
            assoc_type = f"{from_type.rstrip('s')}_to_{to_type.rstrip('s')}"
        body = [{"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": assoc_type}]
        _req("PUT", f"/crm/v4/objects/{from_type}/{from_id}/associations/{to_type}/{to_id}", token, body)
        return {"ok": True, "from_id": from_id, "to_id": to_id, "from_type": from_type, "to_type": to_type}

    else:
        raise ValueError(f"HubSpot: unknown operation {op!r}")
