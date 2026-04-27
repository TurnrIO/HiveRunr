"""Node unit tests — verify output shapes and error handling for
the five most-used nodes with mocked I/O.

No network calls, no DB, no Celery required.
"""
import json
import pytest
import unittest.mock as mock


def make_logger():
    """Minimal logger that collects messages."""
    msgs = []
    class L:
        def info(self, *a): msgs.append(("info", a))
        def warning(self, *a): msgs.append(("warning", a))
        def error(self, *a): msgs.append(("error", a))
        def debug(self, *a): pass
    return L(), msgs


# ── action.transform ──────────────────────────────────────────────────────────

def test_transform_basic_expression():
    from app.nodes.action_transform import run
    log, _ = make_logger()
    out = run({"expression": "{'doubled': input['x'] * 2}"}, {"x": 5}, {}, log)
    assert out == {"doubled": 10}


def test_transform_context_access():
    from app.nodes.action_transform import run
    log, _ = make_logger()
    out = run(
        {"expression": "{'sum': context['a']['val'] + context['b']['val']}"},
        {},
        {"a": {"val": 3}, "b": {"val": 4}},
        log,
    )
    assert out == {"sum": 7}


def test_transform_invalid_expression_raises():
    from app.nodes.action_transform import run
    log, _ = make_logger()
    with pytest.raises(Exception):
        run({"expression": "this is not python &&"}, {}, {}, log)


def test_transform_missing_expression_returns_empty():
    """Missing expression returns {} rather than raising — not a hard error."""
    from app.nodes.action_transform import run
    log, _ = make_logger()
    out = run({}, {}, {}, log)
    assert isinstance(out, dict)


# ── action.condition ──────────────────────────────────────────────────────────

def test_condition_true_branch():
    from app.nodes.action_condition import run
    log, _ = make_logger()
    out = run({"expression": "input.get('x') > 5"}, {"x": 10}, {}, log)
    assert out.get("result") is True


def test_condition_false_branch():
    from app.nodes.action_condition import run
    log, _ = make_logger()
    out = run({"expression": "input.get('x') > 5"}, {"x": 2}, {}, log)
    assert out.get("result") is False


def test_condition_missing_expression_returns_false():
    """Missing/empty expression evaluates to False rather than raising."""
    from app.nodes.action_condition import run
    log, _ = make_logger()
    out = run({}, {}, {}, log)
    assert isinstance(out, dict)
    assert out.get("result") is False


# ── action.http_request ───────────────────────────────────────────────────────

def test_http_request_get_success():
    from app.nodes.action_http_request import run
    log, _ = make_logger()

    mock_response = mock.MagicMock()
    mock_response.status_code = 200
    mock_response.text = '{"ok": true}'
    mock_response.headers = mock.MagicMock()
    mock_response.headers.get.return_value = "application/json"
    mock_response.json.return_value = {"ok": True}
    mock_response.raise_for_status.return_value = None

    mock_client = mock.MagicMock()
    mock_client.__enter__ = lambda s: s
    mock_client.__exit__ = mock.MagicMock(return_value=False)
    mock_client.request.return_value = mock_response

    with mock.patch("httpx.Client") as MockClient, \
         mock.patch("httpx.HTTPStatusError", Exception), \
         mock.patch("httpx.RequestError", Exception):
        MockClient.return_value = mock_client
        out = run({"url": "https://example.com/api", "method": "GET"}, {}, {}, log)

    assert out["status_code"] == 200
    assert "body" in out or "json" in out or "text" in out


def test_http_request_missing_url_raises():
    from app.nodes.action_http_request import run
    log, _ = make_logger()
    with pytest.raises(Exception):
        run({"method": "GET"}, {}, {}, log)


# ── trigger.webhook ───────────────────────────────────────────────────────────

def test_webhook_trigger_passthrough():
    from app.nodes.trigger_webhook import run
    log, _ = make_logger()
    payload = {"event": "push", "repo": "HiveRunr"}
    out = run({}, payload, {}, log)
    # Webhook trigger should pass its input straight through as output
    assert out.get("event") == "push" or out == payload or "payload" in out


# ── action.llm_call ───────────────────────────────────────────────────────────

def test_llm_call_output_shape():
    """LLM node should return text, model, and token counts."""
    from app.nodes.action_llm_call import run
    log, _ = make_logger()

    fake_response = {
        "choices": [{"message": {"content": "Hello from LLM"}}],
        "model": "gpt-4o-mini",
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }

    with mock.patch("app.nodes.action_llm_call.urllib.request.urlopen") as mock_urlopen:
        mock_cm = mock.MagicMock()
        mock_cm.__enter__ = lambda s: s
        mock_cm.__exit__ = mock.MagicMock(return_value=False)
        mock_cm.read.return_value = json.dumps(fake_response).encode()
        mock_urlopen.return_value = mock_cm

        out = run(
            {
                "prompt": "Say hello",
                "model": "gpt-4o-mini",
                "api_key": "sk-test",
                "api_base": "https://api.openai.com/v1",
            },
            {}, {}, log,
        )

    assert out["response"] == "Hello from LLM"
    assert "model" in out
    assert "tokens" in out


def test_llm_call_missing_api_key_raises():
    """LLM node must raise when no api_key is configured and env var is absent."""
    import os
    from app.nodes.action_llm_call import run
    log, _ = make_logger()
    with mock.patch.dict(os.environ, {}, clear=True):
        # Ensure OPENAI_API_KEY is not set
        os.environ.pop("OPENAI_API_KEY", None)
        with pytest.raises(ValueError, match="api_key"):
            run({"model": "gpt-4o-mini", "prompt": "test"}, {}, {}, log)
