"""Endpoint de retrieval RAG.

Este endpoint lo consume el tutor-service (F3) como fuente de contexto
ancla. También lo pueden llamar docentes directamente para testear el
funcionamiento del RAG sobre su cátedra.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from content_service.auth import RETRIEVAL_ROLES, User, get_db, require_role
from content_service.schemas import RetrievalRequest, RetrievalResponse
from content_service.services import RetrievalService

router = APIRouter(prefix="/api/v1", tags=["retrieval"])


@router.post("/retrieve", response_model=RetrievalResponse)
async def retrieve(
    request: RetrievalRequest,
    user: User = Depends(require_role(*RETRIEVAL_ROLES)),
    db: AsyncSession = Depends(get_db),
) -> RetrievalResponse:
    """Retrieval RAG filtrado estrictamente por comisión.

    El `comision_id` es mandatorio (validado en el schema). Los resultados
    pasan por filtro doble: RLS por tenant_id + WHERE comision_id explícito.

    Devuelve `chunks_used_hash` para que el tutor lo incluya en el evento
    `PromptEnviado` del CTR (trazabilidad reproducible).
    """
    svc = RetrievalService(db)
    return await svc.retrieve(request)
