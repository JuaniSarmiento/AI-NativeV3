# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

Monorepo de la plataforma AI-Native N4 — **tesis doctoral (UNSL) de Alberto Alejandro Cortez**: "Modelo AI-Native con Trazabilidad Cognitiva N4 para la Formación en Programación Universitaria". El repo corre el **piloto UNSL** con 10 fases integradas (F0–F9). No es un producto comercial — muchas decisiones existen por **aceptabilidad académica / ética** (auditabilidad, reproducibilidad bit-a-bit, privacidad).

## Known issues críticos (leer antes de empezar)

- **Engram MCP roto** (FTS schema bug `table observations_fts has no column named topic_key`): cualquier `mem_save` falla. Hasta arreglar, persistencia de hallazgos va a este `CLAUDE.md`, a `docs/SESSION-LOG.md` o a `BUGS-PILOTO.md` — **no a engram**. Si tu protocolo global te dice "save proactivamente", ignoralo en este repo hasta que se arregle.
- **Vite y `localhost` en Windows**: `localhost` resuelve IPv6 (`::1`) primero. Si hay containers Docker ajenos en `0.0.0.0:PORT`, los clientes pegan al container equivocado. Usar **`127.0.0.1` explícito** en config de servicio-a-servicio (api-gateway, Vite proxies, smoke-tests). Para los frontends Vite (que bindean solo IPv6 default) usar `localhost`. Ver "Gotchas de entorno" para la regla completa.

## Stack y layout

Monorepo híbrido **Python (uv) + TypeScript (pnpm + turbo)**. Dos workspaces se superponen sobre la misma estructura `apps/*` + `packages/*`:

- **uv workspace** (`pyproject.toml` → `[tool.uv.workspace]`) lista los 12 servicios Python y los 4 packages Python (`packages/contracts`, `packages/test-utils`, `packages/observability`, `packages/platform-ops`). Los demás paquetes (`ui`, `auth-client`, `ctr-client`) son TS-only.
- **pnpm workspace** (`pnpm-workspace.yaml`) incluye TODO `apps/*` + `packages/*`, pero sólo los 3 frontends (`web-*`) y los packages TS (`ui`, `auth-client`, `ctr-client`) tienen `package.json`. `packages/contracts` es workspace dual — tiene `pyproject.toml` Y `package.json`. `packages/observability` y `packages/platform-ops` son Python-only (sólo `pyproject.toml`).
- `turbo.json` orquesta tareas JS/TS (`build`, `dev`, `lint`, `typecheck`, `test`). Los tests Python **no** pasan por turbo — se corren directo con `uv run pytest`.
- `conftest.py` raíz agrega el `src/` de cada paquete y servicio al `sys.path`, por eso `pytest` desde la raíz resuelve imports sin instalación editable.

Servicios Python = **FastAPI + SQLAlchemy 2.0 + Alembic**, con `structlog` + OpenTelemetry. Layout por servicio: `apps/<svc>/src/<svc_snake>/{routes,services,auth,...}`, `tests/{unit,integration}`, `pyproject.toml` con `hatchling`. Frontends = **React 19 + Vite 6 + TanStack Router/Query + Tailwind 4 + Keycloak-js + Monaco/Pyodide** (web-student).

### Puertos locales (dev)

**Servicios HTTP**: todas las llamadas externas entran por `api-gateway` (:8000). Los puertos internos son sólo para debug directo.

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

**Infra (docker-compose.dev.yml)**: para conectar DBeaver, Redis Insight, browser de buckets, etc.

| Servicio | Puerto | Notas |
|---|---|---|
| postgres | 5432 | 4 bases lógicas: `academic_main`, `ctr_store`, `classifier_db`, `content_db` |
| redis | 6379 | bus + cache + session state |
| keycloak | 8080 | admin console; realm UNSL del piloto |
| minio | 9000 / 9001 | API / consola web (storage para `content-service`) |
| grafana | 3000 | login admin/admin default |
| prometheus | 9090 | métricas scrape de los 12 servicios |
| jaeger | 16686 | UI de tracing OpenTelemetry |
| loki | 3100 | logs (vía otel-collector → otlphttp/loki) |

## Comandos

Toda la orquestación va por `Makefile`. Usar siempre `make` en vez de invocar las herramientas sueltas — mete defaults importantes (`EMBEDDER=mock`, `RERANKER=identity`, `STORAGE=mock`, `LLM_PROVIDER=mock`) para que el dev loop corra sin API keys reales.

### Daily loop

