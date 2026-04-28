"""api-gateway: entrada única con JWT validation, rate limit y proxy."""
from contextlib import asynccontextmanager
from typing import AsyncIterator

import redis.asyncio as redis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api_gateway.config import settings
from api_gateway.middleware import JWTMiddleware, RateLimitMiddleware
from api_gateway.observability import setup_observability
from api_gateway.routes import health, proxy
from api_gateway.services import JWTValidator, JWTValidatorConfig


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    setup_observability(app)
    yield


app = FastAPI(
    title="api-gateway",
    description="Entrada única de la plataforma — JWT + rate limit + proxy",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── JWT validation (F5) ─────────────────────────────────────────────
# El validator se construye solo si hay issuer configurado. Si no, el
# middleware corre en modo dev_trust_headers (acepta X-* tal cual vienen).
_jwt_validator: JWTValidator | None = None
if settings.jwt_issuer:
    _jwt_validator = JWTValidator(
        config=JWTValidatorConfig(
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            jwks_uri=settings.jwt_jwks_uri,
            jwks_cache_ttl_seconds=settings.jwt_jwks_cache_ttl,
        )
    )

app.add_middleware(
    JWTMiddleware,
    validator=_jwt_validator,
    dev_trust_headers=settings.dev_trust_headers,
)

# ── Rate limit (F4) ─────────────────────────────────────────────────
_rate_limit_redis = redis.from_url(
    settings.rate_limit_redis_url, decode_responses=True,
)
app.add_middleware(RateLimitMiddleware, redis_client=_rate_limit_redis)

app.include_router(health.router)
app.include_router(proxy.router)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "api-gateway",
        "version": "0.1.0",
        "status": "operational",
    }
