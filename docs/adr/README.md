# Architecture Decision Records

Decisiones arquitectónicas significativas del proyecto. Formato [MADR](https://adr.github.io/madr/).

Cada ADR es inmutable una vez aceptado. Para revertir o cambiar una decisión, se crea un nuevo ADR que marca el anterior como "Superseded".

## Índice

| ID | Título | Estado | Fecha |
|---|---|---|---|
| [ADR-001](./001-multi-tenancy-rls.md) | Multi-tenancy por Row-Level Security | Aceptado | 2026-04 |
| [ADR-002](./002-keycloak-iam-federado.md) | Keycloak como IAM central con federación | Aceptado | 2026-04 |
| [ADR-003](./003-separacion-bases-logicas.md) | Separación de bases lógicas por plano | Aceptado | 2026-04 |
| [ADR-004](./004-ai-gateway-propio.md) | AI Gateway propio centralizado | Aceptado | 2026-04 |
| [ADR-005](./005-redis-streams-bus.md) | Redis Streams como bus de eventos | Aceptado | 2026-04 |
| [ADR-006](./006-fastapi-sqlalchemy.md) | FastAPI + SQLAlchemy 2.0 en backend | Aceptado | 2026-04 |
| [ADR-007](./007-react-tanstack-frontend.md) | React 19 + TanStack en frontends | Aceptado | 2026-04 |
| [ADR-008](./008-casbin-autorizacion.md) | Casbin para autorización fine-grained | Aceptado | 2026-04 |
| [ADR-009](./009-git-fuente-prompt.md) | Git como fuente de verdad del prompt | Aceptado | 2026-04 |
| [ADR-010](./010-append-only-clasificaciones.md) | Append-only para clasificaciones | Aceptado | 2026-04 |
| [ADR-011](./011-pgvector-rag.md) | pgvector para RAG en MVP | Aceptado | 2026-04 |
| [ADR-012](./012-monorepo-pnpm-uv.md) | Monorepo con pnpm workspaces + uv | Aceptado | 2026-04 |
| [ADR-013](./013-opentelemetry-observabilidad.md) | OpenTelemetry como estándar de observabilidad | Aceptado | 2026-04 |
| [ADR-014](./014-docker-k8s-deployment.md) | Docker Compose en dev, Kubernetes en prod | Aceptado | 2026-04 |
| [ADR-015](./015-blue-green-rolling-deploy.md) | Blue-green para servicios académicos, rolling para workers | Aceptado | 2026-04 |

## Template

Nuevos ADRs usan [`_template.md`](./_template.md).