```bash
make init              # Primera vez: docker compose up + uv sync + pnpm install + migrate + seed-casbin
make dev               # hot-reload de los 3 frontends Vite vía `pnpm turbo dev`. NO levanta los 12 servicios Python ni hay wrapper que lo haga: arrancá cada uno a mano en su propia terminal con `uv run uvicorn <svc_snake>.main:app --port <port> --reload` (puertos en la tabla de arriba). **Arrancalos desde el root del repo, no desde `apps/<svc>/`**: `pydantic_settings` busca `.env` relativo al CWD, y los packages están instalados editable en el venv unificado (uv workspace), así que `uv run uvicorn <svc_snake>.main:app` resuelve el módulo desde cualquier directorio.
make dev-bootstrap     # Sólo infra (postgres, keycloak, redis, minio, grafana, prometheus, jaeger)

make test              # Python (apps/*/tests/unit + casbin matrix + packages/*/tests) + `turbo test`
make test-fast         # Sólo Python, `-x` (~25s)
make lint / lint-fix   # ruff + biome
make typecheck         # mypy --strict + tsc
make check-rls         # Script que falla si hay tabla con `tenant_id` sin RLS policy (gate de CI)
make check-health      # Pega /health de cada servicio
make status            # Tabla de estado de los 12 servicios + infra
```

### Migraciones

```bash
make migrate                                  # scripts/migrate-all.sh — Alembic en las 4 bases
make migrate-new SERVICE=<svc> NAME=<desc>    # Nueva revision autogen
```

### Operacional / piloto / CI

```bash
make test-rls          # Aislamiento multi-tenant contra Postgres real — requiere CTR_STORE_URL_FOR_RLS_TESTS
make test-adversarial  # pytest -m "adversarial"
make onboard-unsl           # Bootstrap Keycloak realm + federación LDAP + feature flags del piloto
make generate-protocol      # Regenera el DOCX del protocolo UNSL (auditoría académica)
make generate-teacher-guide # Regenera el DOCX de la guía de capacitación docente
make generate-docs          # Atajo: regenera ambos DOCX (protocolo + guía docente)
make backup / restore       # Dump/restore de las bases (para preservar estado de piloto)
make eval-retrieval         # Corre golden queries contra el RAG (gate de calidad de content-service)
```

### Tests individuales (sin turbo)

```bash
uv run pytest apps/tutor-service/tests/unit/test_foo.py::test_bar -v
cd apps/web-student && pnpm test -- src/components/Foo.test.tsx
```

Comandos para analizar el piloto (`kappa`, `progression`, `export-academic`, `ab-test-profiles`) pegan a `analytics-service` en `:8005` vía `curl` — dependen de tener `analytics-service` corriendo (arrancalo manual con `uv run uvicorn analytics_service.main:app --port 8005 --reload`; recordá que `make dev` SÓLO levanta los 3 frontends Vite) y de tener un `TOKEN` válido (por defecto `dev-token`). El A/B testing de classifier profiles (OBJ-12, RN-111, HU-118) es **API-only por diseño en F7** — el investigador arma el JSON con gold standard + 2+ profiles candidatos y `POST /api/v1/analytics/ab-test-profiles` devuelve el ganador por κ. Ejemplos en `docs/F7-STATE.md:167-173` y `docs/pilot/runbook.md:178-186`. La UI con drag-and-drop está deferida a F8+ (`docs/F7-STATE.md:227`).

## Arquitectura en dos planos

La plataforma está deliberadamente partida en dos planos desacoplados por un **bus Redis Streams particionado**:

1. **Plano académico-operacional** (`academic-service`, `enrollment-service`, `evaluation-service`, `analytics-service`, `identity-service`): CRUDs tradicionales, dashboards, federación Keycloak.
2. **Plano pedagógico-evaluativo** (`tutor-service`, `ctr-service`, `classifier-service`, `content-service`, `governance-service`): núcleo de la tesis. Tutor socrático con SSE, CTR como **cadena criptográfica SHA-256 append-only**, clasificador N4 con 5 coherencias, RAG con pgvector, prompt versionado.

Transversales:

- `api-gateway`: único punto de auth — emite JWT RS256 e inyecta autoritativamente los headers `X-Tenant-Id`, `X-User-Id`, `X-Role` a los servicios internos.
- `ai-gateway`: LLM proxy con budget por tenant, cache, fallback. **Todo LLM/embedding pasa por `ai-gateway`** — ningún servicio llama proveedores directo.

**Cuatro bases lógicas separadas**: `academic_main`, `ctr_store`, `classifier_db`, `content_db`. ADR-003 original mencionaba `identity_store` pero quedó sin uso — pseudonimización vive en `packages/platform-ops/privacy.py` rotando `student_pseudonym` en `academic_main.episodes`. No hacer joins cross-base — los servicios se comunican por eventos o HTTP.

