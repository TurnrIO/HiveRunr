"""Send email action node."""
import os
import json
from json import JSONDecodeError
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.nodes._utils import _render, _resolve_cred_raw
from app.core.smtp import send_message

NODE_TYPE = "action.send_email"
LABEL = "Send Email"


def run(config, inp, context, logger, creds=None, **kwargs):
    """Send email via SMTP.

    Port selection (SMTP_PORT env var or credential 'port' field):
      465 → implicit TLS (SMTP_SSL)   — legacy default
      587 → STARTTLS                  — Gmail, Outlook, most modern providers
      25  → plain SMTP                — local relay / MTA
    """
    to      = _render(config.get('to', ''), context, creds)
    subject = _render(config.get('subject', ''), context, creds)
    body    = _render(config.get('body', ''), context, creds)
    host    = _render(config.get('smtp_host', ''), context, creds)
    user    = _render(config.get('smtp_user', ''), context, creds)
    pwd     = _render(config.get('smtp_pass', ''), context, creds)
    port    = None

    # Structured credential shortcut
    cred_name = _render(config.get('credential', ''), context, creds)
    if cred_name and creds:
        raw = _resolve_cred_raw(cred_name, creds)
        if raw:
            try:
                c = json.loads(raw)
                host = host or c.get('host', '')
                port = port or c.get('port')
                user = user or c.get('user', '')
                pwd  = pwd  or c.get('pass', '')
            except (JSONDecodeError, AttributeError):
                pass

    host      = host or os.environ.get('SMTP_HOST', '')
    user      = user or os.environ.get('SMTP_USER', '')
    pwd       = pwd  or os.environ.get('SMTP_PASS', '')
    smtp_port = int(port or os.environ.get('SMTP_PORT', 587))

    if not host:
        raise ValueError("Send Email: no SMTP host configured")

    from_addr = os.environ.get('SMTP_FROM', '') or user

    msg = MIMEMultipart()
    msg['From']    = from_addr
    msg['To']      = to
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))

    send_message(host, smtp_port, user, pwd, from_addr, to, msg.as_string())
    return {'sent': True, 'to': to, 'subject': subject}
