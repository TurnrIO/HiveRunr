"""HTTP request action node."""
import json
from app.nodes._utils import _render, _resolve_cred_raw

NODE_TYPE = "action.http_request"
LABEL = "HTTP Request"


def run(config, inp, context, logger, creds=None, **kwargs):
    """Execute HTTP request and return response."""
    import httpx

    url     = _render(config.get("url", ""),    context, creds)
    method  = config.get("method", "GET").upper()
    headers = {}

    # ── Credential shortcut (Bearer token / API key) ──────────────────────
    cred_name = _render(config.get("credential", ""), context, creds)
    if cred_name and creds:
        raw = _resolve_cred_raw(cred_name, creds)
        if raw:
            try:
                c = json.loads(raw)
                # Support {token}, {api_key}, or {Authorization} fields
                token = c.get("token") or c.get("api_key") or c.get("Authorization")
                if token:
                    headers["Authorization"] = f"Bearer {token}"
            except (json.JSONDecodeError, AttributeError):
                # Raw string — treat as a Bearer token directly
                headers["Authorization"] = f"Bearer {raw}"

    # ── Headers ───────────────────────────────────────────────────────────
    if config.get("headers_json"):
        try:
            extra = json.loads(_render(config["headers_json"], context, creds))
            headers.update(extra)
        except (json.JSONDecodeError, ValueError):
            pass

    # ── Body (JSON) ───────────────────────────────────────────────────────
    json_body  = None
    raw_body   = None
    form_body  = None

    if config.get("body_json"):
        rendered = _render(config["body_json"], context, creds)
        try:
            parsed = json.loads(rendered)
            json_body = parsed if isinstance(parsed, dict) else None
            raw_body  = rendered if not isinstance(parsed, dict) else None
        except (json.JSONDecodeError, ValueError):
            raw_body = rendered

    # ── Form data ─────────────────────────────────────────────────────────
    if config.get("form_json"):
        try:
            form_body = json.loads(_render(config["form_json"], context, creds))
        except (json.JSONDecodeError, ValueError):
            pass

    # ── Timeout ───────────────────────────────────────────────────────────
    try:
        timeout = float(config.get("timeout") or 30)
    except (ValueError, TypeError):
        timeout = 30

    # ── Execute ───────────────────────────────────────────────────────────
    if not url:
        raise ValueError("HTTP Request: no URL configured")

    logger(f"HTTP {method} {url}")

    r = httpx.request(
        method, url,
        headers=headers,
        json=json_body,
        content=raw_body.encode() if isinstance(raw_body, str) else None,
        data=form_body,
        timeout=timeout,
        follow_redirects=True,
    )

    ignore_errors = str(config.get("ignore_errors", "false")).lower() == "true"
    if not ignore_errors:
        r.raise_for_status()

    try:
        rbody = r.json()
    except (json.JSONDecodeError, ValueError):
        rbody = r.text

    ok = 200 <= r.status_code < 300
    logger(f"HTTP {method} {url} → {r.status_code}")

    return {
        "status":  r.status_code,
        "ok":      ok,
        "body":    rbody,
        "headers": dict(r.headers),
    }