**Multi-tenancy = Row-Level Security de Postgres** (ADR-001). Toda tabla con `tenant_id` **debe** tener policy RLS activa, y el driver entra con `SET LOCAL app.current_tenant = ...` por request (helper `set_tenant_rls(session, tenant_id)`). `make check-rls` lo verifica y corre en CI.

## Propiedades críticas (invariantes del sistema)

Estas NO son sugerencias — están verificadas por tests y fundamentan la aceptabilidad académica del piloto. Antes de tocar código en estas áreas, leer el ADR correspondiente:

- **CTR append-only** (ADR-010): nunca `UPDATE`/`DELETE` de eventos. Reclasificar = `is_current=false` en el viejo + `INSERT` del nuevo. La única excepción es `Episode.integrity_compromised=true` cuando el integrity checker detecta tampering — documentado en `reglas.md` RN-039/RN-040.
- **api-gateway es el ÚNICO source of truth de identidad**: servicios internos confían en headers `X-Tenant-Id`, `X-User-Id`, `X-Role` del gateway. No re-verificar JWT aguas abajo. Aplicado a TODOS los endpoints de analytics (kappa, ab-test-profiles, progression, export-academic) — leen los headers vía `Depends`.
- **Hash determinista de `classifier_config_hash`**: la reproducibilidad bit-a-bit está cubierta por `apps/classifier-service/tests/unit/test_pipeline_reproducibility.py`. Cualquier cambio en serialización de config rompe auditabilidad.
- **Las 5 coherencias se mantienen SEPARADAS**: `CT`, `CCD_mean`, `CCD_orphan_ratio`, `CII_stability`, `CII_evolution`. Nunca colapsarlas en un score único — la tesis depende de análisis multidimensional.
- **Write-only al CTR desde `tutor-service`**, excepto el evento `codigo_ejecutado` que usa el `user_id` del estudiante autenticado (no el del tutor).
- **Export académico**: `salt` ≥ 16 chars, `include_prompts=False` por default. No afloje esto por conveniencia.
- **LDAP federation es READ-ONLY**: la plataforma nunca modifica el directorio institucional (condición del convenio).
- **Episodios siempre apuntan a una `TareaPractica` validada**: `tutor.open_episode()` valida 6 condiciones antes del CTR `EpisodioAbierto` (TP existe / tenant matches / comision matches / estado=published / now ≥ fecha_inicio / now ≤ fecha_fin) vía `AcademicClient` en `apps/tutor-service/src/tutor_service/services/academic_client.py`. Doble validación (best-effort): primera al abrir, segunda justo antes del event emission para reducir ventana de race a <1ms.
- **Dev mode sin Keycloak onboardeado**: cuando el api-gateway corre con `dev_trust_headers=True` (default en dev) y Keycloak no tiene el realm cargado, los frontends deben mandar `X-User-Id`, `X-Tenant-Id`, `X-User-Email`, `X-User-Roles` en vez de un Bearer JWT. Los `vite.config.ts` de los 3 frontends tienen un `configure` hook que inyecta esos headers.

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
- **Coverage**: CI gate falla si coverage <60% (umbral pragmático HOY). Target a futuro: ≥80% global / ≥85% pedagogía, con plan de ratchet documentado en `BUGS-PILOTO.md` GAP-9. Para medir el real corriente: `make test` con `--cov`.
- **Tests obligatorios en PRs**: bug fix = test que reproduce el bug; nueva tabla `tenant_id` = test RLS; cambio de contrato = actualizar `packages/contracts` Python **y** TypeScript + test de serialización.

## Sistema de ayuda in-app (HelpButton / helpContent.tsx)

Los 3 frontends exponen ayuda in-app con un patrón uniforme: cada dashboard page tiene un `?` en el header que abre un modal grande con ayuda estructurada (título → intro → lista de acciones → tip box), y cada form de create/edit lleva un `?` chico inline que describe sus campos.

