"""Endpoints de Tareas Prácticas (TP)."""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from academic_service.auth import User, get_db, require_permission
from academic_service.schemas import ListMeta, ListResponse
from academic_service.schemas.tarea_practica import (
    TareaPracticaCreate,
    TareaPracticaOut,
    TareaPracticaUpdate,
    TareaPracticaVersionRef,
)
from academic_service.services.tarea_practica_service import TareaPracticaService

router = APIRouter(prefix="/api/v1/tareas-practicas", tags=["tareas-practicas"])


@router.post("", response_model=TareaPracticaOut, status_code=status.HTTP_201_CREATED)
async def create_tarea_practica(
    data: TareaPracticaCreate,
    user: User = Depends(require_permission("tarea_practica", "create")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaOut:
    svc = TareaPracticaService(db)
    obj = await svc.create(data, user)
    return TareaPracticaOut.model_validate(obj)


@router.get("", response_model=ListResponse[TareaPracticaOut])
async def list_tareas_practicas(
    limit: int = Query(50, ge=1, le=200),
    cursor: UUID | None = None,
    comision_id: UUID | None = None,
    estado: Literal["draft", "published", "archived"] | None = None,
    user: User = Depends(require_permission("tarea_practica", "read")),
    db: AsyncSession = Depends(get_db),
) -> ListResponse[TareaPracticaOut]:
    svc = TareaPracticaService(db)
    objs = await svc.list(
        comision_id=comision_id, estado=estado, limit=limit, cursor=cursor
    )
    items = [TareaPracticaOut.model_validate(o) for o in objs]
    next_cursor = str(objs[-1].id) if len(objs) == limit else None
    return ListResponse(data=items, meta=ListMeta(cursor_next=next_cursor))


@router.get("/{tarea_id}", response_model=TareaPracticaOut)
async def get_tarea_practica(
    tarea_id: UUID,
    user: User = Depends(require_permission("tarea_practica", "read")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaOut:
    svc = TareaPracticaService(db)
    obj = await svc.get(tarea_id)
    return TareaPracticaOut.model_validate(obj)


@router.patch("/{tarea_id}", response_model=TareaPracticaOut)
async def update_tarea_practica(
    tarea_id: UUID,
    data: TareaPracticaUpdate,
    user: User = Depends(require_permission("tarea_practica", "update")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaOut:
    svc = TareaPracticaService(db)
    obj = await svc.update(tarea_id, data, user)
    return TareaPracticaOut.model_validate(obj)


@router.delete("/{tarea_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tarea_practica(
    tarea_id: UUID,
    user: User = Depends(require_permission("tarea_practica", "delete")),
    db: AsyncSession = Depends(get_db),
) -> None:
    svc = TareaPracticaService(db)
    await svc.soft_delete(tarea_id, user)


@router.post("/{tarea_id}/publish", response_model=TareaPracticaOut)
async def publish_tarea_practica(
    tarea_id: UUID,
    user: User = Depends(require_permission("tarea_practica", "update")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaOut:
    svc = TareaPracticaService(db)
    obj = await svc.publish(tarea_id, user)
    return TareaPracticaOut.model_validate(obj)


@router.post("/{tarea_id}/archive", response_model=TareaPracticaOut)
async def archive_tarea_practica(
    tarea_id: UUID,
    user: User = Depends(require_permission("tarea_practica", "update")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaOut:
    svc = TareaPracticaService(db)
    obj = await svc.archive(tarea_id, user)
    return TareaPracticaOut.model_validate(obj)


@router.post(
    "/{tarea_id}/new-version",
    response_model=TareaPracticaOut,
    status_code=status.HTTP_201_CREATED,
)
async def new_version_tarea_practica(
    tarea_id: UUID,
    data: TareaPracticaUpdate,
    user: User = Depends(require_permission("tarea_practica", "create")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaOut:
    svc = TareaPracticaService(db)
    obj = await svc.new_version(tarea_id, data, user)
    return TareaPracticaOut.model_validate(obj)


@router.get("/{tarea_id}/versions", response_model=list[TareaPracticaVersionRef])
async def list_tarea_practica_versions(
    tarea_id: UUID,
    user: User = Depends(require_permission("tarea_practica", "read")),
    db: AsyncSession = Depends(get_db),
) -> list[TareaPracticaVersionRef]:
    svc = TareaPracticaService(db)
    chain = await svc.list_versions(tarea_id)

    latest_published_version: int | None = None
    for t in chain:
        if t.estado == "published":
            if latest_published_version is None or t.version > latest_published_version:
                latest_published_version = t.version

    if latest_published_version is not None:
        current_version = latest_published_version
    else:
        current_version = max(t.version for t in chain)

    return [
        TareaPracticaVersionRef(
            id=t.id,
            version=t.version,
            estado=t.estado,  # type: ignore[arg-type]
            titulo=t.titulo,
            created_at=t.created_at,
            is_current=(t.version == current_version),
        )
        for t in chain
    ]
