"""Coherencia Código-Discurso (CCD).

Definición operacional:
  Un "giro" ocurre cuando el estudiante, tras ejecutar código o recibir
  feedback del tutor, verbaliza explícitamente su comprensión/confusión
  (prompt_enviado con `prompt_kind=reflexion` o anotación explícita).

  - ccd_mean: promedio de "alineación" entre código ejecutado y giros verbales.
  - ccd_orphan_ratio: fracción de acciones (prompts o ejecuciones) que NO
    tienen un giro verbal correlacionado dentro de una ventana de 2 min.

Valores cercanos a 0 en ccd_orphan_ratio = buena coherencia.
Valores cercanos a 1 = muchas acciones "huérfanas" = baja apropiación.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any


CORRELATION_WINDOW = timedelta(minutes=2)
# Tiempo máximo entre acción y verbalización para considerarlas correlacionadas


@dataclass
class AlignmentPair:
    action_ts: datetime
    action_type: str  # "prompt_enviado" | "codigo_ejecutado"
    has_reflection: bool
    gap_seconds: float | None  # None si no hay reflexión en la ventana


def compute_ccd(events: list[dict]) -> dict[str, Any]:
    """Calcula ccd_mean y ccd_orphan_ratio a partir de la serie de eventos."""
    if not events:
        return {
            "ccd_mean": 0.5,
            "ccd_orphan_ratio": 0.0,
            "pairs": 0,
            "insufficient_data": True,
        }

    sorted_events = sorted(events, key=lambda e: e["seq"])

    # Acciones: prompt_enviado (no-reflexion) + codigo_ejecutado
    actions = [
        e for e in sorted_events
        if e["event_type"] == "codigo_ejecutado"
        or (
            e["event_type"] == "prompt_enviado"
            and (e.get("payload") or {}).get("prompt_kind") != "reflexion"
        )
    ]

    # Verbalizaciones reflexivas: anotacion_creada O prompt con kind=reflexion
    reflections = [
        e for e in sorted_events
        if e["event_type"] == "anotacion_creada"
        or (
            e["event_type"] == "prompt_enviado"
            and (e.get("payload") or {}).get("prompt_kind") == "reflexion"
        )
    ]

    if not actions:
        return {
            "ccd_mean": 0.5,
            "ccd_orphan_ratio": 0.0,
            "pairs": 0,
            "no_actions": True,
        }

    # Para cada acción, buscar la reflexión más cercana DENTRO de la ventana
    pairs: list[AlignmentPair] = []
    reflection_times = [_parse_ts(r["ts"]) for r in reflections]

    for action in actions:
        a_ts = _parse_ts(action["ts"])
        # Buscar reflexión en (a_ts, a_ts + window]
        candidates = [
            (r_ts - a_ts).total_seconds()
            for r_ts in reflection_times
            if a_ts < r_ts <= a_ts + CORRELATION_WINDOW
        ]
        if candidates:
            gap = min(candidates)
            pairs.append(AlignmentPair(
                action_ts=a_ts,
                action_type=action["event_type"],
                has_reflection=True,
                gap_seconds=gap,
            ))
        else:
            pairs.append(AlignmentPair(
                action_ts=a_ts,
                action_type=action["event_type"],
                has_reflection=False,
                gap_seconds=None,
            ))

    orphans = sum(1 for p in pairs if not p.has_reflection)
    orphan_ratio = orphans / len(pairs)

    # ccd_mean: qué tan "rápido" es el giro en las que SÍ se dan
    aligned = [p.gap_seconds for p in pairs if p.gap_seconds is not None]
    if aligned:
        avg_gap = sum(aligned) / len(aligned)
        # Normalizar: gap de 0s → 1.0, gap de 120s (tope) → 0.0
        ccd_mean = max(0.0, 1.0 - avg_gap / CORRELATION_WINDOW.total_seconds())
    else:
        ccd_mean = 0.0  # sin ninguna alineación

    return {
        "ccd_mean": ccd_mean,
        "ccd_orphan_ratio": orphan_ratio,
        "pairs": len(pairs),
        "aligned": len(aligned),
        "orphans": orphans,
        "avg_gap_seconds": sum(aligned) / len(aligned) if aligned else None,
    }


def _parse_ts(ts: str | datetime) -> datetime:
    if isinstance(ts, datetime):
        return ts
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))
