"""Service de Comisión.

Valida que el período esté abierto antes de crear, que la materia
pertenezca al tenant del user, y emite ComisionCreada al bus.
"""

from __future__ import annotations

import builtins
from datetime import date
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from academic_service.auth.dependencies import User
from academic_service.models import AuditLog, Comision, Periodo, UsuarioComision
from academic_service.repositories import (
    ComisionRepository,
    InscripcionRepository,
    MateriaRepository,
    PeriodoRepository,
)
from academic_service.schemas.comision import (
    ComisionCreate,
    ComisionUpdate,
    PeriodoCreate,
    PeriodoUpdate,
)


class PeriodoService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = PeriodoRepository(session)
        self.comisiones = ComisionRepository(session)

    async def _find_overlapping(
        self,
        fecha_inicio: date,
        fecha_fin: date,
        exclude_id: UUID | None = None,
    ) -> list[Periodo]:
        """Busca periodos soft-non-deleted que se solapen con el rango dado.

        Dos rangos [A.inicio, A.fin] y [B.inicio, B.fin] se solapan sii
        `A.inicio <= B.fin AND A.fin >= B.inicio`. Los adyacentes
        (A.fin == B.inicio) NO se consideran overlap — se usa `<` estricto
        en los extremos (A.inicio < B.fin AND A.fin > B.inicio) para
        permitir que el cierre de un periodo coincida con el inicio del
        siguiente.

        Respeta RLS: el tenant se aplica automáticamente vía
        `SET LOCAL app.current_tenant` en la sesión.
        """
        stmt = select(Periodo).where(
            and_(
                Periodo.deleted_at.is_(None),
                Periodo.fecha_inicio < fecha_fin,
                Periodo.fecha_fin > fecha_inicio,
            )
        )
        if exclude_id is not None:
            stmt = stmt.where(Periodo.id != exclude_id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create(self, data: PeriodoCreate, user: User) -> Periodo:
        overlapping = await self._find_overlapping(data.fecha_inicio, data.fecha_fin)
        if overlapping:
            codigos = ", ".join(p.codigo for p in overlapping)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(f"Las fechas solapan con periodo(s) existente(s): [{codigos}]"),
            )

        new_id = uuid4()
        periodo = await self.repo.create(
            {
                "id": new_id,
                "tenant_id": user.tenant_id,
                "codigo": data.codigo,
                "nombre": data.nombre,
                "fecha_inicio": data.fecha_inicio,
                "fecha_fin": data.fecha_fin,
                "estado": data.estado,
            }
        )
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

    async def list(self, limit: int = 50, cursor: UUID | None = None) -> list[Periodo]:
        return await self.repo.list(limit=limit, cursor=cursor)

    async def get(self, id_: UUID) -> Periodo:
        return await self.repo.get_or_404(id_)

    async def update(self, id_: UUID, data: PeriodoUpdate, user: User) -> Periodo:
        """Update parcial de periodo.

        Reglas:
        - Si el periodo ya está `cerrado`, no se permite ningún cambio
          (409 Conflict). El cierre es one-way para preservar el
          invariante CTR ("el CTR se sella al cierre del ciclo").
        - La transición `cerrado → abierto` NO está permitida (409).
        - `abierto → cerrado` OK.
        - `fecha_fin > fecha_inicio` si ambos están presentes (ya
          validado por el schema, pero además chequeamos contra los
          valores persistidos cuando solo uno está en el payload).
        - Emite audit log `periodo.update` (RN-016) con los campos
          modificados.
        """
        obj = await self.repo.get_or_404(id_)

        changes = data.model_dump(exclude_unset=True, exclude_none=True)

        # Si el periodo está cerrado, está frozen: no se puede editar nada.
        if obj.estado == "cerrado":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Periodo cerrado, no se puede modificar. "
                    "Si necesitás trazabilidad de un cambio, usá el audit log."
                ),
            )

        # Transición de estado: cerrado → abierto NO permitida.
        new_estado = changes.get("estado")
        if new_estado == "abierto" and obj.estado != "abierto":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "No se puede reabrir un periodo cerrado — "
                    "usar audit log si se necesita trazabilidad"
                ),
            )

        # Validar fecha_fin > fecha_inicio contra valores persistidos
        # cuando solo uno viene en el payload.
        new_inicio = changes.get("fecha_inicio", obj.fecha_inicio)
        new_fin = changes.get("fecha_fin", obj.fecha_fin)
        if new_fin <= new_inicio:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="fecha_fin debe ser posterior a fecha_inicio",
            )

        # Overlap check: si el PATCH toca fechas, verificar que no pisen
        # a otros periodos del tenant (excluyendo el propio).
        if "fecha_inicio" in changes or "fecha_fin" in changes:
            overlapping = await self._find_overlapping(new_inicio, new_fin, exclude_id=obj.id)
            if overlapping:
                codigos = ", ".join(p.codigo for p in overlapping)
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(f"Las fechas solapan con periodo(s) existente(s): [{codigos}]"),
                )

        for k, v in changes.items():
            setattr(obj, k, v)

        audit = AuditLog(
            tenant_id=obj.tenant_id,
            user_id=user.id,
            action="periodo.update",
            resource_type="periodo",
            resource_id=id_,
            changes={"after": changes},
        )
        self.session.add(audit)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def soft_delete(self, id_: UUID, user: User) -> Periodo:
        comisiones_activas = await self.comisiones.count(filters={"periodo_id": id_})
        if comisiones_activas > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Periodo tiene {comisiones_activas} comisiones activas",
            )

        obj = await self.repo.soft_delete(id_)
        audit = AuditLog(
            tenant_id=obj.tenant_id,
            user_id=user.id,
            action="periodo.delete",
            resource_type="periodo",
            resource_id=id_,
            changes={"soft_delete": True},
        )
        self.session.add(audit)
        await self.session.flush()
        return obj


