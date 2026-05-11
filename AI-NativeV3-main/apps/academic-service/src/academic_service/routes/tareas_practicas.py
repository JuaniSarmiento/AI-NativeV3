"""Endpoints de Tareas Prácticas (TP)."""

from __future__ import annotations

import logging
from typing import Any, Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from academic_service.auth import User, get_db, require_permission
from academic_service.schemas import ListMeta, ListResponse
from academic_service.schemas.tarea_practica import (
    TareaPracticaCreate,
    TareaPracticaOut,
    TareaPracticaUpdate,
    TareaPracticaVersionRef,
)
from academic_service.services.tarea_practica_service import TareaPracticaService

router = APIRouter(prefix="/api/v1/tareas-practicas", tags=["tareas-practicas"])


@router.post("", response_model=TareaPracticaOut, status_code=status.HTTP_201_CREATED)
async def create_tarea_practica(
    data: TareaPracticaCreate,
    user: User = Depends(require_permission("tarea_practica", "create")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaOut:
    svc = TareaPracticaService(db)
    obj = await svc.create(data, user)
    return TareaPracticaOut.model_validate(obj)


@router.get("", response_model=ListResponse[TareaPracticaOut])
async def list_tareas_practicas(
    limit: int = Query(50, ge=1, le=200),
    cursor: UUID | None = None,
    comision_id: UUID | None = None,
    estado: Literal["draft", "published", "archived"] | None = None,
    unidad_id: UUID | None = None,
    user: User = Depends(require_permission("tarea_practica", "read")),
    db: AsyncSession = Depends(get_db),
) -> ListResponse[TareaPracticaOut]:
    """Lista TPs con filtros opcionales (fix QA A13: unidad_id).

    - `unidad_id` filtra a las TPs asignadas a esa Unidad temática
      (ADR-041). Sin el query param, devuelve TPs sin filtrar por
      unidad (comportamiento actual).
    """
    svc = TareaPracticaService(db)
    objs = await svc.list(
        comision_id=comision_id,
        estado=estado,
        unidad_id=unidad_id,
        limit=limit,
        cursor=cursor,
    )
    items = [TareaPracticaOut.model_validate(o) for o in objs]
    next_cursor = str(objs[-1].id) if len(objs) == limit else None
    return ListResponse(data=items, meta=ListMeta(cursor_next=next_cursor))


@router.get("/{tarea_id}", response_model=TareaPracticaOut)
async def get_tarea_practica(
    tarea_id: UUID,
    user: User = Depends(require_permission("tarea_practica", "read")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaOut:
    svc = TareaPracticaService(db)
    obj = await svc.get(tarea_id)
    return TareaPracticaOut.model_validate(obj)


@router.patch("/{tarea_id}", response_model=TareaPracticaOut)
async def update_tarea_practica(
    tarea_id: UUID,
    data: TareaPracticaUpdate,
    user: User = Depends(require_permission("tarea_practica", "update")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaOut:
    svc = TareaPracticaService(db)
    obj = await svc.update(tarea_id, data, user)
    return TareaPracticaOut.model_validate(obj)


@router.delete("/{tarea_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tarea_practica(
    tarea_id: UUID,
    user: User = Depends(require_permission("tarea_practica", "delete")),
    db: AsyncSession = Depends(get_db),
) -> None:
    svc = TareaPracticaService(db)
    await svc.soft_delete(tarea_id, user)


@router.post("/{tarea_id}/publish", response_model=TareaPracticaOut)
async def publish_tarea_practica(
    tarea_id: UUID,
    user: User = Depends(require_permission("tarea_practica", "update")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaOut:
    svc = TareaPracticaService(db)
    obj = await svc.publish(tarea_id, user)
    return TareaPracticaOut.model_validate(obj)


@router.post("/{tarea_id}/archive", response_model=TareaPracticaOut)
async def archive_tarea_practica(
    tarea_id: UUID,
    user: User = Depends(require_permission("tarea_practica", "update")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaOut:
    svc = TareaPracticaService(db)
    obj = await svc.archive(tarea_id, user)
    return TareaPracticaOut.model_validate(obj)


@router.post(
    "/{tarea_id}/new-version",
    response_model=TareaPracticaOut,
    status_code=status.HTTP_201_CREATED,
)
async def new_version_tarea_practica(
    tarea_id: UUID,
    data: TareaPracticaUpdate,
    user: User = Depends(require_permission("tarea_practica", "create")),
    db: AsyncSession = Depends(get_db),
) -> TareaPracticaOut:
    svc = TareaPracticaService(db)
    obj = await svc.new_version(tarea_id, data, user)
    return TareaPracticaOut.model_validate(obj)


# ── TP-gen IA (Sec 11 epic ai-native-completion / ADR-036) ─────────────


async def _retrieve_rag_context(
    descripcion_nl: str,
    materia_id: UUID,
    tenant_id: UUID,
    comision_id: UUID | None = None,
) -> tuple[str, int, str | None]:
    """Consulta RAG al content-service. Devuelve (context_text, n_chunks, hash).

    Usa materia_id como scope principal (el material pertenece a la materia).
    """
    try:
        from academic_service.config import settings
        from academic_service.services.ai_clients import ContentClient

        content = ContentClient(settings.content_service_url)
        retrieval = await content.retrieve(
            query=descripcion_nl,
            tenant_id=tenant_id,
            materia_id=materia_id,
            comision_id=comision_id,
            top_k=5,
        )
        if not retrieval.chunks:
            return "", 0, None
        chunks_text = "\n---\n".join(
            f"[{c.material_nombre}]\n{c.contenido}" for c in retrieval.chunks
        )
        context = (
            "\n\nMaterial de referencia de la catedra (usa este contenido "
            "como base para el ejercicio):\n\n" + chunks_text
        )
        return context, len(retrieval.chunks), retrieval.chunks_used_hash
    except Exception as exc:
        logger.warning("rag_retrieval_failed_for_tp_gen: %s (continuing without RAG)", exc)
        return "", 0, None


class TPGenerateRequest(BaseModel):
    """Request del wizard TP-gen del web-teacher.

    El docente describe en NL que TP quiere; el endpoint pega al ai-gateway
    via governance-service (resuelve prompt activo) y devuelve un borrador
    editable. NO persiste — el docente edita y dispara `POST /tareas-practicas`
    tradicional con `created_via_ai=true`.
    """

    materia_id: UUID
    descripcion_nl: str = Field(min_length=10, max_length=2000)
    num_ejercicios: int = Field(default=1, ge=1, le=10)
    dificultad: Literal["basica", "intermedia", "avanzada"] | None = None
    contexto: str | None = Field(default=None, max_length=2000)
    comision_id: UUID | None = None


class EjercicioGenerado(BaseModel):
    titulo: str
    enunciado: str
    inicial_codigo: str
    rubrica: dict[str, Any]
    test_cases: list[dict[str, Any]]


class TPGenerateResponse(BaseModel):
    ejercicios: list[EjercicioGenerado]
    prompt_version: str
    model_used: str
    provider_used: str
    tokens_input: int
    tokens_output: int
    rag_chunks_used: int
    rag_chunks_hash: str | None


@router.post("/generate", response_model=TPGenerateResponse)
async def generate_tarea_practica(
    req: TPGenerateRequest,
    user: User = Depends(require_permission("tarea_practica", "create")),
    db: AsyncSession = Depends(get_db),
) -> TPGenerateResponse:
    """Genera un borrador de TP via IA (ADR-036, Sec 11 epic ai-native-completion).

    Flow:
      1. Valida materia_id existe en este tenant.
      2. governance-service resuelve el prompt `tp_generator/{version}` activo.
      3. ai-gateway con `feature="tp_generator"` + `materia_id` para BYOK.
      4. Parse del JSON estructurado del LLM (formato declarado en el prompt).
      5. Audit log structlog `tp_generated_by_ai` con todos los campos.

    Errores:
      - 400 si materia_id no existe o no pertenece al tenant.
      - 502 si el ai-gateway falla o el LLM devuelve JSON invalido.
      - 403 (Casbin) si el caller es estudiante.
    """
    import json
    import time

    from sqlalchemy import select

    from academic_service.config import settings
    from academic_service.models.institucional import Materia
    from academic_service.services.ai_clients import AIGatewayClient, GovernanceClient

    # 1. Validar materia
    stmt = select(Materia).where(Materia.id == req.materia_id)
    materia = (await db.execute(stmt)).scalar_one_or_none()
    if materia is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Materia {req.materia_id} no encontrada en este tenant",
        )

    # 2. Resolver prompt (governance-service)
    governance = GovernanceClient(settings.governance_service_url)
    prompt_version_full = f"tp_generator/{settings.tp_generator_prompt_version}"
    try:
        prompt_cfg = await governance.get_prompt("tp_generator", settings.tp_generator_prompt_version)
    except Exception as exc:
        logger.error("tp_generator_prompt_fetch_failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="No se pudo resolver el prompt activo del tp_generator",
        ) from exc

    # 2b. RAG: buscar materiales relevantes con materia_id como scope principal
    rag_context, rag_chunks_used, rag_chunks_hash = await _retrieve_rag_context(
        req.descripcion_nl, req.materia_id, user.tenant_id, req.comision_id,
    )

    # 3. Construir mensajes para LLM
    user_message_parts = [f"Descripcion: {req.descripcion_nl}"]
    user_message_parts.append(f"num_ejercicios: {req.num_ejercicios}")
    if req.dificultad:
        user_message_parts.append(f"Dificultad: {req.dificultad}")
    if req.contexto:
        user_message_parts.append(f"Contexto: {req.contexto}")
    if rag_context:
        user_message_parts.append(rag_context)
    user_message = "\n\n".join(user_message_parts)

    messages = [
        {"role": "system", "content": prompt_cfg.content},
        {"role": "user", "content": user_message},
    ]

    # 4. Pegar al ai-gateway (con retry si el LLM devuelve error)
    ai = AIGatewayClient(settings.ai_gateway_url)
    max_attempts = 2
    parsed: dict = {}
    result = None
    t0 = time.perf_counter()

    for attempt in range(max_attempts):
        try:
            result = await ai.complete(
                messages=messages,
                model=settings.tp_generator_default_model,
                feature="tp_generator",
                tenant_id=user.tenant_id,
                materia_id=req.materia_id,
                temperature=0.7,
                max_tokens=8192,
                response_format={"type": "json_object"},
            )
        except httpx.HTTPError as exc:
            logger.error("ai_gateway_call_failed: %s", exc)
            if attempt < max_attempts - 1:
                continue
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="ai-gateway no respondio correctamente",
            ) from exc

        # 5. Parsear JSON
        raw_content = result.content.strip()
        if not raw_content.startswith("{"):
            brace_start = raw_content.find("{")
            brace_end = raw_content.rfind("}")
            if brace_start != -1 and brace_end > brace_start:
                raw_content = raw_content[brace_start:brace_end + 1]
        try:
            parsed = json.loads(raw_content)
        except json.JSONDecodeError as exc:
            logger.error(
                "tp_generator_invalid_json provider=%s model=%s error=%s raw_start=%r",
                result.provider,
                result.model,
                str(exc),
                raw_content[:300],
            )
            if attempt < max_attempts - 1:
                continue
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LLM devolvio JSON invalido (revisar prompt o modelo)",
            ) from exc

        if "error" in parsed and attempt < max_attempts - 1:
            logger.warning("tp_generator_llm_returned_error attempt=%d: %s", attempt, parsed["error"])
            continue

        break

    assert result is not None
    latency_ms = int((time.perf_counter() - t0) * 1000)

    if "error" in parsed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"LLM no pudo generar borrador: {parsed['error']}",
        )

    raw_ejercicios = parsed.get("ejercicios") or []
    if not isinstance(raw_ejercicios, list) or not raw_ejercicios:
        if "enunciado" in parsed:
            raw_ejercicios = [parsed]
        else:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LLM no devolvio ejercicios validos",
            )

    ejercicios = []
    for i, ej in enumerate(raw_ejercicios):
        rubrica = ej.get("rubrica") or {}
        test_cases = ej.get("test_cases") or []
        if not isinstance(rubrica, dict):
            rubrica = {}
        if not isinstance(test_cases, list):
            test_cases = []
        ejercicios.append(
            EjercicioGenerado(
                titulo=str(ej.get("titulo", f"Ejercicio {i + 1}")),
                enunciado=str(ej.get("enunciado", "")),
                inicial_codigo=str(ej.get("inicial_codigo", "")),
                rubrica=rubrica,
                test_cases=test_cases,
            )
        )

    # 6. Audit log structlog (queryable via Loki)
    try:
        import structlog

        structlog.get_logger().info(
            "tp_generated_by_ai",
            tenant_id=str(user.tenant_id),
            user_id=str(user.id),
            materia_id=str(req.materia_id),
            prompt_version=prompt_version_full,
            tokens_input=result.input_tokens,
            tokens_output=result.output_tokens,
            latency_ms=latency_ms,
            provider_used=result.provider,
            model_used=result.model,
            cache_hit=result.cache_hit,
            rag_chunks_used=rag_chunks_used,
            rag_chunks_hash=rag_chunks_hash,
            num_ejercicios=len(ejercicios),
        )
    except ImportError:
        logger.info(
            "tp_generated_by_ai tenant=%s user=%s materia=%s prompt=%s "
            "tokens_in=%d tokens_out=%d latency_ms=%d provider=%s model=%s ejercicios=%d",
            user.tenant_id,
            user.id,
            req.materia_id,
            prompt_version_full,
            result.input_tokens,
            result.output_tokens,
            latency_ms,
            result.provider,
            result.model,
            len(ejercicios),
        )

    return TPGenerateResponse(
        ejercicios=ejercicios,
        prompt_version=prompt_version_full,
        model_used=result.model,
        provider_used=result.provider,
        tokens_input=result.input_tokens,
        tokens_output=result.output_tokens,
        rag_chunks_used=rag_chunks_used,
        rag_chunks_hash=rag_chunks_hash,
    )


# ── Test cases (Sec 9 epic ai-native-completion / ADR-034) ─────────────


@router.get("/{tarea_id}/test-cases")
async def get_tarea_practica_test_cases(
    tarea_id: UUID,
    include_hidden: bool = False,
    user: User = Depends(require_permission("tarea_practica", "read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Devuelve los test cases de una TP filtrados por rol del caller.

    Filtrado por rol (ADR-034):
      - Estudiante con `include_hidden=true`        => 403.
      - Estudiante (default `include_hidden=false`) => solo `is_public=true`.
      - Docente / docente_admin / superadmin        => respeta `include_hidden`.

    El endpoint NO ejecuta tests (eso lo hace Pyodide client-side en
    web-student). Solo devuelve la metadata.

    Tests `is_public=false` quedan opacos al cliente — defensa critica para
    que el alumno no pueda ver los tests hidden via dev tools del browser.
    """
    is_priv_role = bool(
        {"docente", "docente_admin", "superadmin", "jtp", "auxiliar"} & user.roles
    )
    if include_hidden and not is_priv_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="include_hidden requiere rol docente, docente_admin o superior",
        )

    svc = TareaPracticaService(db)
    obj = await svc.get(tarea_id)

    raw: list[dict[str, Any]] = list(obj.test_cases or [])
    if include_hidden:
        # Caller privilegiado pidiendo todo — devolvemos sin filtrar
        visible = raw
    else:
        # Default: omitir tests privados (sin importar el rol)
        visible = [tc for tc in raw if tc.get("is_public") is True]

    return {
        "tarea_id": str(tarea_id),
        "test_cases": visible,
        "total_count": len(raw),
        "visible_count": len(visible),
        "include_hidden": include_hidden,
    }


@router.get("/{tarea_id}/ejercicios")
async def get_tarea_practica_ejercicios(
    tarea_id: UUID,
    user: User = Depends(require_permission("tarea_practica", "read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Devuelve los ejercicios de una TP (tp-entregas-correccion).

    Lista ordenada por `orden`. Array vacío = TP monolítica (sin ejercicios).
    Accesible para todos los roles con `tarea_practica:read`.
    """
    svc = TareaPracticaService(db)
    obj = await svc.get(tarea_id)
    ejercicios = list(obj.ejercicios or [])
    return {
        "tarea_id": str(tarea_id),
        "ejercicios": sorted(ejercicios, key=lambda e: e.get("orden", 0)),
        "count": len(ejercicios),
        "tiene_ejercicios": len(ejercicios) > 0,
    }


@router.get("/{tarea_id}/versions", response_model=list[TareaPracticaVersionRef])
async def list_tarea_practica_versions(
    tarea_id: UUID,
    user: User = Depends(require_permission("tarea_practica", "read")),
    db: AsyncSession = Depends(get_db),
) -> list[TareaPracticaVersionRef]:
    svc = TareaPracticaService(db)
    chain = await svc.list_versions(tarea_id)

    latest_published_version: int | None = None
    for t in chain:
        if t.estado == "published":
            if latest_published_version is None or t.version > latest_published_version:
                latest_published_version = t.version

    if latest_published_version is not None:
        current_version = latest_published_version
    else:
        current_version = max(t.version for t in chain)

    return [
        TareaPracticaVersionRef(
            id=t.id,
            version=t.version,
            estado=t.estado,
            titulo=t.titulo,
            created_at=t.created_at,
            is_current=(t.version == current_version),
        )
        for t in chain
    ]
