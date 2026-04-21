"""Schemas para Periodo y Comisión."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PeriodoBase(BaseModel):
    codigo: str = Field(min_length=4, max_length=20)  # ej. "2026-S1"
    nombre: str = Field(min_length=2, max_length=100)
    fecha_inicio: date
    fecha_fin: date
    estado: Literal["abierto", "cerrado"] = "abierto"

    @model_validator(mode="after")
    def check_dates(self) -> PeriodoBase:
        if self.fecha_fin <= self.fecha_inicio:
            raise ValueError("fecha_fin debe ser posterior a fecha_inicio")
        return self


class PeriodoCreate(PeriodoBase):
    pass


class PeriodoOut(PeriodoBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    created_at: datetime


class ComisionBase(BaseModel):
    codigo: str = Field(min_length=1, max_length=50)
    cupo_maximo: int = Field(ge=1, le=500, default=50)
    horario: dict[str, Any] = Field(default_factory=dict)
    ai_budget_monthly_usd: Decimal = Field(default=Decimal("100.00"), ge=0, le=10000)


class ComisionCreate(ComisionBase):
    materia_id: UUID
    periodo_id: UUID


class ComisionUpdate(BaseModel):
    cupo_maximo: int | None = Field(default=None, ge=1, le=500)
    horario: dict[str, Any] | None = None
    ai_budget_monthly_usd: Decimal | None = Field(default=None, ge=0, le=10000)


class ComisionOut(ComisionBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    materia_id: UUID
    periodo_id: UUID
    curso_config_hash: str | None = None
    created_at: datetime
    deleted_at: datetime | None = None
