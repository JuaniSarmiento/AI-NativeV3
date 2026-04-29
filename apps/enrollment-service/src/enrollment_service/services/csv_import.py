"""Servicio de importación masiva de inscripciones desde CSV.

Flujo:
  1. POST /imports      → sube CSV, valida en dry-run, devuelve import_id + errores
  2. GET  /imports/{id} → estado de la importación
  3. POST /imports/{id}/commit → aplica cambios en transacción única

Formato CSV esperado:
  student_pseudonym,comision_codigo,rol,fecha_inscripcion
  00000000-...,Algebra-II-A,regular,2026-03-01

Ver docs/imports/enrollment-csv-format.md para detalle completo.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import pandas as pd


@dataclass
class ImportError:
    row_number: int
    field: str
    message: str


@dataclass
class ImportValidationResult:
    total_rows: int = 0
    valid_rows: int = 0
    errors: list[ImportError] = field(default_factory=list)
    preview: list[dict[str, Any]] = field(default_factory=list)  # primeras 10 filas OK


REQUIRED_COLUMNS = {"student_pseudonym", "comision_codigo", "rol", "fecha_inscripcion"}
VALID_ROLES = {"regular", "oyente", "reinscripcion"}


def validate_csv_bytes(content: bytes) -> ImportValidationResult:
    """Valida el CSV y devuelve errores por fila sin tocar la DB."""
    result = ImportValidationResult()

    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        result.errors.append(ImportError(0, "file", f"CSV malformado: {e}"))
        return result

    # Verificar columnas
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        result.errors.append(
            ImportError(0, "header", f"Faltan columnas: {', '.join(sorted(missing))}")
        )
        return result

    result.total_rows = len(df)

    for idx, row in df.iterrows():
        row_num = int(idx) + 2  # +2 porque idx=0 es la primera fila post-header
        row_errors: list[ImportError] = []

        # student_pseudonym
        try:
            from uuid import UUID

            UUID(str(row["student_pseudonym"]))
        except (ValueError, TypeError):
            row_errors.append(ImportError(row_num, "student_pseudonym", "no es UUID válido"))

        # rol
        if row["rol"] not in VALID_ROLES:
            row_errors.append(
                ImportError(
                    row_num,
                    "rol",
                    f"debe ser uno de {sorted(VALID_ROLES)}",
                )
            )

        # fecha_inscripcion
        try:
            date.fromisoformat(str(row["fecha_inscripcion"]))
        except ValueError:
            row_errors.append(
                ImportError(row_num, "fecha_inscripcion", "formato inválido (esperado YYYY-MM-DD)")
            )

        # comision_codigo
        if not str(row["comision_codigo"]).strip():
            row_errors.append(ImportError(row_num, "comision_codigo", "vacío"))

        if row_errors:
            result.errors.extend(row_errors)
        else:
            result.valid_rows += 1
            if len(result.preview) < 10:
                result.preview.append(row.to_dict())

    return result
