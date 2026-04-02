"""Shared SMTP send helper.

Auto-selects the connection mode based on port:
  465        → SMTP_SSL  (implicit TLS — the old default everywhere)
  587        → SMTP + STARTTLS (explicit TLS — required by Gmail, Outlook, etc.)
  25 / other → plain SMTP (LAN relay, MTA, etc.)

Usage:
    from app.core.smtp import send_message
    send_message(host, port, user, pwd, from_addr, to_addr, msg.as_string())
"""
import ssl
import smtplib


def send_message(
    host: str,
    port: int,
    user: str,
    pwd: str,
    from_addr: str,
    to_addr: str,
    msg_str: str,
    timeout: int = 15,
) -> None:
    """Send a pre-built RFC-2822 message string via SMTP.

    Raises smtplib.SMTPException (or subclass) on failure — callers are
    responsible for catching and logging.
    """
    ctx = ssl.create_default_context()

    if port == 587:
        # Explicit TLS / STARTTLS
        with smtplib.SMTP(host, port, timeout=timeout) as s:
            s.ehlo()
            s.starttls(context=ctx)
            s.ehlo()
            if user and pwd:
                s.login(user, pwd)
            s.sendmail(from_addr, to_addr, msg_str)

    elif port == 465:
        # Implicit TLS / SMTP_SSL
        with smtplib.SMTP_SSL(host, port, timeout=timeout, context=ctx) as s:
            if user and pwd:
                s.login(user, pwd)
            s.sendmail(from_addr, to_addr, msg_str)

    else:
        # Port 25 or any custom port — plain SMTP (no TLS)
        with smtplib.SMTP(host, port, timeout=timeout) as s:
            if user and pwd:
                s.login(user, pwd)
            s.sendmail(from_addr, to_addr, msg_str)
