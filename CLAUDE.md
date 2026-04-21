# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

Monorepo de la plataforma AI-Native N4 — **tesis doctoral (UNSL) de Alberto Alejandro Cortez**: "Modelo AI-Native con Trazabilidad Cognitiva N4 para la Formación en Programación Universitaria". El repo corre el **piloto UNSL** con 10 fases integradas (F0–F9). No es un producto comercial — muchas decisiones existen por **aceptabilidad académica / ética** (auditabilidad, reproducibilidad bit-a-bit, privacidad).

## Stack y layout

Monorepo híbrido **Python (uv) + TypeScript (pnpm + turbo)**. Dos workspaces se superponen sobre la misma estructura `apps/*` + `packages/*`:

- **uv workspace** (`pyproject.toml` → `[tool.uv.workspace]`) lista los 12 servicios Python y los packages Python (`packages/contracts`, `packages/test-utils`). Los demás paquetes son TS-only.
- **pnpm workspace** (`pnpm-workspace.yaml`) incluye TODO `apps/*` + `packages/*`, pero sólo los 3 frontends (`web-*`) y packages TS (`ui`, `auth-client`, `ctr-client`, `observability`, `platform-ops`) tienen `package.json`. `packages/contracts` es workspace dual — tiene `pyproject.toml` Y `package.json`.
- `turbo.json` orquesta tareas JS/TS (`build`, `dev`, `lint`, `typecheck`, `test`). Los tests Python **no** pasan por turbo — se corren directo con `uv run pytest`.
- `conftest.py` raíz agrega el `src/` de cada paquete y servicio al `sys.path`, por eso `pytest` desde la raíz resuelve imports sin instalación editable.

Servicios Python = **FastAPI + SQLAlchemy 2.0 + Alembic**, con `structlog` + OpenTelemetry. Layout por servicio: `apps/<svc>/src/<svc_snake>/{routes,services,auth,...}`, `tests/{unit,integration}`, `pyproject.toml` con `hatchling`. Frontends = **React 19 + Vite 6 + TanStack Router/Query + Tailwind 4 + Keycloak-js + Monaco/Pyodide** (web-student).

### Puertos locales (dev)

| Servicio | Puerto |
|---|---|
| api-gateway | 8000 |
| identity-service | 8001 |
| academic-service | 8002 |
| enrollment-service | 8003 |
| evaluation-service | 8004 |
| analytics-service | 8005 |
| tutor-service | 8006 |
| ctr-service | 8007 |
| classifier-service | 8008 |
| content-service | 8009 |
| governance-service | 8010 |
| ai-gateway | 8011 |
| web-admin | 5173 |
| web-teacher | 5174 |
| web-student | 5175 |

Todas las llamadas externas entran por `api-gateway` (:8000). Los puertos de los servicios internos son sólo para debug directo.

## Comandos

Toda la orquestación va por `Makefile`. Usar siempre `make` en vez de invocar las herramientas sueltas — mete defaults importantes (`EMBEDDER=mock`, `RERANKER=identity`, `STORAGE=mock`, `LLM_PROVIDER=mock`) para que el dev loop corra sin API keys reales.

