# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

Monorepo de la plataforma AI-Native N4 — **tesis doctoral (UNSL) de Alberto Alejandro Cortez**: "Modelo AI-Native con Trazabilidad Cognitiva N4 para la Formación en Programación Universitaria". El repo corre el **piloto UNSL** con 10 fases integradas (F0–F9). No es un producto comercial — muchas decisiones existen por **aceptabilidad académica / ética** (auditabilidad, reproducibilidad bit-a-bit, privacidad).

## Known issues críticos (leer antes de empezar)

- **Engram MCP funciona** (verificado 2026-05-04 con `mem_doctor`: 4/4 ok, 0 errors). El proyecto se detecta como `ai-nativev3` via git_remote. Versiones previas del CLAUDE.md decían que estaba roto por un FTS schema bug — ya está resuelto. Usá `mem_save` siguiendo el protocolo global (calibración: 0-2 saves por sesión, sólo lo que persiste y NO es derivable del repo). Hallazgos durables del piloto siguen yendo además a `docs/SESSION-LOG.md` (changelog narrativo) y a `CLAUDE.md` (verdades permanentes) — engram complementa, no reemplaza.
- **Vite y `localhost` en Windows**: `localhost` resuelve IPv6 (`::1`) primero. Si hay containers Docker ajenos en `0.0.0.0:PORT`, los clientes pegan al container equivocado. Usar **`127.0.0.1` explícito** en config de servicio-a-servicio (api-gateway, Vite proxies, smoke-tests). Para los frontends Vite (que bindean solo IPv6 default) usar `localhost`. Ver "Gotchas de entorno" para la regla completa.

## Stack y layout

Monorepo híbrido **Python (uv) + TypeScript (pnpm + turbo)**. Dos workspaces se superponen sobre la misma estructura `apps/*` + `packages/*`:

- **uv workspace** (`pyproject.toml` → `[tool.uv.workspace]`) lista **12 servicios Python activos** (los 13 originales menos `enrollment-service` deprecado por ADR-030, sacado del workspace pero preservado en `apps/enrollment-service/` con README de deprecation) y los 4 packages Python (`packages/contracts`, `packages/test-utils`, `packages/observability`, `packages/platform-ops`). Los demás paquetes (`ui`, `auth-client`, `ctr-client`) son TS-only.
- **pnpm workspace** (`pnpm-workspace.yaml`) incluye TODO `apps/*` + `packages/*`, pero sólo los 3 frontends (`web-*`) y los packages TS (`ui`, `auth-client`, `ctr-client`) tienen `package.json`. `packages/contracts` es workspace dual — tiene `pyproject.toml` Y `package.json`. `packages/observability` y `packages/platform-ops` son Python-only (sólo `pyproject.toml`).
- `turbo.json` orquesta tareas JS/TS (`build`, `dev`, `lint`, `typecheck`, `test`). Los tests Python **no** pasan por turbo — se corren directo con `uv run pytest`.
- `conftest.py` raíz agrega el `src/` de cada paquete y servicio al `sys.path`, por eso `pytest` desde la raíz resuelve imports sin instalación editable.

Servicios Python = **FastAPI + SQLAlchemy 2.0 + Alembic**, con `structlog` + OpenTelemetry. Layout por servicio: `apps/<svc>/src/<svc_snake>/{routes,services,auth,...}`, `tests/{unit,integration}`, `pyproject.toml` con `hatchling`. Frontends = **React 19 + Vite 6 + TanStack Router/Query + Tailwind 4 + Keycloak-js + Monaco/Pyodide** (web-student).

### Puertos locales (dev)

**Servicios HTTP**: todas las llamadas externas entran por `api-gateway` (:8000). Los puertos internos son sólo para debug directo.

| Servicio | Puerto |
|---|---|
| api-gateway | 8000 |
| ~~identity-service~~ | ~~8001~~ | DEPRECATED por ADR-041 (2026-05-07). Auth resuelta en api-gateway (headers X-* + Casbin descentralizado). 0 endpoints reales. Código preservado en `apps/identity-service/` con README de deprecation; sacado del workspace + helm. |
| academic-service | 8002 |
| ~~enrollment-service~~ | ~~8003~~ | DEPRECATED por ADR-030 (2026-04-29). Bulk-import unificado en academic-service (ADR-029). Código preservado en `apps/enrollment-service/` con README de deprecation; sacado del workspace + ROUTE_MAP + helm. |
| evaluation-service | 8004 |
| analytics-service | 8005 |
| tutor-service | 8006 |
| ctr-service | 8007 |
| classifier-service | 8008 |
| content-service | 8009 |
| governance-service | 8010 |
| ai-gateway | 8011 |
| integrity-attestation-service | 8012 (ADR-021, dev local; en piloto vive en infra institucional separada) |
| web-admin | 5173 |
| web-teacher | 5174 |
| web-student | 5175 |

**Infra (docker-compose.dev.yml)**: para conectar DBeaver, Redis Insight, browser de buckets, etc.

| Servicio | Puerto | Notas |
|---|---|---|
| postgres | 5432 | 4 bases lógicas: `academic_main`, `ctr_store`, `classifier_db`, `content_db` |
| redis | 6379 | bus + cache + session state |
| keycloak | 8180 | admin/admin; host 8180 mapeado a 8080 del container (ver `docker-compose.dev.yml:79`); realm UNSL del piloto |
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

### Seeds para demos (scripts directos — NO hay `make` target)

```bash
uv run python scripts/seed-demo-data.py       # 6 estudiantes, 30 episodios, 30 classifications en la comisión demo
uv run python scripts/seed-3-comisiones.py    # Versión extendida: 3 comisiones (A-Mañana / B-Tarde / C-Noche), 18 estudiantes, 94 episodios. Cohortes deliberadamente diferenciadas para el dashboard `/cohort/{id}/progression`.
```

Idempotentes. Si corrés `seed-3-comisiones` después de `seed-demo-data`, **pisa** la data del primero. Recordá sincronizar el UUID hardcoded de `vite.config.ts` del web-student con el seed activo (ver "Frontends React" abajo).

### Tests individuales (sin turbo)

```bash
uv run pytest apps/tutor-service/tests/unit/test_foo.py::test_bar -v
cd apps/web-student && pnpm test -- src/components/Foo.test.tsx
cd apps/web-teacher && pnpm test tests/EpisodeNLevelView.test.tsx   # E2E de una vista (vitest + RTL + jsdom)
```

Comandos para analizar el piloto (`kappa`, `progression`, `export-academic`, `ab-test-profiles`) pegan a `analytics-service` en `:8005` vía `curl` — dependen de tener `analytics-service` corriendo (arrancalo manual con `uv run uvicorn analytics_service.main:app --port 8005 --reload`; recordá que `make dev` SÓLO levanta los 3 frontends Vite) y de tener un `TOKEN` válido (por defecto `dev-token`). El A/B testing de classifier profiles (OBJ-12, RN-111, HU-118) es **API-only por diseño en F7** — el investigador arma el JSON con gold standard + 2+ profiles candidatos y `POST /api/v1/analytics/ab-test-profiles` devuelve el ganador por κ. Ejemplos en `docs/F7-STATE.md:167-173` y `docs/pilot/runbook.md:178-186`. La UI con drag-and-drop está deferida a F8+ (`docs/F7-STATE.md:227`).

## Arquitectura en dos planos

La plataforma está deliberadamente partida en dos planos desacoplados por un **bus Redis Streams particionado**:

1. **Plano académico-operacional** (`academic-service`, `evaluation-service`, `analytics-service`): CRUDs tradicionales, dashboards, federación Keycloak. (`enrollment-service` deprecated por ADR-030; bulk-import centralizado en academic-service vía ADR-029. `identity-service` deprecated por ADR-041; auth via api-gateway + Casbin.)
2. **Plano pedagógico-evaluativo** (`tutor-service`, `ctr-service`, `classifier-service`, `content-service`, `governance-service`): núcleo de la tesis. Tutor socrático con SSE, CTR como **cadena criptográfica SHA-256 append-only**, clasificador N4 con 5 coherencias, RAG con pgvector, prompt versionado.

Transversales:

- `api-gateway`: único punto de auth — emite JWT RS256 e inyecta autoritativamente los headers `X-Tenant-Id`, `X-User-Id`, `X-User-Roles` (plural) a los servicios internos. **Solo expone los prefijos listados en `ROUTE_MAP`** (`apps/api-gateway/src/api_gateway/routes/proxy.py:26`): cuando agregues un servicio nuevo o un endpoint público para frontends, registralo ahí — sin entrada en el ROUTE_MAP el endpoint queda **inalcanzable desde frontend** (accesible solo service-to-service). Hoy NO están en el ROUTE_MAP (by-design o discutible): `governance-service`, `ai-gateway` (LLM proxy interno), `ctr-service` (eventos write + read/verify de auditoría), `integrity-attestation-service` (infra institucional separada).
- `ai-gateway`: LLM proxy con budget por tenant, cache, fallback. **Todo LLM/embedding pasa por `ai-gateway`** — ningún servicio llama proveedores directo.

**Cuatro bases lógicas separadas**: `academic_main`, `ctr_store`, `classifier_db`, `content_db`. ADR-003 original mencionaba `identity_store` pero quedó sin uso — pseudonimización vive en `packages/platform-ops/privacy.py` rotando `student_pseudonym` en `academic_main.episodes`. No hacer joins cross-base — los servicios se comunican por eventos o HTTP.

**Multi-tenancy = Row-Level Security de Postgres** (ADR-001). Toda tabla con `tenant_id` **debe** tener policy RLS activa, y el driver entra con `SET LOCAL app.current_tenant = ...` por request (helper `set_tenant_rls(session, tenant_id)`). `make check-rls` lo verifica y corre en CI.

