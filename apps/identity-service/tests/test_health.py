"""Tests del endpoint /health del identity-service."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from identity_service.main import app
from platform_observability.health import CheckResult, _http_cache_clear


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    _http_cache_clear()


@pytest.fixture
async def client() -> AsyncClient:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


def _ok() -> CheckResult:
    return CheckResult(ok=True, latency_ms=5)


def _ko() -> CheckResult:
    return CheckResult(ok=False, latency_ms=2000, error="down")


def _patch_check_http(result: CheckResult) -> Any:
    return patch(
        "identity_service.routes.health.check_http",
        AsyncMock(return_value=result),
    )


async def test_health_ready_keycloak_ok(client: AsyncClient) -> None:
    with _patch_check_http(_ok()):
        response = await client.get("/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "identity-service"
    assert body["status"] == "ready"
    assert body["checks"]["keycloak"]["ok"] is True


async def test_health_ready_keycloak_down(client: AsyncClient) -> None:
    with _patch_check_http(_ko()):
        response = await client.get("/health/ready")
    assert response.status_code == 503
    assert response.json()["status"] == "error"


async def test_health_alias_routes_to_ready(client: AsyncClient) -> None:
    with _patch_check_http(_ok()):
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "identity-service"


async def test_health_live(client: AsyncClient) -> None:
    response = await client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


async def test_root(client: AsyncClient) -> None:
    response = await client.get("/")
    assert response.status_code == 200
    assert response.json()["service"] == "identity-service"
