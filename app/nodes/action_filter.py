"""Filter / map action node."""
import logging
from app.nodes._utils import _render

logger = logging.getLogger(__name__)

NODE_TYPE = "action.filter"
LABEL = "Filter"


def run(config, inp, context, logger, creds=None, **kwargs):
    """Filter items in a list based on an expression."""
    field = config.get('field', '')
    expr = _render(config.get('expression', 'True'), context, creds)
    items = inp.get(field, inp) if field and isinstance(inp, dict) else inp

    if not isinstance(items, list):
        items = [items]

    try:
        safe_builtins = {'len': len, 'str': str, 'int': int, 'float': float, 'bool': bool, 'list': list, 'dict': dict, 'tuple': tuple}
        kept = [item for item in items
                if eval(expr, {'__builtins__': safe_builtins}, {'item': item, 'context': context, 'input': inp})]
    except (SyntaxError, ValueError, TypeError, NameError, ZeroDivisionError) as e:
        logger.warning("Filter expression evaluation failed: %s — returning all items", e)
        kept = items

    logger.info("Filter: kept %s/%s items", len(kept), len(items))
    return {'items': kept, 'count': len(kept), 'total': len(items)}

