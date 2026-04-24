"""Schemas para Tarea Práctica Template (ADR-016).

Plantilla canónica de TP por (Materia, Período). La instancia por comisión
(`TareaPractica`) mantiene su `problema_id` estable para la cadena CTR;
el template solo provee la fuente única editable de enunciado/rúbrica/peso
que la cátedra replica en todas sus comisiones.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from academic_service.schemas.tarea_practica import TareaPracticaOut


class TareaPracticaTemplateBase(BaseModel):
    titulo: str = Field(min_length=2, max_length=200)
    enunciado: str = Field(min_length=1)
    inicial_codigo: str | None = Field(default=None, max_length=5000)
    fecha_inicio: datetime | None = None
    fecha_fin: datetime | None = None
    peso: Decimal = Field(default=Decimal("1.0"), ge=0, le=1)
    rubrica: dict[str, Any] | None = None

    @model_validator(mode="after")
    def check_dates(self) -> TareaPracticaTemplateBase:
        if (
            self.fecha_inicio is not None
            and self.fecha_fin is not None
            and self.fecha_fin <= self.fecha_inicio
        ):
            raise ValueError("fecha_fin debe ser posterior a fecha_inicio")
        return self


class TareaPracticaTemplateCreate(TareaPracticaTemplateBase):
    materia_id: UUID
    periodo_id: UUID
    codigo: str = Field(min_length=1, max_length=20)


class TareaPracticaTemplateUpdate(BaseModel):
    titulo: str | None = Field(default=None, min_length=2, max_length=200)
    enunciado: str | None = Field(default=None, min_length=1)
    inicial_codigo: str | None = Field(default=None, max_length=5000)
    fecha_inicio: datetime | None = None
    fecha_fin: datetime | None = None
    peso: Decimal | None = Field(default=None, ge=0, le=1)
    rubrica: dict[str, Any] | None = None


class TareaPracticaTemplateOut(TareaPracticaTemplateBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    materia_id: UUID
    periodo_id: UUID
    codigo: str
    estado: Literal["draft", "published", "archived"]
    version: int
    parent_template_id: UUID | None = None
    created_by: UUID
    created_at: datetime
    deleted_at: datetime | None = None


class TareaPracticaTemplateVersionRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    version: int
    estado: str
    created_at: datetime
    is_current: bool


class TareaPracticaInstancesResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    template_id: UUID
    instances: list[TareaPracticaOut]
