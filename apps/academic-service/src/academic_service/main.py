"""academic-service: CRUDs del dominio académico.

En F1 expone los endpoints de Universidades, Carreras, Materias,
Periodos y Comisiones con matriz de permisos Casbin.
"""
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from academic_service.config import settings
from academic_service.observability import setup_observability
from academic_service.routes import carreras, comisiones, health, materias, universidades


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    setup_observability(app)
    # DB y event bus se inicializan lazy al primer request (o explícito en F3)
    yield


app = FastAPI(
    title="academic-service",
    description="CRUDs del dominio académico (universidades, carreras, comisiones)",
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

# Routers
app.include_router(health.router)
app.include_router(universidades.router)
app.include_router(carreras.router)
app.include_router(materias.router)
app.include_router(comisiones.periodos_router)
app.include_router(comisiones.comisiones_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "academic-service",
        "version": "0.1.0",
        "status": "operational",
    }
