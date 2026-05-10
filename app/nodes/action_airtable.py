"""Airtable action node.

Wraps the Airtable REST API v0 using only httpx (already a project dependency).

Credential JSON fields:
  api_key  — Airtable personal access token (starts with "pat…")
  base_id  — Airtable base ID (starts with "app…")

These can also be overridden directly in config fields.

Operations
----------
  list_records    — fetch all records from a table (handles pagination)
  get_record      — fetch a single record by ID
  create_record   — create one record
  update_record   — update fields on an existing record (PATCH)
  upsert_record   — create or update based on a field match
  delete_record   — delete a record by ID
  search          — list_records with filter_formula + optional sort

Output
------
  list_records / search:
    { records[], count, offset }
  get_record:
    { record, id, fields }
  create_record:
    { record, id, fields, created: true }
  update_record / upsert_record:
    { record, id, fields, updated: true }
  delete_record:
    { id, deleted: true }
"""
import json
from json import JSONDecodeError
from app.nodes._utils import _render, _resolve_cred_raw

NODE_TYPE = "action.airtable"
LABEL = "Airtable"

_BASE_URL = "https://api.airtable.com/v0"


def _get_headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _resolve_creds(config, context, creds):
    """Return (api_key, base_id) from credential or inline config fields."""
    api_key = _render(config.get("api_key", ""), context, creds).strip()
    base_id = _render(config.get("base_id", ""), context, creds).strip()

    cred_name = _render(config.get("credential", ""), context, creds).strip()
    if cred_name and creds and not (api_key and base_id):
        raw = _resolve_cred_raw(cred_name, creds)
        if raw:
            try:
                c = json.loads(raw)
                api_key = api_key or c.get("api_key", "") or c.get("token", "")
                base_id = base_id or c.get("base_id", "") or c.get("base", "")
            except (JSONDecodeError, AttributeError):
                api_key = api_key or raw.strip()

    if not api_key:
        raise ValueError("Airtable: 'api_key' is required (set in credential or config)")
    if not base_id:
        raise ValueError("Airtable: 'base_id' is required (set in credential or config)")
    return api_key, base_id


def _list_all(client, url: str, headers: dict, params: dict) -> list:
    """Fetch all pages of records, following Airtable's offset pagination."""
    records = []
    offset = None
    while True:
        p = dict(params)
        if offset:
            p["offset"] = offset
        resp = client.get(url, headers=headers, params=p)
        resp.raise_for_status()
        data = resp.json()
        records.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            break
    return records


def _clean_record(r: dict) -> dict:
    """Flatten an Airtable record for easier downstream use."""
    return {
        "id":          r.get("id", ""),
        "fields":      r.get("fields", {}),
        "created_time": r.get("createdTime", ""),
    }


