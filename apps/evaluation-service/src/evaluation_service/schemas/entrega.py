"""Schemas Pydantic para Entrega y Calificacion."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class EjercicioEstadoSchema(BaseModel):
    """Estado de un ejercicio dentro de una Entrega."""

    orden: int
    episode_id: UUID | None = None
    completado: bool = False
    completed_at: datetime | None = None


class EntregaCreate(BaseModel):
    """Request de creacion de Entrega (draft).

    Idempotente: si ya existe una entrega para este (tarea_practica_id,
    student_pseudonym), el endpoint devuelve la existente.
    """

    tarea_practica_id: UUID
    comision_id: UUID


class EntregaOut(BaseModel):
    """Respuesta de Entrega."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    tarea_practica_id: UUID
    student_pseudonym: UUID
    comision_id: UUID
    estado: Literal["draft", "submitted", "graded", "returned"]
    ejercicio_estados: list[dict[str, Any]] = Field(default_factory=list)
    submitted_at: datetime | None = None
    created_at: datetime
    deleted_at: datetime | None = None


class CriterioCalificacion(BaseModel):
    criterio: str
    puntaje: Decimal
    max_puntaje: Decimal
    comentario: str | None = None


class MarkEjercicioBody(BaseModel):
    completado: bool = True
    episode_id: UUID | None = None


class CalificacionCreate(BaseModel):
    nota_final: Decimal = Field(ge=0, le=10)
    feedback_general: str | None = None
    detalle_criterios: list[CriterioCalificacion] = Field(default_factory=list)


class CalificacionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    entrega_id: UUID
    graded_by: UUID
    nota_final: Decimal
    feedback_general: str | None = None
    detalle_criterios: list[dict[str, Any]] = Field(default_factory=list)
    graded_at: datetime
    created_at: datetime


class EntregaListMeta(BaseModel):
    """Metadata de paginacion para `GET /api/v1/entregas`.

    Cursor-based: `cursor_next` es el `id` (UUID) de la ultima entrega del
    batch actual; pasarlo como `?cursor=<uuid>&limit=<n>` en la siguiente
    llamada para continuar. `null` cuando no hay mas paginas.
    """

    cursor_next: str | None = None
    total: int | None = None
    limit: int


class EntregaListResponse(BaseModel):
    """Envelope de respuesta paginada para `GET /api/v1/entregas`.

    BC-incompatible vs v1.0 (lista plana). Frontends consumers tienen que
    leer `body.data` en vez de iterar el body directo.
    """

    data: list[EntregaOut]
    meta: EntregaListMeta
