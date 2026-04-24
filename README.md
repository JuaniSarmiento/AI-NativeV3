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
| Tests | **~440 passing** (+ 4 RLS skipped en dev) |
| Apps (servicios + frontends) | 15 (12 servicios Python + 3 frontends) |
| Packages compartidos | 7 |
| LOC Python | ~27.000 |
| LOC TypeScript | ~5.200 |
| Migraciones Alembic | 7 |
| ADRs | 16 |

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

## Decisiones arquitectónicas recientes

### ADR-016 — TareaPractica: plantilla + instancia (2026-04-23)

Cada **cátedra** (materia + período) define una `TareaPracticaTemplate` como fuente canónica editable. Al crearla, el sistema **auto-instancia** una `TareaPractica` en cada comisión de esa materia+período — así los estudiantes de A-Mañana, B-Tarde, C-Noche reciben el **mismo** enunciado/rúbrica/fechas sin que el docente tenga que copiar manualmente.

- Si el docente edita una instancia directamente (sin pasar por el template), se marca `has_drift=true` — mantiene el vínculo al template pero queda excluida del re-sync automático al versionarlo.
- `problema_id` del episodio CTR sigue apuntando a la **instancia**, no al template — cadena criptográfica SHA-256 intacta, `curso_config_hash` per-Comisión preservado.
- Casbin: +14 policies sobre el nuevo recurso `tarea_practica_template` (total 108).
- UI: `web-teacher` tiene vista "Plantillas" con cascada Universidad → Facultad → Carrera → Plan → Materia → Período.

Ver [`docs/adr/016-tp-template-instance.md`](docs/adr/016-tp-template-instance.md) para el diseño completo + migración + alternativas descartadas.

## Empezar

Requisitos: **Python 3.12**, **uv**, **pnpm**, **Docker** (compose v2), **Node 20+**, **make**.

> En Windows: `winget install ezwinports.make` y reiniciar Git Bash. Usar Git Bash o WSL.

### Paso 1 — Bootstrap (primera vez)

```bash
git clone <repo>
cd jr-3-main
make init     # infra Docker + deps + migraciones + seed Casbin
```

### Paso 2 — Levantar infraestructura

Si ya hiciste `make init` antes, solo necesitas levantar los containers:

```bash
make dev-bootstrap
```

Servicios de infraestructura:

| Servicio    | URL                          | Credenciales        |
|-------------|------------------------------|---------------------|
| PostgreSQL  | `localhost:5432`             | postgres/postgres   |
| Keycloak    | `http://localhost:8180`      | admin/admin         |
| Redis       | `localhost:6379`             | —                   |
| MinIO       | `http://localhost:9001`      | minioadmin/minioadmin |
| Grafana     | `http://localhost:3000`      | admin/admin         |
| Prometheus  | `http://localhost:9090`      | —                   |

### Paso 3 — Levantar frontends

```bash
make dev
```

> **Importante**: `make dev` **SÓLO levanta los 3 frontends Vite** (hot-reload via `pnpm turbo dev`). **NO levanta los 12 servicios Python** — para eso, ver el Paso 4. Los frontends van a renderizarse, pero cualquier interacción con la API va a fallar hasta que arranques los backends a mano.

| Frontend      | URL                      |
|---------------|--------------------------|
| web-admin     | `http://localhost:5173`   |
| web-teacher   | `http://localhost:5174`   |
| web-student   | `http://localhost:5175`   |

> Si los puertos estan ocupados, Vite asigna el siguiente disponible. Revisar el log de `make dev`.

### Paso 4 — Levantar servicios backend

Los 12 servicios Python se arrancan **cada uno en su propia terminal**:

```bash
# api-gateway (OBLIGATORIO — proxy de entrada para los frontends)
uv run uvicorn api_gateway.main:app --port 8000 --reload

# identity-service
uv run uvicorn identity_service.main:app --port 8001 --reload

# academic-service
uv run uvicorn academic_service.main:app --port 8002 --reload

# enrollment-service
uv run uvicorn enrollment_service.main:app --port 8003 --reload

# evaluation-service
uv run uvicorn evaluation_service.main:app --port 8004 --reload

# analytics-service
uv run uvicorn analytics_service.main:app --port 8005 --reload

# tutor-service
uv run uvicorn tutor_service.main:app --port 8006 --reload

# ctr-service
uv run uvicorn ctr_service.main:app --port 8007 --reload

# classifier-service
uv run uvicorn classifier_service.main:app --port 8008 --reload

# content-service
uv run uvicorn content_service.main:app --port 8009 --reload

# governance-service (ver "Prompts del tutor" abajo)
# Nota: la env var correcta es PROMPTS_REPO_PATH (el .env.example dice GOVERNANCE_REPO_PATH
# por deuda del template — el código no la lee). El repo incluye ai-native-prompts/ con el
# prompt N4 minimo sembrado; en Windows usar ruta absoluta:
PROMPTS_REPO_PATH="$(pwd)/ai-native-prompts" uv run uvicorn governance_service.main:app --port 8010 --reload

# ai-gateway
uv run uvicorn ai_gateway.main:app --port 8011 --reload
```

Para el flujo minimo (estudiante abre TP y chatea con el tutor) necesitas al menos:
**api-gateway** + **academic-service** + **tutor-service** + **ctr-service** + **governance-service** + **ai-gateway**.

### Paso 5 — Prompts del tutor (governance-service)

El governance-service sirve prompts versionados desde un repo en filesystem (ADR-009). **El repo ya incluye `ai-native-prompts/prompts/tutor/v1.0.0/system.md`** con un prompt N4 mínimo sembrado en sesión 2026-04-23. **No hace falta crearlo** — sólo asegurate de arrancar el governance-service con la env var correcta (ver Paso 4).

Si querés personalizar el prompt, editá `ai-native-prompts/prompts/tutor/v1.0.0/system.md` y reiniciá el governance-service. El hash se recomputa automáticamente y viaja en cada evento CTR como `prompt_system_hash`.

> **Gotcha conocido**: el `.env.example` declara `GOVERNANCE_REPO_PATH` pero el código lee `PROMPTS_REPO_PATH` — **son nombres distintos**. Hay que pasar la var correcta en el CLI del governance-service (no alcanza el `.env`). Ver `CLAUDE.md` sección "Gotchas de entorno" para el contexto completo.

### Paso 6 — Datos demo (opcional, recomendado)

Hay dos seeds complementarios — usar el nuevo para demos de comparación de cohortes:

```bash
# Opción A — Seed básico: 1 comisión, 6 estudiantes, 30 episodios
uv run python scripts/seed-demo-data.py

# Opción B — Seed extendido (RECOMENDADO): 3 comisiones (A-Manana, B-Tarde, C-Noche)
# con 18 estudiantes + 94 episodios + 2 plantillas de TP auto-instanciadas en las 3
# comisiones (demostración completa del ADR-016).
uv run python scripts/seed-3-comisiones.py
```

Ambos son **idempotentes** — se pueden correr repetidas veces. El seed extendido pisa lo que haya dejado el básico si se corre después. Cohortes del seed B están deliberadamente diferenciadas (A=balanceada, B=cohorte fuerte, C=cohorte con dificultades) para que el dashboard de progresión del `web-teacher` muestre patrones distintos.

### Paso 7 — Verificar

```bash
make status        # Estado de containers + health checks
make check-health  # Solo health checks de los 12 servicios
```

### Resumen de URLs

| Servicio | URL | Notas |
|---|---|---|
| web-admin | http://localhost:5173 | Gestion academica |
| web-teacher | http://localhost:5174 | TPs, materiales, progresion |
| web-student | http://localhost:5175 | IDE + tutor socratico |
| API Gateway | http://localhost:8000 | Entrada unica para APIs |
| Grafana | http://localhost:3000 | admin/admin |
| Keycloak | http://localhost:8180 | admin/admin |

### Modo dev sin Keycloak

En desarrollo, el api-gateway corre con `dev_trust_headers=True`. Los frontends inyectan headers
`X-User-Id`, `X-Tenant-Id`, `X-User-Email`, `X-User-Roles` automaticamente via el proxy de Vite.
No necesitas onboardear Keycloak para desarrollo local.

### Gotchas en Windows

- Usar **Git Bash** o **WSL** — el Makefile requiere bash.
- Despues de `winget install ezwinports.make`, **reiniciar Git Bash**.
- Si hay containers Docker de otros proyectos, usar `127.0.0.1` en vez de `localhost` en URLs de servicio (IPv6 dual-stack).
- Si Vite cambia de puerto por colision, revisar el log de `make dev`.

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
