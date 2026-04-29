"""Tests del etiquetador de eventos N1-N4 (ADR-020)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from classifier_service.services.event_labeler import (
    EVENT_N_LEVEL_BASE,
    LABELER_VERSION,
    label_event,
    n_level_distribution,
    time_in_level,
)


def _ev(
    seq: int, event_type: str, sec_offset: int, payload: dict[str, Any] | None = None
) -> dict[str, Any]:
    base = datetime(2026, 9, 1, 10, 0, 0, tzinfo=UTC)
    return {
        "seq": seq,
        "event_type": event_type,
        "ts": (base + timedelta(seconds=sec_offset)).isoformat().replace("+00:00", "Z"),
        "payload": payload or {},
    }


# ---------------------------------------------------------------------------
# label_event
# ---------------------------------------------------------------------------


def test_mapping_base_cubre_todos_los_event_types_del_contrato() -> None:
    """Sanity check: el mapping cubre los 10 event_type que existen hoy en
    `packages/contracts/src/platform_contracts/ctr/events.py`. Si se agrega
    uno nuevo (ej. nuevos eventos de G2/G6), este test recuerda actualizar el mapping."""
    expected_types = {
        "episodio_abierto",
        "episodio_cerrado",
        "episodio_abandonado",
        "lectura_enunciado",
        "anotacion_creada",
        "edicion_codigo",
        "codigo_ejecutado",
        "prompt_enviado",
        "tutor_respondio",
        "intento_adverso_detectado",  # ADR-019, G3 Fase A
    }
    assert set(EVENT_N_LEVEL_BASE.keys()) == expected_types


def test_intento_adverso_detectado_es_n4() -> None:
    """ADR-019: el evento adverso es N4 porque es interaccion con la IA."""
    from classifier_service.services.event_labeler import label_event

    assert label_event("intento_adverso_detectado") == "N4"


def test_meta_events() -> None:
    assert label_event("episodio_abierto") == "meta"
    assert label_event("episodio_cerrado") == "meta"
    assert label_event("episodio_abandonado") == "meta"


def test_lectura_enunciado_es_n1() -> None:
    assert label_event("lectura_enunciado") == "N1"


def test_anotacion_creada_es_n2_fijo_en_v1() -> None:
    """v1.0.0 etiqueta toda anotacion como N2. El override por contenido es
    agenda futura. Si en el futuro se cambia, este test forzara revisar el ADR."""
    assert label_event("anotacion_creada", {"content": "planeo dividir en pasos"}) == "N2"
    assert label_event("anotacion_creada", {"content": "ejecute y dio error"}) == "N2"


def test_anotacion_creada_n2_es_decision_de_implementacion_no_tabla_4_1() -> None:
    """Decision de implementacion documentada (F18 / ADR-020): la Tabla 4.1
    de la tesis asigna las anotaciones a N1 (notas durante lectura) o N4
    (apropiacion tras respuesta del tutor) segun contenido. v1.0.0 las fija
    a N2 para no requerir clasificacion semantica del contenido.

    Si esta asignacion cambia (por agregar override de contenido en el Eje B):
      1. Bumpear LABELER_VERSION (ADR-020).
      2. Actualizar Seccion 19.5 de la tesis sobre el sesgo sistematico que se cierra.
      3. Actualizar este test con los nuevos casos esperados.

    El test ancla TODOS los casos al N2 fijo — cualquier divergencia de
    contenido devolviendo otro nivel rompe aqui antes de propagarse.
    """
    casos_que_la_tabla_4_1_pondria_en_n1 = [
        {"content": "no entiendo bien el enunciado, dice 'lista enlazada'"},
        {"content": "voy a leer otra vez el problema"},
    ]
    casos_que_la_tabla_4_1_pondria_en_n4 = [
        {"content": "ya vi por que falla — el indice arranca en 0"},
        {"content": "el tutor explico que era O(n^2), reescribi con dict"},
    ]
    for payload in casos_que_la_tabla_4_1_pondria_en_n1:
        assert label_event("anotacion_creada", payload) == "N2", (
            f"v1.0.0: anotacion_creada SIEMPRE N2 (decision de implementacion), "
            f"NO override por contenido. payload={payload}"
        )
    for payload in casos_que_la_tabla_4_1_pondria_en_n4:
        assert label_event("anotacion_creada", payload) == "N2", (
            f"v1.0.0: anotacion_creada SIEMPRE N2 (decision de implementacion), "
            f"NO override por contenido. payload={payload}"
        )
    # Sanity: el LABELER_VERSION sigue siendo 1.x — un bump mayor implica
    # que la decision cambio y este test debe ser revisado.
    major = int(LABELER_VERSION.split(".")[0])
    assert major == 1, (
        f"LABELER_VERSION saltó a {LABELER_VERSION}: revisar si la asignación "
        "fija de anotacion_creada a N2 sigue siendo válida o ya se introdujo "
        "override por contenido."
    )


def test_codigo_ejecutado_es_n3() -> None:
    assert label_event("codigo_ejecutado") == "N3"


def test_prompts_y_respuestas_son_n4() -> None:
    assert label_event("prompt_enviado") == "N4"
    assert label_event("tutor_respondio") == "N4"


def test_edicion_codigo_student_typed_es_n2() -> None:
    assert label_event("edicion_codigo", {"origin": "student_typed"}) == "N2"


def test_edicion_codigo_legacy_sin_origin_es_n2() -> None:
    """Eventos pre-F6 no tienen `origin`. Cae al default N2."""
    assert label_event("edicion_codigo", {}) == "N2"
    assert label_event("edicion_codigo", None) == "N2"
    assert label_event("edicion_codigo", {"origin": None}) == "N2"


def test_edicion_codigo_copied_from_tutor_es_n4() -> None:
    """Override clave: codigo copiado del tutor es interaccion IA, no elaboracion."""
    assert label_event("edicion_codigo", {"origin": "copied_from_tutor"}) == "N4"


def test_edicion_codigo_pasted_external_es_n4() -> None:
    """Pegar codigo de afuera tampoco es elaboracion propia."""
    assert label_event("edicion_codigo", {"origin": "pasted_external"}) == "N4"


def test_event_type_desconocido_cae_a_meta() -> None:
    """Fallback conservador: nunca crashear ante un evento experimental o legacy."""
    assert label_event("evento_inventado_v9000") == "meta"
    assert label_event("future_event_g6_g7") == "meta"


def test_label_event_es_pura_y_deterministica() -> None:
    """Mismo input → mismo output, sin side-effects observables."""
    payload = {"origin": "copied_from_tutor"}
    a = label_event("edicion_codigo", payload)
    b = label_event("edicion_codigo", payload)
    c = label_event("edicion_codigo", dict(payload))
    assert a == b == c == "N4"


# ---------------------------------------------------------------------------
# time_in_level
# ---------------------------------------------------------------------------


def test_time_in_level_episodio_vacio() -> None:
    r = time_in_level([])
    assert r == {"N1": 0.0, "N2": 0.0, "N3": 0.0, "N4": 0.0, "meta": 0.0}


def test_time_in_level_un_solo_evento() -> None:
    """Sin evento siguiente no hay delta posible. Devuelve todo en 0."""
    r = time_in_level([_ev(0, "lectura_enunciado", 0)])
    assert sum(r.values()) == 0.0


def test_time_in_level_dos_eventos_acumula_en_el_primero() -> None:
    """La duracion de un evento es delta hasta el siguiente."""
    events = [
        _ev(0, "lectura_enunciado", 0),
        _ev(1, "edicion_codigo", 90, {"origin": "student_typed"}),
    ]
    r = time_in_level(events)
    assert r["N1"] == 90.0
    assert r["N2"] == 0.0  # el ultimo evento aporta 0


def test_time_in_level_episodio_mixto() -> None:
    """Episodio realista: lectura → edicion → ejecucion → prompt → respuesta."""
    events = [
        _ev(0, "episodio_abierto", 0),
        _ev(1, "lectura_enunciado", 10, {"duration_seconds": 20}),
        _ev(2, "edicion_codigo", 30, {"origin": "student_typed"}),
        _ev(3, "codigo_ejecutado", 90),
        _ev(4, "prompt_enviado", 130, {"prompt_kind": "validacion"}),
        _ev(5, "tutor_respondio", 145),
        _ev(6, "episodio_cerrado", 160),
    ]
    r = time_in_level(events)
    # meta(0→10)=10 + N1(10→30)=20 + N2(30→90)=60 + N3(90→130)=40 + N4(130→145)=15 + N4(145→160)=15
    # episodio_cerrado es el ultimo → no aporta delta
    assert r["meta"] == 10.0
    assert r["N1"] == 20.0
    assert r["N2"] == 60.0
    assert r["N3"] == 40.0
    assert r["N4"] == 30.0
    assert sum(r.values()) == 160.0  # duracion total del episodio


def test_time_in_level_edicion_copiada_del_tutor_acumula_en_n4() -> None:
    """Override de origin afecta a `time_in_level`."""
    events = [
        _ev(0, "edicion_codigo", 0, {"origin": "copied_from_tutor"}),
        _ev(1, "codigo_ejecutado", 50),
    ]
    r = time_in_level(events)
    assert r["N4"] == 50.0  # la edicion fue copia del tutor → N4
    assert r["N2"] == 0.0


def test_time_in_level_eventos_desordenados_se_ordenan_por_seq() -> None:
    """`seq` es la fuente de orden, no la posicion en la lista."""
    events = [
        _ev(2, "codigo_ejecutado", 100),
        _ev(0, "lectura_enunciado", 0),
        _ev(1, "edicion_codigo", 50, {"origin": "student_typed"}),
    ]
    r = time_in_level(events)
    assert r["N1"] == 50.0
    assert r["N2"] == 50.0
    assert r["N3"] == 0.0  # el ejecutado quedo ultimo, no aporta delta


def test_time_in_level_clampa_deltas_negativos_a_cero() -> None:
    """Reloj de cliente desincronizado puede producir ts invertidos. No crashear."""
    base = datetime(2026, 9, 1, 10, 0, 0, tzinfo=UTC)
    events = [
        {
            "seq": 0,
            "event_type": "lectura_enunciado",
            "ts": (base + timedelta(seconds=100)).isoformat().replace("+00:00", "Z"),
            "payload": {},
        },
        {
            "seq": 1,
            "event_type": "edicion_codigo",
            "ts": base.isoformat().replace("+00:00", "Z"),  # mas viejo que el seq=0
            "payload": {"origin": "student_typed"},
        },
    ]
    r = time_in_level(events)
    assert r["N1"] == 0.0  # delta negativo → clamp 0


# ---------------------------------------------------------------------------
# n_level_distribution
# ---------------------------------------------------------------------------


def test_distribution_episodio_vacio() -> None:
    r = n_level_distribution([])
    assert r["labeler_version"] == LABELER_VERSION
    assert r["distribution_seconds"] == {
        "N1": 0.0,
        "N2": 0.0,
        "N3": 0.0,
        "N4": 0.0,
        "meta": 0.0,
    }
    assert r["distribution_ratio"] == {
        "N1": 0.0,
        "N2": 0.0,
        "N3": 0.0,
        "N4": 0.0,
        "meta": 0.0,
    }
    assert r["total_events_per_level"] == {"N1": 0, "N2": 0, "N3": 0, "N4": 0, "meta": 0}


def test_distribution_cuenta_eventos_y_ratios() -> None:
    """El conteo de eventos es por evento; los segundos son por delta."""
    events = [
        _ev(0, "lectura_enunciado", 0),
        _ev(1, "edicion_codigo", 100, {"origin": "student_typed"}),
        _ev(2, "edicion_codigo", 200, {"origin": "copied_from_tutor"}),  # N4
        _ev(3, "codigo_ejecutado", 300),
    ]
    r = n_level_distribution(events)

    counts = r["total_events_per_level"]
    assert counts["N1"] == 1  # lectura
    assert counts["N2"] == 1  # student_typed
    assert counts["N4"] == 1  # copied_from_tutor
    assert counts["N3"] == 1  # ejecutado
    assert counts["meta"] == 0

    secs = r["distribution_seconds"]
    assert secs["N1"] == 100.0  # lectura → edicion
    assert secs["N2"] == 100.0  # edicion student → edicion tutor
    assert secs["N4"] == 100.0  # edicion tutor → ejecutado
    assert secs["N3"] == 0.0  # ejecutado es el ultimo

    ratios = r["distribution_ratio"]
    assert abs(ratios["N1"] - 1 / 3) < 1e-9
    assert abs(ratios["N2"] - 1 / 3) < 1e-9
    assert abs(ratios["N4"] - 1 / 3) < 1e-9
    assert ratios["N3"] == 0.0
    assert sum(ratios.values()) == 1.0


def test_distribution_ratio_es_cero_si_total_es_cero() -> None:
    """Un solo evento → 0 segundos totales → ratios todos en 0 (no NaN)."""
    r = n_level_distribution([_ev(0, "lectura_enunciado", 0)])
    assert all(v == 0.0 for v in r["distribution_ratio"].values())
    assert r["total_events_per_level"]["N1"] == 1


def test_distribution_incluye_labeler_version() -> None:
    """El endpoint debe propagar la version para que el analisis empirico
    sepa con que reglas se generaron los datos. Si bumpea LABELER_VERSION,
    los consumidores ven el cambio."""
    r = n_level_distribution([_ev(0, "lectura_enunciado", 0)])
    assert r["labeler_version"] == LABELER_VERSION
    assert isinstance(r["labeler_version"], str)