```bash
make init              # Primera vez: docker compose up + uv sync + pnpm install + migrate + seed-casbin
make dev               # hot-reload de los 3 frontends Vite vía `pnpm turbo dev`. NO levanta los 12 servicios Python; esos hay que arrancarlos uno a uno con `uv run uvicorn <svc>.main:app --port <port>` o con un wrapper propio (ver `scripts/start-all-services.sh` si existe). La primera vez en Windows, asumir nada: `make` no viene en Git Bash default (instalar con `choco`/`scoop`, o correr los targets a mano).
make dev-bootstrap     # Sólo infra (postgres, keycloak, redis, minio, grafana, prometheus, jaeger)

make test              # Python (apps/*/tests/unit + casbin matrix + packages/*/tests) + `turbo test`
make test-fast         # Sólo Python, `-x` (~25s)
make test-rls          # Aislamiento multi-tenant contra Postgres real — requiere CTR_STORE_URL_FOR_RLS_TESTS
make test-adversarial  # pytest -m "adversarial"

make lint / lint-fix   # ruff + biome
make typecheck         # mypy --strict + tsc
make check-rls         # Script que falla si hay tabla con `tenant_id` sin RLS policy (gate de CI)
make check-health      # Pega /health de cada servicio

make migrate           # scripts/migrate-all.sh — aplica Alembic en las 3 bases
make migrate-new SERVICE=<svc> NAME=<desc>   # Nueva revision autogen

make onboard-unsl      # Bootstrap Keycloak realm + federación LDAP + feature flags del piloto
make generate-protocol # Regenera el DOCX del protocolo UNSL (auditoría académica)
make status            # Tabla de estado de los 12 servicios + infra
make backup / restore  # Dump/restore de las 3 bases (para preservar estado de piloto)
```

Para correr **un único test** sin turbo:

```bash
uv run pytest apps/tutor-service/tests/unit/test_foo.py::test_bar -v
cd apps/web-student && pnpm test -- src/components/Foo.test.tsx
```

Comandos para analizar el piloto (`kappa`, `progression`, `export-academic`) pegan a `analytics-service` en `:8005` vía `curl` — dependen de que `make dev` esté corriendo y de tener un `TOKEN` válido (por defecto `dev-token`).

## Arquitectura en dos planos

La plataforma está deliberadamente partida en dos planos desacoplados por un **bus Redis Streams particionado**:

1. **Plano académico-operacional** (`academic-service`, `enrollment-service`, `evaluation-service`, `analytics-service`, `identity-service`): CRUDs tradicionales, dashboards, federación Keycloak.
2. **Plano pedagógico-evaluativo** (`tutor-service`, `ctr-service`, `classifier-service`, `content-service`, `governance-service`): núcleo de la tesis. Tutor socrático con SSE, CTR como **cadena criptográfica SHA-256 append-only**, clasificador N4 con 5 coherencias, RAG con pgvector, prompt versionado.

Transversales:

- `api-gateway`: único punto de auth — emite JWT RS256 e inyecta autoritativamente los headers `X-Tenant-Id`, `X-User-Id`, `X-Role` a los servicios internos.
- `ai-gateway`: LLM proxy con budget por tenant, cache, fallback. **Todo LLM/embedding pasa por `ai-gateway`** — ningún servicio llama proveedores directo.

**Tres bases lógicas separadas** (ADR-003): `academic_main`, `ctr_store`, `identity_store`. No hacer joins cross-base — los servicios se comunican por eventos o HTTP.

**Multi-tenancy = Row-Level Security de Postgres** (ADR-001). Toda tabla con `tenant_id` **debe** tener policy RLS activa, y el driver entra con `SET LOCAL app.current_tenant = ...` por request (helper `set_tenant_rls(session, tenant_id)`). `make check-rls` lo verifica y corre en CI.

## Propiedades críticas (invariantes del sistema)

Estas NO son sugerencias — están verificadas por tests y fundamentan la aceptabilidad académica del piloto. Antes de tocar código en estas áreas, leer el ADR correspondiente:

- **CTR append-only** (ADR-010): nunca `UPDATE`/`DELETE` de eventos. Reclasificar = `is_current=false` en el viejo + `INSERT` del nuevo. La única excepción es `Episode.integrity_compromised=true` cuando el integrity checker detecta tampering — documentado en `reglas.md` RN-039/RN-040.
- **api-gateway es el ÚNICO source of truth de identidad**: servicios internos confían en headers `X-Tenant-Id`, `X-User-Id`, `X-Role` del gateway. No re-verificar JWT aguas abajo.
  - **Excepción temporal (TODO F9)**: el endpoint `/api/v1/analytics/cohort/{id}/progression` en `apps/analytics-service/src/analytics_service/routes/analytics.py:260` hardcodea `tenant_id = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")` en vez de leer `X-Tenant-Id` del gateway. Es un workaround de dev para el piloto; debe removerse antes de staging. Documentado como BUG-21 en `BUGS-PILOTO.md`.
