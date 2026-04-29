"""Endpoints de liveness y readiness."""

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
    return HealthResponse(
        service="integrity-attestation-service",
        status="ready",
        version="0.1.0",
        checks={},
    )


@router.get("/live", status_code=status.HTTP_200_OK)
async def live() -> dict[str, str]:
    return {"status": "alive"}
