"""Schemas Pydantic compartidos para entidades academicas.

Incluye la validacion del JSONB de ejercicios de TareaPractica
(tp-entregas-correccion).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class EjercicioSchema(BaseModel):
    """Schema de un ejercicio dentro de TareaPractica.ejercicios JSONB.

    Validaciones obligatorias:
    - orden >= 1 (unico dentro del array; se valida en EjerciciosValidator)
    - peso > 0 y <= 1
    - titulo, enunciado_md requeridos
    """

    orden: int = Field(ge=1)
    titulo: str = Field(min_length=1, max_length=200)
    enunciado_md: str = Field(min_length=1)
    inicial_codigo: str | None = None
    test_cases: list[dict[str, Any]] = Field(default_factory=list)
    peso: Decimal = Field(gt=0, le=1)


class EjerciciosValidator(BaseModel):
    """Validator para el array completo de ejercicios.

    Reglas:
    1. ordenes deben ser unicos.
    2. suma de pesos debe ser 1.0 (tolerancia 0.001).
    3. ordenes deben ser consecutivos desde 1 (recomendado, no critico).
    """

    ejercicios: list[EjercicioSchema] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_ejercicios(self) -> EjerciciosValidator:
        if not self.ejercicios:
            return self

        ordenes = [e.orden for e in self.ejercicios]
        if len(ordenes) != len(set(ordenes)):
            raise ValueError("Los ordenes de ejercicios deben ser unicos")

        peso_total = sum(e.peso for e in self.ejercicios)
        if abs(float(peso_total) - 1.0) > 0.001:
            raise ValueError(
                f"La suma de pesos de ejercicios debe ser 1.0 (actual: {peso_total})"
            )

        return self
