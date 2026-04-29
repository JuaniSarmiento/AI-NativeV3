"""Schemas para Inscripcion (estudiante en una comisión).

ADR-029 (B.1, 2026-04-29): inscripciones se sumaron al bulk-import de
academic-service para destrabar el alta masiva via CSV. El endpoint de
enrollment-service `POST /api/v1/imports` queda deprecated por ADR-030.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class InscripcionBase(BaseModel):
    rol: Literal["regular", "oyente", "reinscripcion"] = "regular"
    estado: Literal["activa", "cursando", "aprobado", "desaprobado", "abandono"] = "activa"
    fecha_inscripcion: date


class InscripcionCreate(InscripcionBase):
    """Payload para crear una inscripcion (CSV bulk o REST).

    El `student_pseudonym` se acepta como UUID — debe ser pre-derivado por
    enrollment / federacion LDAP antes de llegar al CSV. La identidad real
    vive en Keycloak (no en este monorepo).
    """

    comision_id: UUID
    student_pseudonym: UUID
    nota_final: Decimal | None = Field(default=None, ge=0, le=10)
    fecha_cierre: date | None = None


class InscripcionOut(InscripcionBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    comision_id: UUID
    student_pseudonym: UUID
    nota_final: Decimal | None = None
    fecha_cierre: date | None = None
    created_at: datetime
