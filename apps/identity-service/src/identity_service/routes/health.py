"""Endpoints de liveness y readiness.

- /health/live  → siempre 200 si el proceso corre
- /health/ready → 200 si Keycloak responde; 503 si no
- /health      → alias de readiness por compatibilidad

Critical: `keycloak`. Aunque identity-service es `/health` only by-design
(auth via api-gateway + Casbin descentralizado), chequear Keycloak da una
señal independiente del path del gateway — útil cuando Keycloak cae.
"""

from __future__ import annotations

from fastapi import APIRouter, Response, status
from platform_observability.health import (
    HealthResponse,
    assemble_readiness,
    check_http,
)

from identity_service.config import settings

router = APIRouter(prefix="/health", tags=["health"])

VERSION = "0.1.0"


def _keycloak_realm_url() -> str:
    return (
        f"{settings.keycloak_url.rstrip('/')}/realms/{settings.keycloak_realm}"
    )


@router.get("", response_model=HealthResponse)
@router.get("/ready", response_model=HealthResponse)
async def ready(response: Response) -> HealthResponse:
    keycloak_check = await check_http(_keycloak_realm_url())
    health, http_code = assemble_readiness(
        service="identity-service",
        version=VERSION,
        checks={"keycloak": keycloak_check},
        critical={"keycloak"},
    )
    response.status_code = http_code
    return health


@router.get("/live", status_code=status.HTTP_200_OK)
async def live() -> dict[str, str]:
    return {"status": "alive"}