- **Hash determinista de `classifier_config_hash`**: la reproducibilidad bit-a-bit está cubierta por test de integración (`test_pipeline_reproducibility.py`). Cualquier cambio en serialización de config rompe auditabilidad.
- **Las 5 coherencias se mantienen SEPARADAS**: `CT`, `CCD_mean`, `CCD_orphan_ratio`, `CII_stability`, `CII_evolution`. Nunca colapsarlas en un score único — la tesis depende de análisis multidimensional.
- **Write-only al CTR desde `tutor-service`**, excepto el evento `codigo_ejecutado` que usa el `user_id` del estudiante autenticado (no el del tutor).
- **Export académico**: `salt` ≥ 16 chars, `include_prompts=False` por default. No afloje esto por conveniencia.
- **LDAP federation es READ-ONLY**: la plataforma nunca modifica el directorio institucional (condición del convenio).
- **Dev mode sin Keycloak onboardeado**: cuando el api-gateway corre con `dev_trust_headers=True` (default en dev) y Keycloak no tiene el realm cargado, los frontends deben mandar `X-User-Id`, `X-Tenant-Id`, `X-User-Email`, `X-User-Roles` en vez de un Bearer JWT. Los `vite.config.ts` de los 3 frontends tienen un `configure` hook que inyecta esos headers. Ver BUG-22 y BUG-23 en `BUGS-PILOTO.md`.

### Constantes que NO deben inventarse ni cambiarse

- **Service-account del tutor**: `TUTOR_SERVICE_USER_ID = UUID("00000000-0000-0000-0000-000000000010")` (en `apps/tutor-service/src/tutor_service/services/tutor_core.py`). Los eventos CTR del tutor llevan ese `user_id`, excepto `codigo_ejecutado` (que usa el `user_id` del estudiante real). Si necesitás un UUID de service-account para algo nuevo, NO reuses éste — definí uno propio.
- **Genesis del CTR**: `GENESIS_HASH = "0" * 64` (definido en `packages/contracts/src/platform_contracts/ctr/hashing.py` y replicado en `apps/ctr-service/src/ctr_service/models/base.py`). Es el `prev_chain_hash` del primer evento (`seq=0`) de cada episodio. Cambiarlo invalida toda cadena existente.
- **Serialización canónica NO es uniforme entre hashes** — cada uno tiene su fórmula, cotejada contra el código:
  - **CTR `self_hash`** (`packages/contracts/.../ctr/hashing.py::compute_self_hash`): `event.model_dump_json(exclude={"self_hash","chain_hash"})` → `json.loads` → `json.dumps(parsed, sort_keys=True, separators=(",", ":"))` → `sha256(...).hexdigest()`. **Sin** `ensure_ascii=False`.
  - **CTR `chain_hash`** (mismo archivo, `compute_chain_hash`): `sha256(f"{self_hash}{prev_chain_hash}".encode("utf-8")).hexdigest()` — concatenación de strings hex, **`self` primero, `prev` después** (no confundir el orden — es contraintuitivo).
  - **`classifier_config_hash`** (`apps/classifier-service/src/classifier_service/services/pipeline.py::compute_classifier_config_hash`): `json.dumps({"tree_version": ..., "profile": ...}, sort_keys=True, ensure_ascii=False, separators=(",", ":"))` → `sha256(...).hexdigest()`. **Con** `ensure_ascii=False` (a diferencia del self_hash del CTR).
  - Tocar cualquier parámetro de estos (sort_keys, separators, ensure_ascii, exclusiones) rompe reproducibilidad bit-a-bit — y con eso la tesis.
