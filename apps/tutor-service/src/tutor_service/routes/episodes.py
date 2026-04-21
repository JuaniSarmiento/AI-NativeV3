"""Endpoints HTTP del tutor-service.

POST /api/v1/episodes              crear episodio (devuelve episode_id)
POST /api/v1/episodes/{id}/message SSE con la respuesta del tutor
POST /api/v1/episodes/{id}/close   cerrar episodio (emite evento cierre)
"""
from __future__ import annotations

import json
from uuid import UUID

import redis.asyncio as redis
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from tutor_service.auth.dependencies import User, require_role
from tutor_service.config import settings
from tutor_service.services.clients import (
    AIGatewayClient,
    CTRClient,
    ContentClient,
    GovernanceClient,
)
from tutor_service.services.session import SessionManager
from tutor_service.services.tutor_core import TutorCore

router = APIRouter(prefix="/api/v1/episodes", tags=["tutor"])


_redis: redis.Redis | None = None
_tutor: TutorCore | None = None


def _get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _get_tutor() -> TutorCore:
    global _tutor
    if _tutor is None:
        _tutor = TutorCore(
            governance=GovernanceClient(settings.governance_service_url),
            content=ContentClient(settings.content_service_url),
            ai_gateway=AIGatewayClient(settings.ai_gateway_url),
            ctr=CTRClient(settings.ctr_service_url),
            sessions=SessionManager(_get_redis()),
            default_prompt_version=settings.default_prompt_version,
            default_model=settings.default_model,
        )
    return _tutor


# ── Schemas ─────────────────────────────────────────────────────────


class OpenEpisodeRequest(BaseModel):
    comision_id: UUID
    problema_id: UUID
    curso_config_hash: str = Field(min_length=64, max_length=64)
    classifier_config_hash: str = Field(min_length=64, max_length=64)


class OpenEpisodeResponse(BaseModel):
    episode_id: UUID


class MessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=10000)


class CloseEpisodeRequest(BaseModel):
    reason: str = "student_closed"


# ── Endpoints ────────────────────────────────────────────────────────


@router.post("", response_model=OpenEpisodeResponse, status_code=status.HTTP_201_CREATED)
async def open_episode(
    req: OpenEpisodeRequest,
    user: User = Depends(require_role("estudiante", "docente", "docente_admin", "superadmin")),
) -> OpenEpisodeResponse:
    """Abre un episodio respetando feature flags del tenant.

    F6: consulta los flags del tenant para:
      - Modelo LLM (`enable_claude_opus` → opus; sino → sonnet)
      - Enforcement de `max_episodes_per_day` (deferred a F7 cuando tengamos
        contador en Redis; por ahora solo log)
    """
    from tutor_service.services.features import get_flags
    from platform_ops import FeatureNotDeclaredError

    tutor = _get_tutor()

    # Feature flag: modelo LLM por tenant
    flags = get_flags()
    try:
        use_opus = flags.is_enabled(user.tenant_id, "enable_claude_opus")
    except FeatureNotDeclaredError:
        use_opus = False
    model = settings.opus_model if use_opus else settings.default_model

    episode_id = await tutor.open_episode(
        tenant_id=user.tenant_id,
        comision_id=req.comision_id,
        student_pseudonym=user.id,
        problema_id=req.problema_id,
        curso_config_hash=req.curso_config_hash,
        classifier_config_hash=req.classifier_config_hash,
        model=model,
    )
    return OpenEpisodeResponse(episode_id=episode_id)


@router.post("/{episode_id}/message")
async def send_message(
    episode_id: UUID,
    req: MessageRequest,
    user: User = Depends(require_role("estudiante", "docente", "docente_admin", "superadmin")),
):
    """SSE streaming de la respuesta del tutor."""
    tutor = _get_tutor()

    async def event_stream():
        try:
            async for event in tutor.interact(episode_id, req.content):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except ValueError as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        except Exception as e:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'error', 'message': f'Internal error: {e}'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{episode_id}/close", status_code=status.HTTP_204_NO_CONTENT)
async def close_episode(
    episode_id: UUID,
    req: CloseEpisodeRequest,
    user: User = Depends(require_role("estudiante", "docente", "docente_admin", "superadmin")),
) -> None:
    tutor = _get_tutor()
    try:
        await tutor.close_episode(episode_id, reason=req.reason)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


class CodigoEjecutadoRequest(BaseModel):
    """Evento emitido por el frontend cuando Pyodide corre código."""

    code: str = Field(..., description="Código Python ejecutado")
    stdout: str = Field(default="", description="Stdout capturado")
    stderr: str = Field(default="", description="Stderr capturado")
    duration_ms: float = Field(..., ge=0, description="Duración de la ejecución")


@router.post(
    "/{episode_id}/events/codigo_ejecutado",
    status_code=status.HTTP_202_ACCEPTED,
)
async def emit_codigo_ejecutado(
    episode_id: UUID,
    req: CodigoEjecutadoRequest,
    user: User = Depends(require_role("estudiante", "docente", "docente_admin", "superadmin")),
) -> dict[str, str]:
    """Emite evento codigo_ejecutado al CTR con seq correcto del episodio.

    Este endpoint es el puente entre la ejecución Pyodide del navegador
    y la cadena criptográfica del CTR. El cliente envía el resultado de
    la ejecución; el tutor-service asigna el seq (atómicamente desde el
    session manager) y publica al ctr-stream, que luego el worker
    persiste en la cadena.

    Idempotencia: el cliente NO debe reintentar este POST en error de
    red — generará una segunda fila con seq distinto. En caso de duda,
    consultar el episodio para ver si el evento quedó registrado.
    """
    tutor = _get_tutor()
    try:
        seq = await tutor.emit_codigo_ejecutado(
            episode_id=episode_id,
            user_id=user.id,
            payload={
                "code": req.code,
                "stdout": req.stdout,
                "stderr": req.stderr,
                "duration_ms": req.duration_ms,
                "runtime": "pyodide-0.26",
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    return {"status": "accepted", "seq": str(seq)}
