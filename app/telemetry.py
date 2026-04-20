"""OpenTelemetry distributed tracing setup.

Zero-overhead design
────────────────────
When OTEL_EXPORTER_OTLP_ENDPOINT is **not** set, setup_tracing() returns
immediately without touching the SDK.  All get_tracer() calls return the
opentelemetry-api's built-in NoopTracer — instrumented code compiles and
runs with negligible overhead (a dict lookup and a noop context manager).

When OTEL_EXPORTER_OTLP_ENDPOINT **is** set:
  • SDK TracerProvider is installed globally via trace.set_tracer_provider()
  • Spans are exported over OTLP/HTTP (compatible with Jaeger ≥1.35,
    Grafana Tempo, and any OpenTelemetry Collector)
  • An optional ConsoleSpanExporter is added when OTEL_LOG_LEVEL=debug

Usage
─────
    # In each process entry point (main.py / worker.py / scheduler.py):
    from app.telemetry import setup_tracing
    setup_tracing()                  # idempotent; safe to call multiple times

    # In any module that wants to create spans:
    from app.telemetry import get_tracer
    tracer = get_tracer("hiverunr.executor")
    with tracer.start_as_current_span("run_graph") as span:
        span.set_attribute("graph.id", graph_id)
        ...

Environment variables
─────────────────────
  OTEL_SERVICE_NAME              Service name tag  (default: hiverunr)
  OTEL_EXPORTER_OTLP_ENDPOINT    OTLP/HTTP collector URL, e.g.:
                                   http://jaeger:4318          ← Jaeger all-in-one
                                   http://otel-collector:4318  ← OpenTelemetry Collector
                                 When unset, tracing is completely disabled.
  OTEL_EXPORTER_OTLP_HEADERS     Optional comma-separated k=v pairs, e.g.:
                                   Authorization=Bearer <token>
  OTEL_LOG_LEVEL                 Set to "debug" to also print spans to stdout
"""
import logging
import os

from opentelemetry import trace

log = logging.getLogger(__name__)

# ── Internal state ────────────────────────────────────────────────────────────
_setup_done   = False
_tracer_cache: dict[str, trace.Tracer] = {}


def setup_tracing() -> None:
    """Configure the OTEL TracerProvider.

    Idempotent — subsequent calls after the first are silently ignored.
    Safe to call from all three process entry points (API, worker, scheduler).
    """
    global _setup_done
    if _setup_done:
        return
    _setup_done = True

    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not endpoint:
        log.debug("OTEL tracing disabled — set OTEL_EXPORTER_OTLP_ENDPOINT to enable")
        return

    try:
        _configure_sdk(endpoint)
    except ImportError as exc:
        log.warning(
            "OTEL tracing requested (OTEL_EXPORTER_OTLP_ENDPOINT=%s) but SDK packages "
            "are missing: %s.  "
            "Install: opentelemetry-sdk opentelemetry-exporter-otlp-proto-http",
            endpoint, exc,
        )
    except Exception as exc:
        log.warning("OTEL tracing setup failed: %s — continuing without tracing", exc)


def _configure_sdk(endpoint: str) -> None:
    """Import and configure the OTEL SDK.  Isolated so ImportError is caught cleanly."""
    from opentelemetry.sdk.resources import Resource, SERVICE_NAME
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from app._version import __version__

    service_name = os.environ.get("OTEL_SERVICE_NAME", "hiverunr")

    resource = Resource.create({
        SERVICE_NAME:       service_name,
        "service.version":  __version__,
        "deployment.environment": os.environ.get("APP_ENV", "production"),
    })

    provider = TracerProvider(resource=resource)

    # ── OTLP/HTTP exporter ────────────────────────────────────────────────────
    headers: dict[str, str] = {}
    for part in os.environ.get("OTEL_EXPORTER_OTLP_HEADERS", "").split(","):
        part = part.strip()
        if "=" in part:
            k, _, v = part.partition("=")
            headers[k.strip()] = v.strip()

    otlp = OTLPSpanExporter(endpoint=endpoint, headers=headers)
    provider.add_span_processor(BatchSpanProcessor(otlp))

    # ── Optional stdout/console exporter (debug mode) ─────────────────────────
    if os.environ.get("OTEL_LOG_LEVEL", "").lower() == "debug":
        from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor
        provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
        log.info("OTEL console span exporter enabled (OTEL_LOG_LEVEL=debug)")

    trace.set_tracer_provider(provider)
    log.info(
        "OTEL tracing enabled → %s  service=%s  version=%s",
        endpoint, service_name, __version__,
    )


def get_tracer(name: str = "hiverunr") -> trace.Tracer:
    """Return a Tracer for the given instrument name.

    Returns the real SDK Tracer when tracing is active, or the opentelemetry-api
    NoopTracer otherwise.  Callers never need to check whether tracing is on.

    Example::

        tracer = get_tracer("hiverunr.nodes")
        with tracer.start_as_current_span("action.http_request") as span:
            span.set_attribute("http.url", url)
    """
    if name not in _tracer_cache:
        _tracer_cache[name] = trace.get_tracer(name)
    return _tracer_cache[name]
