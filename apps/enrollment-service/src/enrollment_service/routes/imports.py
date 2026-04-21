"""Endpoints de importación masiva."""
from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from enrollment_service.services import validate_csv_bytes

router = APIRouter(prefix="/api/v1/imports", tags=["imports"])

# In-memory store de importaciones en curso — en producción es Redis/DB
_imports_cache: dict[UUID, dict] = {}


class ImportErrorOut(BaseModel):
    row_number: int
    field: str
    message: str


class ImportResponse(BaseModel):
    import_id: UUID
    status: str  # "validated" | "failed" | "committed"
    total_rows: int
    valid_rows: int
    errors: list[ImportErrorOut]
    preview: list[dict]


@router.post("", response_model=ImportResponse, status_code=status.HTTP_201_CREATED)
async def upload_csv(file: UploadFile = File(...)) -> ImportResponse:
    if not file.filename or not file.filename.endswith((".csv", ".tsv")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Archivo debe ser .csv o .tsv",
        )

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:  # 10 MB
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Archivo excede 10 MB",
        )

    result = validate_csv_bytes(content)

    import_id = uuid4()
    _imports_cache[import_id] = {
        "content": content,
        "result": result,
        "status": "validated" if result.valid_rows > 0 else "failed",
    }

    return ImportResponse(
        import_id=import_id,
        status=_imports_cache[import_id]["status"],
        total_rows=result.total_rows,
        valid_rows=result.valid_rows,
        errors=[
            ImportErrorOut(
                row_number=e.row_number, field=e.field, message=e.message
            )
            for e in result.errors
        ],
        preview=result.preview,
    )


@router.post("/{import_id}/commit", response_model=ImportResponse)
async def commit_import(import_id: UUID) -> ImportResponse:
    cached = _imports_cache.get(import_id)
    if not cached:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Import {import_id} no encontrado",
        )
    if cached["status"] != "validated":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Import en estado '{cached['status']}', no se puede commitear",
        )

    # TODO F1-W7: aplicar realmente las inscripciones usando academic-service HTTP
    # Por ahora marcamos como committed sin persistir
    cached["status"] = "committed"

    result = cached["result"]
    return ImportResponse(
        import_id=import_id,
        status="committed",
        total_rows=result.total_rows,
        valid_rows=result.valid_rows,
        errors=[],
        preview=result.preview,
    )
