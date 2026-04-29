"""enrollment-service: gestión de inscripciones + sync con SIS institucionales."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from enrollment_service.config import settings
from enrollment_service.observability import setup_observability
from enrollment_service.routes import health, imports


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    setup_observability(app)
    yield


app = FastAPI(
    title="enrollment-service",
    description="Gestión de inscripciones y sincronización con SIS institucionales",
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
app.include_router(imports.router)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "enrollment-service",
        "version": "0.1.0",
        "status": "operational",
    }