## Propiedades críticas (invariantes del sistema)

Estas NO son sugerencias — están verificadas por tests y fundamentan la aceptabilidad académica del piloto. Antes de tocar código en estas áreas, leer el ADR correspondiente:

- **CTR append-only** (ADR-010): nunca `UPDATE`/`DELETE` de eventos. Reclasificar = `is_current=false` en el viejo + `INSERT` del nuevo. La única excepción es `Episode.integrity_compromised=true` cuando el integrity checker detecta tampering — documentado en `reglas.md` RN-039/RN-040.
- **api-gateway es el ÚNICO source of truth de identidad**: servicios internos confían en headers `X-Tenant-Id`, `X-User-Id`, `X-User-Roles` (plural) del gateway. No re-verificar JWT aguas abajo. Aplicado a TODOS los endpoints de analytics (kappa, ab-test-profiles, progression, export-academic) — leen los headers vía `Depends`.
- **Hash determinista de `classifier_config_hash`**: la reproducibilidad bit-a-bit está cubierta por `apps/classifier-service/tests/unit/test_pipeline_reproducibility.py`. Cualquier cambio en serialización de config rompe auditabilidad.
- **Las 5 coherencias se mantienen SEPARADAS**: `CT`, `CCD_mean`, `CCD_orphan_ratio`, `CII_stability`, `CII_evolution`. Nunca colapsarlas en un score único — la tesis depende de análisis multidimensional.
- **Write-only al CTR desde `tutor-service`**, excepto el evento `codigo_ejecutado` que usa el `user_id` del estudiante autenticado (no el del tutor).
- **Export académico**: `salt` ≥ 16 chars, `include_prompts=False` por default. No afloje esto por conveniencia.
- **LDAP federation es READ-ONLY**: la plataforma nunca modifica el directorio institucional (condición del convenio).
- **Episodios siempre apuntan a una `TareaPractica` validada**: `tutor.open_episode()` valida 6 condiciones antes del CTR `EpisodioAbierto` (TP existe / tenant matches / comision matches / estado=published / now ≥ fecha_inicio / now ≤ fecha_fin) vía `AcademicClient` en `apps/tutor-service/src/tutor_service/services/academic_client.py`. Doble validación (best-effort): primera al abrir, segunda justo antes del event emission para reducir ventana de race a <1ms.
- **CTR apunta a la instancia, NUNCA al template** (ADR-016, RN-013bis): `Episode.problema_id = TareaPractica.id` (instancia), no `template_id`. Si el template muta, la instancia se marca `has_drift=true` y el CTR queda intacto. Cambiar este apuntador rompe reproducibilidad bit-a-bit (verificado por `apps/classifier-service/tests/unit/test_pipeline_reproducibility.py`).
- **`n_level` (N1–N4) es derivado en lectura, NUNCA almacenado en payload** (ADR-020): el etiquetador vive en `apps/classifier-service/src/classifier_service/services/event_labeler.py` como función pura sobre `(event_type, payload)`. Agregarlo al payload ROMPE `self_hash` y append-only. Versionable vía `LABELER_VERSION`. Override condicional usa info ya en el payload (ej. `EdicionCodigoPayload.origin == "copied_from_tutor"` → N4). `anotacion_creada` es N2 fijo en v1.0.0 — override es agenda futura.
- **Cada episodio cerrado emite attestation externa Ed25519** (ADR-021, RN-128): el ctr-service hace XADD a stream Redis `attestation.requests` post-commit; el `integrity-attestation-service` (puerto 8012, infra institucional separada en piloto) firma y appendea a `attestations-YYYY-MM-DD.jsonl`. **Eventualmente consistente** con SLO 24h — su ausencia **NO bloquea** el cierre del episodio. Buffer canónico bit-exact + formato del `ts` (sufijo `Z`, no `+00:00`) están en RN-128; cualquier desviación ROMPE la verificación. El payload de cierre (`episodio_cerrado` o `episodio_abandonado`, snake_case) no cambia — la attestation es side-channel. **Verificado 2026-05-07 (QA pass post-stash recovery)**: el stream `attestation.requests` se está disparando real. `XLEN = 20` con 108 episodios cerrados — el path se dispara cuando los cierres pasan por la API real (no solo seeds). Bit-exact buffer canónico verificado. El `integrity-attestation-service:8012` no está levantado en local (vive en VPS UNSL en piloto real); los eventos se acumulan en Redis Stream y se drenan cuando el consumer institucional viene online.
- **Detección preprocesamiento de intentos adversos** (ADR-019, RN-129): antes de pegar al `ai-gateway`, `apps/tutor-service/src/tutor_service/services/guardrails.py::detect()` matchea el prompt por regex y emite eventos CTR `intento_adverso_detectado` (side-channel — NO bloquea, el prompt llega al LLM sin modificar). **Severidad ≥ 3** inyecta `_REINFORCEMENT_SYSTEM_MESSAGE` ANTES del prompt del estudiante (Sección 8.5.1 de tesis). `guardrails_corpus_hash` SHA-256 determinista — bumpear `GUARDRAILS_CORPUS_VERSION` cambia el hash; eventos viejos quedan etiquetados con qué corpus los detectó. Falla soft. Categorías + severidades exactas + formato del hash en RN-129. Fase B (postprocesamiento + `socratic_compliance`) es agenda futura.
- **CII evolution longitudinal: slope ordinal por `template_id`** (ADR-018, RN-130): el nuevo `cii_evolution_longitudinal` vive en `packages/platform-ops/src/platform_ops/cii_longitudinal.py` como función pura. Los `cii_stability`/`cii_evolution` actuales (intra-episodio) **NO se renombran** (BC-incompatible con classifications históricas). Cálculo on-demand en `GET /api/v1/analytics/student/{id}/cii-evolution-longitudinal?comision_id=X`; persistido opcionalmente en `Classification.features['cii_evolution_longitudinal']` (JSONB, sin migration). Mínimo 3 episodios por template; TPs huérfanas (`template_id=NULL`) NO entran al cálculo. Slope cardinal sobre datos ordinales es operacionalización conservadora declarada en el ADR.
- **Alertas predictivas son estadística clásica (z-score vs cohorte), NO ML; cuartiles requieren N≥5 por privacidad** (ADR-022, RN-131): `GET /api/v1/analytics/student/{id}/alerts?comision_id=X` calcula 3 alertas (`regresion_vs_cohorte`, `bottom_quartile`, `slope_negativo_significativo`) en `packages/platform-ops/src/platform_ops/cii_alerts.py`. **Privacy gate**: con `len(student_slopes) < MIN_STUDENTS_FOR_QUARTILES = 5` → `insufficient_data: true` SIN cuartiles ni stats (k-anonymity). El endpoint de alertas degrada graciosamente. Las alertas son **pedagógicas, no clínicas**. ML predictivo verdadero (>1σ del propio trayecto, no de cohorte) es agenda piloto-2.
- **Dev mode sin Keycloak onboardeado**: cuando el api-gateway corre con `dev_trust_headers=True` (default en dev) y Keycloak no tiene el realm cargado, los frontends deben mandar `X-User-Id`, `X-Tenant-Id`, `X-User-Email`, `X-User-Roles` en vez de un Bearer JWT. Los `vite.config.ts` de los 3 frontends tienen un `configure` hook que inyecta esos headers.
- **Override temporal de `anotacion_creada` en labeler v1.1.0** (ADR-023, G8a): la versión vigente del piloto NO etiqueta N2 fijo — aplica heurística posicional sobre `(event_ts, episode_started_at, last_tutor_respondio_at)`. Implementación: función pura `label_event(event_type, payload, context=None)`. **Sin contexto = comportamiento v1.0.0 puro** (backwards-compat para tests directos). Con contexto = override v1.1.0. `time_in_level()` y `n_level_distribution()` construyen contextos automáticamente con `_build_event_contexts()` — los caminos del piloto SÍ usan el override. Solapes N1∩N4 → gana N4 (apropiación pedagógicamente más informativa que lectura inicial). Defensa: `tutor_respondio` futuro relativo al evento (delta negativo) NO aplica override.
- **`EpisodioAbandonado` con doble trigger idempotente** (ADR-025, G10-A): hay DOS emisores complementarios — el frontend (`web-student/EpisodePage.tsx` listener `beforeunload` → `POST /api/v1/episodes/{id}/abandoned` con `reason="beforeunload"`) y el worker server-side (`tutor-service/services/abandonment_worker.py` que scanea sesiones inactivas cada 60s y emite con `reason="timeout"`). **Idempotencia por estado de sesión**: la primera emisión borra la sesión Redis; la segunda llamada encuentra `session=None` y devuelve sin emitir. **Caller distinto por reason**: para `beforeunload`/`explicit` el caller es el UUID del estudiante (su acción); para `timeout` es `TUTOR_SERVICE_USER_ID` (acción del sistema). Cualquier reseñalización de `record_episodio_abandonado` debe preservar la propiedad de cancelación atómica del state Redis post-emit.
- **Aliases `/api/v1/audit/*` apuntan al MISMO handler que el legacy del CTR** (ADR-031, D.4): el `audit_router` en `apps/ctr-service/src/ctr_service/routes/events.py` registra `get_episode` y `verify_episode_chain` via `add_api_route` apuntando a las funciones legacy. Cero duplicación de lógica — cualquier mejora del verify aplica a ambos paths automáticamente. **NO mover los handlers** sin actualizar el audit_router; el test `apps/ctr-service/tests/unit/test_audit_aliases.py::test_audit_verify_episode_apunta_al_mismo_handler_que_legacy` falla si el alias deja de apuntar al mismo objeto. El web-admin `AuditoriaPage.tsx` consume `/api/v1/audit/episodes/{id}/verify` via api-gateway ROUTE_MAP.
- **Bulk-import centralizado en academic-service** (ADR-029 + ADR-030): toda nueva entidad para bulk va a `SUPPORTED_ENTITIES` de `apps/academic-service/src/academic_service/services/bulk_import.py`, NO a un servicio separado. `enrollment-service` quedó deprecado por ADR-030 (preservado en disco con README de deprecation, sacado del workspace + ROUTE_MAP + helm). Si emerge un caso de uso real para sync con SIS institucional, revivir el servicio siguiendo las instrucciones del README en lugar de duplicar bulk en otro lado.
- **Manifest declarativo + config efectivo del prompt deben mantenerse alineados** (G12 activación, 2026-04-29): `ai-native-prompts/manifest.yaml` (parseado por `PromptLoader.active_configs()` y expuesto via `GET /api/v1/active_configs`) declara la versión activa para frontends/dashboards. Pero el tutor-service **NO consulta ese manifest en runtime** — usa `apps/tutor-service/src/tutor_service/config.py:default_prompt_version` directo. Si solo se cambia uno, frontends ven una versión y el CTR registra otra. El test `apps/tutor-service/tests/unit/test_config_prompt_version.py::test_manifest_yaml_existe_y_se_parsea` cubre la consistencia, pero es responsabilidad operacional en cualquier rotación futura.