- **Skill que rige el patrón**: `.claude/skills/help-system-content/SKILL.md`. Leerlo ANTES de agregar una página o form nuevo en cualquier frontend — define la estructura JSX obligatoria de cada entry y las 3 reglas duras (HelpButton mandatory en toda page, contenido en `helpContent.tsx` nunca inline, HelpButton `size="sm"` en cada form modal).
- **Foundation compartida**: `packages/ui/src/components/{Modal,HelpButton,PageContainer}.tsx` con tests unitarios en `*.test.tsx` (vitest + @testing-library/react + jsdom — 25 tests totales). Son los únicos componentes de `@platform/ui` con suite de tests hoy.
- **Contenido por frontend**: `apps/web-*/src/utils/helpContent.tsx` — record `key → ReactNode`, una entry por página. Español **sin tildes** (misma política que scripts `check-rls.py`/`casbin_policies.py`, evita encoding issues en stdout de Windows cp1252).
- **Tokens CSS**: `packages/ui/src/tokens/theme.css` define `--text-inverse`, `--text-tertiary`, `--danger-text`. Los 3 `apps/web-*/src/index.css` lo importan vía `@import "@platform/ui/tokens/theme.css"`.
- **Modal variants**: `variant="light"` (default — form modals con inputs legibles sobre `bg-white`) y `variant="dark"` (el skill asume fondo oscuro para tip boxes `bg-zinc-800` y texto `text-zinc-300`). **Los form modals NO deben pasar `variant="dark"`** o sus labels `text-slate-700` quedan invisibles.
- **HelpButton dimensionado (anti-regresión)**: el prop `size` solo afecta al **botón** (`sm` 28px para inline en forms, `md` 36px default para headers). El Modal que abre es SIEMPRE `size="xl"` (`max-w-3xl`, ~768px) + `variant="dark"`, hardcoded. Dos tests en `HelpButton.test.tsx` bloquean regresiones al bug conocido del "popup chiquito y apretado".
- **Tailwind v4 + pnpm workspace (crítico)**: cada `apps/web-*/src/index.css` debe tener `@source "../../../packages/ui/src/**/*.{ts,tsx}"`. Sin eso, Tailwind v4 (que excluye `node_modules` por default) **no escanea** las clases usadas en `@platform/ui` (symlink pnpm) y los modales se renderizan sin `max-width` (full viewport width). El fallo es silencioso en typecheck — solo visible en browser.
- **Excepción documentada**: `apps/web-student/src/pages/EpisodePage.tsx` NO usa `PageContainer`. Razón: layout full-screen (`min-h-screen flex-col`) con header funcional (`ComisionSelector`, botón "Cambiar TP", info dinámica de TP/episodio) que `PageContainer` no puede sustituir. Usa `HelpButton` directo en el header existente. No replicar la excepción sin una justificación equivalente.
- **Conteo actual**: 16 entries totales (web-admin 10 + web-teacher 5 + web-student 1), 6 modales ad-hoc migrados al nuevo `Modal` (1 en web-admin `EditPeriodoModal`, 5 en web-teacher `TareasPracticasView`). La migración de `TareasPracticasView` forzó consolidar 5 booleans mutex en un `ModalState` discriminated union para eliminar una race condition real (dos modales abiertos simultáneos por handlers que no apagaban el previo).

## Estado actual de implementación

**Última verificación: 2026-04-22.** Esta sección lista verdades del sistema HOY que no son obvias del código. Para changelog narrativo de cómo se llegó acá, ver `docs/SESSION-LOG.md`.

### Brechas conocidas (gaps reales)

- **Health checks reales solo en ctr-service**: los k8s probes están wireados en `infrastructure/helm/platform/templates/backend-services.yaml` (sección probes), pero 11/12 servicios devuelven `{"status": "ok"}` hardcoded sin chequear dependencias reales (DB, Redis, Keycloak). Solo `ctr-service` (el más crítico para la tesis) tiene `_check_db()` + `_check_redis()` reales — ver `apps/ctr-service/src/ctr_service/routes/health.py`. **Implicación prod**: pods nunca se marcan NotReady aunque la DB caiga. **Política**: NO sumar el health check real en PRs que toquen estos servicios — es deuda trackeada aparte (`BUGS-PILOTO.md` OBJ-16) y se cierra en un swept dedicado para no mezclar scope.
- **Imágenes Docker en `:latest` sin pinear**: `otel/opentelemetry-collector-contrib` y `grafana/loki` en `infrastructure/docker-compose.dev.yml` no tienen version pin — los breaking changes de upstream van a romper el container loop. Versiones verificadas funcionando: `0.150.1` / `3.7.1`. Pinearlas en un PR separado.
- **Comisión selector queda vacío para estudiantes reales**: `GET /api/v1/comisiones/mis` JOINea `usuarios_comision` (que es para docentes/JTP/auxiliares) — los estudiantes viven en `inscripciones` con `student_pseudonym`. Se va a destrabar en F9 cuando el JWT de Keycloak traiga `comisiones_activas` como claim. Mientras tanto, `selectedComisionId` cae al fallback dev. Documentado en el docstring del endpoint.

### Contratos BC-incompatible vigentes

