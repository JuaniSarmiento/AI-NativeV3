"""Endpoints de Tarea Práctica Template (ADR-016).

Plantilla canónica de TP por `(materia_id, periodo_id)`. Al crear o
versionar un template se fan-out-ean instancias `TareaPractica` en cada
comisión de esa materia+periodo, manteniendo el `problema_id` de cada
instancia estable para la cadena CTR. Los campos canónicos del template
heredan a la instancia; una edición en la instancia dispara
`has_drift=True` en esa fila (sin afectar al template ni a las demás
comisiones).

Todos los endpoints exigen `X-Tenant-Id` + `X-User-Id` inyectados por
api-gateway (o por los vite proxies en dev_trust_headers). El permiso
Casbin `tarea_practica_template:<action>` se verifica en `require_permission`.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from academic_service.auth import User, get_db, require_permission
from academic_service.schemas.tarea_practica import TareaPracticaOut
from academic_service.schemas.tarea_practica_template import (
    TareaPracticaInstancesResponse,
    TareaPracticaTemplateCreate,
    TareaPracticaTemplateOut,
    TareaPracticaTemplateUpdate,
    TareaPracticaTemplateVersionRef,
)
from academic_service.services.tarea_practica_template_service import (
    TareaPracticaTemplateService,
)

router = APIRouter(
    prefix="/api/v1/tareas-practicas-templates",
    tags=["tareas-practicas-templates"],
)


class NewVersionRequest(BaseModel):
    """Body del endpoint `new-version`: patch + flag de re-instanciación."""

    patch: TareaPracticaTemplateUpdate
    reinstance_non_drifted: bool = False


@router.post(
    "",
    response_model=TareaPracticaTemplateOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_template(
    data: TareaPracticaTemplateCreate,
    user: User = Depends(require_permission("tarea_practica_template", "create")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaTemplateOut:
    svc = TareaPracticaTemplateService(db)
    obj = await svc.create(data, user)
    return TareaPracticaTemplateOut.model_validate(obj)


@router.get("", response_model=list[TareaPracticaTemplateOut])
async def list_templates(
    materia_id: UUID | None = Query(default=None),
    periodo_id: UUID | None = Query(default=None),
    estado: Literal["draft", "published", "archived"] | None = Query(default=None),
    user: User = Depends(require_permission("tarea_practica_template", "read")),
    db: AsyncSession = Depends(get_db),
) -> list[TareaPracticaTemplateOut]:
    svc = TareaPracticaTemplateService(db)
    objs = await svc.list(
        tenant_id=user.tenant_id,
        materia_id=materia_id,
        periodo_id=periodo_id,
        estado=estado,
    )
    return [TareaPracticaTemplateOut.model_validate(o) for o in objs]


@router.get("/{template_id}", response_model=TareaPracticaTemplateOut)
async def get_template(
    template_id: UUID,
    user: User = Depends(require_permission("tarea_practica_template", "read")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaTemplateOut:
    svc = TareaPracticaTemplateService(db)
    obj = await svc.get(template_id, user.tenant_id)
    return TareaPracticaTemplateOut.model_validate(obj)


@router.patch("/{template_id}", response_model=TareaPracticaTemplateOut)
async def update_template(
    template_id: UUID,
    data: TareaPracticaTemplateUpdate,
    user: User = Depends(require_permission("tarea_practica_template", "update")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaTemplateOut:
    svc = TareaPracticaTemplateService(db)
    obj = await svc.update(template_id, data, user)
    return TareaPracticaTemplateOut.model_validate(obj)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: UUID,
    user: User = Depends(require_permission("tarea_practica_template", "delete")),
    db: AsyncSession = Depends(get_db),
) -> None:
    svc = TareaPracticaTemplateService(db)
    await svc.soft_delete(template_id, user)


@router.post("/{template_id}/publish", response_model=TareaPracticaTemplateOut)
async def publish_template(
    template_id: UUID,
    user: User = Depends(require_permission("tarea_practica_template", "update")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaTemplateOut:
    svc = TareaPracticaTemplateService(db)
    obj = await svc.publish(template_id, user)
    return TareaPracticaTemplateOut.model_validate(obj)


@router.post("/{template_id}/archive", response_model=TareaPracticaTemplateOut)
async def archive_template(
    template_id: UUID,
    user: User = Depends(require_permission("tarea_practica_template", "update")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaTemplateOut:
    svc = TareaPracticaTemplateService(db)
    obj = await svc.archive(template_id, user)
    return TareaPracticaTemplateOut.model_validate(obj)


@router.post(
    "/{template_id}/new-version",
    response_model=TareaPracticaTemplateOut,
    status_code=status.HTTP_201_CREATED,
)
async def new_version_template(
    template_id: UUID,
    body: NewVersionRequest,
    user: User = Depends(require_permission("tarea_practica_template", "update")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaTemplateOut:
    svc = TareaPracticaTemplateService(db)
    obj = await svc.new_version(
        template_id,
        body.patch,
        user,
        reinstance_non_drifted=body.reinstance_non_drifted,
    )
    return TareaPracticaTemplateOut.model_validate(obj)


@router.get(
    "/{template_id}/instances",
    response_model=TareaPracticaInstancesResponse,
)
async def list_template_instances(
    template_id: UUID,
    user: User = Depends(require_permission("tarea_practica_template", "read")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaInstancesResponse:
    svc = TareaPracticaTemplateService(db)
    instances = await svc.list_instances(template_id, user.tenant_id)
    return TareaPracticaInstancesResponse(
        template_id=template_id,
        instances=[TareaPracticaOut.model_validate(i) for i in instances],
    )


@router.get(
    "/{template_id}/versions",
    response_model=list[TareaPracticaTemplateVersionRef],
)
async def list_template_versions(
    template_id: UUID,
    user: User = Depends(require_permission("tarea_practica_template", "read")),
    db: AsyncSession = Depends(get_db),
) -> list[TareaPracticaTemplateVersionRef]:
    svc = TareaPracticaTemplateService(db)
    versions = await svc.list_versions(template_id, user.tenant_id)
    return [TareaPracticaTemplateVersionRef.model_validate(v) for v in versions]
