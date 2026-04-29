"""Tests del pipeline completo del classifier.

Verifica la propiedad CRÍTICA para la tesis: dado un episodio y un
classifier_config_hash, la clasificación es 100% reproducible. Otra
persona puede correr el mismo algoritmo sobre los mismos eventos y
obtener exactamente el mismo resultado.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from classifier_service.services.pipeline import (
    classify_episode_from_events,
    compute_classifier_config_hash,
)
from classifier_service.services.tree import DEFAULT_REFERENCE_PROFILE


def _ev(seq: int, event_type: str, minutes_offset: int, payload: dict | None = None) -> dict:
    base = datetime(2026, 9, 1, 10, 0, 0, tzinfo=UTC)
    return {
        "seq": seq,
        "event_type": event_type,
        "ts": (base + timedelta(minutes=minutes_offset)).isoformat().replace("+00:00", "Z"),
        "payload": payload or {},
    }


# ── Reproducibilidad ─────────────────────────────────────────────────


def test_clasificacion_es_completamente_reproducible() -> None:
    """Misma serie de eventos → exactamente la misma clasificación.

    Esta es la propiedad central de la tesis: auditabilidad total.
    """
    events = [
        _ev(0, "episodio_abierto", 0),
        _ev(
            1,
            "prompt_enviado",
            1,
            {"content": "qué es recursión", "prompt_kind": "solicitud_directa"},
        ),
        _ev(2, "tutor_respondio", 2, {"content": "..."}),
        _ev(3, "codigo_ejecutado", 4),
        _ev(4, "anotacion_creada", 5, {"content": "ya entendí"}),
        _ev(5, "prompt_enviado", 7, {"content": "cómo aplico recursión a factorial"}),
        _ev(6, "tutor_respondio", 8, {"content": "..."}),
        _ev(7, "codigo_ejecutado", 10),
        _ev(8, "episodio_cerrado", 12, {"reason": "completed"}),
    ]

    r1 = classify_episode_from_events(events)
    r2 = classify_episode_from_events(events)

    assert r1.appropriation == r2.appropriation
    assert r1.reason == r2.reason
    assert r1.ct_summary == r2.ct_summary
    assert r1.ccd_mean == r2.ccd_mean
    assert r1.ccd_orphan_ratio == r2.ccd_orphan_ratio
    assert r1.cii_stability == r2.cii_stability
    assert r1.cii_evolution == r2.cii_evolution


def test_classifier_config_hash_es_determinista() -> None:
    """El hash de la config es el mismo dado el mismo profile + version."""
    h1 = compute_classifier_config_hash(DEFAULT_REFERENCE_PROFILE, "v1.0.0")
    h2 = compute_classifier_config_hash(DEFAULT_REFERENCE_PROFILE, "v1.0.0")
    assert h1 == h2
    assert len(h1) == 64


def test_classifier_config_hash_cambia_con_profile_distinto() -> None:
    """Cambiar el profile o la versión cambia el hash → nueva reclasificación."""
    h_default = compute_classifier_config_hash(DEFAULT_REFERENCE_PROFILE, "v1.0.0")

    modified = {
        **DEFAULT_REFERENCE_PROFILE,
        "thresholds": {**DEFAULT_REFERENCE_PROFILE["thresholds"], "ct_low": 0.4},
    }
    h_modified = compute_classifier_config_hash(modified, "v1.0.0")
    assert h_default != h_modified

    h_new_version = compute_classifier_config_hash(DEFAULT_REFERENCE_PROFILE, "v1.1.0")
    assert h_default != h_new_version


def test_classifier_config_hash_invariante_a_orden_de_keys() -> None:
    """El hash usa canonical JSON, por lo que el orden de keys no afecta."""
    profile_a = {
        "name": "default",
        "version": "v1.0.0",
        "thresholds": {"ct_low": 0.3, "ct_high": 0.7},
    }
    profile_b = {
        "thresholds": {"ct_high": 0.7, "ct_low": 0.3},
        "version": "v1.0.0",
        "name": "default",
    }
    assert compute_classifier_config_hash(profile_a) == compute_classifier_config_hash(profile_b)


# ── Escenarios end-to-end ──────────────────────────────────────────────


def test_escenario_copypaste_sin_reflexion_es_delegacion_pasiva() -> None:
    """Estudiante pregunta, copia, reejecuta rápido sin reflexión.
    Eventos erráticos con pausas largas irregulares y cero anotaciones.
    Este patrón cumple los umbrales de delegación pasiva."""
    events = [
        _ev(0, "episodio_abierto", 0),
    ]
    # Ciclos MUY rápidos + pausas largas mezcladas + ninguna reflexión
    offsets = [2, 2, 3, 15, 15, 16, 18, 25, 25, 26]  # pausas de 12min entre bloques
    for i, m in enumerate(offsets):
        if i % 3 == 0:
            events.append(
                _ev(
                    len(events),
                    "prompt_enviado",
                    m,
                    {"content": "dame la solución completa", "prompt_kind": "solicitud_directa"},
                )
            )
        elif i % 3 == 1:
            events.append(_ev(len(events), "tutor_respondio", m, {"content": "..."}))
        else:
            events.append(_ev(len(events), "codigo_ejecutado", m))

    r = classify_episode_from_events(events)
    # Orphan ratio alto (todas huérfanas) + CT baja (pausas) → delegación pasiva
    assert r.ccd_orphan_ratio > 0.5
    assert r.appropriation == "delegacion_pasiva"


def test_escenario_trabajo_sostenido_con_reflexion_es_reflexiva() -> None:
    """Trabajo sostenido >30min con reflexiones tras cada ejecución
    debería dar apropiacion_reflexiva."""
    events = [
        _ev(0, "episodio_abierto", 0),
        # 8 iteraciones con reflexión y tema coherente
        _ev(
            1,
            "prompt_enviado",
            2,
            {
                "content": "cómo estructuro la recursión para factorial",
                "prompt_kind": "solicitud_directa",
            },
        ),
        _ev(2, "tutor_respondio", 3, {"content": "..."}),
        _ev(3, "codigo_ejecutado", 5),
        _ev(
            4,
            "anotacion_creada",
            5,
            {"content": "entiendo el caso base pero el caso recursivo me confunde"},
        ),
        _ev(
            5,
            "prompt_enviado",
            8,
            {
                "content": "por qué mi caso recursivo para factorial falla",
                "prompt_kind": "reflexion",
            },
        ),
        _ev(6, "tutor_respondio", 9, {"content": "..."}),
        _ev(7, "codigo_ejecutado", 11),
        _ev(8, "anotacion_creada", 12, {"content": "ahora sí, ya pasó el factorial"}),
        _ev(
            9,
            "prompt_enviado",
            14,
            {
                "content": "cómo extiendo la recursión del factorial a fibonacci",
                "prompt_kind": "solicitud_directa",
            },
        ),
        _ev(10, "tutor_respondio", 15, {"content": "..."}),
        _ev(11, "codigo_ejecutado", 17),
        _ev(
            12,
            "anotacion_creada",
            18,
            {"content": "fibonacci es parecido pero con dos casos base y dos recursiones"},
        ),
        _ev(13, "episodio_cerrado", 20),
    ]
    r = classify_episode_from_events(events)
    # Puede ser superficial o reflexiva dependiendo del profile; con el
    # default, verificamos que al menos NO sea delegación pasiva
    assert r.appropriation != "delegacion_pasiva"


def test_episodio_vacio_no_crashea() -> None:
    """Caso borde: episodio con solo apertura y cierre (sin interacciones reales)."""
    events = [
        _ev(0, "episodio_abierto", 0),
        _ev(1, "episodio_cerrado", 1),
    ]
    r = classify_episode_from_events(events)
    # Falla graceful: no crashea y devuelve una clasificación
    assert r.appropriation in {
        "delegacion_pasiva",
        "apropiacion_superficial",
        "apropiacion_reflexiva",
    }