- **Endpoints de analytics requieren `X-Tenant-Id` + `X-User-Id`**: aplicado a `POST /api/v1/analytics/kappa`, `POST /api/v1/analytics/ab-test-profiles`, y los demás endpoints del plano académico. Curls en docs sin headers van a recibir 401/403. Cuando regeneres `docs/pilot/protocolo-piloto-unsl.docx` con `make generate-protocol`, asegurate que los ejemplos de curl tengan los headers.
- **HU-088 audit log es structlog, no tabla persistente**: el endpoint AB emite event `ab_test_profiles_completed` con `tenant_id`, `user_id`, `kappa_per_profile`, `classifier_config_hash`. Mismo patrón en `kappa_computed`. Si compliance team del piloto requiere tabla queryable, revisitable (S effort, 1-2h).

### Modelos no obvios desde el código

- **`TareaPractica` es la fuente de `Episode.problema_id`**: tabla en `apps/academic-service/src/academic_service/models/operacional.py` con campos `codigo, titulo, enunciado (markdown), fecha_inicio/fin nullable, peso, rubrica JSONB, estado draft|published|archived, version, parent_tarea_id (FK self), created_by`. Versionado inmutable: una vez `published` no se puede editar — se crea nueva versión vía `POST {id}/new-version` que clona y linkea por `parent_tarea_id`. `GET {id}/versions` devuelve la cadena con flag `is_current`. Casbin: `tarea_practica:CRUD` para superadmin/docente_admin/docente, read-only para estudiante.
- **Markdown rendering en frontends**: `react-markdown@9` + `remark-gfm@4`. Componente `MarkdownRenderer.tsx` está **duplicado** en `apps/web-teacher/src/components/` y `apps/web-student/src/components/` (no shared package — overhead). Sin `@tailwindcss/typography` plugin — usa selectors arbitrarios `[&_h1]:text-lg [&_p]:my-2 [&_table]:...`. XSS-safe by default. Rubrica de TPs sigue como `<pre>{JSON.stringify(...)}</pre>` (markdown wrapper sobre JSON luce raro).
- **Casbin policies — sin spec hardcodeado**: el source of truth es el código del seed (`apps/academic-service/src/academic_service/seeds/casbin_policies.py`). Hoy carga ~92 policies (4 roles × N entidades crecientes). RN-018, HU-016, F1-STATE.md ya no especifican un número fijo — evoluciona con el catálogo de recursos.

## Dónde buscar contexto

- `docs/SESSION-LOG.md` — bitácora dated de sesiones de trabajo. Si querés saber **cuándo** y **por qué** se cerró un bug, agregó una entidad o se tomó una decisión, está acá. Las verdades permanentes están promovidas a este archivo.
- `docs/adr/001-*.md` … `docs/adr/015-*.md` — 15 ADRs numerados, cada uno justifica una decisión atada a tests.
- `docs/F0-STATE.md` … `docs/F9-STATE.md` — una bitácora por fase de qué quedó en cada milestone (útil para entender por qué un módulo existe).
- `docs/pilot/` — protocolo UNSL (`protocolo-piloto-unsl.docx`), runbook con 10 incidentes codificados `I01`–`I10` en `runbook.md` (I01 integridad CTR = CRÍTICA; I06 borrado = usar `anonymize_student()` sin tocar CTR), notebook de análisis `analysis-template.ipynb`.
- `docs/pilot/kappa-workflow.md` — procedimiento intercoder para Cohen's kappa (OBJ-13, RN-095/RN-096). Pre-piloto: 2 docentes etiquetan 50 episodios independientemente y se computa κ vía `POST /api/v1/analytics/kappa`. Plantillas en `docs/pilot/kappa-tuning/gold-standard-{template,example}.json`. Target tesis: κ ≥ 0.6.
- `docs/golden-queries/` — queries de evaluación del retrieval RAG (gate de calidad para cambios en `content-service`). Evaluadas por `scripts/eval-retrieval.py` → `make eval-retrieval`.
- `docs/architecture.md` — pointer al PDF formal + resumen navegable.
- `CONTRIBUTING.md` — branches, reglas de PRs y tests obligatorios (se superpone con este archivo; CLAUDE.md es el source of truth para agentes).
- `historias.md` (raíz) — 124 historias de usuario (HU-001 a HU-124) derivadas de F0–F9, con actor, fase, servicio, criterios de aceptación y trazabilidad a invariantes. Útil para entender la intención de un módulo antes de tocarlo.
- `reglas.md` (raíz) — 127 reglas de negocio (RN-001 a RN-127) clasificadas por severidad (Críticas/Altas/Medias/Bajas) y categoría (Invariante, Cálculo, Validación, Autorización, Persistencia, Privacidad, Operación, Auditoría, Seguridad), con cifras cotejadas contra el código. Leer antes de tocar hashing, clasificador, CTR o privacy.
- `scripts/` — utilitarios de CI, migraciones, smoke tests, onboarding UNSL y export académico. Cuando veas `make X`, el `scripts/X.sh` tiene la lógica real.
- `BUGS-PILOTO.md` (raíz) — reporte de bugs detectados al levantar el piloto en Windows limpio + issues conocidos. Cada bug con severidad, ubicación exacta, fix aplicado y recomendación PR. Leer antes de tocar migraciones RLS, workspace Python, dev loop o proxy Vite.
- `scripts/seed-demo-data.py` (raíz) — crea 6 estudiantes con 30 episodios CTR + 30 classifications en la comisión demo (`aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`) para que las vistas del web-teacher muestren data real. Idempotente.
- `scripts/seed-3-comisiones.py` (raíz) — seed extendido: 3 comisiones (A-Mañana, B-Tarde, C-Noche) con 18 estudiantes y 94 episodios en el mismo tenant demo. Cohortes deliberadamente diferenciadas (balanceada / fuerte / con dificultades) para demos comparativos del dashboard `/api/v1/analytics/cohort/{id}/progression`. Idempotente; pisa lo que haya dejado el `seed-demo-data.py` si se corre después.
- **Antes de declarar un OBJ como missing**: grep agresivamente en `packages/platform-ops/` y `packages/observability/` — implementaciones compartidas viven ahí, no necesariamente en `apps/<service>/`. Lección aprendida con 2 falsos negativos (OBJ-10 privacy + OBJ-12 A/B profiles aparecían como MISSING/PARTIAL pero estaban fully implementados en `packages/platform-ops/` con tests + endpoints + docs).
- `.claude/skills/help-system-content/SKILL.md` — patrón obligatorio para el sistema de ayuda in-app (`PageContainer` + `HelpButton` + `helpContent.tsx`). Leer antes de agregar una página o form en cualquier frontend. Ver "Sistema de ayuda in-app" arriba para los detalles operativos.

