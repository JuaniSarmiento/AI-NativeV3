"""Service de Comisión.

Valida que el período esté abierto antes de crear, que la materia
pertenezca al tenant del user, y emite ComisionCreada al bus.
"""
from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from academic_service.auth.dependencies import User
from academic_service.models import AuditLog, Comision, Periodo
from academic_service.repositories import (
    ComisionRepository,
    MateriaRepository,
    PeriodoRepository,
)
from academic_service.schemas.comision import (
    ComisionCreate,
    ComisionUpdate,
    PeriodoCreate,
)


class PeriodoService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = PeriodoRepository(session)

    async def create(self, data: PeriodoCreate, user: User) -> Periodo:
        new_id = uuid4()
        periodo = await self.repo.create({
            "id": new_id,
            "tenant_id": user.tenant_id,
            "codigo": data.codigo,
            "nombre": data.nombre,
            "fecha_inicio": data.fecha_inicio,
            "fecha_fin": data.fecha_fin,
            "estado": data.estado,
        })
        audit = AuditLog(
            tenant_id=user.tenant_id,
            user_id=user.id,
            action="periodo.create",
            resource_type="periodo",
            resource_id=new_id,
            changes={"after": data.model_dump(mode="json")},
        )
        self.session.add(audit)
        await self.session.flush()
        return periodo

    async def list(
        self, limit: int = 50, cursor: UUID | None = None
    ) -> list[Periodo]:
        return await self.repo.list(limit=limit, cursor=cursor)

    async def get(self, id_: UUID) -> Periodo:
        return await self.repo.get_or_404(id_)


class ComisionService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = ComisionRepository(session)
        self.materias = MateriaRepository(session)
        self.periodos = PeriodoRepository(session)

    async def create(self, data: ComisionCreate, user: User) -> Comision:
        # 1. Validar que la materia existe (RLS la filtra por tenant)
        materia = await self.materias.get_or_404(data.materia_id)

        # 2. Validar que el periodo está abierto
        periodo = await self.periodos.get_or_404(data.periodo_id)
        if periodo.estado != "abierto":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No se pueden crear comisiones en el periodo '{periodo.codigo}' (estado: {periodo.estado})",
            )

        # 3. Crear
        new_id = uuid4()
        comision = await self.repo.create({
            "id": new_id,
            "tenant_id": user.tenant_id,
            "materia_id": materia.id,
            "periodo_id": periodo.id,
            "codigo": data.codigo,
            "cupo_maximo": data.cupo_maximo,
            "horario": data.horario,
            "ai_budget_monthly_usd": data.ai_budget_monthly_usd,
        })

        audit = AuditLog(
            tenant_id=user.tenant_id,
            user_id=user.id,
            action="comision.create",
            resource_type="comision",
            resource_id=new_id,
            changes={"after": data.model_dump(mode="json")},
        )
        self.session.add(audit)
        await self.session.flush()

        # TODO F3: publish ComisionCreada event al bus
        return comision

    async def update(
        self, id_: UUID, data: ComisionUpdate, user: User
    ) -> Comision:
        obj = await self.repo.get_or_404(id_)
        changes = data.model_dump(exclude_unset=True, exclude_none=True)
        for k, v in changes.items():
            setattr(obj, k, v)

        audit = AuditLog(
            tenant_id=obj.tenant_id,
            user_id=user.id,
            action="comision.update",
            resource_type="comision",
            resource_id=id_,
            changes={"after": changes},
        )
        self.session.add(audit)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def get(self, id_: UUID) -> Comision:
        return await self.repo.get_or_404(id_)

    async def list(
        self,
        limit: int = 50,
        cursor: UUID | None = None,
        materia_id: UUID | None = None,
        periodo_id: UUID | None = None,
    ) -> list[Comision]:
        filters: dict = {}
        if materia_id:
            filters["materia_id"] = materia_id
        if periodo_id:
            filters["periodo_id"] = periodo_id
        return await self.repo.list(limit=limit, cursor=cursor, filters=filters)
