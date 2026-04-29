# identity-service

Wrapper de la Admin API de Keycloak + gestión de pseudonimización

**Puerto**: 8001
**Features**: auth, db

## Desarrollo local

```bash
# Desde la raíz del monorepo
cd apps/identity-service
uv run uvicorn identity_service.main:app --reload --port 8001

# Chequear que responde
curl http://localhost:8001/health
```

## Tests

```bash
uv run pytest
```

## Estructura

```
identity-service/
├── src/identity_service/
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