def run(config, inp, context, logger, creds=None, **kwargs):
    import httpx

    api_key, base_id = _resolve_creds(config, context, creds)
    table      = _render(config.get("table", ""), context, creds).strip()
    operation  = _render(config.get("operation", "list_records"), context, creds).strip()
    record_id  = _render(config.get("record_id", ""), context, creds).strip()
    fields_raw = _render(config.get("fields_json", ""), context, creds).strip()
    formula    = _render(config.get("filter_formula", ""), context, creds).strip()
    sort_raw   = _render(config.get("sort_json", ""), context, creds).strip()
    view       = _render(config.get("view", ""), context, creds).strip()
    max_raw    = _render(config.get("max_records", ""), context, creds).strip()
    try: timeout = float(_render(config.get("timeout", "30"), context, creds))
    except (ValueError, TypeError): timeout = 30.0

    if not table:
        raise ValueError("Airtable: 'table' is required")

    # Parse JSON fields
    fields = {}
    if fields_raw:
        try:
            fields = json.loads(fields_raw)
        except JSONDecodeError as exc:
            raise ValueError(f"Airtable: fields_json is not valid JSON — {exc}") from exc

    sort = []
    if sort_raw:
        try:
            sort = json.loads(sort_raw)
        except JSONDecodeError:
            pass

    table_url  = f"{_BASE_URL}/{base_id}/{table}"
    headers    = _get_headers(api_key)

    with httpx.Client(timeout=timeout) as client:

        # ── list_records / search ─────────────────────────────────────────────
        if operation in ("list_records", "search"):
            params = {}
            if formula:
                params["filterByFormula"] = formula
            if view:
                params["view"] = view
            if max_raw:
                params["maxRecords"] = int(max_raw)
            if sort:
                # Airtable expects sort[0][field]=... sort[0][direction]=...
                for i, s in enumerate(sort):
                    params[f"sort[{i}][field]"]     = s.get("field", "")
                    params[f"sort[{i}][direction]"] = s.get("direction", "asc")

            logger.info("Airtable: list_records %s/%s", base_id, table)
            records_raw = _list_all(client, table_url, headers, params)
            records     = [_clean_record(r) for r in records_raw]
            return {
                "records": records,
                "count":   len(records),
                "record":  records[0] if records else None,
            }

        # ── get_record ────────────────────────────────────────────────────────
        elif operation == "get_record":
            if not record_id:
                raise ValueError("Airtable get_record: 'record_id' is required")
            logger.info("Airtable: get_record %s", record_id)
            resp = client.get(f"{table_url}/{record_id}", headers=headers)
            resp.raise_for_status()
            r = _clean_record(resp.json())
            return {"record": r, "id": r["id"], "fields": r["fields"]}

        # ── create_record ─────────────────────────────────────────────────────
        elif operation == "create_record":
            if not fields:
                raise ValueError("Airtable create_record: 'fields_json' is required")
            logger.info("Airtable: create_record in %s", table)
            resp = client.post(table_url, headers=headers, json={"fields": fields})
            resp.raise_for_status()
            r = _clean_record(resp.json())
            return {"record": r, "id": r["id"], "fields": r["fields"], "created": True}

        # ── update_record ─────────────────────────────────────────────────────
        elif operation == "update_record":
            if not record_id:
                raise ValueError("Airtable update_record: 'record_id' is required")
            if not fields:
                raise ValueError("Airtable update_record: 'fields_json' is required")
            logger.info("Airtable: update_record %s", record_id)
            resp = client.patch(f"{table_url}/{record_id}", headers=headers,
                                json={"fields": fields})
            resp.raise_for_status()
            r = _clean_record(resp.json())
            return {"record": r, "id": r["id"], "fields": r["fields"], "updated": True}

        # ── upsert_record ─────────────────────────────────────────────────────
        elif operation == "upsert_record":
            # Airtable upsert: PATCH the table with performUpsert
            upsert_field = _render(config.get("upsert_field", ""), context, creds).strip()
            if not upsert_field:
                raise ValueError("Airtable upsert_record: 'upsert_field' is required")
            if not fields:
                raise ValueError("Airtable upsert_record: 'fields_json' is required")
            logger.info("Airtable: upsert_record on field '%s'", upsert_field)
            payload = {
                "records":       [{"fields": fields}],
                "performUpsert": {"fieldsToMergeOn": [upsert_field]},
            }
            resp = client.patch(table_url, headers=headers, json=payload)
            resp.raise_for_status()
            data    = resp.json()
            updated = data.get("updatedRecords", [])
            created = data.get("createdRecords", [])
            records_out = [_clean_record(r) for r in data.get("records", [])]
            r = records_out[0] if records_out else {}
            return {
                "record":  r,
                "id":      r.get("id", ""),
                "fields":  r.get("fields", {}),
                "updated": bool(updated),
                "created": bool(created),
            }

        # ── delete_record ─────────────────────────────────────────────────────
        elif operation == "delete_record":
            if not record_id:
                raise ValueError("Airtable delete_record: 'record_id' is required")
            logger.info("Airtable: delete_record %s", record_id)
            resp = client.delete(f"{table_url}/{record_id}", headers=headers)
            resp.raise_for_status()
            data = resp.json()
            return {"id": data.get("id", record_id), "deleted": data.get("deleted", True)}

        else:
            raise ValueError(f"Airtable: unknown operation '{operation}'")
