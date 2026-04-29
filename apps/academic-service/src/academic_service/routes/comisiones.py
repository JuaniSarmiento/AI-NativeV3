"""Endpoints de Comisiones y Periodos."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from academic_service.auth import User, get_db, require_permission
from academic_service.schemas import (
    ComisionCreate,
    ComisionOut,
    ComisionUpdate,
    ListMeta,
    ListResponse,
    PeriodoCreate,
    PeriodoOut,
    PeriodoUpdate,
)
from academic_service.services import ComisionService, PeriodoService

periodos_router = APIRouter(prefix="/api/v1/periodos", tags=["periodos"])
comisiones_router = APIRouter(prefix="/api/v1/comisiones", tags=["comisiones"])


# ── Periodos ───────────────────────────────────────────


@periodos_router.post("", response_model=PeriodoOut, status_code=status.HTTP_201_CREATED)
async def create_periodo(
    data: PeriodoCreate,
    user: User = Depends(require_permission("periodo", "create")),
    db: AsyncSession = Depends(get_db),
) -> PeriodoOut:
    svc = PeriodoService(db)
    obj = await svc.create(data, user)
    return PeriodoOut.model_validate(obj)


@periodos_router.get("", response_model=ListResponse[PeriodoOut])
async def list_periodos(
    limit: int = Query(50, ge=1, le=200),
    cursor: UUID | None = None,
    user: User = Depends(require_permission("periodo", "read")),
    db: AsyncSession = Depends(get_db),
) -> ListResponse[PeriodoOut]:
    svc = PeriodoService(db)
    objs = await svc.list(limit=limit, cursor=cursor)
    items = [PeriodoOut.model_validate(o) for o in objs]
    next_cursor = str(objs[-1].id) if len(objs) == limit else None
    return ListResponse(data=items, meta=ListMeta(cursor_next=next_cursor))


@periodos_router.patch("/{periodo_id}", response_model=PeriodoOut)
async def update_periodo(
    periodo_id: UUID,
    data: PeriodoUpdate,
    user: User = Depends(require_permission("periodo", "update")),
    db: AsyncSession = Depends(get_db),
) -> PeriodoOut:
    svc = PeriodoService(db)
    obj = await svc.update(periodo_id, data, user)
    return PeriodoOut.model_validate(obj)


@periodos_router.delete("/{periodo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_periodo(
    periodo_id: UUID,
    user: User = Depends(require_permission("periodo", "delete")),
    db: AsyncSession = Depends(get_db),
) -> None:
    svc = PeriodoService(db)
    await svc.soft_delete(periodo_id, user)


# ── Comisiones ────────────────────────────────────────


@comisiones_router.post("", response_model=ComisionOut, status_code=status.HTTP_201_CREATED)
async def create_comision(
    data: ComisionCreate,
    user: User = Depends(require_permission("comision", "create")),
    db: AsyncSession = Depends(get_db),
) -> ComisionOut:
    svc = ComisionService(db)
    obj = await svc.create(data, user)
    return ComisionOut.model_validate(obj)


@comisiones_router.get("", response_model=ListResponse[ComisionOut])
async def list_comisiones(
    limit: int = Query(50, ge=1, le=200),
    cursor: UUID | None = None,
    materia_id: UUID | None = None,
    periodo_id: UUID | None = None,
    user: User = Depends(require_permission("comision", "read")),
    db: AsyncSession = Depends(get_db),
) -> ListResponse[ComisionOut]:
    svc = ComisionService(db)
    objs = await svc.list(limit=limit, cursor=cursor, materia_id=materia_id, periodo_id=periodo_id)
    items = [ComisionOut.model_validate(o) for o in objs]
    next_cursor = str(objs[-1].id) if len(objs) == limit else None
    return ListResponse(data=items, meta=ListMeta(cursor_next=next_cursor))


@comisiones_router.get("/mis", response_model=ListResponse[ComisionOut])
async def list_my_comisiones(
    limit: int = Query(50, ge=1, le=200),
    cursor: UUID | None = None,
    user: User = Depends(require_permission("comision", "read")),
    db: AsyncSession = Depends(get_db),
) -> ListResponse[ComisionOut]:
    """Devuelve las comisiones donde el user tiene un rol activo.

    El endpoint busca matches en `usuarios_comision` (docente, jtp,
    auxiliar, etc.). Para inscripciones de estudiantes ver
    `/api/v1/inscripciones?student_pseudonym=...` — la separación es
    deliberada: el estudiante se identifica por pseudónimo opaco y no
    debe enumerar comisiones por user_id.
    """
    svc = ComisionService(db)
    objs = await svc.list_for_user(user_id=user.id, limit=limit, cursor=cursor)
    items = [ComisionOut.model_validate(o) for o in objs]
    next_cursor = str(objs[-1].id) if len(objs) == limit else None
    return ListResponse(data=items, meta=ListMeta(cursor_next=next_cursor))


@comisiones_router.get("/{comision_id}", response_model=ComisionOut)
async def get_comision(
    comision_id: UUID,
    user: User = Depends(require_permission("comision", "read")),
    db: AsyncSession = Depends(get_db),
) -> ComisionOut:
    svc = ComisionService(db)
    obj = await svc.get(comision_id)
    return ComisionOut.model_validate(obj)


@comisiones_router.patch("/{comision_id}", response_model=ComisionOut)
async def update_comision(
    comision_id: UUID,
    data: ComisionUpdate,
    user: User = Depends(require_permission("comision", "update")),
    db: AsyncSession = Depends(get_db),
) -> ComisionOut:
    svc = ComisionService(db)
    obj = await svc.update(comision_id, data, user)
    return ComisionOut.model_validate(obj)


@comisiones_router.delete("/{comision_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comision(
    comision_id: UUID,
    user: User = Depends(require_permission("comision", "delete")),
    db: AsyncSession = Depends(get_db),
) -> None:
    svc = ComisionService(db)
    await svc.soft_delete(comision_id, user)
