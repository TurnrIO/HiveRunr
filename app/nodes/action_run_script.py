"""Run script action node.

DANGER: this node executes arbitrary Python via exec() with os, time, and
json available in the namespace.  It is disabled by default.

Set ENABLE_RUN_SCRIPT=true in your environment to allow execution.
Every execution is written to the 'audit' logger at WARNING level so it is
always visible in Docker / system logs regardless of the application log level.
"""

import logging
import os
import time
import json
import hashlib

from app.nodes._utils import _render

logger = logging.getLogger(__name__)

NODE_TYPE = "action.run_script"
LABEL = "Run Script"

_audit = logging.getLogger("audit")


def run(config, inp, context, logger, creds=None, **kwargs):
    """Execute arbitrary Python — requires ENABLE_RUN_SCRIPT=true."""
    logger.info("action.run_script: starting")
    # ── feature flag ──────────────────────────────────────────────────────
    enabled = os.environ.get("ENABLE_RUN_SCRIPT", "false").strip().lower() == "true"
    if not enabled:
        logger.info("action.run_script: disabled, rejecting")
        raise RuntimeError(
            "action.run_script is disabled. "
            "Set ENABLE_RUN_SCRIPT=true in your .env to enable it. "
            "WARNING: this node executes arbitrary Python code — only enable "
            "it if you fully trust every user who can edit flows."
        )

    script = _render(config.get('script', ''), context, creds)

    # ── audit log (always, even before exec) ─────────────────────────────
    script_hash    = hashlib.sha256(script.encode()).hexdigest()[:12]
    script_preview = script[:120].replace('\n', ' ')
    logger.info("action.run_script: script_hash=%s", script_hash)
    _audit.warning(
        "AUDIT run_script | hash=%s | preview=%s",
        script_hash,
        script_preview,
    )

    _UNSET = object()
    ns = {
        'input':   inp,
        'context': context,
        'result':  _UNSET,      # sentinel — distinguishes "not assigned" from None
        'log':     logger,
        'json':    json,
        'os':      os,
        'time':    time,
    }
    try:
        exec(script, ns)  # noqa: S102
    except (ValueError, RuntimeError, TypeError, ArithmeticError, SyntaxError) as exc:
        raise RuntimeError(f"run_script raised {type(exc).__name__}: {exc}") from exc

    _audit.warning(
        "AUDIT run_script | hash=%s | completed_ok",
        script_hash,
    )
    logger.info("action.run_script: completed_ok hash=%s", script_hash)
    r = ns.get('result', _UNSET)
    return inp if r is _UNSET else r
