"""CII evolution longitudinal — slope ordinal de apropiacion entre episodios analogos (ADR-018).

Implementa la version minima de la `cii_evolution_longitudinal` para
el piloto UNSL: dado un estudiante con N>=3 episodios cerrados sobre el
mismo `template_id` (problemas analogos definidos por ADR-016), calcula
el slope de la regresion lineal sobre `APPROPRIATION_ORDINAL[appropriation]`
ordenados por `classified_at`.

Slope > 0 = el estudiante mejora longitudinalmente sobre ese problema.
Slope < 0 = el estudiante empeora.
Slope ~ 0 = estable.

NO incluye `cii_criteria_stability` ni `cii_transfer_effective` (Seccion 15.4
los menciona pero requieren NLP — agenda futura piloto-2).

Funcion pura: input lista de classifications con template_id + appropriation +
classified_at, output dict con slope per-template + mean_slope. Testeable
bit-exact con golden inputs sin DB.

LABELER_VERSION (renombrado por consistencia con ADR-020 a CII_LONGITUDINAL_VERSION)
identifica que reglas se usaron para calcular. Bumpear cambia la estructura del
output en `Classification.features['cii_evolution_longitudinal']`; los datos
viejos quedan etiquetados con la version anterior.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from platform_ops.longitudinal import APPROPRIATION_ORDINAL

CII_LONGITUDINAL_VERSION = "1.0.0"

# Minimo de episodios sobre el mismo template para calcular slope.
# Con N=2 el slope es trivial (linea entre 2 puntos), con N=1 indefinido.
# La tesis Seccion 15.4 dice "longitudinal" sin numero exacto; 3 es defendible.
MIN_EPISODES_FOR_LONGITUDINAL = 3


def _coerce_ts(ts: Any) -> datetime:
    """Convierte timestamp a datetime. Acepta str ISO-8601 o datetime."""
    if isinstance(ts, datetime):
        return ts
    return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))


def _compute_slope_ordinal(scores: list[int]) -> float:
    """Regresion lineal simple sobre scores ordinales (xs = 0..N-1).

    Mismo algoritmo que `cii.py::compute_cii::evolution`, pero sin la
    normalizacion final a [0, 1]. Slope crudo es interpretable como
    "cuantas categorias ordinales sube por episodio en promedio".
    """
    n = len(scores)
    xs = list(range(n))
    mean_x = sum(xs) / n
    mean_y = sum(scores) / n
    num = sum((xs[i] - mean_x) * (scores[i] - mean_y) for i in range(n))
    den = sum((xs[i] - mean_x) ** 2 for i in range(n))
    return num / den if den > 0 else 0.0


def compute_evolution_per_template(
    classifications: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Agrupa por `template_id` y calcula slope por grupo.

    Args:
        classifications: lista de dicts con al menos las claves:
            - `template_id`: UUID o str (None se SKIPPEA — TPs huerfanas
              no entran al calculo).
            - `appropriation`: str ("delegacion_pasiva" | "apropiacion_superficial"
              | "apropiacion_reflexiva").
            - `classified_at`: datetime o str ISO-8601.

    Returns:
        Lista de dicts, uno por template_id distinto que tenga al menos
        1 episodio asociado. Cada dict tiene:
            - `template_id`: el UUID/str del template.
            - `n_episodes`: int, cantidad de episodios en el grupo.
            - `scores_ordinal`: list[int], scores 0/1/2 ordenados por classified_at.
            - `slope`: float | None. None si N < MIN_EPISODES_FOR_LONGITUDINAL.
            - `insufficient_data`: bool, True si N < MIN.

    Cero side-effects, idempotente. Templates con N<3 igual aparecen en el
    output con `slope=null` para visibilidad — el caller decide si filtrarlos.
    """
    # Agrupar por template_id; saltear los que no tengan template (None).
    groups: dict[Any, list[dict[str, Any]]] = {}
    for c in classifications:
        template_id = c.get("template_id")
        if template_id is None:
            continue
        groups.setdefault(template_id, []).append(c)

    result: list[dict[str, Any]] = []
    for template_id, items in groups.items():
        # Ordenar por classified_at ascendente
        items_sorted = sorted(items, key=lambda c: _coerce_ts(c["classified_at"]))
        scores = [
            APPROPRIATION_ORDINAL[c["appropriation"]]
            for c in items_sorted
            if c.get("appropriation") in APPROPRIATION_ORDINAL
        ]
        n = len(scores)

        entry: dict[str, Any] = {
            "template_id": template_id,
            "n_episodes": n,
            "scores_ordinal": scores,
        }
        if n < MIN_EPISODES_FOR_LONGITUDINAL:
            entry["slope"] = None
            entry["insufficient_data"] = True
        else:
            entry["slope"] = _compute_slope_ordinal(scores)
            entry["insufficient_data"] = False
        result.append(entry)

    return result


def compute_mean_slope(per_template: list[dict[str, Any]]) -> float | None:
    """Promedio de slopes de templates con N >= MIN_EPISODES_FOR_LONGITUDINAL.

    Templates con `slope=None` (insufficient data) se excluyen. None si
    ningun template del estudiante tiene N>=3.
    """
    valid_slopes = [entry["slope"] for entry in per_template if entry.get("slope") is not None]
    if not valid_slopes:
        return None
    return sum(valid_slopes) / len(valid_slopes)


def compute_cii_evolution_longitudinal(
    classifications: list[dict[str, Any]],
) -> dict[str, Any]:
    """Helper de alto nivel: combina ambas funciones + metadata.

    Devuelve estructura completa lista para serializar al endpoint analytics
    o para persistir en `Classification.features['cii_evolution_longitudinal']`.
    """
    per_template = compute_evolution_per_template(classifications)
    mean_slope = compute_mean_slope(per_template)

    n_groups_evaluated = sum(1 for entry in per_template if not entry.get("insufficient_data"))
    n_groups_insufficient = len(per_template) - n_groups_evaluated
    n_episodes_total = sum(entry["n_episodes"] for entry in per_template)

    return {
        "n_groups_evaluated": n_groups_evaluated,
        "n_groups_insufficient": n_groups_insufficient,
        "n_episodes_total": n_episodes_total,
        "evolution_per_template": per_template,
        "mean_slope": mean_slope,
        "sufficient_data": mean_slope is not None,
        "labeler_version": CII_LONGITUDINAL_VERSION,
    }
