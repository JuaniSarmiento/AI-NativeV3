# Plataforma AI-Native con Trazabilidad Cognitiva N4

Monorepo integrado para la tesis doctoral de **Alberto Alejandro Cortez**
(UNSL) — _"Modelo AI-Native con Trazabilidad Cognitiva N4 para la
Formación en Programación Universitaria"_.

Este repositorio contiene **la plataforma completa** que ejecuta el
estudio piloto en UNSL: servicios backend, frontends, observabilidad,
análisis empírico, privacidad, y toda la operación.

## Estado

**Listo para piloto**. Fases F0–F9 integradas.

| Métrica | Valor |
|---|---|
| Tests | **320 passing** (+ 4 RLS skipped en dev) |
| Apps (servicios + frontends) | 15 |
| Packages compartidos | 7 |
| LOC Python | ~25.900 |
| LOC TypeScript | ~3.800 |
| Migraciones Alembic | 6 |
| ADRs | 15 |

## Arquitectura en un vistazo

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  web-student    │   │  web-teacher    │   │  web-admin      │
│  (Vite + React) │   │  (3 vistas F7)  │   │                 │
└────────┬────────┘   └────────┬────────┘   └────────┬────────┘
         │                     │                     │
         └──────────────┬──────┴──────────┬──────────┘
                        ▼                 ▼
                ┌───────────────┐  ┌──────────────┐
                │  api-gateway  │  │   Keycloak   │
                │  (JWT + RLS)  │◄─┤   (+ LDAP)   │
                └───────┬───────┘  └──────────────┘
                        │
      ┌─────────────────┼─────────────────┬─────────────────┐
      ▼                 ▼                 ▼                 ▼
 ┌─────────┐      ┌─────────┐       ┌───────────┐    ┌──────────┐
 │ tutor-  │      │  ctr-   │       │classifier-│    │analytics-│
 │ service │─────▶│ service │◄─────│  service  │───▶│ service  │
 │  (RAG)  │      │ (chain) │       │  (N4)    │    │(F7 + F8) │
 └────┬────┘      └────┬────┘       └──────────┘    └──────────┘
      │                │                    │
      ▼                ▼                    ▼
 ┌──────────────────────────────────────────────┐
 │  Postgres (4 bases lógicas + RLS + FORCE)    │
 │  Redis (sessions + streams)                  │
 │  MinIO (artifacts + backups)                 │
 │  Prometheus + Grafana + Loki                 │
 └──────────────────────────────────────────────┘
```

Ver detalles en [`docs/architecture.md`](docs/architecture.md).

## Empezar (3 comandos)

Requisitos: **Python 3.12**, **uv**, **pnpm**, **Docker** (compose v2), **Node 20+**.

```bash
git clone <repo>
cd platform
make init     # infra + deps + migrate + seed (primera vez)
make dev      # servicios + frontends
```

Luego:

- Student UI: http://localhost:5175
- Teacher UI: http://localhost:5176 (vistas F7: progresión, Kappa, export)
- Admin UI: http://localhost:5174
- API Gateway: http://localhost:8000
- Grafana: http://localhost:3000 (admin/admin)
- Prometheus: http://localhost:9090
- Keycloak: http://localhost:8180 (admin/admin)

## Ejecutar la suite de tests

```bash
make test              # Python 320 + frontends
make test-fast         # Solo Python, termina en ~25s
make test-rls          # Solo multi-tenant contra Postgres real (requiere CTR_STORE_URL_FOR_RLS_TESTS)
```

## Estructura del repo

```
platform/
├── apps/
│   ├── academic-service/      # Usuarios, comisiones, Casbin RBAC
│   ├── content-service/       # Materiales, chunker, RAG (pgvector)
│   ├── ctr-service/           # Cuaderno Trabajo Reflexivo (cadena cripto)
│   ├── classifier-service/    # Árbol N4 + 5 coherencias
│   ├── tutor-service/         # Orquestador socrático (SSE)
│   ├── ai-gateway/            # LLM proxy + budget por tenant
│   ├── governance-service/    # Prompts versionados
│   ├── api-gateway/           # JWT RS256 + inyección X-*
│   ├── analytics-service/     # Kappa, progresión, export (F7-F8)
│   ├── identity-service/      # Federación Keycloak
│   ├── enrollment-service/    # Matrícula
│   ├── evaluation-service/    # Rubricas (futuro)
│   ├── web-student/           # React + Monaco + Pyodide
│   ├── web-teacher/           # React: Progresión + Kappa + Export (F8)
│   └── web-admin/             # Gestión de cohortes
│
├── packages/
│   ├── contracts/             # Schemas + hashing canónico
│   ├── observability/         # OTel + structlog unificado
│   ├── platform-ops/          # Onboarding, privacy, Kappa, audit,
│   │                          # LDAP, longitudinal, A/B, export worker,
│   │                          # real datasources
│   ├── ctr-client/            # Cliente tipado del ctr-service
│   ├── auth-client/           # keycloak-js + authenticated fetch
│   ├── ui/                    # Componentes React compartidos
│   └── test-utils/            # Helpers de testing
│
├── infrastructure/            # docker-compose.dev.yml + observability configs
├── ops/
│   ├── k8s/                   # Manifests K8s + canary Argo Rollouts
│   └── grafana/               # Dashboards + provisioning
│
├── docs/
│   ├── architecture.md        # Diseño general
│   ├── adr/                   # 15 Architecture Decision Records
│   ├── onboarding.md          # Guía para nuevos devs
│   ├── F0-STATE.md ... F9-STATE.md   # Log por fase
│   ├── golden-queries/        # Queries de evaluación RAG
│   └── pilot/                 # Protocolo piloto UNSL
│       ├── protocolo-piloto-unsl.docx   # Documento formal (23KB)
│       ├── generate_protocol.js         # Fuente docx-js
│       ├── runbook.md                   # 10 incidentes codificados
│       ├── analysis-template.ipynb      # Notebook Jupyter de análisis
│       └── README.md                    # Guía operativa del piloto
│
├── examples/
│   └── unsl_onboarding.py     # Script runnable de bootstrap UNSL
│
├── scripts/                   # bash + python (migrate-all, backup, etc.)
├── Makefile                   # Orquestación
└── README.md                  # (este archivo)
```

## Workflows comunes

### Crear un tenant nuevo (ej. UNSL)

```bash
export KEYCLOAK_ADMIN_PASSWORD=admin
export LDAP_BIND_PASSWORD=secret
export TENANT_ADMIN_EMAIL=admin@unsl.edu.ar
make onboard-unsl
```

### Análisis empírico del piloto

```bash
# Progresión longitudinal de una cohorte
make progression COMISION=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa

