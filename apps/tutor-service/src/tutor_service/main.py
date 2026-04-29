"""tutor-service: orquesta prompt + retrieval + LLM + CTR."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from tutor_service.config import settings
from tutor_service.observability import setup_observability
from tutor_service.routes import episodes, health


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    setup_observability(app)
    yield


app = FastAPI(
    title="tutor-service",
    description="Tutor socrático con streaming SSE y emisión de eventos CTR",
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

app.include_router(health.router)
app.include_router(episodes.router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "tutor-service", "version": "0.1.0", "status": "operational"}
