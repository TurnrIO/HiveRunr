"""Shared utilities for node modules."""
import re
import json

_TMPL = re.compile(r'\{\{([^}]+)\}\}')


def _resolve_cred_raw(cred_name: str, creds: dict):
    """Return the raw credential string for *cred_name*.

    Handles two calling conventions:
    - ``cred_name`` is a plain name ("my-smtp")  → looked up in *creds*
    - ``cred_name`` was produced by rendering ``{{creds.my-smtp}}`` and is
      therefore already the raw JSON/secret string → returned as-is.

    This prevents a silent fallback to env-var defaults when users
    type ``{{creds.name}}`` in the "Credential (name)" node field instead
    of the bare name ``name``.
    """
    if not cred_name or not creds:
        return None
    raw = creds.get(cred_name)
    if raw is None and cred_name.lstrip().startswith('{'):
        # Already resolved by _render — use the JSON value directly
        raw = cred_name
    return raw


def _render(text: str, ctx: dict, creds: dict = None, predecessor_ids=None) -> str:
    """
    Render template variables in text.
    Supports:
    - {{node_id.field}} — reference output of a previous node
    - {{creds.name}} or {{creds.name.field}} — credential vault access

    Args:
        predecessor_ids: set of node IDs that are actual predecessors of the
            current node in the execution graph. Node references outside this
            set are treated as unsafe and return the placeholder unchanged,
            preventing cross-node data exfiltration via template injection.
            When None (default), no graph-based restriction is applied
            (backward-compatible for direct callers not invoked via executor).
    """
    if not isinstance(text, str):
        return text

    def replace(m):
        key = m.group(1).strip()

        # Credential vault: {{creds.name}} or {{creds.name.field}}
        if key.startswith('creds.') and creds is not None:
            rest  = key[6:].strip()
            parts = rest.split('.', 1)
            cred_name  = parts[0]
            cred_field = parts[1] if len(parts) > 1 else None
            raw = creds.get(cred_name)
            if raw is None:
                return m.group(0)
            if cred_field:
                try:
                    data = json.loads(raw)
                    val  = data.get(cred_field)
                    return str(val) if val is not None else m.group(0)
                except (json.JSONDecodeError, AttributeError):
                    return m.group(0)
            return raw

        # Context reference: {{node_id.field}} or {{node_id}}
        parts = key.split('.', 1)
        node_id = parts[0]
        field   = parts[1] if len(parts) > 1 else None

        # Guard: only allow references to actual predecessors in the graph
        # when predecessor_ids is explicitly provided (via executor path)
        if predecessor_ids is not None and node_id not in predecessor_ids:
            return m.group(0)

        val = ctx.get(node_id)
        if val is None:
            return m.group(0)
        if field:
            if isinstance(val, dict):
                val = val.get(field, m.group(0))
            else:
                return m.group(0)
        return str(val) if not isinstance(val, str) else val

    return _TMPL.sub(replace, text)