## CI y deploy

- `.github/workflows/ci.yml` — gate de PR: `ruff` + `mypy --strict` + `tsc` + `pytest` (unit + integration) + `make check-rls` + dry-run de migraciones + coverage a Codecov. **Todo lo que rompe CI rompe el merge** — correr `make lint typecheck test check-rls` local antes de pushear.
- `.github/workflows/deploy.yml` — `helm upgrade` a staging/prod + `scripts/smoke-tests.sh` post-deploy + notificaciones. Requiere secrets `KUBECONFIG_STAGING` / `KUBECONFIG_PROD` (base64) ya configurados en GitHub. No tocar sin coordinar.
- `infrastructure/helm/platform/` — chart único para los 12 servicios + 3 frontends. Values por ambiente (`values-staging.yaml`, `values-prod.yaml`).
- **Estrategia de deploy por servicio** (ADR-015): servicios HTTP → blue-green atómico; workers CTR → rolling (preserva invariante single-writer por partición). Canary de `tutor-service` con Argo Rollouts (`ops/k8s/canary-tutor-service.yaml`): 10% → 2min → 50% → 5min → 100%, con rollback automático si `ctr_episodes_integrity_compromised_total` incrementa.
- No hay pre-commit hooks (`.pre-commit-config.yaml` / `.husky/`) — la verificación vive en CI y en los `make` targets. Si agregás uno, documentá el ADR.

## Gotchas de entorno

### Setup inicial

- Windows: el `Makefile` asume bash (`SHELL := /bin/bash`), Postgres vía Docker. Usar Git Bash / WSL.
- **Instalar `make` en Windows con winget**: `winget install ezwinports.make` instala una versión "portable" cuyo binario queda en `%LOCALAPPDATA%\Microsoft\WinGet\Packages\ezwinports.make_*\bin\make.exe`. **Hay que reiniciar Git Bash** después del install para que el PATH del usuario se refresque, o agregar ese path al PATH de la sesión actual con `export PATH=".../bin:$PATH"`.
- La primera `uv sync --all-packages` tarda 3–5 min.
- Testcontainers baja imágenes la primera corrida (`pgvector/pgvector:pg16`, `redis:7-alpine`) — pre-pullear si la red es lenta.
- Stack local completo ≈ 4 GB RAM. Comentar observabilidad en `infrastructure/docker-compose.dev.yml` si la máquina es chica.

### Dev mode

