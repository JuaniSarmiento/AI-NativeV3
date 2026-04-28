# enrollment-service

Gestión de inscripciones y sincronización con SIS institucionales

**Puerto**: 8003
**Features**: db, events

## Desarrollo local

```bash
# Desde la raíz del monorepo
cd apps/enrollment-service
uv run uvicorn enrollment_service.main:app --reload --port 8003

# Chequear que responde
curl http://localhost:8003/health
```

## Tests

```bash
uv run pytest
```

## Estructura

```
enrollment-service/
├── src/enrollment_service/
│   ├── __init__.py
│   ├── main.py           # FastAPI app + lifespan
│   ├── config.py         # Settings Pydantic
│   ├── observability.py  # OpenTelemetry + structlog
│   └── routes/
│       ├── __init__.py
│       └── health.py     # /health endpoints
├── tests/
│   └── test_health.py
├── pyproject.toml
├── Dockerfile
└── README.md
```

## Próximas fases

Esta es la versión F0 (esqueleto). La lógica se desarrolla en fases siguientes
según [docs/plan-detallado-fases.md](../../docs/plan-detallado-fases.md).
