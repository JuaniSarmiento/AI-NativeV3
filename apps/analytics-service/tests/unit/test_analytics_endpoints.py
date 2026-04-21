"""Tests del endpoint /api/v1/analytics/kappa."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from analytics_service.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _rating(ep: str, a: str, b: str) -> dict:
    return {"episode_id": ep, "rater_a": a, "rater_b": b}


# ── Happy path ────────────────────────────────────────────────────────


def test_kappa_endpoint_con_acuerdo_perfecto(client: TestClient) -> None:
    ratings = [
        _rating("ep1", "apropiacion_reflexiva", "apropiacion_reflexiva"),
        _rating("ep2", "apropiacion_superficial", "apropiacion_superficial"),
        _rating("ep3", "delegacion_pasiva", "delegacion_pasiva"),
    ]
    r = client.post("/api/v1/analytics/kappa", json={"ratings": ratings})
    assert r.status_code == 200
    data = r.json()
    assert data["kappa"] == 1.0
    assert data["n_episodes"] == 3
    assert data["interpretation"] == "casi perfecto"


def test_kappa_endpoint_con_desacuerdo_parcial(client: TestClient) -> None:
    ratings = [
        _rating("ep1", "apropiacion_reflexiva", "apropiacion_reflexiva"),
        _rating("ep2", "apropiacion_reflexiva", "apropiacion_superficial"),  # disagree
        _rating("ep3", "apropiacion_superficial", "apropiacion_superficial"),
        _rating("ep4", "delegacion_pasiva", "delegacion_pasiva"),
    ]
    r = client.post("/api/v1/analytics/kappa", json={"ratings": ratings})
    assert r.status_code == 200
    data = r.json()
    assert 0 < data["kappa"] < 1.0
    assert data["observed_agreement"] == 0.75  # 3 de 4 aciertos


def test_kappa_endpoint_incluye_matriz_de_confusion(client: TestClient) -> None:
    ratings = [
        _rating("ep1", "apropiacion_reflexiva", "apropiacion_reflexiva"),
        _rating("ep2", "apropiacion_reflexiva", "apropiacion_superficial"),
    ]
    r = client.post("/api/v1/analytics/kappa", json={"ratings": ratings})
    assert r.status_code == 200
    data = r.json()
    cm = data["confusion_matrix"]
    assert cm["apropiacion_reflexiva"]["apropiacion_reflexiva"] == 1
    assert cm["apropiacion_reflexiva"]["apropiacion_superficial"] == 1


def test_kappa_endpoint_incluye_per_class_agreement(client: TestClient) -> None:
    ratings = [
        _rating("ep1", "apropiacion_reflexiva", "apropiacion_reflexiva"),
        _rating("ep2", "delegacion_pasiva", "delegacion_pasiva"),
    ]
    r = client.post("/api/v1/analytics/kappa", json={"ratings": ratings})
    data = r.json()
    assert "per_class_agreement" in data
    assert data["per_class_agreement"]["apropiacion_reflexiva"] == 1.0


# ── Validación ────────────────────────────────────────────────────────


def test_kappa_endpoint_categoria_invalida_422(client: TestClient) -> None:
    """Pydantic Literal rechaza categorías inválidas con 422."""
    bad = {"episode_id": "x", "rater_a": "foobar", "rater_b": "apropiacion_reflexiva"}
    r = client.post("/api/v1/analytics/kappa", json={"ratings": [bad]})
    assert r.status_code == 422


def test_kappa_endpoint_sin_ratings_422(client: TestClient) -> None:
    r = client.post("/api/v1/analytics/kappa", json={"ratings": []})
    assert r.status_code == 422  # min_length=1


# ── Cohort export endpoint ────────────────────────────────────────────


def test_cohort_export_acepta_request_valido(client: TestClient) -> None:
    r = client.post(
        "/api/v1/analytics/cohort/export",
        json={
            "comision_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            "period_days": 90,
            "include_prompts": False,
            "salt": "research_salt_16_chars_min_yes",
            "cohort_alias": "UNSL_2026_P2",
        },
    )
    assert r.status_code == 202
    data = r.json()
    # F7: respuesta con job_id + status pending
    assert data["status"] == "pending"
    assert "job_id" in data


def test_cohort_export_salt_corto_falla_422(client: TestClient) -> None:
    r = client.post(
        "/api/v1/analytics/cohort/export",
        json={
            "comision_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            "salt": "short",  # < 16 chars
        },
    )
    assert r.status_code == 422
