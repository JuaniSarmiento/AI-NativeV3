"""Servicio evaluation-service: Rúbricas, corrección asistida, calificaciones finales"""
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from evaluation_service.config import settings
from evaluation_service.observability import setup_observability
from evaluation_service.routes import health


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup y shutdown del servicio."""
    # Startup
    setup_observability(app)
    # await db.connect()
    # await event_bus.connect()
    yield
    # Shutdown
    # await db.disconnect()


app = FastAPI(
    title="evaluation-service",
    description="Rúbricas, corrección asistida, calificaciones finales",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS: configuración abierta en dev, restrictiva en prod (setea en settings)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(health.router)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "evaluation-service",
        "version": "0.1.0",
        "status": "operational",
    }
