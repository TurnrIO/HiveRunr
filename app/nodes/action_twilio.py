"""Twilio SMS / WhatsApp / Voice REST API node."""
import json
import base64
import urllib.request
import urllib.error
import urllib.parse
from json import JSONDecodeError
from app.nodes._utils import _render

NODE_TYPE = "action.twilio"
LABEL     = "Twilio"

_API_BASE = "https://api.twilio.com/2010-04-01"

def _req(method, path, account_sid, auth_token, body=None):
    url   = f"{_API_BASE}/Accounts/{account_sid}{path}"
    data  = urllib.parse.urlencode(body).encode() if body else None
    req   = urllib.request.Request(url, data=data, method=method)
    creds = base64.b64encode(f"{account_sid}:{auth_token}".encode()).decode()
    req.add_header("Authorization", f"Basic {creds}")
    if data:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode()
        try:    detail = json.loads(body_txt).get("message", body_txt)
        except JSONDecodeError: detail = body_txt
        raise RuntimeError(f"Twilio {e.code}: {detail}")

def run(config, inp, context, logger, creds=None, **kwargs):
    logger.info("Twilio: op=%s", op)
    # ── resolve credentials ────────────────────────────────────────────────
    cred_name   = config.get("credential", "")
    account_sid = ""
    auth_token  = ""
    if cred_name and creds:
        raw = creds.get(cred_name, {})
        if isinstance(raw, str):
            try:   raw = json.loads(raw)
            except JSONDecodeError: raw = {}
        account_sid = raw.get("account_sid", "")
        auth_token  = raw.get("auth_token", "")
    if not account_sid:
        account_sid = _render(config.get("account_sid", ""), context, creds)
    if not auth_token:
        auth_token  = _render(config.get("auth_token", ""), context, creds)
    if not account_sid or not auth_token:
        raise ValueError("Twilio: account_sid and auth_token are required")

    op = _render(config.get("operation", "send_sms"), context, creds)

    # ── send SMS ───────────────────────────────────────────────────────────
    if op in ("send_sms", "send_whatsapp"):
        logger.info("Twilio: sending %s", op)
        to_   = _render(config.get("to", ""), context, creds)
        from_ = _render(config.get("from", ""), context, creds)
        body_ = _render(config.get("body", ""), context, creds)
        if op == "send_whatsapp":
            if not to_.startswith("whatsapp:"):    to_   = f"whatsapp:{to_}"
            if not from_.startswith("whatsapp:"): from_ = f"whatsapp:{from_}"
        result = _req("POST", "/Messages.json", account_sid, auth_token, {
            "To": to_, "From": from_, "Body": body_,
        })
        return {
            "sid":    result.get("sid"),
            "status": result.get("status"),
            "to":     result.get("to"),
            "from":   result.get("from"),
            "body":   result.get("body"),
            "error_code": result.get("error_code"),
            "raw":    result,
        }

    # ── make call ──────────────────────────────────────────────────────────
    elif op == "make_call":
        logger.info("Twilio: make_call to=%s", to_)
        to_    = _render(config.get("to", ""), context, creds)
        from_  = _render(config.get("from", ""), context, creds)
        url_   = _render(config.get("twiml_url", ""), context, creds)
        twiml_ = _render(config.get("twiml", ""), context, creds)
        if not url_ and not twiml_:
            raise ValueError("Twilio make_call: twiml_url or twiml is required")
        params = {"To": to_, "From": from_}
        if url_:
            params["Url"] = url_
        else:
            params["Twiml"] = twiml_
        result = _req("POST", "/Calls.json", account_sid, auth_token, params)
        return {
            "sid":    result.get("sid"),
            "status": result.get("status"),
            "to":     result.get("to"),
            "from":   result.get("from"),
            "raw":    result,
        }

    # ── check status ───────────────────────────────────────────────────────
    elif op == "check_status":
        logger.info("Twilio: check_status sid=%s", sid)
        sid    = _render(config.get("sid", ""), context, creds)
        kind   = _render(config.get("resource_type", "message"), context, creds).lower()
        suffix = "/Messages" if kind == "message" else "/Calls"
        result = _req("GET", f"{suffix}/{sid}.json", account_sid, auth_token)
        return {
            "sid":        result.get("sid"),
            "status":     result.get("status"),
            "to":         result.get("to"),
            "from":       result.get("from"),
            "body":       result.get("body"),
            "error_code": result.get("error_code"),
            "raw":        result,
        }

    # ── list messages ──────────────────────────────────────────────────────
    elif op == "list_messages":
        logger.info("Twilio: list_messages")
        to_   = _render(config.get("to", ""), context, creds)
        from_ = _render(config.get("from", ""), context, creds)
        try: limit = int(_render(config.get("limit", "20"), context, creds))
        except (ValueError, TypeError): limit = 20
        qs    = urllib.parse.urlencode({k: v for k, v in {"To": to_, "From": from_, "PageSize": limit}.items() if v})
        result = _req("GET", f"/Messages.json?{qs}", account_sid, auth_token)
        msgs  = result.get("messages", [])
        return {
            "messages": [{
                "sid": m.get("sid"), "status": m.get("status"),
                "to": m.get("to"), "from": m.get("from"),
                "body": m.get("body"), "date_sent": m.get("date_sent"),
            } for m in msgs],
            "count": len(msgs),
        }

    else:
        raise ValueError(f"Twilio: unknown operation {op!r}")
