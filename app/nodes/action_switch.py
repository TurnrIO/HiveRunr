"""Switch / multi-way routing action node.

Like `action.condition` but supports N branches instead of two.
Each case is matched in order; the first match wins.

Canvas wiring:
  Connect the downstream edge from the Switch node and label it with the
  case name (or index).  The executor skips nodes that are only reachable
  from un-matched cases, the same way it handles the false-branch of a
  Condition node.

Output:
  { value, matched_case, matched_index, no_match: bool }
"""
import logging

logger = logging.getLogger(__name__)
import json
from json import JSONDecodeError
from app.nodes._utils import _render

NODE_TYPE = "action.switch"
LABEL = "Switch / Router"


def run(config, inp, context, logger, creds=None, **kwargs):
    """Evaluate `value` expression and match it against ordered cases."""
    value_expr = _render(config.get("value", ""), context, creds)

    # Evaluate the value expression in a safe sandbox
    safe_builtins = {
        "len": len, "str": str, "int": int, "float": float,
        "bool": bool, "list": list, "dict": dict, "tuple": tuple,
    }
    try:
        value = eval(value_expr, {"__builtins__": safe_builtins},
                     {"input": inp, "context": context})
    except (SyntaxError, ValueError, NameError, TypeError):
        # If expression fails, use raw string as the value
        value = value_expr

    # Parse cases — JSON array of {match, label} objects
    cases_raw = config.get("cases", "[]")
    try:
        cases = json.loads(cases_raw)
    except (JSONDecodeError, TypeError):
        cases = []

    matched_case = None
    matched_index = -1

    for i, case in enumerate(cases):
        match_val = case.get("match", "")
        # Support Python expression matching: wrap in eval if it contains
        # operators, otherwise do simple equality / string comparison.
        try:
            case_result = eval(
                f"{repr(value)} == {repr(match_val)}",
                {"__builtins__": safe_builtins}, {}
            )
        except (SyntaxError, ValueError, ZeroDivisionError) as e:
            case_result = str(value) == str(match_val)
            if case_result is False:
                logger.warning("Switch case %d: expression eval failed (%s), fell back to string compare", i, e)
            # If still False after fallback, keep False — don't match

        if case_result:
            matched_case = case.get("label") or match_val
            matched_index = i
            logger.info("Switch matched case %s: %r (value=%r)", i, matched_case, value)
            break

    no_match = matched_case is None
    if no_match:
        logger.info("Switch: no case matched value=%r", value)

    return {
        "value": value,
        "matched_case": matched_case,
        "matched_index": matched_index,
        "no_match": no_match,
    }
