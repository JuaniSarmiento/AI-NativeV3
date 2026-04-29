"""Endpoints de liveness y readiness.

- /health/live  → siempre 200 si el proceso corre
- /health/ready → 200 si dependencias están OK (DB, Redis, Keycloak)
- /health      → alias de readiness por compatibilidad
"""

from fastapi import APIRouter, status
from pydantic import BaseModel

router = APIRouter(prefix="/health", tags=["health"])


class HealthResponse(BaseModel):
    service: str
    status: str
    version: str
    checks: dict[str, str] = {}


@router.get("", response_model=HealthResponse)
@router.get("/ready", response_model=HealthResponse)
async def ready() -> HealthResponse:
    # TODO: chequear dependencias reales (DB ping, Redis ping)
    return HealthResponse(
        service="ai-gateway",
        status="ready",
        version="0.1.0",
        checks={},
    )


@router.get("/live", status_code=status.HTTP_200_OK)
async def live() -> dict[str, str]:
    return {"status": "alive"}