- Los defaults de env (`EMBEDDER=mock`, `RERANKER=identity`, `LLM_PROVIDER=mock`, `STORAGE=mock`) son clave para que el test suite no necesite API keys ni red — si los sobreescribís, vas a romper tests deterministas.
- `.env.example` define usuarios DB separados por plano (`academic_user`, `ctr_user`) — respetarlos, ADR-003 los exige aislados (auditoría + RLS).
- Migraciones y tests contra Postgres real requieren estas env vars (las lee `scripts/migrate-all.sh` y los tests RLS): `ACADEMIC_DB_URL`, `CTR_STORE_URL`, `CLASSIFIER_DB_URL`, `CONTENT_DB_URL`. El target `make test-rls` específicamente exige `CTR_STORE_URL_FOR_RLS_TESTS` (apuntando a una base con usuario no-superuser para que RLS aplique) — sin esa var, los 4 tests de RLS real se skippean en silencio.
- **`.env` + `pydantic_settings` trap**: los servicios usan `BaseSettings(env_file=".env")` pero sólo cargan las vars *declaradas en el modelo Settings*. Las extras (`extra="ignore"`) se ignoran silenciosamente y NO se inyectan en `os.environ`. Si un servicio lee una var con `os.environ.get("X")` **Y** `X` no está en su `Settings`, tener `X` en `.env` no alcanza: hay que agregarla al modelo o exportarla en el shell antes de arrancar. Caso resuelto en sesión 2026-04-23 con `analytics-service`: leía `CTR_STORE_URL`/`CLASSIFIER_DB_URL` por `os.environ` sin declararlas, entonces caía a stub mode (devolvía `n_students=0` en `/cohort/{id}/progression`) aunque el `.env` las tuviera.
- **Uvicorn + `taskkill` en Windows deja sockets huérfanos**: si matás un uvicorn con `taskkill //F`, el proceso muere pero el socket LISTENING puede quedar en el kernel con el PID del proceso muerto. `netstat -ano` lo muestra, `Get-Process` no encuentra el PID. Nuevos uvicorn en el mismo puerto conviven sin recibir tráfico (Windows prefiere exact-match bindings, primer listener gana). `Stop-NetTCPConnection` NO está disponible en Windows PowerShell 5.1 default. Formas de liberar: esperar timeout del kernel (impredecible, minutos-horas), `wsl --shutdown` (tira Docker), o reboot. **Mitigación pragmática**: para validar un cambio, arrancar en un puerto alternativo temporal (ej. `:8035` si `:8005` tiene zombies) y aceptar que limpiar el puerto canónico puede requerir reboot.
- **Bootstrap del `governance-service` y prompts del tutor**: el `tutor-service` llama a `GET http://governance:8010/api/v1/prompts/tutor/v1.0.0` al abrir cada episodio. Si falla, `POST /api/v1/episodes` del tutor-service devuelve **500** con stack trace `httpx.HTTPStatusError: '404 Not Found' for '/api/v1/prompts/tutor/v1.0.0'`. Tres condiciones tienen que cumplirse simultáneamente para que arranque:
    - **Env var**: el governance-service lee `PROMPTS_REPO_PATH` en su `Settings` — **distinta** al `GOVERNANCE_REPO_PATH` que figura en `.env.example` (deuda del template). Si no se setea, el default es `/var/lib/platform/prompts` que no existe en Windows.
    - **Directorio físico**: tiene que existir `{PROMPTS_REPO_PATH}/prompts/{name}/{version}/system.md` en el filesystem. `make init` NO lo auto-crea.
    - **Prompt mínimo sembrado**: al menos `tutor/v1.0.0` debe existir. Sin esto el web-student no puede abrir ningún episodio.
    - Workaround sesión 2026-04-23: creado `ai-native-prompts/prompts/tutor/v1.0.0/system.md` con prompt N4 mínimo. Relanzar governance con `PROMPTS_REPO_PATH="<ruta absoluta a ai-native-prompts>" uv run uvicorn governance_service.main:app --port 8010 --reload`. La env var del `.env` no alcanza por la deuda del template.

### Windows + Docker + IPv6 (regla crítica)

