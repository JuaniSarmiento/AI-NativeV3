"""Pipeline: episodio cerrado → features → árbol → clasificación persistida.

El worker de classifier-service escucha eventos `episodio_cerrado`, carga
todos los eventos del episodio desde el ctr-service, calcula las 3
coherencias, aplica el árbol N4, y persiste la clasificación como fila
append-only en `classifications` con `is_current=true` (marcando la
anterior, si existía, como `is_current=false`).
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from classifier_service.models import Classification
from classifier_service.services.ccd import compute_ccd
from classifier_service.services.cii import compute_cii
from classifier_service.services.ct import ct_features
from classifier_service.services.tree import (
    DEFAULT_REFERENCE_PROFILE,
    ClassificationResult,
    classify,
)

logger = logging.getLogger(__name__)


def compute_classifier_config_hash(
    reference_profile: dict[str, Any], tree_version: str = "v1.0.0"
) -> str:
    """Hash determinista del config del classifier.

    Este hash acompaña cada clasificación (classifier_config_hash) y es lo
    que permite reproducir EXACTAMENTE el mismo resultado en el futuro.
    Si cambia el reference_profile o la versión del árbol, cambia el hash
    y toda reclasificación insert nueva fila append-only (ADR-010).
    """
    canonical = json.dumps(
        {"tree_version": tree_version, "profile": reference_profile},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def classify_episode_from_events(
    events: list[dict],
    reference_profile: dict[str, Any] | None = None,
) -> ClassificationResult:
    """Clasifica un episodio dado su lista de eventos.

    Esta función es pura y determinista: mismos eventos + mismo profile =
    misma clasificación.
    """
    profile = reference_profile or DEFAULT_REFERENCE_PROFILE
    ct = ct_features(events)
    ccd = compute_ccd(events)
    cii = compute_cii(events)
    return classify(ct=ct, ccd=ccd, cii=cii, reference_profile=profile)


async def persist_classification(
    session: AsyncSession,
    tenant_id: UUID,
    episode_id: UUID,
    comision_id: UUID,
    result: ClassificationResult,
    classifier_config_hash: str,
) -> Classification:
    """Persiste append-only (ADR-010).

    Si ya existe una fila con el mismo classifier_config_hash para este
    episode_id, devuelve la existente (idempotencia). Si existe con OTRO
    hash, marca is_current=false en la vieja e inserta la nueva.
    """
    # Marcar cualquier clasificación previa del mismo episodio como no-current
    await session.execute(
        update(Classification)
        .where(
            Classification.episode_id == episode_id,
            Classification.is_current.is_(True),
        )
        .values(is_current=False)
    )

    new_classification = Classification(
        tenant_id=tenant_id,
        episode_id=episode_id,
        comision_id=comision_id,
        classifier_config_hash=classifier_config_hash,
        appropriation=result.appropriation,
        appropriation_reason=result.reason,
        ct_summary=result.ct_summary,
        ccd_mean=result.ccd_mean,
        ccd_orphan_ratio=result.ccd_orphan_ratio,
        cii_stability=result.cii_stability,
        cii_evolution=result.cii_evolution,
        features=result.features,
        is_current=True,
    )
    session.add(new_classification)
    await session.flush()
    return new_classification
