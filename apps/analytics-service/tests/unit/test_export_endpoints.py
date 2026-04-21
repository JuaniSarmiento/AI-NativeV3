"""Tests de los endpoints de cohort/export del analytics-service."""
from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from analytics_service.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:  # activa lifespan → arranca worker
        yield c


def _reset_store_between_tests():
    """Limpia el singleton del store entre tests."""
    from analytics_service.services.export import get_job_store
    get_job_store.cache_clear()


def test_export_encola_job_y_devuelve_job_id(client: TestClient) -> None:
    _reset_store_between_tests()
    r = client.post(
        "/api/v1/analytics/cohort/export",
        json={
            "comision_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            "period_days": 30,
            "include_prompts": False,
            "salt": "research_salt_16_chars_or_more",
            "cohort_alias": "UNSL_2026_P2",
        },
    )
    assert r.status_code == 202
    data = r.json()
    assert "job_id" in data
    assert data["status"] == "pending"


def test_export_status_404_si_job_no_existe(client: TestClient) -> None:
    r = client.get(
        "/api/v1/analytics/cohort/export/00000000-0000-0000-0000-000000000000/status"
    )
    assert r.status_code == 404


def test_export_status_devuelve_estado_del_job(client: TestClient) -> None:
    _reset_store_between_tests()
    # Crear job
    r = client.post(
        "/api/v1/analytics/cohort/export",
        json={
            "comision_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            "salt": "research_salt_16_chars_or_more",
        },
    )
    job_id = r.json()["job_id"]

    # Consultar status (puede estar pending o ya succeeded si el worker fue rápido)
    r2 = client.get(f"/api/v1/analytics/cohort/export/{job_id}/status")
    assert r2.status_code == 200
    data = r2.json()
    assert data["status"] in ("pending", "running", "succeeded")
    assert data["comision_id"] == "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    # El salt NO aparece (solo el hash)
    assert "salt" not in data
    assert "salt_hash" in data


def test_download_425_si_aun_pending(client: TestClient) -> None:
    _reset_store_between_tests()
    # Crear job que quedará pending un ratito (worker tarda en pollear)
    r = client.post(
        "/api/v1/analytics/cohort/export",
        json={
            "comision_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            "salt": "research_salt_16_chars_or_more",
        },
    )
    job_id = r.json()["job_id"]

    # Intentar descargar inmediatamente — puede ser 425 (aún pending) o 200 (worker rápido)
    r2 = client.get(f"/api/v1/analytics/cohort/export/{job_id}/download")
    assert r2.status_code in (200, 425)


def test_download_200_eventualmente(client: TestClient) -> None:
    _reset_store_between_tests()
    r = client.post(
        "/api/v1/analytics/cohort/export",
        json={
            "comision_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            "salt": "research_salt_16_chars_or_more",
        },
    )
    job_id = r.json()["job_id"]

    # En TestClient el worker async no gana tiempo de CPU automáticamente,
    # así que disparamos el procesamiento manualmente.
    from analytics_service.services.export import get_job_store, _StubDataSource
    from platform_ops import ExportWorker

    async def _drain() -> None:
        worker = ExportWorker(
            store=get_job_store(),
            data_source_factory=lambda tid: _StubDataSource(tenant_id=tid),
            salt="research_salt_16_chars_or_more",
        )
        # Correr hasta que no queden pending (max 10 iteraciones)
        for _ in range(10):
            if not await worker.run_once():
                break

    import asyncio
    asyncio.run(_drain())

    r3 = client.get(f"/api/v1/analytics/cohort/export/{job_id}/download")
    assert r3.status_code == 200
    payload = r3.json()
    # El stub DataSource devuelve vacío, pero la estructura debe estar
    assert payload["schema_version"] == "1.0.0"
    assert payload["total_episodes"] == 0


def test_download_404_si_job_no_existe(client: TestClient) -> None:
    r = client.get(
        "/api/v1/analytics/cohort/export/00000000-0000-0000-0000-000000000001/download"
    )
    assert r.status_code == 404
