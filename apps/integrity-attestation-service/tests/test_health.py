"""Tests del endpoint de salud del integrity-attestation-service."""

import pytest
from httpx import ASGITransport, AsyncClient
from integrity_attestation_service.main import app


@pytest.fixture
async def client() -> AsyncClient:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_health_ready(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "integrity-attestation-service"
    assert data["status"] == "ready"


async def test_health_live(client: AsyncClient) -> None:
    response = await client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


async def test_root(client: AsyncClient) -> None:
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "integrity-attestation-service"
    assert data["adr"] == "ADR-021"
