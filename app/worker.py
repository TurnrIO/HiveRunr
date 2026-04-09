import os, json, logging, io, sys, runpy
from pathlib import Path
from celery import Celery

# Load secrets before any env-var reads (Celery broker URL, AgentMail creds, etc.)
from app.core.secrets import load_secrets
load_secrets()
from app.core.db import (
    get_run_by_task, update_run,
    list_workflows, get_graph
)

SCRIPTS_DIR = Path(__file__).parent / 'workflows'

log    = logging.getLogger(__name__)
broker = os.environ.get("CELERY_BROKER_URL", "redis://redis:6379/0")
app    = Celery("hiverunr", broker=broker, backend=broker)
app.conf.task_serializer   = "json"
app.conf.result_serializer = "json"
app.conf.accept_content    = ["json"]


# ── Alert helpers ─────────────────────────────────────────────────────────────
def _fire_webhook(webhook_url: str, payload: dict) -> None:
    """POST alert payload to a webhook URL. Never raises."""
    try:
        import httpx
        httpx.post(webhook_url, json=payload, timeout=10)
    except Exception as exc:
        log.warning("webhook alert failed (%s): %s", webhook_url[:60], exc)


def _send_run_alert(
    *,
    graph_id: int | None,
    flow_name: str,
    status: str,
    task_id: str,
    error: str = "",
) -> None:
    """Dispatch email + webhook alerts for a completed graph run.

    Reads per-flow alert config from the DB; also honours the global
    OWNER_EMAIL env var for system-level failure notifications.
    """
    from app.email import send_run_alert, _is_configured

    alert_emails:   str  = ""
    alert_webhook:  str  = ""
    alert_on_success: bool = False

    # Per-flow config
    if graph_id:
        try:
            from app.core.db import get_graph_alerts
            cfg = get_graph_alerts(graph_id)
            if cfg:
                alert_emails    = cfg.get("alert_emails") or ""
                alert_webhook   = cfg.get("alert_webhook") or ""
                alert_on_success = bool(cfg.get("alert_on_success", False))
        except Exception as exc:
            log.warning("Could not load alert config for graph %s: %s", graph_id, exc)

    # Decide whether to fire
    is_failure = status == "failed"
    should_alert = is_failure or alert_on_success

    if not should_alert:
        return

    webhook_payload = {
        "event":     "run.failed" if is_failure else "run.succeeded",
        "flow":      flow_name,
        "graph_id":  graph_id,
        "task_id":   task_id,
        "status":    status,
        "error":     error or None,
    }

    # Webhook
    if alert_webhook:
        _fire_webhook(alert_webhook, webhook_payload)

    # Email — per-flow recipients
    if alert_emails and _is_configured():
        send_run_alert(
            to=alert_emails,
            flow_name=flow_name,
            status=status,
            task_id=task_id,
            error=error,
            graph_id=graph_id,
        )

    # Email — global owner alert on failure only
    owner_email = os.environ.get("OWNER_EMAIL", "")
    if is_failure and owner_email and _is_configured():
        # Only send to owner if not already included in per-flow list
        existing = {e.strip().lower() for e in alert_emails.split(",") if e.strip()}
        if owner_email.lower() not in existing:
            send_run_alert(
                to=owner_email,
                flow_name=flow_name,
                status=status,
                task_id=task_id,
                error=error,
                graph_id=graph_id,
            )


def _notify_failure(name: str, error: str, task_id: str, graph_id: int = None):
    """Legacy wrapper — kept for backward compatibility with enqueue_script."""
    _send_run_alert(
        graph_id=graph_id,
        flow_name=name,
        status="failed",
        task_id=task_id,
        error=error,
    )



