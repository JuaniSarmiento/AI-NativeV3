"""Schemas para Tarea Práctica (TP)."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TareaPracticaBase(BaseModel):
    codigo: str = Field(min_length=1, max_length=20)
    titulo: str = Field(min_length=2, max_length=200)
    enunciado: str = Field(min_length=1)
    inicial_codigo: str | None = Field(default=None, max_length=5000)
    fecha_inicio: datetime | None = None
    fecha_fin: datetime | None = None
    peso: Decimal = Field(default=Decimal("1.0"), ge=0, le=1)
    rubrica: dict[str, Any] | None = None

    @model_validator(mode="after")
    def check_dates(self) -> TareaPracticaBase:
        if (
            self.fecha_inicio is not None
            and self.fecha_fin is not None
            and self.fecha_fin <= self.fecha_inicio
        ):
            raise ValueError("fecha_fin debe ser posterior a fecha_inicio")
        return self


class TareaPracticaCreate(TareaPracticaBase):
    comision_id: UUID


class TareaPracticaUpdate(BaseModel):
    titulo: str | None = Field(default=None, min_length=2, max_length=200)
    enunciado: str | None = Field(default=None, min_length=1)
    inicial_codigo: str | None = Field(default=None, max_length=5000)
    fecha_inicio: datetime | None = None
    fecha_fin: datetime | None = None
    peso: Decimal | None = Field(default=None, ge=0, le=1)
    rubrica: dict[str, Any] | None = None


class TareaPracticaOut(TareaPracticaBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    comision_id: UUID
    estado: Literal["draft", "published", "archived"]
    version: int
    parent_tarea_id: UUID | None = None
    template_id: UUID | None = None
    has_drift: bool = False
    created_by: UUID
    created_at: datetime
    deleted_at: datetime | None = None


class TareaPracticaVersionRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    version: int
    estado: Literal["draft", "published", "archived"]
    titulo: str
    created_at: datetime
    is_current: bool
