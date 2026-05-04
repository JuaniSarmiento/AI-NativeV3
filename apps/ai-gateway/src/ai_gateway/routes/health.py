"""Endpoints de liveness y readiness.

- /health/live  → siempre 200 si el proceso corre
- /health/ready → 200 si Redis (budget store) responde; 503 si no.
                  `llm_provider` es non-critical → degraded si la config
                  está rota.
- /health      → alias de readiness por compatibilidad

Critical: `redis` (budget store).
Non-critical: `llm_provider` (degrada si LLM_PROVIDER=anthropic sin API key).
"""

from __future__ import annotations

import asyncio
import os

from fastapi import APIRouter, Response, status
from platform_observability.health import (
    CheckResult,
    HealthResponse,
    assemble_readiness,
    check_redis,
)

from ai_gateway.config import settings

router = APIRouter(prefix="/health", tags=["health"])

VERSION = "0.1.0"


def _check_llm_provider() -> CheckResult:
    """Valida que la config del provider activo esté coherente.

    No pega al provider externo (no hay endpoint de health público gratuito).
    Solo verifica que si LLM_PROVIDER=anthropic, exista una API key.
    Modo mock siempre OK.
    """
    provider = os.environ.get("LLM_PROVIDER", "anthropic").lower()
    if provider == "mock":
        return CheckResult(ok=True, latency_ms=0)
    if provider == "anthropic":
        if not settings.anthropic_api_key:
            return CheckResult(
                ok=False, latency_ms=0, error="anthropic api key missing"
            )
        return CheckResult(ok=True, latency_ms=0)
    return CheckResult(
        ok=False,
        latency_ms=0,
        error=f"unknown provider: {provider}",
    )


@router.get("", response_model=HealthResponse)
@router.get("/ready", response_model=HealthResponse)
async def ready(response: Response) -> HealthResponse:
    redis_check, llm_check = await asyncio.gather(
        check_redis(settings.redis_url),
        asyncio.to_thread(_check_llm_provider),
    )
    health, http_code = assemble_readiness(
        service="ai-gateway",
        version=VERSION,
        checks={
            "redis": redis_check,
            "llm_provider": llm_check,
        },
        critical={"redis"},
    )
    response.status_code = http_code
    return health


@router.get("/live", status_code=status.HTTP_200_OK)
async def live() -> dict[str, str]:
    return {"status": "alive"}