# Kappa inter-rater (requiere archivo con ratings)
make kappa FILE=ratings.json

# Export académico anonymizado
make export-academic COMISION=<uuid> SALT=mi-salt-de-investigacion-2026
```

O desde el frontend docente en http://localhost:5176.

### Backup y restore

```bash
PG_BACKUP_PASSWORD=xxx make backup
make restore DIR=/var/backups/platform/2026-04-20
```

### Regenerar el protocolo del piloto

```bash
make generate-protocol
# → docs/pilot/protocolo-piloto-unsl.docx
```

### Correr un análisis estadístico sobre los datos del piloto

```bash
jupyter notebook docs/pilot/analysis-template.ipynb
# Editar DATASET_PATH y correr todas las celdas
```

## Documentación por rol

### Si sos **docente participante** del piloto UNSL

1. Leer [`docs/pilot/README.md`](docs/pilot/README.md) — operativa diaria
2. Entrar a http://localhost:5176 — UI con las 3 vistas del piloto
3. Ante un incidente: [`docs/pilot/runbook.md`](docs/pilot/runbook.md)

### Si sos **desarrollador nuevo** contribuyendo al código

1. Leer [`docs/onboarding.md`](docs/onboarding.md)
2. Ejecutar `make init` para entorno local
3. Revisar [`docs/adr/`](docs/adr/) para decisiones arquitectónicas clave
4. [`CONTRIBUTING.md`](CONTRIBUTING.md) para el workflow de contribución

### Si sos **investigador** analizando los datos

1. Leer [`docs/pilot/protocolo-piloto-unsl.docx`](docs/pilot/protocolo-piloto-unsl.docx)
2. Descargar dataset: `make export-academic` o desde la UI docente
3. Usar [`docs/pilot/analysis-template.ipynb`](docs/pilot/analysis-template.ipynb)

### Si sos **ops** desplegando la plataforma

1. Configurar secrets (`.env` desde `.env.example`)
2. Aplicar migraciones: `make migrate` (ver [`scripts/migrate-all.sh`](scripts/migrate-all.sh))
3. Verificar RLS: `make check-rls`
4. Montar dashboards Grafana: ya auto-provisiona desde
   [`ops/grafana/provisioning/`](ops/grafana/provisioning/)
5. Configurar canary: [`ops/k8s/canary-tutor-service.yaml`](ops/k8s/canary-tutor-service.yaml)

## Propiedades críticas preservadas

Este repo encarna decisiones arquitectónicas específicas, verificadas
por tests automatizados. **Al modificar código, respetar**:

- **CTR append-only** — nunca UPDATE/DELETE de eventos. Reclasificar =
  marcar viejo con `is_current=false` + INSERT nuevo.
- **RLS multi-tenant** — toda tabla con `tenant_id` debe tener policy
  activa. `make check-rls` lo verifica.
- **api-gateway como único source of truth de identidad** — los
  servicios internos confían en los headers X-* del gateway.
- **Hash determinista del classifier_config_hash** — reproducibilidad
  bit a bit verificada con test de integración.
- **Preservar las 5 coherencias separadas** (CT, CCD_mean,
  CCD_orphan_ratio, CII_stability, CII_evolution) — nunca colapsar en
  un score único.
- **Write-only al CTR desde tutor-service**, excepto `codigo_ejecutado`
  que usa el `user_id` del estudiante autenticado.
- **Salt mínimo 16 chars** en export académico, `include_prompts=False`
  por default.
- **LDAP federation READ_ONLY** — la plataforma nunca modifica el
  directorio institucional.

## Fases del desarrollo

El monorepo se construyó incrementalmente en 10 fases. Cada una tiene
su doc de estado en [`docs/F*-STATE.md`](docs/):

| Fase | Alcance |
|---|---|
| F0 | Monorepo semilla (12 servicios + 3 frontends + CI + docs) |
| F1 | academic-service + enrollment-service (RLS + Casbin) |
| F2 | content-service con RAG (pgvector + chunker estratificado) |
| F3 | ctr-service (cadena cripto) + classifier + tutor + ai-gateway |
| F4 | Hardening: SLOs, rate limiting, integrity checker |
| F5 | Multi-tenant producción: JWT, onboarding, privacy, Pyodide |
| F6 | Piloto UNSL: feature flags runtime, Kappa, audit, LDAP, canary |
| F7 | Empírico: longitudinal, A/B profiles, export worker |
| F8 | Adaptadores DB reales + frontend docente + Grafana + protocolo DOCX |
| F9 | Preflight operacional: RLS migrations, runbook, notebook |

## Licencia

Ver [`LICENSE`](LICENSE).

## Contacto

- **Investigador principal**: Alberto Alejandro Cortez · UNSL
- **Dudas del código**: issues del repo
- **Comité de ética UNSL**: cei@unsl.edu.ar
