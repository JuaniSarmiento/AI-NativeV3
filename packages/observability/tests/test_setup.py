"""Tests del módulo de observabilidad unificado."""

from __future__ import annotations

from platform_observability import (
    ObservabilityConfig,
    get_tracer,
    setup_observability,
)


def test_config_tiene_defaults_razonables() -> None:
    c = ObservabilityConfig(service_name="test")
    assert c.service_name == "test"
    assert c.environment == "development"
    assert c.log_level == "info"
    assert c.log_format == "json"
    assert c.otel_enabled is True


def test_setup_sin_app_no_crashea() -> None:
    """Workers headless (sin FastAPI) deben poder llamar setup."""
    # No debe lanzar excepción
    setup_observability(service_name="worker-test", otel_enabled=False)


def test_setup_con_sentry_dsn_vacio_no_falla() -> None:
    setup_observability(
        service_name="test-service",
        otel_enabled=False,
        sentry_dsn="",
    )


def test_get_tracer_devuelve_algo_usable() -> None:
    """El tracer debe soportar start_as_current_span con context manager."""
    tracer = get_tracer("test.module")
    # Funciona con o sin OTel instalado (fallback a _NoopTracer)
    with tracer.start_as_current_span("test_op"):
        pass  # no debe crashear


def test_get_tracer_span_puede_usarse_anidadamente() -> None:
    tracer = get_tracer("test.module")
    with tracer.start_as_current_span("outer"), tracer.start_as_current_span("inner"):
        pass


def test_setup_es_idempotente() -> None:
    """Llamar setup dos veces no debe romper."""
    setup_observability(service_name="s1", otel_enabled=False)
    setup_observability(service_name="s1", otel_enabled=False)
