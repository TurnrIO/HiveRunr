"""Transform / evaluate expression action node."""
import logging
import json
from app.nodes._utils import _render

logger = logging.getLogger(__name__)
NODE_TYPE = "action.transform"
LABEL = "Transform"


def run(config, inp, context, logger, creds=None, **kwargs):
    """Evaluate a Python expression and return result."""
    expr = _render(config.get('expression') or 'input', context, creds)
    safe_builtins = {'len': len, 'str': str, 'int': int, 'float': float, 'bool': bool, 'list': list, 'dict': dict, 'tuple': tuple}
    try:
        result = eval(expr, {'__builtins__': safe_builtins}, {'input': inp, 'context': context, 'json': json})
    except (KeyError, SyntaxError, NameError, TypeError, ZeroDivisionError) as e:
        if isinstance(e, KeyError) and e.args and isinstance(e.args[0], slice):
            s = e.args[0]
            notation = f"[:{s.stop}]" if s.start is None and s.step is None else repr(s)
            keys = list(inp.keys()) if isinstance(inp, dict) else None
            hint = f" Available keys: {keys}. Try input['key']{notation} instead." if keys else ""
            return {
                '__error': f"Cannot slice a dict with {notation} — 'input' is a dict, not a list.{hint}"
            }
        return {
            '__error': f"Transform expression error: {type(e).__name__}: {e}"
        }
    logger.info("Transform: evaluated expression")
    return result

