"""Endpoints de liveness y readiness.

- /health/live  → siempre 200 si el proceso corre
- /health/ready → 200 si classifier_db + Redis responden; 503 si alguno falla
- /health      → alias de readiness por compatibilidad

Critical: `classifier_db`, `redis` (consumer del CTR stream).
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Response, status
from platform_observability.health import (
    HealthResponse,
    assemble_readiness,
    check_postgres,
    check_redis,
)

from classifier_service.config import settings
from classifier_service.db import get_engine

router = APIRouter(prefix="/health", tags=["health"])

VERSION = "0.1.0"


@router.get("", response_model=HealthResponse)
@router.get("/ready", response_model=HealthResponse)
async def ready(response: Response) -> HealthResponse:
    db_check, redis_check = await asyncio.gather(
        check_postgres(get_engine()),
        check_redis(settings.redis_url),
    )
    health, http_code = assemble_readiness(
        service="classifier-service",
        version=VERSION,
        checks={
            "classifier_db": db_check,
            "redis": redis_check,
        },
        critical={"classifier_db", "redis"},
    )
    response.status_code = http_code
    return health


@router.get("/live", status_code=status.HTTP_200_OK)
async def live() -> dict[str, str]:
    return {"status": "alive"}
