"""Métricas custom de ai-gateway emitidas via OTel SDK.

Cardinality rule: `student_pseudonym`/`episode_id`/`prompt_id` PROHIBIDOS.
Las labels permitidas acá son `tenant_id`, `provider`, `kind` (input/output),
`reason` (fallback), `feature`.
"""

from __future__ import annotations

from platform_observability import get_meter

_meter = get_meter("ai-gateway")

# Tokens consumidos por proveedor — incluye al mock (declarado como dato del
# piloto en el dashboard 3).
ai_gateway_tokens_total = _meter.create_counter(
    "ai_gateway_tokens_total",
    description="Tokens consumidos por requests al ai-gateway (input/output).",
    unit="1",
)

# Budget remanente USD por tenant — gauge (UpDownCounter para que pueda subir
# cuando se resetea mensualmente y bajar al consumir).
ai_gateway_budget_remaining_usd = _meter.create_up_down_counter(
    "ai_gateway_budget_remaining_usd",
    description="Budget USD restante del tenant en el período actual.",
    unit="USD",
)

# Latencia del request al provider externo (excluye cache hits).
ai_gateway_request_duration_seconds = _meter.create_histogram(
    "ai_gateway_request_duration_seconds",
    description="Latencia de requests al provider LLM (excluye cache hits).",
    unit="s",
)

# Fallback events — cuando el provider primario falla y se cae al secundario.
ai_gateway_fallback_total = _meter.create_counter(
    "ai_gateway_fallback_total",
    description="Eventos de fallback al provider secundario.",
    unit="1",
)

# Cache hit rate components.
ai_gateway_cache_hits_total = _meter.create_counter(
    "ai_gateway_cache_hits_total",
    description="Requests respondidos desde cache.",
    unit="1",
)

ai_gateway_requests_total = _meter.create_counter(
    "ai_gateway_requests_total",
    description="Total de requests recibidos por el ai-gateway.",
    unit="1",
)


__all__ = [
    "ai_gateway_budget_remaining_usd",
    "ai_gateway_cache_hits_total",
    "ai_gateway_fallback_total",
    "ai_gateway_request_duration_seconds",
    "ai_gateway_requests_total",
    "ai_gateway_tokens_total",
]