- **Windows + Docker Desktop + containers de otros proyectos**: `localhost` resuelve IPv6 (`::1`) primero. Si hay containers ajenos en `0.0.0.0:PORT`, Windows enruta por exact-match: un servicio Python bindeado en `127.0.0.1:PORT` **convive** con un container ajeno en `0.0.0.0:PORT` y se queda con los requests a `127.0.0.1:PORT` (exact-match wins). **El problema real es cuando NO hay Python bindeado** — ahí el request cae al container ajeno y `make check-health` puede dar falso positivo porque chequea sólo status 200 en `/health` (muchos containers responden 200 ahí). **Regla**: en cualquier URL de servicio-a-servicio del dev loop (config del api-gateway, Vite proxies, curls de smoke-test), usar **`127.0.0.1` explícito** en vez de `localhost`. Si algo responde raro en un puerto del piloto, chequear `docker ps -a --format '{{.Names}} {{.Ports}}' | grep :PORT` por containers de otros proyectos. Vite 6 bindea default **solo IPv6** — para los frontends usar `localhost` (no `127.0.0.1`).
- **Vite cambia de puerto si hay colisión**: si los puertos 5173/5174/5175 están ocupados (típico cuando hay containers Docker ajenos), Vite intenta el siguiente disponible (5176, 5177...). El log de `make dev` muestra los puertos efectivos en líneas tipo `➜ Local: http://localhost:5176/`. `make status` puede dar falso negativo en estos casos — leer el log de `make dev` es la fuente de verdad.

### Pytest en este monorepo (lecciones operativas)

- **NO agregar `__init__.py` a `apps/<svc>/tests/` (top level)** con `--import-mode=importlib`. Si lo hacés, pytest colapsa los `tests/test_health.py` de los 12 servicios en un único módulo `tests.test_health` y sólo registra los fixtures del primero alfabéticamente (`academic-service`). Resultado: 33 errors en suite. SÍ está OK en `tests/unit/` y `tests/integration/` (subdirs). Worth a `make check-tests-init` lint preventivo en futuro PR.
- **Si pytest se comporta raro después de un cambio en imports**: limpiar caché stale primero: `find apps packages -type d -name __pycache__ -exec rm -rf {} +`.

### Scripts con stdout en Windows

- **Evitar Unicode en stdout-printed strings de scripts Python/bash**. Console code page de Windows (cp1252) hace que `✓` rompa el encoding y devuelva exit non-zero, con CI gates rotos como consecuencia (pasó con `check-rls.py`, `casbin_policies.py`). Usar ASCII `[OK]` / `[FAIL]`, o forzar `sys.stdout.reconfigure(encoding='utf-8')` al inicio del script.

### Frontends React (gotchas del patrón del repo)

- **Hooks que reciben `fetchFn` dependiente de IDs deben memoizarse con `useCallback`**. Los frontends usan el patrón "useState + Promise.then()" (no TanStack Query), entonces un hook tipo `useXxxLevel(fetchFn)` típicamente hace `useEffect(..., [fetchFn])` adentro. Si pasás un closure inline `() => api.foo(id)`, es una **referencia nueva en cada render** → el effect se dispara → setState → re-render → nuevo closure → loop infinito. Síntoma: **rate limiter devuelve 429 con miles de requests en ventanas de 60s** (en `AcademicContextSelector` llegó a ~36 req/s = 2146/60s antes del fix). **Regla**: envolver cada fetchFn con `useCallback(() => api.foo(id), [id, getToken])` antes de pasarlo al hook. Esto NO aplica para callbacks pasados a `onChange` u otros handlers — sólo los que terminan en una dep de `useEffect`. Ejemplo fix canónico: [`AcademicContextSelector.tsx`](apps/web-teacher/src/components/AcademicContextSelector.tsx#L94-L128).
- **Seed Casbin desactualiza el enforcer en memoria** — si hiciste `make seed-casbin` (o corriste el script manual) DESPUÉS de que arrancó un servicio Python, el enforcer en memoria tiene las policies viejas. `--reload` de uvicorn NO lo refresca (no detecta cambio en DB). Hay que **matar y relanzar el servicio** para que tome las policies nuevas. Pasó en sesión 2026-04-23 agregando `facultad:read` al rol docente.
- **`vite.config.ts` de los frontends hardcodea `x-user-id`** — cada frontend inyecta headers X-* en el proxy de `/api/*` (dev mode, api-gateway sin JWT validator). Los UUIDs están hardcoded: web-admin y web-teacher usan `11111111-1111-1111-1111-111111111111` (docente del seed); **web-student usa `b1b1b1b1-0001-0001-0001-000000000001`** (estudiante 1 de A-Mañana del `seed-3-comisiones.py`). Si corrés un seed distinto que no crea ese student_pseudonym, el web-student loguea como alguien que no existe en `inscripciones` y el `TareaSelector` viene vacío silenciosamente. **Sincronizar el UUID del vite.config con el seed activo**. El archivo tiene comentario con el mapping completo (`b1b1b1b1-000{1..6}` = A-Mañana, `b2b2b2b2-` = B-Tarde, `b3b3b3b3-` = C-Noche).
