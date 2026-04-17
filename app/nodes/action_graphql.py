"""GraphQL action node.

Sends a GraphQL query or mutation to any endpoint.

Credential JSON fields (store as a generic/API Key credential):
  endpoint  — full GraphQL URL, e.g. https://api.example.com/graphql
  token     — Bearer token (added as Authorization: Bearer <token>)
  headers   — JSON string of extra headers (optional)

All config fields support {{template}} rendering.
"""
import json
from app.nodes._utils import _render, _resolve_cred_raw

NODE_TYPE = "action.graphql"
LABEL = "GraphQL"


def _parse_json_field(raw, label):
    """Parse a JSON string field, returning a dict/list or raising ValueError."""
    if not raw or not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError(f"GraphQL: {label} is not valid JSON — {exc}") from exc


def run(config, inp, context, logger, creds=None, **kwargs):
    """Execute a GraphQL query or mutation."""
    import httpx

    # ── Resolve credential ────────────────────────────────────────────────────
    endpoint = _render(config.get("endpoint", ""), context, creds).strip()
    token    = _render(config.get("token", ""),    context, creds).strip()
    extra_headers_raw = _render(config.get("headers_json", ""), context, creds).strip()

    cred_name = _render(config.get("credential", ""), context, creds).strip()
    if cred_name and creds:
        raw = _resolve_cred_raw(cred_name, creds)
        if raw:
            try:
                c = json.loads(raw)
                endpoint = endpoint or c.get("endpoint", "") or c.get("url", "")
                token    = token    or c.get("token", "")    or c.get("api_key", "")
                if not extra_headers_raw:
                    extra_headers_raw = c.get("headers", "") or ""
            except (json.JSONDecodeError, AttributeError):
                # raw value might be a bare token
                token = token or raw.strip()

    if not endpoint:
        raise ValueError("GraphQL: 'endpoint' is required (set in config or credential)")

    # ── Build query & variables ───────────────────────────────────────────────
    query     = _render(config.get("query", ""), context, creds).strip()
    variables_raw = _render(config.get("variables_json", ""), context, creds).strip()
    op_name   = _render(config.get("operation_name", ""), context, creds).strip()
    timeout   = float(_render(config.get("timeout", "30"), context, creds) or 30)

    if not query:
        raise ValueError("GraphQL: 'query' is required")

    variables = _parse_json_field(variables_raw, "variables_json") if variables_raw else {}
    extra_headers = _parse_json_field(extra_headers_raw, "headers_json") if extra_headers_raw else {}

    # ── Build headers ─────────────────────────────────────────────────────────
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    headers.update(extra_headers)

    # ── Build payload ─────────────────────────────────────────────────────────
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    if op_name:
        payload["operationName"] = op_name

    # ── Execute ───────────────────────────────────────────────────────────────
    logger.info("GraphQL request → %s", endpoint)
    resp = httpx.post(endpoint, json=payload, headers=headers, timeout=timeout)

    # GraphQL servers typically return 200 even for errors; parse body first
    try:
        body = resp.json()
    except Exception:
        resp.raise_for_status()
        raise ValueError(f"GraphQL: non-JSON response (status {resp.status_code})")

    data   = body.get("data")
    errors = body.get("errors", [])

    if errors:
        messages = [e.get("message", str(e)) for e in errors]
        logger.warning("GraphQL errors: %s", messages)

    ignore_errors = str(config.get("ignore_errors", "false")).lower() == "true"
    if errors and not data and not ignore_errors:
        raise ValueError(f"GraphQL errors: {'; '.join(messages)}")

    return {
        "data":        data,
        "errors":      errors,
        "has_errors":  bool(errors),
        "status_code": resp.status_code,
        "ok":          resp.status_code < 400 and not (errors and not data),
    }