class ComisionService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = ComisionRepository(session)
        self.materias = MateriaRepository(session)
        self.periodos = PeriodoRepository(session)
        self.inscripciones = InscripcionRepository(session)

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
        comision = await self.repo.create(
            {
                "id": new_id,
                "tenant_id": user.tenant_id,
                "materia_id": materia.id,
                "periodo_id": periodo.id,
                "codigo": data.codigo,
                "nombre": data.nombre,
                "cupo_maximo": data.cupo_maximo,
                "horario": data.horario,
                "ai_budget_monthly_usd": data.ai_budget_monthly_usd,
            }
        )

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

    async def update(self, id_: UUID, data: ComisionUpdate, user: User) -> Comision:
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

    async def soft_delete(self, id_: UUID, user: User) -> Comision:
        inscripciones_activas = await self.inscripciones.count(filters={"comision_id": id_})
        if inscripciones_activas > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Comisión tiene {inscripciones_activas} inscripciones activas",
            )

        obj = await self.repo.soft_delete(id_)
        audit = AuditLog(
            tenant_id=obj.tenant_id,
            user_id=user.id,
            action="comision.delete",
            resource_type="comision",
            resource_id=id_,
            changes={"soft_delete": True},
        )
        self.session.add(audit)
        await self.session.flush()
        return obj

    async def get(self, id_: UUID) -> Comision:
        return await self.repo.get_or_404(id_)

    async def list(
        self,
        limit: int = 50,
        cursor: UUID | None = None,
        materia_id: UUID | None = None,
        periodo_id: UUID | None = None,
    ) -> builtins.list[Comision]:
        filters: dict = {}
        if materia_id:
            filters["materia_id"] = materia_id
        if periodo_id:
            filters["periodo_id"] = periodo_id
        return await self.repo.list(limit=limit, cursor=cursor, filters=filters)

    async def list_for_user(
        self,
        user_id: UUID,
        limit: int = 50,
        cursor: UUID | None = None,
    ) -> builtins.list[Comision]:
        """Devuelve las Comisiones donde `user_id` tiene un rol activo.

        Sólo considera filas de `usuarios_comision` no soft-deleted. La
        ventana de vigencia (`fecha_desde`/`fecha_hasta`) NO se filtra
        acá: la responsabilidad de mostrar comisiones futuras o
        históricas queda en el front (selector). RLS del tenant aplica
        automáticamente vía `tenant_session()`.
        """
        stmt = (
            select(Comision)
            .join(UsuarioComision, UsuarioComision.comision_id == Comision.id)
            .where(
                UsuarioComision.user_id == user_id,
                UsuarioComision.deleted_at.is_(None),
                Comision.deleted_at.is_(None),
            )
        )
        if cursor:
            stmt = stmt.where(Comision.id > cursor)
        stmt = stmt.order_by(Comision.id).limit(limit)
        result = await self.session.execute(stmt)
        return list(result.scalars().unique().all())
