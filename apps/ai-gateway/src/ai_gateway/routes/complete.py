"""Endpoints del ai-gateway.

POST /api/v1/complete    → completion (sync, JSON)
POST /api/v1/stream      → SSE de completion streaming
GET  /api/v1/budget      → estado actual del budget del tenant
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import redis.asyncio as redis
from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ai_gateway.config import settings
from ai_gateway.providers.base import CompletionRequest, get_provider
from ai_gateway.services.budget_and_cache import BudgetTracker, ResponseCache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["ai-gateway"])


_redis_client: redis.Redis | None = None


def _get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


# ── Schemas ─────────────────────────────────────────────────────────


class Message(BaseModel):
    role: str = Field(pattern=r"^(system|user|assistant)$")
    content: str


class CompleteRequest(BaseModel):
    messages: list[Message]
    model: str
    feature: str  # "tutor" | "classifier" | "evaluation" | ...
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=1024, ge=1, le=8192)


class CompleteResponse(BaseModel):
    content: str
    model: str
    provider: str
    feature: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    cache_hit: bool
    budget_status: dict


class BudgetOut(BaseModel):
    tenant_id: UUID
    feature: str
    month: str
    used_usd: float
    limit_usd: float
    remaining_usd: float
    exceeded: bool


# ── Auth minimal ────────────────────────────────────────────────────


@dataclass(frozen=True)
class ServiceCaller:
    tenant_id: UUID
    caller: str  # "tutor-service" | "classifier-service" | ...


async def get_caller(
    x_tenant_id: str = Header(),
    x_caller: str = Header(),
) -> ServiceCaller:
    """Los clientes del ai-gateway son OTROS servicios de la plataforma,
    no usuarios finales. Se autentican con service account (en F5 con mTLS
    o JWT de cliente). Por ahora headers X-* son suficientes."""
    return ServiceCaller(tenant_id=UUID(x_tenant_id), caller=x_caller)


# ── Endpoints ────────────────────────────────────────────────────────


@router.post("/complete", response_model=CompleteResponse)
async def complete(
    req: CompleteRequest,
    caller: ServiceCaller = Depends(get_caller),
) -> CompleteResponse:
    """Completion síncrona. Aplica budget + caché antes de llamar al provider."""
    redis_client = _get_redis()
    tracker = BudgetTracker(redis_client)
    cache = ResponseCache(redis_client)

    # 1. Check budget (el límite se toma de la config del tenant; por ahora,
    # un default global. En F4 se consulta academic-service por el límite
    # específico del tenant/feature).
    limit = settings.default_monthly_budget_usd
    status_info = await tracker.check(caller.tenant_id, req.feature, limit)
    if status_info.exceeded:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Budget excedido para {caller.tenant_id}/{req.feature}: "
                f"gastado ${status_info.used_usd:.2f} de ${limit:.2f}"
            ),
        )

    # 2. Armar request interno
    internal_req = CompletionRequest(
        messages=[m.model_dump() for m in req.messages],
        model=req.model,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
    )

    # 3. Cache check
    cached = await cache.get(internal_req)
    if cached:
        logger.info(
            "cache_hit tenant=%s feature=%s model=%s",
            caller.tenant_id, req.feature, req.model,
        )
        return CompleteResponse(
            content=cached.content,
            model=cached.model,
            provider=cached.provider,
            feature=req.feature,
            input_tokens=cached.input_tokens,
            output_tokens=cached.output_tokens,
            cost_usd=0.0,
            cache_hit=True,
            budget_status={
                "used_usd": status_info.used_usd,
                "limit_usd": status_info.limit_usd,
                "remaining_usd": status_info.remaining_usd,
            },
        )

    # 4. Invocar al provider
    provider = get_provider()
    try:
        response = await provider.complete(internal_req)
    except Exception as e:  # noqa: BLE001
        logger.exception("provider_error")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"LLM provider error: {e}",
        )

    # 5. Cache + budget charge
    await cache.set(internal_req, response)
    new_total = await tracker.charge(caller.tenant_id, req.feature, response.cost_usd)

    return CompleteResponse(
        content=response.content,
        model=response.model,
        provider=response.provider,
        feature=req.feature,
        input_tokens=response.input_tokens,
        output_tokens=response.output_tokens,
        cost_usd=response.cost_usd,
        cache_hit=False,
        budget_status={
            "used_usd": new_total,
            "limit_usd": limit,
            "remaining_usd": max(0.0, limit - new_total),
        },
    )


@router.post("/stream")
async def stream_complete(
    req: CompleteRequest,
    caller: ServiceCaller = Depends(get_caller),
):
    """SSE streaming. El caller recibe chunks de texto en tiempo real.

    Cada evento es un JSON en el formato:
        data: {"type": "token", "content": "..."}
        data: {"type": "done", "usage": {...}}
    """
    redis_client = _get_redis()
    tracker = BudgetTracker(redis_client)
    limit = settings.default_monthly_budget_usd

    status_info = await tracker.check(caller.tenant_id, req.feature, limit)
    if status_info.exceeded:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Budget excedido",
        )

    internal_req = CompletionRequest(
        messages=[m.model_dump() for m in req.messages],
        model=req.model,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
        stream=True,
    )

    provider = get_provider()

    async def event_stream():
        total_chars = 0
        try:
            async for chunk in provider.stream_complete(internal_req):
                total_chars += len(chunk)
                yield f"data: {json.dumps({'type': 'token', 'content': chunk})}\n\n"
            # Estimación rudimentaria de costo (el provider streaming no
            # siempre expone tokens finales)
            est_cost = total_chars / 4 / 1_000_000 * 5.0  # ~$5/M output tokens
            await tracker.charge(caller.tenant_id, req.feature, est_cost)
            yield f"data: {json.dumps({'type': 'done', 'estimated_cost_usd': est_cost})}\n\n"
        except Exception as e:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/budget", response_model=BudgetOut)
async def get_budget(
    feature: str,
    caller: ServiceCaller = Depends(get_caller),
) -> BudgetOut:
    redis_client = _get_redis()
    tracker = BudgetTracker(redis_client)
    limit = settings.default_monthly_budget_usd
    status_info = await tracker.check(caller.tenant_id, feature, limit)
    return BudgetOut(
        tenant_id=caller.tenant_id,
        feature=feature,
        month=datetime.now(UTC).strftime("%Y-%m"),
        used_usd=status_info.used_usd,
        limit_usd=status_info.limit_usd,
        remaining_usd=status_info.remaining_usd,
        exceeded=status_info.exceeded,
    )
