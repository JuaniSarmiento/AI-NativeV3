"""Adaptador DB real para exportación académica + análisis longitudinal.

Reemplaza los `_StubDataSource` de F7 con queries reales que respetan
la arquitectura de 3 bases lógicas:

  - **ctr_store**: episodes + events (con RLS por tenant)
  - **classifier_db**: classifications (con RLS por tenant)

Ambas DBs se acceden con **sesiones separadas** (ADR-005). El adaptador
abre dos sesiones, una por DB, y las coordina. RLS se activa seteando
`SET LOCAL app.current_tenant` al inicio de cada transacción.

Uso:
    async with get_ctr_session() as ctr_s, get_classifier_session() as cls_s:
        ds = RealDataSource(
            ctr_session=ctr_s,
            classifier_session=cls_s,
            tenant_id=tenant_id,
        )
        dataset = await exporter.export_cohort(...)

Los tests de este módulo usan SQLite in-memory (sin RLS real, pero
suficiente para verificar la lógica de joins y filtros).
"""
from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class RealCohortDataSource:
    """DataSource real que implementa la interface del AcademicExporter.

    Requiere dos sesiones (ctr_store + classifier_db) ya con el RLS
    aplicado vía `SET LOCAL app.current_tenant = '<uuid>'`.
    """

    def __init__(
        self,
        ctr_session: AsyncSession,
        classifier_session: AsyncSession,
        tenant_id: UUID,
    ) -> None:
        self.ctr = ctr_session
        self.classifier = classifier_session
        self.tenant_id = tenant_id

    async def list_episodes_in_comision(
        self, comision_id: UUID, since: datetime
    ) -> list[dict]:
        """Lista episodios de la comisión abiertos desde `since`.

        RLS filtra automáticamente por tenant; el WHERE doble es
        defensivo (patrón recomendado en ADR-007).
        """
        # Import late para evitar ciclos en testing
        from ctr_service.models import Episode

        stmt = (
            select(Episode)
            .where(Episode.comision_id == comision_id)
            .where(Episode.tenant_id == self.tenant_id)  # doble filtro
            .where(Episode.opened_at >= since)
            .order_by(Episode.opened_at.asc())
        )
        result = await self.ctr.execute(stmt)
        episodes = result.scalars().all()
        return [
            {
                "id": ep.id,
                "comision_id": ep.comision_id,
                "student_pseudonym": ep.student_pseudonym,
                "problema_id": getattr(ep, "problema_id", None),
                "opened_at": ep.opened_at,
            }
            for ep in episodes
        ]

    async def list_events_for_episode(self, episode_id: UUID) -> list[dict]:
        """Lista los eventos de un episodio, ordenados por seq."""
        from ctr_service.models import Event

        stmt = (
            select(Event)
            .where(Event.episode_id == episode_id)
            .where(Event.tenant_id == self.tenant_id)  # doble filtro
            .order_by(Event.seq.asc())
        )
        result = await self.ctr.execute(stmt)
        events = result.scalars().all()
        return [
            {
                "seq": ev.seq,
                "event_type": ev.event_type,
                "ts": ev.ts.isoformat().replace("+00:00", "Z") if ev.ts else None,
                "payload": ev.payload or {},
            }
            for ev in events
        ]

    async def get_current_classification(
        self, episode_id: UUID
    ) -> dict | None:
        """Obtiene la clasificación actual (`is_current=true`) de un episodio."""
        from classifier_service.models import Classification

        stmt = (
            select(Classification)
            .where(Classification.episode_id == episode_id)
            .where(Classification.tenant_id == self.tenant_id)
            .where(Classification.is_current.is_(True))
            .order_by(Classification.classified_at.desc())
            .limit(1)
        )
        result = await self.classifier.execute(stmt)
        c = result.scalar_one_or_none()
        if c is None:
            return None
        return {
            "appropriation": c.appropriation,
            "appropiation": c.appropriation,  # compat con academic_export.py
            "classifier_config_hash": c.classifier_config_hash,
            "ct_summary": c.ct_summary,
            "ccd_mean": c.ccd_mean,
            "ccd_orphan_ratio": c.ccd_orphan_ratio,
            "cii_stability": c.cii_stability,
            "cii_evolution": c.cii_evolution,
        }


