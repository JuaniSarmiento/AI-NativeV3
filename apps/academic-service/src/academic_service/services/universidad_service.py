"""Service de Universidad.

Los services contienen lógica de dominio, coordinan repos, publican
eventos al bus y escriben el audit log. Los routers solo hacen
validación de request + llaman a services.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from academic_service.auth.dependencies import User
from academic_service.models import AuditLog, Universidad
from academic_service.repositories import CarreraRepository, UniversidadRepository
from academic_service.schemas.universidad import UniversidadCreate, UniversidadUpdate


class UniversidadService:
    """Universidades son entidades globales (no multi-tenant).

    Solo superadmin puede crearlas. Los docente_admin solo pueden leer/
    editar la propia universidad.
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = UniversidadRepository(session)
        self.carreras = CarreraRepository(session)

    async def create(self, data: UniversidadCreate, user: User) -> Universidad:
        # superadmin-only: chequeado en el router con require_permission
        new_id = uuid4()
        universidad = await self.repo.create(
            {
                "id": new_id,
                "nombre": data.nombre,
                "codigo": data.codigo,
                "dominio_email": data.dominio_email,
                "keycloak_realm": data.keycloak_realm,
                "config": data.config,
            }
        )
        # TODO F3: emitir UniversidadCreada al bus (Redis Streams)
        # await event_bus.publish(UniversidadCreada(...))
        return universidad

    async def update(self, id_: UUID, data: UniversidadUpdate, user: User) -> Universidad:
        # Verificar que el user puede editar ESTA universidad
        if "superadmin" not in user.roles and user.tenant_id != id_:
            from fastapi import HTTPException, status

            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo puede editar la propia universidad",
            )

        obj = await self.repo.get_or_404(id_)
        changes = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
        for k, v in changes.items():
            setattr(obj, k, v)

        # Audit log en la misma transacción
        audit = AuditLog(
            tenant_id=user.tenant_id,
            user_id=user.id,
            action="universidad.update",
            resource_type="universidad",
            resource_id=id_,
            changes={"after": changes},
        )
        self.session.add(audit)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def soft_delete(self, id_: UUID, user: User) -> Universidad:
        if "superadmin" not in user.roles:
            from fastapi import HTTPException, status

            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo superadmin puede eliminar universidades",
            )

        carreras_activas = await self.carreras.count(filters={"universidad_id": id_})
        if carreras_activas > 0:
            from fastapi import HTTPException, status

            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Universidad tiene {carreras_activas} carreras activas",
            )

        obj = await self.repo.soft_delete(id_)
        audit = AuditLog(
            tenant_id=user.tenant_id,
            user_id=user.id,
            action="universidad.delete",
            resource_type="universidad",
            resource_id=id_,
            changes={"soft_delete": True},
        )
        self.session.add(audit)
        await self.session.flush()
        return obj

    async def get(self, id_: UUID) -> Universidad:
        return await self.repo.get_or_404(id_)

    async def list(self, limit: int = 50, cursor: UUID | None = None) -> list[Universidad]:
        return await self.repo.list(limit=limit, cursor=cursor)
