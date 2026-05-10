"""Discord webhook action node."""
import json
from json import JSONDecodeError
from app.nodes._utils import _render, _resolve_cred_raw

NODE_TYPE = "action.discord"
LABEL = "Discord"


def run(config, inp, context, logger, creds=None, **kwargs):
    """Send a message to a Discord channel via an Incoming Webhook."""
    import httpx

    webhook_url = _render(config.get("webhook_url", ""), context, creds)
    message     = _render(config.get("message", ""),     context, creds)
    username    = _render(config.get("username", ""),    context, creds)
    avatar_url  = _render(config.get("avatar_url", ""),  context, creds)

    # Structured credential shortcut
    cred_name = _render(config.get("credential", ""), context, creds)
    if cred_name and creds and not webhook_url:
        raw = _resolve_cred_raw(cred_name, creds)
        if raw:
            try:
                c = json.loads(raw)
                webhook_url = c.get("webhook_url", "") or c.get("url", "")
            except (JSONDecodeError, AttributeError):
                webhook_url = raw  # fallback: raw value is the URL

    if not webhook_url:
        raise ValueError("Discord: no webhook_url configured")
    if not message:
        raise ValueError("Discord: no message configured")

    body: dict = {"content": message}
    if username:
        body["username"] = username
    if avatar_url:
        body["avatar_url"] = avatar_url

    r = httpx.post(webhook_url, json=body, timeout=10)
    r.raise_for_status()

    logger(f"Discord: sent message ({len(message)} chars)")
    return {"sent": True, "message": message}