### Constantes que NO deben inventarse ni cambiarse

- **Service-account del tutor**: `TUTOR_SERVICE_USER_ID = UUID("00000000-0000-0000-0000-000000000010")` (en `apps/tutor-service/src/tutor_service/services/tutor_core.py`). Los eventos CTR del tutor llevan ese `user_id`, excepto `codigo_ejecutado` (que usa el `user_id` del estudiante real). Si necesitás un UUID de service-account para algo nuevo, NO reuses éste — definí uno propio.
- **Genesis del CTR**: `GENESIS_HASH = "0" * 64` (definido en `packages/contracts/src/platform_contracts/ctr/hashing.py` y replicado en `apps/ctr-service/src/ctr_service/models/base.py`). Es el `prev_chain_hash` del primer evento (`seq=0`) de cada episodio. Cambiarlo invalida toda cadena existente.
- **Serialización canónica NO es uniforme entre hashes** — cada uno tiene su fórmula, cotejada contra el código:
  - **CTR `self_hash`** (`packages/contracts/.../ctr/hashing.py::compute_self_hash`): `event.model_dump_json(exclude={"self_hash","chain_hash"})` → `json.loads` → `json.dumps(parsed, sort_keys=True, separators=(",", ":"))` → `sha256(...).hexdigest()`. **Sin** `ensure_ascii=False`.
  - **CTR `chain_hash`** (mismo archivo, `compute_chain_hash`): `sha256(f"{self_hash}{prev_chain_hash}".encode("utf-8")).hexdigest()` — concatenación de strings hex, **`self` primero, `prev` después** (no confundir el orden — es contraintuitivo).
  - **`classifier_config_hash`** (`apps/classifier-service/src/classifier_service/services/pipeline.py::compute_classifier_config_hash`): `json.dumps({"tree_version": ..., "profile": ...}, sort_keys=True, ensure_ascii=False, separators=(",", ":"))` → `sha256(...).hexdigest()`. **Con** `ensure_ascii=False` (a diferencia del self_hash del CTR).
  - Tocar cualquier parámetro de estos (sort_keys, separators, ensure_ascii, exclusiones) rompe reproducibilidad bit-a-bit — y con eso la tesis.
- **Sharding CTR**: `NUM_PARTITIONS = 8` (en `apps/ctr-service/src/ctr_service/services/producer.py`). `shard_of(episode_id)` usa los primeros 4 bytes del `SHA-256(str(episode_id))` módulo 8. **El sharding vive a nivel Redis Streams** (`ctr.p0..ctr.p7`), no a nivel Postgres — la tabla `events` en `ctr_store` es **única y no particionada físicamente** (verificado 2026-05-04: `pg_inherits` devuelve 0 rows). Single-writer por partición aplica al **bus**: cada worker consumer-group consume una partición y los workers no pueden escribir en particiones que no son las suyas. La persistencia es tabla única, justificable por escala del piloto (470 events). Cualquier futuro escalamiento que necesite native partitioning de Postgres requiere ADR + migration de `events` a tabla particionada por hash de `episode_id`.
- **`chunks_used_hash`** (`reglas.md` RN-026, `apps/content-service/src/content_service/services/retrieval.py::_hash_chunk_ids`): `sha256("|".join(sorted(str(id) for id in chunk_ids)).encode("utf-8")).hexdigest()`. Lista vacía → hash del string vacío. Debe propagarse de retrieval → evento `prompt_enviado` → evento `tutor_respondio` del mismo turno.
- **Privacy threshold de cuartiles**: `MIN_STUDENTS_FOR_QUARTILES = 5` (en `packages/platform-ops/src/platform_ops/cii_alerts.py`). Estándar k-anonymity para cohortes educativas. Bajarlo expone individuos en cohortes chicas (con N≤4 los cuartiles son trivialmente reconstruibles). El endpoint `/cohort/{id}/cii-quartiles` y el de alertas (que depende del cohort stats) usan este umbral — modificarlo cambia qué cohortes ven panel de alertas vs `insufficient_data`.
- **`LABELER_VERSION = "1.1.0"`** (en `apps/classifier-service/src/classifier_service/services/event_labeler.py`, ADR-023). v1.1.0 introduce override temporal de `anotacion_creada` (ADR-023, G8a). Bumpear MINOR re-etiqueta históricos sin tocar el CTR (ADR-020 cubre el patrón) pero **obliga a actualizar Sección 17.3 de la tesis** sobre el sesgo que se cierra. v1.0.0 sigue accesible recomputando con la versión anterior. Saltar a major 2.x implica clasificación semántica (Eje B) — revisar tests anti-regresión `test_labeler_version_es_1_x_y_minor_refleja_overrides_temporales`.
- **Ventanas del override `anotacion_creada`**: `ANOTACION_N1_WINDOW_SECONDS = 120.0` y `ANOTACION_N4_WINDOW_SECONDS = 60.0` (en el mismo `event_labeler.py`, ADR-023). Anotación en los primeros 120s del episodio → N1; <60s post-`tutor_respondio` → N4; otros → N2 (fallback v1.0.0). Solapes resueltos N4 > N1. **Cambiar cualquiera obliga a bumpear `LABELER_VERSION`**. Sensibilidad documentada en [`docs/adr/023-sensitivity-analysis.md`](docs/adr/023-sensitivity-analysis.md) (regenerable con `scripts/g8a-sensitivity-analysis.py`).
- **Timeout de abandono de episodio**: `episode_idle_timeout_seconds = 1800` (30 min) y `abandonment_check_interval_seconds = 60` en `apps/tutor-service/src/tutor_service/config.py` (ADR-025, G10-A). El worker server-side scanea sesiones Redis cada 60s y emite `episodio_abandonado(reason="timeout")` con `caller_id=TUTOR_SERVICE_USER_ID`. Idempotente con el frontend `beforeunload` (que emite `reason="beforeunload"` con `caller_id=student`). La primera emisión gana — la segunda es no-op silenciosa por estado de sesión.
- **Mínimos para CII longitudinal y privacy**: `MIN_EPISODES_FOR_LONGITUDINAL = 3` por template (ADR-018) — episodios análogos requieren mismo `template_id`. TPs huérfanas (sin `template_id`) NO entran al cálculo. Con N<3 → `null` + `insufficient_data: true`.
- **`BYOK_MASTER_KEY`** (ADR-038, epic ai-native-completion): 32 bytes random codificados base64. Generar con `openssl rand -base64 32`. Vive como env var del ai-gateway, **NUNCA** en disco ni en logs. El helper `packages/platform-ops/src/platform_ops/crypto.py::encrypt/decrypt` usa AES-256-GCM con esta clave para encriptar `BYOKKey.encrypted_value`. Si la perdés, **TODAS** las keys BYOK en `byok_keys` quedan inservibles — hay que rotarlas todas (`POST /keys/{id}/rotate` con plaintext nuevo). El procedimiento de rotación de master key requiere re-encriptar el catálogo entero (5 pasos en ADR-038). En dev podés tener una local; en prod usar Vault/KMS.
- **`LABELER_VERSION = "1.2.0"`** post-epic ai-native-completion (ADR-034): v1.2.0 introduce regla N3/N4 para `tests_ejecutados` (Sec 9 epic). Bumpear a 2.x sigue reservado para clasificación semántica (Eje B). NO confundir con el bump de v1.0.0 → v1.1.0 (override `anotacion_creada` por ventana temporal, ADR-023).
- **Eventos excluidos del feature extraction del classifier**: `_EXCLUDED_FROM_FEATURES = {"reflexion_completada"}` en `apps/classifier-service/src/classifier_service/services/pipeline.py` (RN-133). Si agregás un evento side-channel post-cierre (analytics, surveys, telemetry), **agregalo a este set** o vas a contaminar el classifier_config_hash con eventos posteriores al cierre del episodio. Cubierto por `test_reflexion_completada_no_afecta_clasificacion_ni_features`.

## Convenciones

