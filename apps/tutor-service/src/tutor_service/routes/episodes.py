"""Endpoints HTTP del tutor-service.

POST /api/v1/episodes              crear episodio (devuelve episode_id)
GET  /api/v1/episodes/{id}         estado del episodio (recovery del frontend)
POST /api/v1/episodes/{id}/message SSE con la respuesta del tutor
POST /api/v1/episodes/{id}/close   cerrar episodio (emite evento cierre)
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

import redis.asyncio as redis
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from tutor_service.auth.dependencies import User, require_role
from tutor_service.config import settings
from tutor_service.services.academic_client import AcademicClient
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
            academic=AcademicClient(settings.academic_service_url),
            default_prompt_version=settings.default_prompt_version,
            default_model=settings.default_model,
        )
    return _tutor


_ctr_client: CTRClient | None = None


def _get_ctr_client() -> CTRClient:
    """CTRClient compartido para reads (GET /episodes/{id}).

    El TutorCore ya tiene su propio CTRClient para writes; éste es el
    mismo tipo, separado para hacer override fácil en tests del endpoint.
    """
    global _ctr_client
    if _ctr_client is None:
        _ctr_client = CTRClient(settings.ctr_service_url)
    return _ctr_client


# UUID fijo del service-account del tutor (mismo que `tutor_core.py`).
# Se usa como caller_id al pegarle al ctr-service en lecturas.
TUTOR_SERVICE_USER_ID = UUID("00000000-0000-0000-0000-000000000010")


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


class EpisodeStateResponse(BaseModel):
    """Estado reconstruído del episodio para que el web-student
    recupere el contexto al recargar el browser.

    NO devuelve la cadena completa de eventos del CTR — sólo lo que la UI
    necesita para volver a renderizar la sesión:
      - metadata del episodio (estado, tarea, comisión, fechas)
      - última snapshot del editor de código
      - mensajes user/assistant de la conversación
      - notas personales del estudiante

    Si el episodio está `closed` igual se devuelve, en modo lectura.
    """

    episode_id: UUID
    tarea_practica_id: UUID
    comision_id: UUID
    estado: str  # open | closed
    opened_at: datetime
    closed_at: datetime | None = None
    last_code_snapshot: str | None = None
    messages: list[dict[str, Any]] = Field(default_factory=list)
    notes: list[dict[str, Any]] = Field(default_factory=list)


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


def _build_episode_state(
    episode_id: UUID, ep: dict[str, Any]
) -> EpisodeStateResponse:
    """Reduce el `EpisodeWithEvents` del CTR al subset que la UI necesita.

    Reglas de extracción:
      - last_code_snapshot: payload.code más reciente entre los eventos
        `edicion_codigo` y `codigo_ejecutado` (orden por seq).
      - messages: pares (prompt_enviado, tutor_respondio) en orden de seq.
        prompt_enviado.payload.content → role="user".
        tutor_respondio.payload.content → role="assistant".
      - notes: eventos `nota_personal` con payload.contenido.

    Eventos sin los campos esperados se ignoran silenciosamente — la UI
    debe ser tolerante a versiones viejas del schema.
    """
    events: list[dict[str, Any]] = ep.get("events") or []
    # Asegurar orden por seq aún si el ctr-service no garantiza el orden.
    events = sorted(events, key=lambda e: e.get("seq", 0))

    last_code: str | None = None
    messages: list[dict[str, Any]] = []
    notes: list[dict[str, Any]] = []

    for ev in events:
        et = ev.get("event_type")
        payload = ev.get("payload") or {}
        ts = ev.get("ts")
        if et in ("edicion_codigo", "codigo_ejecutado"):
            code = payload.get("snapshot") or payload.get("code")
            if isinstance(code, str):
                last_code = code
        elif et == "prompt_enviado":
            content = payload.get("content")
            if isinstance(content, str):
                messages.append({"role": "user", "content": content, "ts": ts})
        elif et == "tutor_respondio":
            content = payload.get("content")
            if isinstance(content, str):
                messages.append(
                    {"role": "assistant", "content": content, "ts": ts}
                )
        elif et in ("nota_personal", "nota_estudiante"):
            contenido = payload.get("contenido") or payload.get("content")
            if isinstance(contenido, str):
                notes.append({"contenido": contenido, "ts": ts})

    return EpisodeStateResponse(
        episode_id=episode_id,
        tarea_practica_id=UUID(str(ep["problema_id"])),
        comision_id=UUID(str(ep["comision_id"])),
        estado=ep["estado"],
        opened_at=_parse_dt(ep["opened_at"]),
        closed_at=_parse_dt(ep.get("closed_at")) if ep.get("closed_at") else None,
        last_code_snapshot=last_code,
        messages=messages,
        notes=notes,
    )


def _parse_dt(value: str | datetime) -> datetime:
    """Parsea ISO-8601 con sufijo Z o offset. Acepta datetime ya parseado."""
    if isinstance(value, datetime):
        return value
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


@router.get("/{episode_id}", response_model=EpisodeStateResponse)
async def get_episode_state(
    episode_id: UUID,
    user: User = Depends(
        require_role("estudiante", "docente", "docente_admin", "superadmin")
    ),
) -> EpisodeStateResponse:
    """Devuelve el estado reconstruído del episodio para recovery del UI.

    Usado por el web-student al montar la vista — si el browser se
    refresca y pierde el `episodeId` en memoria, lo persiste en
    `localStorage` y luego pega acá para reconstruir mensajes, código y
    notas. Funciona también para episodios ya cerrados (modo lectura).

    Errores:
      - 404 si el episodio no existe.
      - 403 si el episodio pertenece a otro tenant.
    """
    ctr = _get_ctr_client()
    ep = await ctr.get_episode(
        episode_id=episode_id,
        tenant_id=user.tenant_id,
        caller_id=TUTOR_SERVICE_USER_ID,
    )
    if ep is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Episode {episode_id} no encontrado",
        )

    # Defensa en profundidad: si el ctr-service por alguna razón
    # devuelve un episodio de otro tenant (shouldn't happen — RLS
    # debería filtrarlo), no lo expongamos.
    if str(ep.get("tenant_id")) != str(user.tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Episode pertenece a otro tenant",
        )

    return _build_episode_state(episode_id, ep)


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


class EdicionCodigoRequest(BaseModel):
    """Evento emitido por el editor del frontend en cada cambio de código.

    Crítico para CCD: distingue "tipeando/pensando" de "idle". Sin este
    evento, los gaps temporales entre prompts y ejecuciones no son
    interpretables por el clasificador.
    """

    snapshot: str = Field(
        ...,
        max_length=50000,
        description="Código completo en el momento del evento (≤50KB)",
    )
    diff_chars: int = Field(
        ..., ge=0, description="Cantidad de caracteres cambiados desde evento anterior"
    )
    language: str = Field(default="python", min_length=1, max_length=32)


@router.post(
    "/{episode_id}/events/edicion_codigo",
    status_code=status.HTTP_202_ACCEPTED,
)
async def emit_edicion_codigo(
    episode_id: UUID,
    req: EdicionCodigoRequest,
    user: User = Depends(require_role("estudiante", "docente", "docente_admin", "superadmin")),
) -> dict[str, str]:
    """Emite evento edicion_codigo al CTR con el seq correcto del episodio.

    El cliente envía un snapshot del código y la cantidad de caracteres
    cambiados desde el snapshot anterior; el tutor-service asigna el seq
    (atómicamente desde el session manager) y publica al ctr-stream, que
    luego el worker persiste en la cadena.

    Estados:
      - 202: evento aceptado, devuelve `seq` asignado.
      - 409: episodio cerrado, expirado o inexistente (no se aceptan más eventos).
      - 422: validación de payload falló (snapshot >50KB, diff_chars negativo).

    Idempotencia: el cliente NO debe reintentar este POST en error de
    red — generará una segunda fila con seq distinto. El frontend debe
    debounce-ar los eventos para no saturar el CTR.
    """
    tutor = _get_tutor()
    try:
        seq = await tutor.record_edicion_codigo(
            episode_id=episode_id,
            snapshot=req.snapshot,
            diff_chars=req.diff_chars,
            language=req.language,
            user_id=user.id,
        )
    except ValueError as e:
        # Sesión inexistente o eliminada (cierre/expiración) → episodio
        # ya no acepta eventos.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))

    return {"status": "accepted", "seq": str(seq)}


class AnotacionCreadaRequest(BaseModel):
    """Evento emitido por el frontend cuando el estudiante guarda una nota.

    Es la señal explícita de reflexión que alimenta CCD orphan ratio.
    Sin este evento, los episodios reflexivos quedan marcados como
    huérfanos de evidencia y se distorsiona la métrica.
    """

    contenido: str = Field(
        ...,
        min_length=1,
        max_length=5000,
        description="Texto de la nota personal del estudiante (1–5000 chars)",
    )


@router.post(
    "/{episode_id}/events/anotacion_creada",
    status_code=status.HTTP_202_ACCEPTED,
)
async def emit_anotacion_creada(
    episode_id: UUID,
    req: AnotacionCreadaRequest,
    user: User = Depends(require_role("estudiante", "docente", "docente_admin", "superadmin")),
) -> dict[str, str]:
    """Emite evento anotacion_creada (NotaPersonal) al CTR.

    Estados:
      - 202: evento aceptado, devuelve `seq` asignado.
      - 409: episodio cerrado, expirado o inexistente (no se aceptan más eventos).
      - 422: validación de payload falló (vacío o >5000 chars).

    El `user_id` autoritativo es el del estudiante (header `X-User-Id`
    inyectado por el api-gateway) — la nota es del estudiante, su autoría.

    Idempotencia: el cliente NO debe reintentar este POST en error de red
    — cada POST exitoso registra una nueva nota con seq distinto.
    """
    tutor = _get_tutor()
    # Defensa adicional: contenido sólo whitespace no aporta señal y
    # rompería la semántica de "reflexión explícita".
    if not req.contenido.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="contenido no puede ser vacío o sólo whitespace",
        )
    try:
        seq = await tutor.record_anotacion_creada(
            episode_id=episode_id,
            contenido=req.contenido,
            user_id=user.id,
        )
    except ValueError as e:
        # Sesión inexistente o eliminada (cierre/expiración) → episodio
        # ya no acepta eventos.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))

    return {"status": "accepted", "seq": str(seq)}