class RealLongitudinalDataSource:
    """DataSource real para análisis longitudinal.

    La query clave cruza episodes (para obtener student_pseudonym) con
    classifications (para las etiquetas) y agrupa por estudiante.
    """

    def __init__(
        self,
        ctr_session: AsyncSession,
        classifier_session: AsyncSession,
        tenant_id: UUID,
        pseudonymize_fn=None,
    ) -> None:
        self.ctr = ctr_session
        self.classifier = classifier_session
        self.tenant_id = tenant_id
        # Si se provee, las filas se anonimizan (útil para endpoint público)
        self.pseudonymize_fn = pseudonymize_fn

    async def list_classifications_grouped_by_student(
        self, comision_id: UUID
    ) -> dict[str, list[dict]]:
        """Devuelve {student_alias: [classification_dict, ...]}.

        La agrupación por estudiante se hace en Python en vez de SQL
        porque las dos tablas viven en DBs distintas (3-base pattern).
        Esto es OK para cohortes del piloto (<500 episodios).
        """
        from classifier_service.models import Classification
        from ctr_service.models import Episode

        # 1. Traer episodios de la comisión para resolver episode_id →
        #    student_pseudonym.
        ep_stmt = (
            select(Episode.id, Episode.student_pseudonym)
            .where(Episode.comision_id == comision_id)
            .where(Episode.tenant_id == self.tenant_id)
        )
        ep_result = await self.ctr.execute(ep_stmt)
        ep_to_student: dict[UUID, UUID] = {
            row.id: row.student_pseudonym for row in ep_result.all()
        }
        if not ep_to_student:
            return {}

        # 2. Traer clasificaciones current de esos episodios
        cls_stmt = (
            select(Classification)
            .where(Classification.comision_id == comision_id)
            .where(Classification.tenant_id == self.tenant_id)
            .where(Classification.is_current.is_(True))
            .where(Classification.episode_id.in_(ep_to_student.keys()))
            .order_by(Classification.classified_at.asc())
        )
        cls_result = await self.classifier.execute(cls_stmt)

        # 3. Agrupar por estudiante
        grouped: dict[str, list[dict]] = {}
        for c in cls_result.scalars().all():
            student_pseudo = ep_to_student.get(c.episode_id)
            if student_pseudo is None:
                continue  # episodio de otra comisión (shouldn't happen con RLS)

            alias = (
                self.pseudonymize_fn(student_pseudo)
                if self.pseudonymize_fn
                else str(student_pseudo)
            )
            grouped.setdefault(alias, []).append({
                "episode_id": c.episode_id,
                "classified_at": c.classified_at,
                "appropriation": c.appropriation,
                "ct_summary": c.ct_summary,
                "ccd_mean": c.ccd_mean,
                "ccd_orphan_ratio": c.ccd_orphan_ratio,
                "cii_stability": c.cii_stability,
                "cii_evolution": c.cii_evolution,
            })

        return grouped


# ── Helper para setear RLS ────────────────────────────────────────────


async def set_tenant_rls(session: AsyncSession, tenant_id: UUID) -> None:
    """Setea el tenant_id para que RLS filtre automáticamente.

    Debe llamarse al inicio de cada transacción. SET LOCAL dura solo
    hasta el final de la transacción actual — por eso rollbacks + new
    txn necesitan re-setearlo.
    """
    from sqlalchemy import text
    # SET LOCAL no admite bind parameters (Postgres utility statement).
    # Interpolamos literal: tenant_id es UUID validado por type hint,
    # no puede contener comillas ni caracteres que inyecten SQL.
    await session.execute(text(f"SET LOCAL app.current_tenant = '{tenant_id}'"))


__all__ = [
    "RealCohortDataSource",
    "RealLongitudinalDataSource",
    "set_tenant_rls",
]