- **Python**: `ruff` (reglas `E,W,F,I,B,C4,UP,N,S,A,RUF,PL,SIM`), `mypy --strict`, `line-length=100`, docstrings breves en español, nombres de API públicas en inglés. `line too long` (E501) está apagado — lo maneja el formatter.
- **TypeScript**: `biome` (no ESLint/Prettier). `noUncheckedIndexedAccess` estricto. React 19 + hooks. Quotes dobles, sin semicolons, trailing commas.
- **Commits**: Conventional Commits con scope del servicio (`feat(academic): ...`, `fix(ctr): ...`). Branches: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`.
- **Cambios arquitectónicos requieren nuevo ADR**: copiar `docs/adr/_template.md`, numerar siguiendo el siguiente disponible (`ls docs/adr/`), incluirlo en el mismo PR. ADRs superseded se marcan — no se borran. Slot 017 reservado para G1 (sin redactar).
- **Coverage**: CI gate falla si coverage <60% (umbral pragmático HOY). Target a futuro: ≥80% global / ≥85% pedagogía, con plan de ratchet documentado en `BUGS-PILOTO.md` GAP-9. Para medir el real corriente: `make test` con `--cov`.
- **Tests obligatorios en PRs**: bug fix = test que reproduce el bug; nueva tabla `tenant_id` = test RLS; cambio de contrato = actualizar `packages/contracts` Python **y** TypeScript + test de serialización.

## Sistema de ayuda in-app (HelpButton / helpContent.tsx)

Patrón obligatorio HelpButton + PageContainer + helpContent en los 3 frontends. **Source of truth: `.claude/skills/help-system-content/SKILL.md`** — estructura JSX de cada entry, las 3 reglas duras (HelpButton mandatory en toda page, contenido nunca inline, `size="sm"` en form modals), Modal variants `light`/`dark`, anti-regresión del HelpButton dimensionado. Leerlo ANTES de agregar una página o form nuevo. **⚠️ Drift detectado 2026-05-04**: 5/9 views del web-teacher (las nuevas de ADR-022 G7 — `EpisodeNLevelView`, `StudentLongitudinalView`, `CohortAdversarialView`, etc.) NO usan HelpButton. Cuando se haga el redesign del frontend (post-skill `impeccable`), agregarles HelpButton en el header como parte del polish.

- **Foundation compartida**: `packages/ui/src/components/{Modal,HelpButton,PageContainer}.tsx` con vitest suite en `*.test.tsx`. Son los únicos componentes de `@platform/ui` con tests hoy. Contenido en español **sin tildes** (mismo motivo que `check-rls.py`: evita encoding issues en stdout cp1252 de Windows).
- **Tailwind v4 + pnpm workspace (gotcha crítico)**: cada `apps/web-*/src/index.css` debe tener `@source "../../../packages/ui/src/**/*.{ts,tsx}"`. Sin eso, Tailwind v4 (que excluye `node_modules` por default) **no escanea** las clases usadas en `@platform/ui` (symlink pnpm) y los modales se renderizan sin `max-width` (full viewport width). El fallo es silencioso en typecheck — solo visible en browser.
- **Excepción documentada**: `apps/web-student/src/pages/EpisodePage.tsx` NO usa `PageContainer` (layout full-screen `min-h-screen flex-col` con header funcional `ComisionSelector` + info dinámica de TP/episodio). Usa `HelpButton` directo. No replicar sin justificación equivalente.
- **Anti-regresión del migración de modals**: cuando se consolidan modales ad-hoc al `Modal` de `@platform/ui`, evitar la trampa de N booleans mutex independientes (`isCreating`, `isEditing`, `isDeleting`...) — usar un `ModalState` discriminated union. La migración de `TareasPracticasView` falló esto y abrió 2 modales simultáneos por handlers que no apagaban el previo.

## Estado actual de implementación

**Última verificación: 2026-05-04** (auditoría con 4 sub-agentes paralelos + smoke E2E + 4 fixes críticos aplicados). Esta sección lista verdades del sistema HOY que no son obvias del código. Para changelog narrativo de cómo se llegó acá, ver `docs/SESSION-LOG.md`.

### Auditoría 2026-05-04 — fixes aplicados ese día

Cuatro bugs/falsedades detectadas por la auditoría y cerrados en la misma sesión (sin commitear todavía al momento de escribir esto):

1. **Migrations BYOK + test_cases aplicadas**: la DB local estaba en `20260430_0001`. Se aplicó `upgrade head` → `20260504_0002`. Tablas `byok_keys` + `byok_keys_usage` con RLS y columnas `tareas_practicas.test_cases JSONB` + `tareas_practicas.created_via_ai BOOLEAN` ahora existen.
2. **Casbin policies completas**: 116 → **131** (verificado 2026-05-07 con `SELECT count(*) FROM casbin_rules WHERE ptype='p'` en `academic_main`). 131 = 116 anteriores + 15 nuevas: 8 de `byok_key:CRUD × superadmin/docente_admin` (ADR-039 epic ai-native-completion) + 7 de `unidad:CRUD` y `unidad:read` para los 4 roles (ADR-041 epic unidades-trazabilidad). RN-018, HU-016, F1-STATE.md ya no especifican un número fijo.
3. **Bug genuino BYOK SET LOCAL**: `apps/ai-gateway/src/ai_gateway/services/byok.py:121-124` usaba `text("SET LOCAL ... :tid")` con bind param — Postgres no acepta parametrizar `SET LOCAL`. Reemplazado por `text("SELECT set_config('app.current_tenant', :tid, true)")` que sí acepta bind. Smoke real confirmado: `GET /api/v1/byok/keys` → 200 (antes 500 silencioso porque tests mockeaban DB).
4. **Doble implementación divergente de `compute_chain_hash`**: `packages/contracts/src/platform_contracts/ctr/hashing.py:46` calculaba `sha256(prev || self_hash)` mientras `apps/ctr-service/.../services/hashing.py` calcula `sha256(self_hash || prev)` (este último coincide con la DB). Invertido el orden en el package contracts (que es el "oficial" para auditores externos) + nuevo test cross-package `packages/contracts/tests/test_chain_hash_canonical_formula.py` con fixtures bit-exact de un episodio real. Sin este fix, un auditor doctoral que use el helper "oficial" para verificar la cadena obtenía falsos failures sobre cadenas íntegras.

### Smoke E2E como red de seguridad (mejora estructural #2)

Suite nueva en `tests/e2e/smoke/` con 32 tests que ejercitan endpoints críticos contra el stack real (Postgres + Redis + 12 servicios). Atrapan exactamente la clase de bugs que escapan a tests unit con DB mockeada. Corre con `make test-smoke` en <2s. CI workflow skeleton en `.github/workflows/e2e-smoke.yml` (workflow_dispatch por ahora; falta probar en rama antes de hacerlo required check). Cada vez que se cierre un epic nuevo, **agregarle smoke tests acá ANTES de declararlo cerrado** — es lo que evita que CLAUDE.md mienta sobre "epic cerrado" cuando en realidad falta runtime-completeness.

### Auditoría — falsedades de versiones anteriores corregidas en este pase

- Header de auth: era `X-Role`, real es **`X-User-Roles`** (plural). Los frontends Vite ya lo mandan correcto; el CLAUDE.md tenía 2 menciones desactualizadas.
- Sharding CTR: la frase "single-writer por partición" se interpretaba como partitioning físico de Postgres. La realidad es que el sharding vive a nivel **Redis Streams** (`ctr.p0..ctr.p7`), la tabla `events` es única (sin `pg_inherits`). Reescrito honestamente abajo en "Constantes que NO deben cambiarse".
- Attestation Ed25519: verificado 2026-05-07 con `XLEN attestation.requests = 20` y 108 episodios cerrados — el path documentado SÍ se está disparando en piloto local cuando los cierres pasan por API real. El warning previo (2026-05-04) quedó obsoleto.
- HelpButton mandatory: documentado como universal pero las 5 vistas nuevas del web-teacher (G7 ADR-022) no lo tienen. Caveat agregado en la sección del sistema de ayuda; cuando se haga el redesign UX/UI se completa.
- Plataforma: el archivo menciona Windows y sus gotchas en mil lugares; **la sesión actual de desarrollo es Linux 6.18 (Pop!_OS)** y los gotchas Windows no aplican a quien está leyendo esto desde Linux. CLAUDE.md sigue mencionándolos porque el repo se usa cross-platform — confirmá tu plataforma antes de aplicar mitigaciones.

### Source of truth de UX/UI: PRODUCT.md y DESIGN.md (root del repo)

Desde 2026-05-04, todo trabajo de frontend/UX/UI debe respetar:
- **`PRODUCT.md`** (root) — register, users (comité doctoral primero, escala N facultades después), brand personality (riguroso · transparente · pedagógico), 5 anti-references (Moodle / Coursera / SaaS genérico / EdTech gamificado / SIU Guaraní), 5 design principles (modelo N4 visible / auditabilidad visible / densidad académica > whitespace SaaS / escala first-class / honestidad técnica explícita).
- **`DESIGN.md`** (root) — tokens visuales actuales del sistema (colors / typography / elevation / components) en formato Stitch. Generado desde código existente con `impeccable document`.

La skill `impeccable` (`~/.claude/skills/impeccable/`) está registrada como auto-load para cualquier tarea de UI. Sus gates obligatorios (PRODUCT.md / DESIGN.md / shape brief confirmado) NO se saltean.



### Capabilities cerradas en epic `ai-native-completion-and-byok` (2026-05-04)

Backend completo de 5 capabilities pedagógicas, archivada con ADRs 033-040:

- **Reflexión metacognitiva post-cierre** (ADR-035): `POST /api/v1/episodes/{id}/reflection` en tutor-service emite evento CTR `reflexion_completada` con 3 textareas (≤500 chars c/u). Modal opcional en web-student post-evento `episodio_cerrado` (snake_case, el tipo del CTR event; la clase Pydantic `EpisodioCerrado` que serializa el payload sigue en PascalCase como convención del package contracts). **Excluido del classifier** vía `_EXCLUDED_FROM_FEATURES = {"reflexion_completada"}` en `pipeline.py` (RN-133, preserva reproducibilidad bit-a-bit del `classifier_config_hash`). Export académico redacta los textuales por default; flag `--include-reflections` con audit log structlog `reflections_exported_with_consent`.
- **Sandbox client-side + test_cases** (ADR-033, ADR-034): test_cases JSONB en `tareas_practicas` y `tareas_practicas_templates` (cada elemento `{id, name, type, code, expected, is_public, weight}`). Endpoint `GET /api/v1/tareas-practicas/{id}/test-cases?include_hidden=...` con filter por rol (estudiante 403 con `include_hidden=true`). `POST /api/v1/episodes/{id}/run-tests` recibe SOLO conteos (no código) y emite evento CTR `tests_ejecutados`. Pyodide en frontend DEFERIDO. Classifier labeler bumpeado a **v1.2.0** con regla N3/N4 sobre `tests_ejecutados` (RN-134: `tests_hidden=0` invariante en endpoint POST run-tests).
- **TP-gen IA** (ADR-036): `POST /api/v1/tareas-practicas/generate` en academic-service llama governance-service (resuelve prompt `tp_generator/v1.0.0`) → ai-gateway con `feature="tp_generator"` + `materia_id` para BYOK. Audit log structlog `tp_generated_by_ai` con tenant/user/materia/prompt_version/tokens/latency/provider. Schema `TareaPracticaCreate.created_via_ai: bool`. Wizard UI en web-teacher DEFERIDO. **Bug fixeado en c8a4685**: `created_via_ai` se persistía siempre `false` por bug en `apps/academic-service/src/academic_service/services/tarea_practica_service.py:94` (el dict pasado a `repo.create()` no incluía el campo). Fix de 1 línea. Trazabilidad ADR-036 ahora íntegra.
- **Governance UI admin** (ADR-037): endpoint extendido `/cohort/{id}/adversarial-events` + nuevo `/governance/events` cross-cohort en analytics-service. Página `GovernanceEventsPage.tsx` en web-admin con filtros cascade facultad → materia → período + CSV export con headers ASCII (cp1252-safe).
- **BYOK multi-provider** (ADR-038, ADR-039, ADR-040): helper `crypto.py` AES-256-GCM en platform-ops. Tablas `byok_keys` + `byok_keys_usage` con RLS. Resolver jerárquico **materia → tenant → env_fallback** en `apps/ai-gateway/.../services/byok.py::resolve_byok_key` (RN-132). 5 endpoints CRUD (`POST/GET /keys`, `POST /keys/{id}/rotate`, `POST /keys/{id}/revoke`, `GET /keys/{id}/usage`). Casbin `byok_key:CRUD` para superadmin/docente_admin. `materia_id: UUID | None` opcional en `CompleteRequest` schema del ai-gateway, propagado por el tutor-service via `SessionState.materia_id` (cacheado al `open_episode`, no se re-resuelve por turno). Métricas OTLP: `byok_key_usage_total`, `byok_key_resolution_total{resolved_scope}`, `byok_key_resolution_duration_seconds` (SLO p99 < 50ms). Health check `byok_resolver_healthy` no-critical degrada cuando master key falta. **Mistral adapter IMPLEMENTADO** (recovery del stash 2026-05-07, commit 7ecabf7): `MistralProvider` en `apps/ai-gateway/src/ai_gateway/providers/base.py` usa `mistralai>=1.0` SDK oficial, soporta `complete()` + `stream_complete()`, pricing per-modelo (mistral-small/medium/large/codestral), verificado end-to-end con API real. **Adapter Gemini sigue diferido** (no hay caso de uso piloto-1). **UI BYOK page DEFERIDA**, cache Redis del resolver DEFERIDO. **Bug latente fixeado en c8a4685**: `create_byok_key`, `rotate`, `revoke` hacían `commit() → refresh()` post-RLS. `set_config('app.current_tenant', ..., is_local=true)` muere con el commit (transaction-scoped), entonces `refresh()` corría con tenant vacío y RLS bloqueaba con `invalid input syntax for type uuid: ""`. Fix: re-aplicar `_set_tenant_rls` antes de cada `refresh` post-commit en los 3 métodos.

**Bug genuino cerrado en la epic**: el classifier consumía TODOS los eventos del CTR sin filtro. Una `reflexion_completada` >5min post-cierre cambiaba `ct_summary` (de `0.54` a `0.56`). Fix en `_EXCLUDED_FROM_FEATURES` + test anti-regresión `test_reflexion_completada_no_afecta_clasificacion_ni_features` en `apps/classifier-service/tests/unit/test_pipeline_reproducibility.py`. **NO romper este test** al refactorizar classifier o agregar event types nuevos.

### Modelo híbrido honesto (decisión estratégica del piloto)

`audi1.md` (descripto abajo en "Dónde buscar contexto") identifica 7 cambios grandes (G1-G7). La decisión NO fue implementar todos antes de la defensa — se partieron en dos categorías:

- **Implementados pre-defensa** (cubren las promesas centrales de la tesis):
  - **G2 mínimo** (ADR-018, RN-130) — `cii_evolution_longitudinal` por `template_id`. Cubre Sección 15.4.
  - **G3 mínimo** (ADR-019, RN-129) — guardrails Fase A (detección preprocesamiento). Cubre Sección 8.5 y habilita 17.8.
  - **G4** (ADR-020) — etiquetador N1-N4 derivado en lectura. Cubre Sección 4.3, 6.4 (componente C3.2), 15.2.
  - **G5** (ADR-021, RN-128) — registro externo Ed25519 con clave institucional UNSL. Cubre Sección 7.3.
  - **G7 MVP** (ADR-022, RN-131) — 3 vistas en `web-teacher` consumiendo endpoints de G2/G3/G4 + 4 endpoints analytics nuevos (`/cohort/{id}/adversarial-events`, `/student/{id}/episodes`, `/cohort/{id}/cii-quartiles`, `/student/{id}/alerts`): `EpisodeNLevelView` (drill-down N1-N4), `StudentLongitudinalView` (slope per-template + sparkline + panel de alertas + posición en cuartiles), `CohortAdversarialView` (intentos adversos agregados). **Alertas predictivas con estadística clásica** (z-score vs cohorte, NO ML) y cuartiles con privacy gate N≥5 — versión defendible pre-defensa; ML predictivo verdadero queda como agenda piloto-2. Drill-down navegacional desde `ProgressionView` a `StudentLongitudinalView` vía TanStack Router file-based routing. Tests E2E (vitest + RTL + jsdom): 11 nuevos en `apps/web-teacher/tests/`.
- **Agenda Cap 20 con ADR redactado o por redactar** (declaradas como trabajo futuro):
  - **G1** — slot ADR-017 reservado, sin redactar. CCD con embeddings semánticos. La versión temporal actual del CCD (ventana 2 min) es operacionalización conservadora declarable; embeddings → piloto-2.
  - **G6** — desacoplamiento instrumento-intervención. Refactor ~1500 LOC, post-piloto-1.
  - **G7 ML predictivo** (ADR-032, redactado) — alertas verdaderas con modelo entrenado sobre el propio trayecto del estudiante (>1σ de su baseline individual, no de cohorte). El MVP estadístico (z-score vs cohorte + cuartiles + drill-down + 3 vistas) ya está hecho pre-defensa con ADR-022/RN-131; el ML predictivo queda para piloto-2 con criterio cuantificable de revisitar (≥200 estudiantes / ≥10 episodios + ≥30 intervenciones docentes etiquetadas con κ ≥ 0.6 + validación cruzada split por estudiante con AUC ≥ 0.75 / Brier ≤ 0.20). Ver ADR-032 para el detalle de las 3 condiciones que destraban el retomar.
  - **G3 Fase B** — postprocesamiento de respuesta + cálculo de `socratic_compliance` y `violations`. Un score mal calculado es peor que ninguno.
  - **G2 versión completa** — `cii_criteria_stability`, `cii_transfer_effective`, rename `cii_*` → `iis_*`. Todo BC-incompatible.

**Regla operativa**: la diferencia entre **deuda silenciosa** y **decisión informada** es el ADR redactado. Antes de cerrar un G como "no se hace", redactá el ADR aunque diga *"decidimos NO hacer esto ahora porque X, criterio para piloto-2: Y"*. Eso es lo que defiende la tesis honestamente ante el comité doctoral. **Si abrís un PR que toca CCD, CII, guardrails o attestation, leé el ADR correspondiente PRIMERO.**

### Brechas conocidas (gaps reales)

- **Health checks reales en los 11 servicios** (cerrado por epic `real-health-checks`, 2026-05-04): los services que antes devolvían `{"status":"ok"}` hardcoded ahora consumen el helper compartido `packages/observability/src/platform_observability/health.py` (`check_postgres`, `check_redis`, `check_http`, `assemble_readiness`). `HealthResponse.checks` ahora es `dict[str, CheckResult]` con `{ok, latency_ms, error}` por dependencia. Status semantics: `ready`/`degraded`/`error` → 200/200/503. `ctr-service` mantiene su patrón propio estable (no fue tocado — separate change si hace falta refactor). Per-service criticality matrix declarada en `openspec/changes/archive/.../specs/service-readiness/spec.md` cuando se archive el epic. **Implicación prod**: pods correctamente marcados NotReady cuando una dep critical cae. **Política**: cualquier nueva dep crítica de un servicio agrega su check en el `routes/health.py` correspondiente y al spec de `service-readiness`.
- **Imágenes Docker pineadas (F15, 2026-04-28)**: `infrastructure/docker-compose.dev.yml` tiene **todas** las imágenes con tag específico — postgres `:16-alpine`, pgvector `:pg16`, keycloak `:25.0`, redis `:7-alpine`, otel-collector `0.150.1`, loki `3.7.1`, minio `RELEASE.2025-09-07T16-13-09Z`, jaeger `1.62.0`, prometheus `v2.55.0`, grafana `11.3.0`. Si actualizás alguna, hacelo en un PR aislado y verificá que `make dev-bootstrap` levante limpio.
- **`evaluation-service` IMPLEMENTADO** (epic `tp-entregas-correccion` cerrado por commit 5efcce8): 8 endpoints REST en `apps/evaluation-service/src/evaluation_service/routes/entregas.py` (`POST/GET /entregas`, `GET /entregas/{id}`, `POST /{id}/submit|calificar|return`, `PATCH /{id}/ejercicio/{n}`, `GET /{id}/calificacion`), 2 modelos (`Entrega`, `Calificacion`), audit log structlog (`tp_entregada`, `tp_calificada`), `IntegrityError` handler. Comparte DB `academic_main` con academic-service vía engine independiente. Casbin: `entrega:create/read` para estudiante, `entrega:update` + `calificacion:create` para docente/docente_admin/superadmin. **Decisión de fusión con academic-service** (Fase 2 del plan de restructure) queda como deuda post-piloto.
- **`identity-service` deprecated** vía ADR-041 (2026-05-07): 0 endpoints reales, código preservado en disco. Mismo tratamiento que `enrollment-service` (ADR-030). El monorepo pasa de 12 a 11 servicios activos.
- **Comisión selector queda vacío para estudiantes reales** (gap B.2 de auditoría 2026-04-29): `GET /api/v1/comisiones/mis` JOINea `usuarios_comision` (que es para docentes/JTP/auxiliares) — los estudiantes viven en `inscripciones` con `student_pseudonym`. Se va a destrabar en F9 cuando el JWT de Keycloak traiga `comisiones_activas` como claim. Plan operativo completo en [`docs/plan-b2-jwt-comisiones-activas.md`](docs/plan-b2-jwt-comisiones-activas.md) — listo para ejecución mecánica post-coordinación con DI UNSL (Keycloak operacional + federación LDAP completa). Mientras tanto, `selectedComisionId` cae al fallback dev hardcoded en `vite.config.ts`. Documentado en el docstring del endpoint.
- **Auditoría CTR desde web-admin operacional** (gap D.4 cerrado por ADR-031): el web-admin tiene `AuditoriaPage` que verifica integridad criptográfica de cualquier episodio cerrado via `POST /api/v1/audit/episodes/{id}/verify` (alias del legacy del ctr-service, ruteado via api-gateway). Útil para defensa doctoral — el comité puede ver la verificación SHA-256 en vivo. NO confundir con las attestations Ed25519 externas (ADR-021) — son dos pruebas independientes complementarias.
- **Bulk import de `inscripciones` operacional** (gap B.1 cerrado por ADR-029): el web-admin tiene en `BulkImportPage` la entidad `inscripciones` (estudiantes en una comisión) — destraba el alta masiva del piloto sin tocar SQL. CSV requiere `comision_id`, `student_pseudonym` (UUID derivado por federación LDAP), `fecha_inscripcion`. Defaults `rol=regular`, `estado=activa`. Constraint UNIQUE (tenant_id, comision_id, student_pseudonym) — re-inscripciones legítimas en períodos distintos van en filas separadas.
- **Deudas detectadas en QA pass 2026-05-07** (no bloquean v1.0 pero quedan como backlog):
  - Leak de `student_pseudonyms` a estudiantes en `GET /comisiones/{id}/inscripciones` — Casbin permite, handler debería filtrar a `WHERE student_pseudonym = user.id`.
  - `POST /api/v1/classify_episode/{id}` no es idempotente: docstring promete sí, pero re-POST devuelve 500 con duplicate-key. Debería responder no-op con la classification existente.
  - Filtro `unidad_id` en `GET /tareas-practicas` no filtra (devuelve todas).
  - `byok_keys_usage` queda vacía cuando resolver cae a `env_fallback` — gap para auditoría doctoral de costos.
  - `tutor_respondio.payload` no persiste `tokens_input/output/provider` — solo `model`, `content`, `chunks_used_hash`.
  - `nota_final` se serializa como string Decimal `"8.50"`; frontends lo tipan `number` — `Number()` works pero `.toFixed()` revienta.
  - 106 classifications pre-existentes con hash legacy `9dd96894...` (pre-bump labeler v1.2.0). NO bloquea — los hashes nuevos son deterministas; deuda operacional: re-classify masivo nunca corrió.

### Contratos BC-incompatible vigentes

- **Endpoints de analytics requieren `X-Tenant-Id` + `X-User-Id`**: aplicado a `POST /api/v1/analytics/kappa`, `POST /api/v1/analytics/ab-test-profiles`, y los demás endpoints del plano académico. Curls en docs sin headers van a recibir 401/403. Cuando regeneres `docs/pilot/protocolo-piloto-unsl.docx` con `make generate-protocol`, asegurate que los ejemplos de curl tengan los headers.
- **HU-088 audit log es structlog, no tabla persistente**: el endpoint AB emite event `ab_test_profiles_completed` con `tenant_id`, `user_id`, `kappa_per_profile`, `classifier_config_hash`. Mismo patrón en `kappa_computed`. Si compliance team del piloto requiere tabla queryable, revisitable (S effort, 1-2h).

### Modelos no obvios desde el código

- **`TareaPractica` es la fuente de `Episode.problema_id`**: tabla en `apps/academic-service/src/academic_service/models/operacional.py` con campos `codigo, titulo, enunciado (markdown), fecha_inicio/fin nullable, peso, rubrica JSONB, estado draft|published|archived, version, parent_tarea_id (FK self), template_id (FK nullable a tareas_practicas_templates), has_drift (bool), created_by`. Versionado inmutable: una vez `published` no se puede editar — se crea nueva versión vía `POST {id}/new-version` que clona y linkea por `parent_tarea_id`. `GET {id}/versions` devuelve la cadena con flag `is_current`. Casbin: `tarea_practica:CRUD` para superadmin/docente_admin/docente, read-only para estudiante.
- **`TareaPracticaTemplate` (ADR-016) es la fuente canónica académica a nivel `(materia_id, periodo_id)`**: tabla `tareas_practicas_templates` en `academic_main`. Crear un template auto-instancia una `TareaPractica` por cada comisión de esa materia+periodo. Las instancias arrancan con `template_id = template.id` y `has_drift = false`. Editar la instancia setea `has_drift = true` (drift aislado por instancia, no se propaga). El template es **académico**, la instancia es **operacional y CTR-relevante** — los eventos del CTR siempre apuntan a la instancia (ver invariante en "Propiedades críticas"). Endpoints: `/api/v1/tareas-practicas-templates` (10 métodos REST). Casbin: `tarea_practica_template:CRUD` para superadmin/docente_admin/docente, read-only para estudiante. Comisiones creadas DESPUÉS del template no auto-propagan hoy (deuda diferida — ver `SESSION-LOG.md` 2026-04-23).
- **CII longitudinal opera por `template_id`, no por episodio individual** (ADR-018, RN-130): dos clasificaciones del mismo estudiante son **"análogas"** si los episodios apuntan a TPs con el mismo `TareaPracticaTemplate.id`. **TPs huérfanas (sin `template_id`) NO entran al cálculo** — limitación declarada del piloto inicial. El slope se computa **on-demand** en `GET /api/v1/analytics/student/{id}/cii-evolution-longitudinal?comision_id=X`, NO eagerly al clasificar (el classifier per-episodio no tiene la info longitudinal). Persistencia opcional en `Classification.features['cii_evolution_longitudinal']` (JSONB — sin migration). Mínimo `MIN_EPISODES_FOR_LONGITUDINAL = 3` por template para considerar el slope válido; con N<3 → `null` + `insufficient_data: true`. La función pura vive en `packages/platform-ops/src/platform_ops/cii_longitudinal.py` (testeable bit-exact). El slope cardinal sobre datos ordinales (`APPROPRIATION_ORDINAL`: delegacion=0, superficial=1, reflexiva=2) es operacionalización conservadora, **NO verdad académica** — declarado como tal en el ADR. **NO renombrar `cii_stability`/`cii_evolution`** (intra-episodio): son BC-incompatibles con classifications históricas, queda como agenda piloto-2.
- **Markdown rendering en frontends**: `react-markdown@9` + `remark-gfm@4`. Componente `MarkdownRenderer.tsx` está **duplicado** en `apps/web-teacher/src/components/` y `apps/web-student/src/components/` (no shared package — overhead). Sin `@tailwindcss/typography` plugin — usa selectors arbitrarios `[&_h1]:text-lg [&_p]:my-2 [&_table]:...`. XSS-safe by default. Rubrica de TPs sigue como `<pre>{JSON.stringify(...)}</pre>` (markdown wrapper sobre JSON luce raro).
- **Casbin policies — sin spec hardcodeado**: el source of truth es el código del seed (`apps/academic-service/src/academic_service/seeds/casbin_policies.py`). Hoy carga **131 policies** (verificado 2026-05-07 contra DB; 4 roles × N entidades crecientes; los últimos bumps: +14 por `tarea_practica_template:CRUD` en ADR-016, +1 por `facultad:read` para docente, +8 por `byok_key:CRUD` para superadmin/docente_admin en ADR-039, +7 por `unidad:CRUD` y `unidad:read` en ADR-041 epic unidades-trazabilidad). RN-018, HU-016, F1-STATE.md ya no especifican un número fijo — evoluciona con el catálogo de recursos.
- **`student_pseudonym` vs `student_alias` — NO son sinónimos**: son dos conceptos distintos con el mismo aspecto (string). NO los unifiques.
  - **`student_pseudonym`** (UUID-as-string): identificador interno del estudiante que vive en `Episode.student_pseudonym` (CTR) y se propaga a `Classification`. Es el identificador que usan **todos los endpoints UI** (`/cohort/{id}/progression`, `/cohort/{id}/adversarial-events`, `/cohort/{id}/cii-quartiles`, `/student/{id}/cii-evolution-longitudinal`, `/student/{id}/episodes`, `/student/{id}/alerts`) — devuelven `student_pseudonym` en el response y reciben el UUID como path param. El drill-down navegacional del web-teacher (`<Link to="/student-longitudinal" search={{ studentId }}>`) depende de esto.
  - **`student_alias`** (hash anonimizado): SHA-256 determinista de `student_pseudonym + salt` (salt ≥16 chars, RN-090). Usado SOLO en `packages/platform-ops/src/platform_ops/academic_export.py` para el export académico anonimizado del piloto. Vive en `EpisodeRecord.student_alias` y en el JSON exportado.
  - **Si agregás un endpoint que devuelve datos de estudiantes a UI interna**, devolvé `student_pseudonym` (UUID). Si agregás un endpoint público con anonimización, ahí va `student_alias` con el `pseudonymize_fn` activo en el datasource. La distorsión histórica (endpoint UI devolvía `student_alias` con valor del UUID directo cuando `pseudonymize_fn=None`) fue **corregida 2026-04-27** — no la reintroduzcas.

## Dónde buscar contexto

- `docs/SESSION-LOG.md` — bitácora dated de sesiones de trabajo. Si querés saber **cuándo** y **por qué** se cerró un bug, agregó una entidad o se tomó una decisión, está acá. Las verdades permanentes están promovidas a este archivo.
- `audi1.md` (raíz) — **auditoría exhaustiva de 7 cambios grandes (G1-G7)** detectados como gaps entre la tesis y el código. Es la fuente de verdad de la **agenda confirmatoria** del modelo híbrido honesto del piloto. ADRs 017-021 (uno por G) materializan la decisión: G2/G3/G4/G5 implementados pre-defensa, G1/G6/G7 declarados como agenda Cap 20. Leer ANTES de tocar código de CCD/CII/guardrails/attestation. Ver "Modelo híbrido honesto" abajo para contexto operativo.
- `audi2.md` (raíz) — **iter 2 de auditoría doctoral**: 8 cambios grandes (G8-G15) detectados post-iter-1. La "Ruta mínima para defensa" prescribe G8a/G10-A/G12 antes de defensa; G9/G11/G13/G14/G15 quedan como agenda confirmatoria con stub ADR. ADRs 023-031 materializan la decisión. Leer si vas a tocar labeler/anotacion_creada/episodio_abandonado/auditoría CTR/bulk inscripciones.
- `01-fixes-codigo-chicos.md` (raíz) — fixes chicos de iter 1 (F14-F22, ≤100 LOC cada uno) que cierran inconsistencias menores entre tesis vigente y código. Útil para entender por qué hay deuda documental cerrada vs deuda técnica diferida.
- `03-cambios-tesis.md` (raíz, creado 2026-04-29) — **parches al texto de la tesis** (no al código) que cierran el lado documental del modelo híbrido honesto post-iter-2. T14-T18 con propuestas de redacción borrador para que el doctorando refine contra el manuscrito real. Cada T ata explícitamente con su contraparte de código (Gnn + ADR).
- `docs/plan-b2-jwt-comisiones-activas.md` (creado 2026-04-29) — **plan operativo de F9** (JWT con `comisiones_activas` claim) para ejecutar cuando la coordinación institucional UNSL desbloquee Keycloak + LDAP. Diseño + cambios concretos + estimación. NO se ejecutó en iter 2 porque requiere infra externa.
- `docs/adr/023-sensitivity-analysis.md` (creado 2026-04-29) — análisis de sensibilidad de las constantes G8a (`ANOTACION_N1_WINDOW_SECONDS`, `ANOTACION_N4_WINDOW_SECONDS`) sobre corpus sintético. Generable con `scripts/g8a-sensitivity-analysis.py` (seed=42). El reporte empírico del piloto-1 debe re-ejecutar contra corpus real.
- `scripts/g8a-sensitivity-analysis.py` (creado 2026-04-29) — herramienta reproducible para regenerar el análisis de sensibilidad del override v1.1.0 del labeler. Usa monkey-patching del módulo (con restauración garantizada) para no contaminar runtime; output Markdown listo para ADR-023 o reporte empírico.
- `docs/adr/` — ADRs numerados (`ls docs/adr/` para el catálogo actual; **42 ADRs** al cierre del QA pass 2026-05-07). Cada ADR justifica una decisión atada a tests. Los más recientes que rigen modelos/invariantes descritos abajo:
  - **ADR-042** (refuerzo TareaPracticaTemplate piloto-1, Accepted 2026-05-07) — narrative students A1/A2/A3 con ≥4 episodios por template para piloto-1.
  - **ADR-041** (deprecación `identity-service`, Accepted 2026-05-07) — mismo patrón que ADR-030: 0 endpoints reales, código preservado en disco con README de deprecation. Auth via api-gateway + Casbin descentralizado.
  - **ADR-040** (BYOK propagation) — `materia_id` opcional en `CompleteRequest` schema del ai-gateway; el tutor-service lo resuelve al `open_episode` y cachea en `SessionState`; sin él el resolver BYOK degrada a scope=tenant (`resolved_scope="tenant_fallback_no_materia"`).
  - **ADR-039** (BYOK resolver jerárquico) — orden materia → tenant → env_fallback. scope=facultad omitido en piloto-1 (requiere lookup cross-DB; cache Redis es follow-up).
  - **ADR-038** (BYOK encriptación) — AES-256-GCM con `BYOK_MASTER_KEY` env var (32 bytes base64). Helper compartido en `packages/platform-ops/src/platform_ops/crypto.py`.
  - **ADR-037** (governance UI) — scope read-only para web-admin: filtros cascade facultad/materia/período + CSV export (cp1252-safe).
  - **ADR-036** (TP-gen IA) — endpoint en academic-service (NO en ai-gateway directo) para mantener Casbin + audit log centralizados. Audit log structlog `tp_generated_by_ai`.
  - **ADR-035** (reflexión privacy) — exclusión del classifier (RN-133) + redacted by default en export académico + flag `--include-reflections` con audit log.
  - **ADR-034** (test_cases JSONB) — almacenados en `tareas_practicas.test_cases` y `tareas_practicas_templates.test_cases`. Filter por rol en endpoint GET. Classifier IGNORA tests `is_public=false` (RN-134).
  - **ADR-033** (sandbox Pyodide-only piloto-1) — sin worker Docker; client-side execution para reducir blast radius.
  - **ADR-032** (G7 ML, diferido) — alertas predictivas con modelo entrenado sobre baseline individual del estudiante DIFERIDAS a piloto-2, con criterio cuantificable de revisitar (dataset mínimo + κ docente + validación cruzada split por estudiante).
  - **ADR-031** (D.4) — aliases `/api/v1/audit/*` para auditoría CTR desde web-admin sin romper el ROUTE_MAP del tutor-service.
  - **ADR-030** (D.6) — deprecación de `enrollment-service` (preservado en disco con README de deprecation).
  - **ADR-029** (B.1) — bulk-import de `inscripciones` centralizado en academic-service.
  - **ADR-028** (G15, diferido) — desacoplamiento instrumento-intervención (refactor 2200 LOC + Chrome ext, post-piloto-1).
  - **ADR-027** (G13, diferido) — Fase B postprocesamiento + `socratic_compliance` (requiere validación κ docente).
  - **ADR-026** (G11, diferido) — botón "Insertar código del tutor" en web-student (cambia condición experimental).
  - **ADR-025** (G10-A) — `EpisodioAbandonado` con doble trigger idempotente (beforeunload + worker timeout).
  - **ADR-024** (G9, diferido) — `prompt_kind` reflexivo en runtime (mid-cohort introduce sesgo).
  - **ADR-023** (G8a) — override temporal de `anotacion_creada` en labeler v1.1.0 (heurística posicional 120s/60s).
  - **ADR-022** — TanStack Router file-based + alertas predictivas + cuartiles privacy-safe.
  - **ADR-021** — registro externo Ed25519 (CTR auditable).
  - **ADR-020** — etiquetador N1-N4 derivado en lectura.
  - **ADR-019** — guardrails Fase A (preprocesamiento de prompts adversos).
  - **ADR-018** — CII evolution longitudinal por `template_id`.
  - **ADR-017** (G14, diferido) — CCD con embeddings semánticos (Eje B).
  - **ADR-016** — TareaPracticaTemplate + instancia.
- `docs/F0-STATE.md` … `docs/F9-STATE.md` — una bitácora por fase de qué quedó en cada milestone (útil para entender por qué un módulo existe).
- `docs/pilot/` — protocolo UNSL (`protocolo-piloto-unsl.docx`), runbook con 10 incidentes codificados `I01`–`I10` en `runbook.md` (I01 integridad CTR = CRÍTICA; I06 borrado = usar `anonymize_student()` sin tocar CTR), notebook de análisis `analysis-template.ipynb`.
- `docs/pilot/kappa-workflow.md` — procedimiento intercoder para Cohen's kappa (OBJ-13, RN-095/RN-096). Pre-piloto: 2 docentes etiquetan 50 episodios independientemente y se computa κ vía `POST /api/v1/analytics/kappa`. Plantillas en `docs/pilot/kappa-tuning/gold-standard-{template,example}.json`. Target tesis: κ ≥ 0.6.
- `docs/pilot/auditabilidad-externa.md` — protocolo de auditoría externa del CTR (ADR-021, RN-128). Documenta el flujo end-to-end (ctr-service → stream Redis → integrity-attestation-service → JSONL firmado), buffer canónico bit-exact, procedimiento del auditor, y limitaciones declaradas. **Es la fuente Markdown del contenido para promover al `protocolo-piloto-unsl.docx` cuando se regenere**. Tool del auditor: `scripts/verify-attestations.py`. Smoke test: `scripts/smoke-test-attestation.sh`.
- `docs/RESUMEN-EJECUTIVO-2026-04-27.md` — resumen ejecutivo de 1 página para destinatarios institucionales (director de tesis + DI UNSL). Decisiones tomadas, próximos pasos operativos, validación técnica. **Listo para enviar por email** sin requerir lectura de código. Si en sesiones futuras se hacen cambios sustanciales que tocan la coordinación institucional, regenerar con la nueva fecha.
- `docs/pilot/attestation-deploy-checklist.md` — checklist operativo de 10 pasos para que el **director de informática UNSL** deploye el `integrity-attestation-service` en VPS institucional separado. Incluye procedimiento de generación de clave Ed25519 **sin participación del doctorando** (D3 del ADR-021), configuración nginx con IP allowlist, systemd units con `replicas: 1`, smoke tests, runbook de fallas. Coordinación institucional desbloqueada 2026-04-27.
- `docs/pilot/attestation-pubkey.pem.PLACEHOLDER` — slot reservado para la pubkey institucional Ed25519. Cuando DI UNSL la entregue (Paso 2 del checklist), renombrar a `attestation-pubkey.pem` y commitear. Auditores externos la usan como snapshot reproducible del período del piloto (URL canónica del servicio + commit como mirror — ambos deben coincidir bit-a-bit).
- `docs/golden-queries/` — queries de evaluación del retrieval RAG (gate de calidad para cambios en `content-service`). Evaluadas por `scripts/eval-retrieval.py` → `make eval-retrieval`.
- `docs/architecture.md` — pointer al PDF formal + resumen navegable.
- `CONTRIBUTING.md` — branches, reglas de PRs y tests obligatorios (se superpone con este archivo; CLAUDE.md es el source of truth para agentes).
- `historias.md` (raíz) — 124 historias de usuario (HU-001 a HU-124) derivadas de F0–F9, con actor, fase, servicio, criterios de aceptación y trazabilidad a invariantes. Útil para entender la intención de un módulo antes de tocarlo.
- `reglas.md` (raíz) — catálogo de reglas de negocio (RN-XXX) clasificadas por severidad (Críticas/Altas/Medias/Bajas) y categoría (Invariante, Cálculo, Validación, Autorización, Persistencia, Privacidad, Operación, Auditoría, Seguridad), con cifras cotejadas contra el código. Ver el "Resumen ejecutivo" del archivo para totales por fase/severidad/categoría. Las recientes (RN-128 attestation Ed25519, RN-129 guardrails Fase A, RN-130 CII longitudinal, RN-131 alertas predictivas + cuartiles privacy-safe) cubren los detalles que las invariantes de "Propiedades críticas" referencian. Leer antes de tocar hashing, clasificador, CTR o privacy.
- `scripts/` — utilitarios de CI, migraciones, smoke tests, onboarding UNSL y export académico. Cuando veas `make X`, el `scripts/X.sh` tiene la lógica real.
- `BUGS-PILOTO.md` (raíz) — reporte de bugs detectados al levantar el piloto en Windows limpio + issues conocidos. Cada bug con severidad, ubicación exacta, fix aplicado y recomendación PR. Leer antes de tocar migraciones RLS, workspace Python, dev loop o proxy Vite.
- `scripts/seed-demo-data.py` y `scripts/seed-3-comisiones.py` — seeds idempotentes para que el web-teacher tenga data real (1 comisión / 6 estudiantes vs 3 comisiones / 18 estudiantes / cohortes diferenciadas). Detalle operativo + invocación en "Seeds para demos" arriba. **Tenant demo hardcoded**: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` (coincide con `tenant_id` del analytics-service).
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
- **`alembic/env.py` del academic-service apunta hardcoded a `academic_user`** que NO es owner de las tablas en el ambiente piloto local (las tablas son owned by `postgres`). Resultado: `make migrate` falla siempre con permission denied. Workaround verificado 2026-05-04: `ACADEMIC_DB_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/academic_main uv run alembic -c apps/academic-service/alembic.ini upgrade head`. Pendiente PR aparte que cambie el default de `env.py` a `postgres` o haga el user configurable. Hasta entonces, override explícito en cada corrida.
- **`CTR_DB_URL` es alias histórico de `CTR_STORE_URL`** — el `.env.example` declara ambos apuntando al mismo URL (líneas 15 y 87). El target `make migrate` ([Makefile:135](Makefile#L135)) usa `CTR_DB_URL`; los servicios y `make test-rls` usan `CTR_STORE_URL`. Si tocás uno, mantenelos sincronizados o consolidá a uno solo en un PR aislado (el ROUTE_MAP del gateway no depende de ninguna).
- **`.env` + `pydantic_settings` trap**: los servicios usan `BaseSettings(env_file=".env")` pero sólo cargan las vars *declaradas en el modelo Settings*. Las extras (`extra="ignore"`) se ignoran silenciosamente y NO se inyectan en `os.environ`. Si un servicio lee una var con `os.environ.get("X")` **Y** `X` no está en su `Settings`, tener `X` en `.env` no alcanza: hay que agregarla al modelo o exportarla en el shell antes de arrancar. Caso resuelto en sesión 2026-04-23 con `analytics-service`: leía `CTR_STORE_URL`/`CLASSIFIER_DB_URL` por `os.environ` sin declararlas, entonces caía a stub mode (devolvía `n_students=0` en `/cohort/{id}/progression`) aunque el `.env` las tuviera.
- **Uvicorn + `taskkill` en Windows deja sockets huérfanos**: si matás un uvicorn con `taskkill //F`, el proceso muere pero el socket LISTENING puede quedar en el kernel con el PID del proceso muerto. `netstat -ano` lo muestra, `Get-Process` no encuentra el PID. Nuevos uvicorn en el mismo puerto conviven sin recibir tráfico (Windows prefiere exact-match bindings, primer listener gana). `Stop-NetTCPConnection` NO está disponible en Windows PowerShell 5.1 default. Formas de liberar: esperar timeout del kernel (impredecible, minutos-horas), `wsl --shutdown` (tira Docker), o reboot. **Mitigación pragmática**: para validar un cambio, arrancar en un puerto alternativo temporal (ej. `:8035` si `:8005` tiene zombies) y aceptar que limpiar el puerto canónico puede requerir reboot.
- **Bootstrap del `governance-service` y prompts del tutor**: el `tutor-service` llama a `GET http://governance:8010/api/v1/prompts/tutor/v1.0.0` al abrir cada episodio. Si falla, `POST /api/v1/episodes` del tutor-service devuelve **500** con stack trace `httpx.HTTPStatusError: '404 Not Found' for '/api/v1/prompts/tutor/v1.0.0'`. Dos condiciones tienen que cumplirse simultáneamente para que arranque:
    - **Env var `PROMPTS_REPO_PATH`** seteada (vía `.env` o export). El default `/var/lib/platform/prompts` no existe en Windows. F14 cerró la deuda del template — `.env.example` ya declara `PROMPTS_REPO_PATH`, no `GOVERNANCE_REPO_PATH`.
    - **Directorio físico + prompt sembrado**: tiene que existir `{PROMPTS_REPO_PATH}/prompts/tutor/v1.0.0/system.md`. El repo incluye `ai-native-prompts/prompts/tutor/v1.0.0/system.md` con prompt N4 mínimo; `make init` NO crea el directorio.

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
- **`web-teacher` usa TanStack Router file-based** (ADR-022): rutas en `apps/web-teacher/src/routes/{__root,index,templates,kappa,progression,tareas-practicas,materiales,export,episode-n-level,student-longitudinal,cohort-adversarial}.tsx`. El `routeTree.gen.ts` lo genera el plugin `TanStackRouterVite` en `vite.config.ts` — registrado **ANTES** del plugin `react()`. Si typecheck falla con "no se encuentra `routeTree.gen.ts`", correr `pnpm exec vite build` una vez para que se genere. Los search params se validan con zod en cada ruta y se acceden tipados vía `Route.useSearch()`. **Drill-down navegacional** = `<Link to="/student-longitudinal" search={{ comisionId, studentId }}>` desde `ProgressionView` (la fila completa del estudiante es clickable). Por `exactOptionalPropertyTypes`, los routes pasan props opcionales con spread condicional (`{...(comisionId ? { initialComisionId: comisionId } : {})}`) en vez de `prop={value || undefined}`. El estado del sidebar (`comisionId` global) es ahora un query param compartido entre rutas via `ComisionSelectorRouted` que lee/escribe `useRouterState({ select: (s) => s.location.search as Record<string, unknown> })`. **Tests E2E** del web-teacher: `apps/web-teacher/tests/{EpisodeNLevelView,CohortAdversarialView,StudentLongitudinalView}.test.tsx` con `setupFetchMock(handlers)` (helper en `tests/_mocks.ts` que mockea fetch por path-prefix con default benigno `{data:[],meta:{cursor_next:null}}` para los componentes que firen fetch al mount — sin este default los `mockResolvedValueOnce` pierden orden y el test muere con `Cannot read properties of undefined (reading 'cursor_next')`).