@app.task(bind=True, name="app.worker.enqueue_workflow")
def enqueue_workflow(self, workflow_name: str, payload: dict):
    task_id = self.request.id
    try:
        from app.core.db import init_db
        init_db()
    except Exception:
        pass
    update_run(task_id, "running")
    try:
        from app.workflows import example
        workflows = {"example": example.run}
        if workflow_name not in workflows:
            raise ValueError(f"Unknown workflow: {workflow_name}")
        result = workflows[workflow_name](payload)
        update_run(task_id, "succeeded", result=result)
    except Exception as e:
        log.exception(f"Workflow {workflow_name} failed")
        update_run(task_id, "failed", result={"error": str(e)})
        _notify_failure(workflow_name, str(e), task_id)

@app.task(bind=True, name="app.worker.enqueue_script")
def enqueue_script(self, script_name: str, payload: dict):
    """Execute a standalone Python script from the workflows directory."""
    import time as _time
    task_id = self.request.id
    try:
        from app.core.db import init_db
        init_db()
    except Exception:
        pass
    buf = io.StringIO()
    old_stdout, old_stderr = sys.stdout, sys.stderr
    t_start = _time.time()
    try:
        # Mark running first — inside try so any DB error is caught too
        update_run(task_id, "running")
        script_path = SCRIPTS_DIR / f"{script_name}.py"
        if not script_path.exists():
            raise FileNotFoundError(f"Script not found: {script_name}.py")
        sys.stdout = sys.stderr = buf
        runpy.run_path(str(script_path), run_name="__main__",
                       init_globals={"__payload__": payload})
        sys.stdout, sys.stderr = old_stdout, old_stderr
        output = buf.getvalue()
        duration_ms = int((_time.time() - t_start) * 1000)
        traces = [{
            'node_id':     'script',
            'type':        'script',
            'label':       script_name,
            'status':      'ok',
            'duration_ms': duration_ms,
            'attempts':    1,
            'input':       payload,
            'output':      output or "(no output)",
            'error':       None,
        }]
        update_run(task_id, "succeeded", result={"output": output, "script": script_name},
                   traces=traces)
    except Exception as e:
        sys.stdout, sys.stderr = old_stdout, old_stderr
        log.exception(f"Script {script_name} failed")
        _notify_failure(script_name, str(e), task_id)
        output = buf.getvalue()
        duration_ms = int((_time.time() - t_start) * 1000)
        traces = [{
            'node_id':     'script',
            'type':        'script',
            'label':       script_name,
            'status':      'error',
            'duration_ms': duration_ms,
            'attempts':    1,
            'input':       payload,
            'output':      output or None,
            'error':       f"{type(e).__name__}: {e}",
        }]
        try:
            update_run(task_id, "failed",
                       result={"error": str(e), "script": script_name, "output": output},
                       traces=traces)
        except Exception:
            pass  # best-effort — don't let a DB error create a second FAILURE


@app.task(bind=True, name="app.worker.enqueue_graph")
def enqueue_graph(self, graph_id: int, payload: dict):
    task_id = self.request.id
    try:
        from app.core.db import init_db
        init_db()
    except Exception:
        pass
    update_run(task_id, "running")
    traces = []
    try:
        g = get_graph(graph_id)
        if not g:
            raise ValueError(f"Graph {graph_id} not found")
        graph_data = json.loads(g.get('graph_json') or '{}')
        from app.core.executor import run_graph
        msgs = []
        result = run_graph(graph_data, payload, logger=msgs.append)
        traces = result.get('traces', [])
        update_run(task_id, "succeeded", result=result, traces=traces)
        _send_run_alert(
            graph_id=graph_id,
            flow_name=g.get("name", f"graph#{graph_id}"),
            status="succeeded",
            task_id=task_id,
        )
    except Exception as e:
        log.exception(f"Graph {graph_id} failed")
        update_run(task_id, "failed", result={"error": str(e)}, traces=traces)
        _send_run_alert(
            graph_id=graph_id,
            flow_name=(g or {}).get("name", f"graph#{graph_id}") if "g" in dir() else f"graph#{graph_id}",
            status="failed",
            task_id=task_id,
            error=str(e),
        )
