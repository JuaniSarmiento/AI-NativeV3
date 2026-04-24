"""Endpoints de Materias."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from academic_service.auth import User, get_db, require_permission
from academic_service.schemas import (
    ListMeta,
    ListResponse,
    MateriaCreate,
    MateriaOut,
    MateriaUpdate,
)
from academic_service.services import MateriaService

router = APIRouter(prefix="/api/v1/materias", tags=["materias"])


@router.post("", response_model=MateriaOut, status_code=status.HTTP_201_CREATED)
async def create_materia(
    data: MateriaCreate,
    user: User = Depends(require_permission("materia", "create")),
    db: AsyncSession = Depends(get_db),
) -> MateriaOut:
    svc = MateriaService(db)
    obj = await svc.create(data, user)
    return MateriaOut.model_validate(obj)


@router.get("", response_model=ListResponse[MateriaOut])
async def list_materias(
    limit: int = Query(50, ge=1, le=200),
    cursor: UUID | None = None,
    plan_id: UUID | None = None,
    user: User = Depends(require_permission("materia", "read")),
    db: AsyncSession = Depends(get_db),
) -> ListResponse[MateriaOut]:
    svc = MateriaService(db)
    objs = await svc.list(limit=limit, cursor=cursor, plan_id=plan_id)
    items = [MateriaOut.model_validate(o) for o in objs]
    next_cursor = str(objs[-1].id) if len(objs) == limit else None
    return ListResponse(data=items, meta=ListMeta(cursor_next=next_cursor))


@router.get("/{materia_id}", response_model=MateriaOut)
async def get_materia(
    materia_id: UUID,
    user: User = Depends(require_permission("materia", "read")),
    db: AsyncSession = Depends(get_db),
) -> MateriaOut:
    svc = MateriaService(db)
    obj = await svc.get(materia_id)
    return MateriaOut.model_validate(obj)


@router.patch("/{materia_id}", response_model=MateriaOut)
async def update_materia(
    materia_id: UUID,
    data: MateriaUpdate,
    user: User = Depends(require_permission("materia", "update")),
    db: AsyncSession = Depends(get_db),
) -> MateriaOut:
    svc = MateriaService(db)
    obj = await svc.update(materia_id, data, user)
    return MateriaOut.model_validate(obj)


@router.delete("/{materia_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_materia(
    materia_id: UUID,
    user: User = Depends(require_permission("materia", "delete")),
    db: AsyncSession = Depends(get_db),
) -> None:
    svc = MateriaService(db)
    await svc.soft_delete(materia_id, user)
