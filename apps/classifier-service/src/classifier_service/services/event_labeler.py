"""Etiquetador de eventos por nivel analitico N1-N4 (componente C3.2 de la tesis).

ADR-020 - derivacion en lectura, funcion pura. NO almacena `n_level` en el
payload del evento (rompe self_hash y choca con append-only). Las reglas son
versionables via LABELER_VERSION: bumpear re-etiqueta historicos sin tocar el CTR.

Niveles (Tesis Seccion 4.3):
- N1: Comprension y planificacion (lectura del enunciado, anotaciones).
- N2: Elaboracion estrategica (escritura/edicion de codigo).
- N3: Validacion (ejecucion de codigo).
- N4: Interaccion con IA (prompts al tutor, respuestas recibidas, codigo
       copiado del tutor o pegado desde fuente externa).
- meta: apertura/cierre/abandono del episodio.

Override condicional para `edicion_codigo`: el payload trae `origin` con valores
"student_typed" | "copied_from_tutor" | "pasted_external" | None (legacy). Una
edicion copiada del tutor o pegada desde afuera se etiqueta N4 (la accion
proviene de una interaccion IA/externa, no es elaboracion propia del estudiante).

`anotacion_creada` se etiqueta N2 fijo en v1.0.0. La Tabla 4.1 de la tesis
asigna las anotaciones a N1 ("notas tomadas; reformulacion verbal en el
asistente") cuando ocurren durante la lectura del enunciado, y a N4
("apropiacion de argumento: reproduccion razonada de una explicacion del
asistente en produccion posterior propia") cuando ocurren tras una respuesta
del tutor. La asignacion N2 fija de v1.0.0 NO surge de la Tabla 4.1 sino que
es una decision de implementacion del labeler para no requerir clasificacion
semantica del contenido en esta version. El sesgo sistematico que esto introduce
(sub-reporta N1 y N4, sobre-reporta N2) esta documentado en el reporte
empirico (Seccion 17.3) y la migracion a override por contenido es agenda
del Eje B (clasificacion semantica) post-defensa. Cualquier cambio de la
asignacion fija obliga a bumpear LABELER_VERSION (ADR-020) y a actualizar
Seccion 19.5 de la tesis sobre el sesgo que se cierra.
"""

from __future__ import annotations

from datetime import datetime
from itertools import pairwise
from typing import Any, Literal

NLevel = Literal["N1", "N2", "N3", "N4", "meta"]

LABELER_VERSION = "1.0.0"

_MIN_EVENTS_FOR_DELTA = 2

EVENT_N_LEVEL_BASE: dict[str, NLevel] = {
    "episodio_abierto": "meta",
    "episodio_cerrado": "meta",
    "episodio_abandonado": "meta",
    "lectura_enunciado": "N1",
    "anotacion_creada": "N2",
    "edicion_codigo": "N2",
    "codigo_ejecutado": "N3",
    "prompt_enviado": "N4",
    "tutor_respondio": "N4",
    # ADR-019 (G3 Fase A): intento adverso del estudiante en su prompt al tutor.
    # Se mapea a N4 porque ocurre en la dimension de interaccion con la IA.
    "intento_adverso_detectado": "N4",
}

_EDICION_CODIGO_N4_ORIGINS = {"copied_from_tutor", "pasted_external"}


def label_event(event_type: str, payload: dict[str, Any] | None = None) -> NLevel:
    """Devuelve el nivel analitico de un evento.

    `event_type` desconocido devuelve "meta" como fallback conservador
    (mejor que crashear ante eventos legacy o experimentales del piloto).
    """
    base = EVENT_N_LEVEL_BASE.get(event_type)
    if base is None:
        return "meta"
    if event_type == "edicion_codigo":
        origin = (payload or {}).get("origin")
        if origin in _EDICION_CODIGO_N4_ORIGINS:
            return "N4"
    return base


def time_in_level(events: list[dict[str, Any]]) -> dict[NLevel, float]:
    """Suma duracion (segundos) acumulada por nivel a lo largo del episodio.

    La duracion de un evento es el delta hasta el evento siguiente. El ultimo
    evento aporta 0 (no hay siguiente). Asume `seq` ordenable; si los timestamps
    estan invertidos por reloj de cliente, el delta se clamp a 0.

    Episodios con < 2 eventos devuelven todos los niveles en 0.0.
    """
    durations: dict[NLevel, float] = {
        "N1": 0.0,
        "N2": 0.0,
        "N3": 0.0,
        "N4": 0.0,
        "meta": 0.0,
    }
    if len(events) < _MIN_EVENTS_FOR_DELTA:
        return durations

    sorted_events = sorted(events, key=lambda e: e["seq"])
    for current, nxt in pairwise(sorted_events):
        level = label_event(current["event_type"], current.get("payload"))
        delta = (_parse_ts(nxt["ts"]) - _parse_ts(current["ts"])).total_seconds()
        if delta < 0:
            delta = 0.0
        durations[level] += delta
    return durations


def n_level_distribution(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Distribucion completa para el endpoint /n-level-distribution.

    Devuelve `labeler_version`, `distribution_seconds` (segundos por nivel),
    `distribution_ratio` (fraccion del tiempo total), y `total_events_per_level`
    (cantidad de eventos por nivel). El ratio es 0.0 si el episodio tiene 0
    duracion (un solo evento, o todos al mismo timestamp).
    """
    durations = time_in_level(events)
    counts: dict[NLevel, int] = {"N1": 0, "N2": 0, "N3": 0, "N4": 0, "meta": 0}
    for ev in events:
        counts[label_event(ev["event_type"], ev.get("payload"))] += 1

    total_seconds = sum(durations.values())
    if total_seconds > 0:
        ratios: dict[NLevel, float] = {
            level: secs / total_seconds for level, secs in durations.items()
        }
    else:
        ratios = dict.fromkeys(durations, 0.0)

    return {
        "labeler_version": LABELER_VERSION,
        "distribution_seconds": durations,
        "distribution_ratio": ratios,
        "total_events_per_level": counts,
    }


def _parse_ts(ts: str | datetime) -> datetime:
    if isinstance(ts, datetime):
        return ts
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))