- **Sharding CTR**: `NUM_PARTITIONS = 8` (en `apps/ctr-service/src/ctr_service/services/producer.py`). `shard_of(episode_id)` usa los primeros 4 bytes del `SHA-256(str(episode_id))` módulo 8. Single-writer por partición — los workers no pueden escribir en particiones que no son las suyas.
- **`chunks_used_hash`** (`reglas.md` RN-026, `apps/content-service/src/content_service/services/retrieval.py::_hash_chunk_ids`): `sha256("|".join(sorted(str(id) for id in chunk_ids)).encode("utf-8")).hexdigest()`. Lista vacía → hash del string vacío. Debe propagarse de retrieval → evento `prompt_enviado` → evento `tutor_respondio` del mismo turno.

## Convenciones

- **Python**: `ruff` (reglas `E,W,F,I,B,C4,UP,N,S,A,RUF,PL,SIM`), `mypy --strict`, `line-length=100`, docstrings breves en español, nombres de API públicas en inglés. `line too long` (E501) está apagado — lo maneja el formatter.
- **TypeScript**: `biome` (no ESLint/Prettier). `noUncheckedIndexedAccess` estricto. React 19 + hooks. Quotes dobles, sin semicolons, trailing commas.
- **Commits**: Conventional Commits con scope del servicio (`feat(academic): ...`, `fix(ctr): ...`). Branches: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`.
- **Cambios arquitectónicos requieren nuevo ADR**: copiar `docs/adr/_template.md`, numerar `016+`, incluirlo en el mismo PR. ADRs superseded se marcan — no se borran.
- **Coverage**: ≥80% global, ≥85% en plano pedagógico (`tutor`, `ctr`, `classifier`).
- **Tests obligatorios en PRs**: bug fix = test que reproduce el bug; nueva tabla `tenant_id` = test RLS; cambio de contrato = actualizar `packages/contracts` Python **y** TypeScript + test de serialización.

## Dónde buscar contexto

- `docs/adr/001-*.md` … `docs/adr/015-*.md` — 15 ADRs numerados, cada uno justifica una decisión atada a tests.
- `docs/F0-STATE.md` … `docs/F9-STATE.md` — una bitácora por fase de qué quedó en cada milestone (útil para entender por qué un módulo existe).
- `docs/pilot/` — protocolo UNSL (`protocolo-piloto-unsl.docx`), runbook con 10 incidentes codificados `I01`–`I10` en `runbook.md` (I01 integridad CTR = CRÍTICA; I06 borrado = usar `anonymize_student()` sin tocar CTR), notebook de análisis `analysis-template.ipynb`.
- `docs/golden-queries/` — queries de evaluación del retrieval RAG (gate de calidad para cambios en `content-service`). Evaluadas por `scripts/eval-retrieval.py` → `make eval-retrieval`.
- `docs/architecture.md` — pointer al PDF formal + resumen navegable.
- `CONTRIBUTING.md` — branches, reglas de PRs y tests obligatorios (se superpone con este archivo; CLAUDE.md es el source of truth para agentes).
- `historias.md` (raíz) — 124 historias de usuario (HU-001 a HU-124) derivadas de F0–F9, con actor, fase, servicio, criterios de aceptación y trazabilidad a invariantes. Útil para entender la intención de un módulo antes de tocarlo.
- `reglas.md` (raíz) — 127 reglas de negocio (RN-001 a RN-127) clasificadas por severidad (Críticas/Altas/Medias/Bajas) y categoría (Invariante, Cálculo, Validación, Autorización, Persistencia, Privacidad, Operación, Auditoría, Seguridad), con cifras cotejadas contra el código. Leer antes de tocar hashing, clasificador, CTR o privacy.
- `scripts/` — utilitarios de CI, migraciones, smoke tests, onboarding UNSL y export académico. Cuando veas `make X`, el `scripts/X.sh` tiene la lógica real.
- `BUGS-PILOTO.md` (raíz) — reporte de 23 bugs detectados al levantar el piloto por primera vez en Windows limpio + 6 issues conocidos. Cada bug con severidad, ubicación exacta, fix aplicado y recomendación PR. Leer antes de tocar migraciones RLS, workspace Python, dev loop o proxy Vite.
- `scripts/seed-demo-data.py` (raíz) — crea 6 estudiantes con 30 episodios CTR + 30 classifications en la comisión demo (`aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`) para que las vistas del web-teacher muestren data real. Idempotente.

## CI y deploy

- `.github/workflows/ci.yml` — gate de PR: `ruff` + `mypy --strict` + `tsc` + `pytest` (unit + integration) + `make check-rls` + dry-run de migraciones + coverage a Codecov. **Todo lo que rompe CI rompe el merge** — correr `make lint typecheck test check-rls` local antes de pushear.
- `.github/workflows/deploy.yml` — `helm upgrade` a staging/prod + `scripts/smoke-tests.sh` post-deploy + notificaciones. Requiere secrets `KUBECONFIG_STAGING` / `KUBECONFIG_PROD` (base64) ya configurados en GitHub. No tocar sin coordinar.
- `infrastructure/helm/platform/` — chart único para los 12 servicios + 3 frontends. Values por ambiente (`values-staging.yaml`, `values-prod.yaml`).
- **Estrategia de deploy por servicio** (ADR-015): servicios HTTP → blue-green atómico; workers CTR → rolling (preserva invariante single-writer por partición). Canary de `tutor-service` con Argo Rollouts (`ops/k8s/canary-tutor-service.yaml`): 10% → 2min → 50% → 5min → 100%, con rollback automático si `ctr_episodes_integrity_compromised_total` incrementa.
- No hay pre-commit hooks (`.pre-commit-config.yaml` / `.husky/`) — la verificación vive en CI y en los `make` targets. Si agregás uno, documentá el ADR.

## Gotchas de entorno

- Windows: el `Makefile` asume bash (`SHELL := /bin/bash`), Postgres vía Docker. Usar Git Bash / WSL.
- La primera `uv sync --all-packages` tarda 3–5 min.
- Testcontainers baja imágenes la primera corrida (`pgvector/pgvector:pg16`, `redis:7-alpine`) — pre-pullear si la red es lenta.
- Stack local completo ≈ 4 GB RAM. Comentar observabilidad en `infrastructure/docker-compose.dev.yml` si la máquina es chica.
- Los defaults de env (`EMBEDDER=mock`, `RERANKER=identity`, `LLM_PROVIDER=mock`, `STORAGE=mock`) son clave para que el test suite no necesite API keys ni red — si los sobreescribís, vas a romper tests deterministas.
- `.env.example` define usuarios DB separados por plano (`academic_user`, `ctr_user`, `identity_user`) — respetarlos, ADR-003 los exige aislados (auditoría + RLS).
- Migraciones y tests contra Postgres real requieren estas env vars (las lee `scripts/migrate-all.sh` y los tests RLS): `ACADEMIC_DB_URL`, `CTR_STORE_URL`, `CLASSIFIER_DB_URL`, `CONTENT_DB_URL`. El target `make test-rls` específicamente exige `CTR_STORE_URL_FOR_RLS_TESTS` (apuntando a una base con usuario no-superuser para que RLS aplique) — sin esa var, los 4 tests de RLS real se skippean en silencio.
- **Windows + Docker Desktop + containers de otros proyectos**: `localhost` resuelve IPv6 (`::1`) primero. Si hay containers ajenos en `0.0.0.0:PORT`, clientes JS/Python pegan al container equivocado. **Regla**: en cualquier URL de servicio-a-servicio del dev loop (config del api-gateway, Vite proxies, curls de smoke-test), usar **`127.0.0.1` explícito** en vez de `localhost`. Vite 6 bindea default **solo IPv6** — para los frontends usar `localhost` (no `127.0.0.1`).
