"""Observabilidad unificada para todos los servicios de la plataforma.

Responsabilidades:
  1. Configurar OTel tracing con OTLP exporter.
  2. Instrumentar automáticamente: FastAPI, httpx, SQLAlchemy, Redis.
  3. Propagar contexto (trace_id/span_id) a llamadas outbound HTTP.
  4. Configurar structlog con campos de traza en cada log line.
  5. Capturar errores críticos con Sentry si hay DSN.

Uso:
    from platform_observability import setup_observability

    app = FastAPI(...)
    setup_observability(
        app,
        service_name="tutor-service",
        environment="production",
        otel_endpoint="http://otel-collector:4317",
    )

Esto hace que cada request HTTP entrante cree un span root, y cualquier
llamada outbound (httpx, DB, Redis) se conecte como span hijo, con el
trace_id propagándose vía header `traceparent` (W3C Trace Context).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any


@dataclass
class ObservabilityConfig:
    service_name: str
    environment: str = "development"
    log_level: str = "info"
    log_format: str = "json"
    otel_endpoint: str = "http://localhost:4317"
    otel_enabled: bool = True
    sentry_dsn: str = ""


def setup_observability(
    app: Any = None, config: ObservabilityConfig | None = None, **kwargs
) -> None:
    """Configura observabilidad completa.

    Si `app` es una FastAPI, la instrumenta. Si no, solo configura
    tracing global (útil para workers headless).

    Parámetros extra por kwargs (service_name, environment, ...) se
    pasan al ObservabilityConfig por conveniencia.
    """
    if config is None:
        config = ObservabilityConfig(**kwargs)

    _setup_logging(config)

    if config.otel_enabled and _can_import_otel():
        _setup_tracing(config, app)

    if config.sentry_dsn:
        _setup_sentry(config)


def _can_import_otel() -> bool:
    try:
        import opentelemetry  # noqa: F401

        return True
    except ImportError:
        return False


def _setup_logging(config: ObservabilityConfig) -> None:
    """Configura structlog con trace context en cada log line."""
    try:
        import structlog
    except ImportError:
        # Sin structlog, usar logging estándar
        logging.basicConfig(
            level=getattr(logging, config.log_level.upper(), logging.INFO),
            format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        )
        return

    processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        _add_trace_context,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    if config.log_format == "json":
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer())

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, config.log_level.upper(), logging.INFO)
        ),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def _add_trace_context(logger: Any, method_name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    """Inyecta trace_id y span_id en cada log line cuando hay span activo."""
    try:
        from opentelemetry import trace

        span = trace.get_current_span()
        if span is None:
            return event_dict
        ctx = span.get_span_context()
        if ctx.trace_id != 0:
            event_dict["trace_id"] = f"{ctx.trace_id:032x}"
            event_dict["span_id"] = f"{ctx.span_id:016x}"
    except Exception:
        pass
    return event_dict


def _setup_tracing(config: ObservabilityConfig, app: Any) -> None:
    """Configura OTel + instrumenta libs disponibles."""
    from opentelemetry import trace
    from opentelemetry.sdk.resources import SERVICE_NAME, Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    # Resource con metadata del servicio
    resource = Resource.create(
        {
            SERVICE_NAME: config.service_name,
            "deployment.environment": config.environment,
        }
    )

    provider = TracerProvider(resource=resource)

    # Exporter OTLP (solo si endpoint está configurado y la lib está disponible)
    try:
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
            OTLPSpanExporter,
        )

        exporter = OTLPSpanExporter(endpoint=config.otel_endpoint, insecure=True)
        provider.add_span_processor(BatchSpanProcessor(exporter))
    except ImportError:
        # Si el exporter no está disponible, tracing funciona sin export
        pass

    trace.set_tracer_provider(provider)

    # Propagator W3C Trace Context (default, explicitado por robustez)
    from opentelemetry.propagate import set_global_textmap
    from opentelemetry.trace.propagation.tracecontext import (
        TraceContextTextMapPropagator,
    )

    set_global_textmap(TraceContextTextMapPropagator())

    # Instrumentar FastAPI si hay app
    if app is not None:
        try:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

            FastAPIInstrumentor.instrument_app(app)
        except ImportError:
            pass

    # Auto-instrumentar libs populares (opt-in)
    _try_instrument_httpx()
    _try_instrument_sqlalchemy()
    _try_instrument_redis()


def _try_instrument_httpx() -> None:
    """Instrumenta httpx para propagar trace context en llamadas outbound."""
    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().instrument()
    except ImportError:
        pass


def _try_instrument_sqlalchemy() -> None:
    try:
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

        SQLAlchemyInstrumentor().instrument()
    except ImportError:
        pass


def _try_instrument_redis() -> None:
    try:
        from opentelemetry.instrumentation.redis import RedisInstrumentor

        RedisInstrumentor().instrument()
    except ImportError:
        pass


def _setup_sentry(config: ObservabilityConfig) -> None:
    """Captura errores críticos a Sentry."""
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=config.sentry_dsn,
            environment=config.environment,
            traces_sample_rate=0.0,  # Usamos OTel para traces, Sentry solo errores
            profiles_sample_rate=0.0,
            release=os.environ.get("SERVICE_VERSION", "unknown"),
        )
    except ImportError:
        pass


# ── Helpers para usar en código de negocio ─────────────────────────────


def get_tracer(name: str):
    """Obtiene un tracer para crear spans manuales.

    Uso:
        tracer = get_tracer(__name__)
        with tracer.start_as_current_span("mi_operacion", attributes={"foo": "bar"}):
            do_stuff()
    """
    try:
        from opentelemetry import trace

        return trace.get_tracer(name)
    except ImportError:
        return _NoopTracer()


class _NoopTracer:
    """Fallback si OTel no está disponible (tests offline)."""

    def start_as_current_span(self, name: str, **kwargs):
        from contextlib import nullcontext

        return nullcontext()


__all__ = [
    "ObservabilityConfig",
    "get_tracer",
    "setup_observability",
]
