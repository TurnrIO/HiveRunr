"""IMAP email trigger — polls an inbox for new/matching messages.

Credential fields expected (store as a credential with these keys):
  host       — IMAP server hostname (e.g. imap.gmail.com)
  port       — port, default 993
  username   — email address / login
  password   — password or app-password
  use_ssl    — "true" (default) or "false"

Output shape
------------
{
  "emails":  [ {message_id, subject, from, to, date, body, html_body, attachment_names}, … ],
  "count":   N,
  # first-email shortcut fields (top-level) when at least one message was fetched:
  "message_id", "subject", "from", "to", "date", "body", "html_body", "attachment_names"
}
"""
import email as _email_module
import email.header as _email_header
import imaplib
import re
import logging
from ._utils import _render

log = logging.getLogger(__name__)

NODE_TYPE = "trigger.email"
LABEL     = "Email Trigger (IMAP)"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _decode_header(value: str) -> str:
    """Decode RFC 2047 encoded email headers to a plain string."""
    if not value:
        return ""
    parts = _email_header.decode_header(value)
    decoded = []
    for part, charset in parts:
        if isinstance(part, bytes):
            decoded.append(part.decode(charset or "utf-8", errors="replace"))
        else:
            decoded.append(str(part))
    return " ".join(decoded).strip()


def _get_body(msg) -> tuple:
    """Return (plain_text, html_text) from a parsed email.Message."""
    plain, html = "", ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype  = part.get_content_type()
            cdispo = str(part.get("Content-Disposition", ""))
            if "attachment" in cdispo:
                continue
            charset = part.get_content_charset() or "utf-8"
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            text = payload.decode(charset, errors="replace")
            if ctype == "text/plain" and not plain:
                plain = text
            elif ctype == "text/html" and not html:
                html = text
    else:
        charset = msg.get_content_charset() or "utf-8"
        payload = msg.get_payload(decode=True)
        text = payload.decode(charset, errors="replace") if payload else ""
        if msg.get_content_type() == "text/html":
            html = text
        else:
            plain = text
    return plain, html


def _get_attachment_names(msg) -> list:
    names = []
    if msg.is_multipart():
        for part in msg.walk():
            cdispo = str(part.get("Content-Disposition", ""))
            if "attachment" in cdispo:
                fname = part.get_filename()
                if fname:
                    names.append(_decode_header(fname))
    return names


# ── Node entry point ──────────────────────────────────────────────────────────

def run(config: dict, inp: dict, context: dict, logger, creds=None, **kwargs) -> dict:
    creds = creds or {}

    # Credential lookup
    cred_name = _render(config.get("credential", ""), context, creds)
    cred      = creds.get(cred_name, {})

    # Connection parameters — config overrides credential fields
    host     = _render(config.get("host",     cred.get("host",     "")), context, creds).strip()
    port_raw = _render(config.get("port",     str(cred.get("port", "993"))), context, creds)
    username = _render(config.get("username", cred.get("username", "")), context, creds).strip()
    password = _render(config.get("password", cred.get("password", "")), context, creds)
    use_ssl_raw = str(cred.get("use_ssl", config.get("use_ssl", "true"))).lower()
    use_ssl  = use_ssl_raw not in ("false", "0", "no")

    # Behaviour parameters
    folder          = _render(config.get("folder",          "INBOX"),  context, creds).strip() or "INBOX"
    search_criteria = _render(config.get("search_criteria", "UNSEEN"), context, creds).strip() or "UNSEEN"
    filter_expr     = _render(config.get("filter_expression", ""),     context, creds).strip()
    max_msg_raw     = _render(config.get("max_messages", "10"),        context, creds)
    mark_read       = str(config.get("mark_read", "false")).lower() in ("true", "1", "yes")

    try:
        port = int(port_raw)
    except (ValueError, TypeError):
        port = 993

    try:
        max_msg = max(1, int(max_msg_raw))
    except (ValueError, TypeError):
        max_msg = 10

    if not host or not username:
        raise ValueError(
            "trigger.email: IMAP credential must include at least 'host' and 'username'"
        )

    logger(
        f"[trigger.email] Connecting to {host}:{port} "
        f"({'SSL' if use_ssl else 'plain'}) as {username}"
    )

    conn = imaplib.IMAP4_SSL(host, port) if use_ssl else imaplib.IMAP4(host, port)

    try:
        conn.login(username, password)
        # readonly=True when we're not marking messages read (avoids write perm requirement)
        conn.select(folder, readonly=not mark_read)

        typ, data = conn.search(None, search_criteria)
        if typ != "OK":
            raise RuntimeError(f"IMAP SEARCH failed: {typ} {data}")

        all_ids = data[0].split() if data and data[0] else []
        # Take the most-recent N message IDs
        ids = all_ids[-max_msg:]

        emails = []
        for uid in ids:
            typ2, raw = conn.fetch(uid, "(RFC822)")
            if typ2 != "OK" or not raw or raw[0] is None:
                continue
            raw_bytes = raw[0][1] if isinstance(raw[0], tuple) else raw[0]
            if not isinstance(raw_bytes, bytes):
                continue
            msg = _email_module.message_from_bytes(raw_bytes)

            plain, html = _get_body(msg)
            attachments = _get_attachment_names(msg)

            entry = {
                "message_id":       msg.get("Message-ID", "").strip(),
                "subject":          _decode_header(msg.get("Subject", "")),
                "from":             _decode_header(msg.get("From", "")),
                "to":               _decode_header(msg.get("To", "")),
                "date":             msg.get("Date", ""),
                "body":             plain,
                "html_body":        html,
                "attachment_names": attachments,
            }

            # Optional Python filter — `email` is bound to the current message dict
            if filter_expr:
                try:
                    keep = eval(filter_expr, {"__builtins__": {}}, {"email": entry, "re": re})  # noqa: S307
                    if not keep:
                        continue
                except Exception as exc:
                    logger(f"[trigger.email] Filter expression error: {exc} — skipping message")
                    continue

            emails.append(entry)

            if mark_read:
                conn.store(uid, "+FLAGS", "\\Seen")

        logger(f"[trigger.email] Fetched {len(emails)} message(s) from {folder}")

        result = {"emails": emails, "count": len(emails)}
        # Expose first-email fields at the top level for simpler single-email flows
        if emails:
            result.update(emails[0])
        return result

    finally:
        try:
            conn.logout()
        except Exception:
            pass
