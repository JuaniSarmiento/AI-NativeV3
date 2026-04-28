"""Service de Tarea Práctica Template (ADR-016).

Plantilla canónica de TP por `(materia_id, periodo_id)`. Introducida por
ADR-016 para que una cátedra con múltiples comisiones mantenga una única
fuente editable del enunciado/rúbrica/peso. Al crear un template, se
auto-instancian `TareaPractica` en cada comisión de la (materia, periodo).

Invariantes críticas (coherentes con `TareaPracticaService`):

- Publicados/archivados son **inmutables** — PATCH sobre no-draft → 409.
- El `problema_id` que viaja por el CTR apunta a la **instancia**, no al
  template: esta capa nunca toca la cadena criptográfica (ADR-010).
- Soft delete del template NO borra las instancias (serían evidencia CTR).
- Detección de colisión de `codigo` contra TPs pre-existentes de las
  comisiones antes del fan-out: si alguna ya tiene una TP con ese código,
  abortamos la transacción con 409 listando las comisiones conflictivas,
  en vez de hacer un fan-out parcial (ADR-016 > Consecuencias > Conflicto
  codigo con TP huérfanas).
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from academic_service.auth.dependencies import User
from academic_service.models import (
    AuditLog,
    Comision,
    TareaPractica,
    TareaPracticaTemplate,
)
from academic_service.repositories import (
    TareaPracticaRepository,
    TareaPracticaTemplateRepository,
)
from academic_service.schemas.tarea_practica_template import (
    TareaPracticaTemplateCreate,
    TareaPracticaTemplateUpdate,
)

logger = logging.getLogger(__name__)


class TareaPracticaTemplateService:
    """CRUD + fan-out + versionado de `TareaPracticaTemplate`."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = TareaPracticaTemplateRepository()
        self.tp_repo = TareaPracticaRepository(session)

    # ------------------------------------------------------------------
    # Helpers internos
    # ------------------------------------------------------------------

    async def _get_template_or_404(
        self, template_id: UUID, tenant_id: UUID
    ) -> TareaPracticaTemplate:
        obj = await self.repo.get_by_id(self.session, tenant_id, template_id)
        if obj is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="TareaPracticaTemplate no encontrada",
            )
        return obj

    async def _comisiones_ids_for_materia_periodo(
        self, tenant_id: UUID, materia_id: UUID, periodo_id: UUID
    ) -> list[UUID]:
        stmt = select(Comision.id).where(
            Comision.tenant_id == tenant_id,
            Comision.materia_id == materia_id,
            Comision.periodo_id == periodo_id,
            Comision.deleted_at.is_(None),
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def _comisiones_with_conflicting_codigo(
        self,
        tenant_id: UUID,
        comision_ids: list[UUID],
        codigo: str,
    ) -> list[UUID]:
        """Devuelve las comisiones cuyo set ya contiene una TP con ese `codigo`.

        Filtra `deleted_at IS NULL`: una TP soft-deleted no bloquea. No filtra
        por `template_id` — CUALQUIER TP con ese `codigo` genera conflicto
        (ADR-016: conflicto contra TP huérfanas también aborta).
        """
        if not comision_ids:
            return []
        stmt = select(TareaPractica.comision_id).where(
            TareaPractica.tenant_id == tenant_id,
            TareaPractica.comision_id.in_(comision_ids),
            TareaPractica.codigo == codigo,
            TareaPractica.deleted_at.is_(None),
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    def _add_audit(
        self,
        *,
        tenant_id: UUID,
        user_id: UUID,
        action: str,
        resource_id: UUID,
        changes: dict[str, Any] | None = None,
    ) -> None:
        self.session.add(
            AuditLog(
                tenant_id=tenant_id,
                user_id=user_id,
                action=action,
                resource_type="tarea_practica_template",
                resource_id=resource_id,
                changes=changes,
            )
        )

    def _add_instance_audit(
        self,
        *,
        tenant_id: UUID,
        user_id: UUID,
        tarea_id: UUID,
        template_id: UUID,
        comision_id: UUID,
    ) -> None:
        self.session.add(
            AuditLog(
                tenant_id=tenant_id,
                user_id=user_id,
                action="tarea_practica.create_from_template",
                resource_type="tarea_practica",
                resource_id=tarea_id,
                changes={
                    "tarea_id": str(tarea_id),
                    "template_id": str(template_id),
                    "comision_id": str(comision_id),
                },
            )
        )

    # ------------------------------------------------------------------
    # CRUD público
    # ------------------------------------------------------------------

    async def create(
        self, data: TareaPracticaTemplateCreate, user: User
    ) -> TareaPracticaTemplate:
        """Crea template + auto-instancia una TP en cada comisión de la materia+periodo.

        Si alguna comisión ya tiene una `TareaPractica` con el mismo `codigo`,
        aborta con 409 (sin crear template ni instancias parciales).
        """
        comision_ids = await self._comisiones_ids_for_materia_periodo(
            user.tenant_id, data.materia_id, data.periodo_id
        )

        # Chequeo de colisión ANTES del INSERT del template. Evita fan-out
        # parcial y CHECK violations en `uq_tarea_codigo_version`.
        conflictivas = await self._comisiones_with_conflicting_codigo(
            user.tenant_id, comision_ids, data.codigo
        )
        if conflictivas:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "codigo_conflict",
                    "comisiones": [str(c) for c in conflictivas],
                },
            )

        # 1) Template
        template = await self.repo.create(
            self.session,
            user.tenant_id,
            {
                "id": uuid4(),
                "materia_id": data.materia_id,
                "periodo_id": data.periodo_id,
                "codigo": data.codigo,
                "titulo": data.titulo,
                "enunciado": data.enunciado,
                "inicial_codigo": data.inicial_codigo,
                "rubrica": data.rubrica,
                "peso": data.peso,
                "fecha_inicio": data.fecha_inicio,
                "fecha_fin": data.fecha_fin,
                "estado": "draft",
                "version": 1,
                "parent_template_id": None,
            },
            user.id,
        )

        # 2) Fan-out de instancias
        instances_created = 0
        for comision_id in comision_ids:
            new_tp_id = uuid4()
            await self.tp_repo.create({
                "id": new_tp_id,
                "tenant_id": user.tenant_id,
                "comision_id": comision_id,
                "codigo": data.codigo,
                "titulo": data.titulo,
                "enunciado": data.enunciado,
                "inicial_codigo": data.inicial_codigo,
                "fecha_inicio": data.fecha_inicio,
                "fecha_fin": data.fecha_fin,
                "peso": data.peso,
                "rubrica": data.rubrica,
                "estado": "draft",
                "version": 1,
                "parent_tarea_id": None,
                "template_id": template.id,
                "has_drift": False,
                "created_by": user.id,
            })
            self._add_instance_audit(
                tenant_id=user.tenant_id,
                user_id=user.id,
                tarea_id=new_tp_id,
                template_id=template.id,
                comision_id=comision_id,
            )
            instances_created += 1

        # 3) Audit log del template
        self._add_audit(
            tenant_id=user.tenant_id,
            user_id=user.id,
            action="tarea_practica_template.create",
            resource_id=template.id,
            changes={
                "template_id": str(template.id),
                "materia_id": str(data.materia_id),
                "periodo_id": str(data.periodo_id),
                "instances_created": instances_created,
            },
        )
        await self.session.flush()
        return template

    async def get(
        self, template_id: UUID, tenant_id: UUID
    ) -> TareaPracticaTemplate:
        return await self._get_template_or_404(template_id, tenant_id)

    async def update(
        self,
        template_id: UUID,
        patch: TareaPracticaTemplateUpdate,
        user: User,
    ) -> TareaPracticaTemplate:
        """PATCH sobre draft. Templates publicados/archivados son inmutables.

        NO toca instancias — el docente decide cómo propagar via `new_version`.
        """
        obj = await self._get_template_or_404(template_id, user.tenant_id)
        if obj.estado != "draft":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Template en estado '{obj.estado}' es inmutable; "
                    "cree una nueva versión"
                ),
            )

        changes = patch.model_dump(exclude_unset=True, exclude_none=True)
        for k, v in changes.items():
            setattr(obj, k, v)

        self._add_audit(
            tenant_id=obj.tenant_id,
            user_id=user.id,
            action="tarea_practica_template.update",
            resource_id=template_id,
            changes={"after": changes},
        )
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def publish(
        self, template_id: UUID, user: User
    ) -> TareaPracticaTemplate:
        """Marca template como published. NO publica instancias."""
        obj = await self._get_template_or_404(template_id, user.tenant_id)
        if obj.estado == "published":
            return obj
        if obj.estado != "draft":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"No se puede publicar un template en estado '{obj.estado}'; "
                    "cree una nueva versión"
                ),
            )

        obj.estado = "published"
        self._add_audit(
            tenant_id=obj.tenant_id,
            user_id=user.id,
            action="tarea_practica_template.publish",
            resource_id=template_id,
            changes={"estado": {"before": "draft", "after": "published"}},
        )
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def archive(
        self, template_id: UUID, user: User
    ) -> TareaPracticaTemplate:
        """Marca template como archived. No archiva instancias."""
        obj = await self._get_template_or_404(template_id, user.tenant_id)
        if obj.estado == "archived":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El template ya está archivado",
            )

        before = obj.estado
        obj.estado = "archived"
        self._add_audit(
            tenant_id=obj.tenant_id,
            user_id=user.id,
            action="tarea_practica_template.archive",
            resource_id=template_id,
            changes={"estado": {"before": before, "after": "archived"}},
        )
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def new_version(
        self,
        template_id: UUID,
        patch: TareaPracticaTemplateUpdate,
        user: User,
        *,
        reinstance_non_drifted: bool = False,
    ) -> TareaPracticaTemplate:
        """Crea v+1 del template. Las instancias sin drift opcionalmente se re-instancian.

        Las instancias con `has_drift=true` NUNCA se re-instancian (el drift
        bloquea el auto-upgrade; decisión consciente del ADR-016).
        """
        parent = await self._get_template_or_404(template_id, user.tenant_id)
        overrides = patch.model_dump(exclude_unset=True, exclude_none=True)

        # Nueva versión del template (siempre en draft)
        new_template = await self.repo.create(
            self.session,
            user.tenant_id,
            {
                "id": uuid4(),
                "materia_id": parent.materia_id,
                "periodo_id": parent.periodo_id,
                "codigo": parent.codigo,
                "titulo": overrides.get("titulo", parent.titulo),
                "enunciado": overrides.get("enunciado", parent.enunciado),
                "inicial_codigo": overrides.get(
                    "inicial_codigo", parent.inicial_codigo
                ),
                "rubrica": overrides.get("rubrica", parent.rubrica),
                "peso": overrides.get("peso", parent.peso),
                "fecha_inicio": overrides.get("fecha_inicio", parent.fecha_inicio),
                "fecha_fin": overrides.get("fecha_fin", parent.fecha_fin),
                "estado": "draft",
                "version": parent.version + 1,
                "parent_template_id": parent.id,
            },
            user.id,
        )

        reinstanced_count = 0
        if reinstance_non_drifted:
            # Instancias vigentes del template viejo
            stmt = select(TareaPractica).where(
                TareaPractica.tenant_id == user.tenant_id,
                TareaPractica.template_id == parent.id,
                TareaPractica.deleted_at.is_(None),
            )
            result = await self.session.execute(stmt)
            instances = list(result.scalars().all())

            for inst in instances:
                if inst.has_drift:
                    logger.warning(
                        "Instance %s skipped: has_drift=true", inst.id,
                    )
                    continue
                new_tp_id = uuid4()
                await self.tp_repo.create({
                    "id": new_tp_id,
                    "tenant_id": user.tenant_id,
                    "comision_id": inst.comision_id,
                    "codigo": parent.codigo,
                    "titulo": overrides.get("titulo", inst.titulo),
                    "enunciado": overrides.get("enunciado", inst.enunciado),
                    "inicial_codigo": overrides.get(
                        "inicial_codigo", inst.inicial_codigo
                    ),
                    "fecha_inicio": overrides.get(
                        "fecha_inicio", inst.fecha_inicio
                    ),
                    "fecha_fin": overrides.get("fecha_fin", inst.fecha_fin),
                    "peso": overrides.get("peso", inst.peso),
                    "rubrica": overrides.get("rubrica", inst.rubrica),
                    "estado": "draft",
                    "version": inst.version + 1,
                    "parent_tarea_id": inst.id,
                    "template_id": new_template.id,
                    "has_drift": False,
                    "created_by": user.id,
                })
                reinstanced_count += 1

        self._add_audit(
            tenant_id=user.tenant_id,
            user_id=user.id,
            action="tarea_practica_template.new_version",
            resource_id=new_template.id,
            changes={
                "old_id": str(parent.id),
                "new_id": str(new_template.id),
                "reinstanced_count": reinstanced_count,
            },
        )
        await self.session.flush()
        return new_template

    async def list_instances(
        self, template_id: UUID, tenant_id: UUID
    ) -> list[TareaPractica]:
        """Lista las instancias vigentes del template."""
        # Valida que el template exista (y pertenezca al tenant) antes de
        # listar; evita devolver `[]` falso positivo para un id inexistente.
        await self._get_template_or_404(template_id, tenant_id)
        return await self.repo.list_instances(
            self.session, tenant_id, template_id
        )

    async def list_versions(
        self, template_id: UUID, tenant_id: UUID
    ) -> list[dict[str, Any]]:
        """Devuelve la cadena de versiones con flag `is_current` en la última no archivada."""
        await self._get_template_or_404(template_id, tenant_id)
        chain = await self.repo.list_versions(
            self.session, tenant_id, template_id
        )

        # "current" = la mayor versión no archivada (si existe).
        non_archived = [t for t in chain if t.estado != "archived"]
        current_id: UUID | None = None
        if non_archived:
            current_id = max(non_archived, key=lambda t: t.version).id

        return [
            {
                "id": t.id,
                "version": t.version,
                "estado": t.estado,
                "created_at": t.created_at,
                "is_current": t.id == current_id,
            }
            for t in chain
        ]

    async def soft_delete(
        self, template_id: UUID, user: User
    ) -> TareaPracticaTemplate:
        """Soft-delete del template. NO borra instancias (evidencia CTR)."""
        obj = await self._get_template_or_404(template_id, user.tenant_id)

        # Contar instancias vigentes ANTES de soft-delete — para audit log.
        instances = await self.repo.list_instances(
            self.session, user.tenant_id, template_id
        )
        instances_remaining = len(instances)

        await self.repo.soft_delete(self.session, obj)

        self._add_audit(
            tenant_id=obj.tenant_id,
            user_id=user.id,
            action="tarea_practica_template.delete",
            resource_id=template_id,
            changes={
                "template_id": str(template_id),
                "instances_remaining": instances_remaining,
            },
        )
        await self.session.flush()
        return obj

    # `list` se define al final para no shadowar el builtin `list[X]` en las
    # anotaciones de retorno de los métodos previos (mypy lo detecta).
    async def list(
        self,
        tenant_id: UUID,
        materia_id: UUID | None = None,
        periodo_id: UUID | None = None,
        estado: str | None = None,
    ) -> list[TareaPracticaTemplate]:
        """Lista templates del tenant. Si `materia_id` es None, listar todo."""
        stmt = select(TareaPracticaTemplate).where(
            TareaPracticaTemplate.tenant_id == tenant_id,
            TareaPracticaTemplate.deleted_at.is_(None),
        )
        if materia_id is not None:
            stmt = stmt.where(TareaPracticaTemplate.materia_id == materia_id)
        if periodo_id is not None:
            stmt = stmt.where(TareaPracticaTemplate.periodo_id == periodo_id)
        if estado is not None:
            stmt = stmt.where(TareaPracticaTemplate.estado == estado)
        stmt = stmt.order_by(
            TareaPracticaTemplate.codigo, TareaPracticaTemplate.version
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
