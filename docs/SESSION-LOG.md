# Session log

Bitácora de sesiones de trabajo significativas. Lo que vive acá es **changelog narrativo** — qué se hizo, por qué, en qué orden. Las verdades **permanentes** del sistema (invariantes, gotchas, decisiones que aplican a futuro) viven en `CLAUDE.md`, no acá.

**Convención**: cada sesión = un bloque dated `## YYYY-MM-DD`. No editar bloques viejos — agregar uno nuevo. Si una conclusión se vuelve permanente, **promovela** a `CLAUDE.md` y dejá un pointer acá.

---

## 2026-04-21 — Cierre de bugs piloto + Camino 3 + TareaPractica + polish

Sesión larga: arrancó con cleanups de bugs detectados en bring-up Windows, terminó con TareaPractica end-to-end y 5 cleanups paralelos.

### Cleanups iniciales (bugs piloto)

- **BUG-23 cerrado**: `scripts/check-rls.py` Unicode → ASCII (`"✓"` → `"[OK]"`). Exit code ahora 0. CI gate `make check-rls` ya no rompe en Windows.
- **BUG-24 cerrado**: `pytest` desde root colecta 376 tests sin errores. Fix real: `--import-mode=importlib` en `pyproject.toml:81` `[tool.pytest.ini_options].addopts` + 13 `__init__.py` en `apps/*/tests/` y `packages/*/tests/`. **Gotcha**: primera corrida post-fix requiere `find apps packages -type d -name __pycache__ -exec rm -rf {} +` para limpiar caché stale. ⚠️ Después se descubrió que los `__init__.py` en `apps/<svc>/tests/` top level rompían `test_health.py` → ver BUG-29 más abajo.
- **BUG-25 cerrado (Option A)**: `identity_store` removida — archivos (`init-dbs.sql`, `operacional.py:88`, `ADR-003` addendum, `architecture.md`, `.env.example`, `.env`) + runtime (`DROP DATABASE identity_store; DROP ROLE identity_user;`). Pseudonimización vive en `packages/platform-ops/privacy.py` rotando `student_pseudonym` en `academic_main.episodes`.
- **otel-collector fixed**: exporter `loki` (removido de otel-collector-contrib v0.86+) → `otlphttp/loki` apuntando a `http://loki:3100/otlp` (Loki 3+ soporta OTLP nativo). Config en `infrastructure/observability/otel-collector-config.yaml`. Container UP en vez de crashloop.
- **Heads-up: imágenes Docker en `:latest` sin pinear**: `otel/opentelemetry-collector-contrib` y `grafana/loki` en `infrastructure/docker-compose.dev.yml` no tienen version pin — el fix del otel-collector va a repetirse en el próximo breaking release. Recomendación: pinear a `0.150.1` / `3.7.1` (versiones verificadas funcionando) en un PR separado.
- **BUG-11 + BUG-18 cerrados (duplicados)**: seed-casbin Unicode `✓` → `[OK]` en `apps/academic-service/src/academic_service/seeds/casbin_policies.py:145`. BUG-18 marcado como `DUPLICADO de BUG-11` en `BUGS-PILOTO.md`. Seed corre con exit 0 en Windows.
- **BUG-20 cerrado**: `scripts/check-health.sh` cambiado de `localhost` a `127.0.0.1` en los 2 curls (backend + frontend). `make status` / `make check-health` ya no dan falso negativo en Windows con IPv6 dual-stack. **Caveat**: los frontends Vite bindean `::1` (IPv6) — el curl a `127.0.0.1` puede dar falso negativo para ellos. Backends Python (uvicorn dual-stack) OK.
- **BUG-15 cerrado**: `--passWithNoTests` agregado al `test` script de los 4 packages TS sin tests (`web-admin`, `web-teacher`, `web-student`, `ctr-client`). `pnpm turbo test` → 4/4 successful (antes exit 1). **Deuda**: esos 4 packages no tienen tests reales — escribir al menos 1 smoke test por frontend antes de staging.

### Auth en endpoints analytics (BC-incompatible)

- **BUG-21 + BUG-22 cerrados**: endpoints de analytics ahora leen `X-Tenant-Id`/`X-User-Id` vía `Depends`. Confirmado el invariante: api-gateway es ÚNICO source of truth de identidad.
- **BUG-26 cerrado (kappa endpoint auth)**: `POST /api/v1/analytics/kappa` ahora requiere `X-Tenant-Id` + `X-User-Id` y emite audit log structlog `kappa_computed` (mismo patrón que BUG-21/22 + HU-088). 11/11 tests pass. **BC-incompatible** — 8 curls en docs pilot/F6/F7-STATE/runbook/kappa-workflow actualizados con headers. `docs/pilot/protocolo-piloto-unsl.docx` (binary) pendiente de regenerar con `make generate-protocol`.
- **HU-088 audit log**: ratificada como structlog (no tabla persistente) — el endpoint AB emite event `ab_test_profiles_completed` con `tenant_id`, `user_id`, `kappa_per_profile`, `classifier_config_hash`. Si compliance team del piloto requiere tabla queryable, revisitable (S effort, 1-2h).
- **AB endpoint requiere auth desde 2026-04-21**: `POST /api/v1/analytics/ab-test-profiles` ahora requiere `X-Tenant-Id` + `X-User-Id` (per HU-088 audit log). Cambio BC-incompatible — curls en `docs/F7-STATE.md:167-173` y posibles notebooks usando el endpoint necesitan headers.

### Camino 3: jerarquía académica + UI + bulk import

- **HU-011 backend completado (Camino 3 Fase 1)**: agregados `Facultad` + `PlanEstudio` con CRUD completo (POST/GET list+filter/GET one/PATCH/DELETE), service+schemas+routes+tests siguiendo pattern de Carrera. Plus DELETE endpoints faltantes en `Universidad` (con superadmin-only enforce + cascade check 409 si tiene carreras), `Materia`, `Comisión`, `Periodo` (cascade checks reales: 409 si hijos activos). Routers registrados en `apps/academic-service/src/academic_service/main.py`. Tests: 8/8 facultad + 8/8 plan + 9/9 soft-delete pass; suite academic-service 64/66 (los 2 errors son pre-existentes en `test_comision_periodo_cerrado.py` por fixture `user_docente_admin_a` faltante — bug aparte).
- **BUG-27 cerrado**: agregado `apps/academic-service/tests/integration/conftest.py` con los fixtures compartidos `tenant_a_id`, `tenant_b_id`, `user_docente_admin_a`, `user_docente_admin_b` (mismo shape que el inline definido en `test_facultades_crud.py` / `test_planes_crud.py`). El collection error de `test_comision_periodo_cerrado.py` desaparece y la suite pasa de `71 passed + 2 errors` a `72 passed + 2 failed` — los 2 failed restantes son un bug separado de mocking SQLAlchemy en ese archivo. Candidato a BUG-28.
- **BUG-28 cerrado**: cambiados `Materia.__new__(Materia)` y `Periodo.__new__(Periodo)` por `MagicMock(spec=Materia/Periodo)` en `test_comision_periodo_cerrado.py` (2 tests). Suite academic-service final: **74 passed, 0 errors, 0 failures** (vs 71+2errors al inicio del día).
- **Camino 3 Fases 2-4 completas (UI académica + bulk import)**: agregadas `MateriasPage`, `ComisionesPage`, `FacultadesPage`, `PlanesPage` en `apps/web-admin/src/pages/`; `Breadcrumb` component en `apps/web-admin/src/components/`; DELETE buttons en UniversidadesPage + CarrerasPage con cascade 409 handling; `BulkImportPage` con dry-run preview + commit transaccional; backend `POST /api/v1/bulk/{entity}?dry_run=...` (multipart CSV, MAX_CSV_BYTES=5MB, 413 si excede) que soporta facultades/carreras/planes/materias/periodos/comisiones; `apps/web-admin/src/router/Router.tsx` con 9 routes navegables; `apps/api-gateway/.../proxy.py` ROUTE_MAP actualizado con `/facultades`, `/planes`, `/bulk`. Casbin re-seedeada a 79 policies.

### Content ingestion (RAG) — UI agregada

- **Auditoría content ingestion**: `content-service` (puerto 8009) tiene 5 endpoints (`POST /materiales` multipart, `GET list/single`, `DELETE`, `POST /retrieve`), 5 extractors (PDF unstructured+pypdf, Markdown con jerarquía, Code ZIP 13 lenguajes, Text, Video placeholder), chunker estratificado (code: 1 chunk/función, prose: sliding window 512/50 tokens, tables atómicas), embeddings con `intfloat/multilingual-e5-large` (1024 dims) + MockEmbedder fallback, pgvector con IVFFlat index (cosine), retrieval con re-ranking (bge-reranker-base) + `chunks_used_hash` SHA-256 para CTR audit, storage abstraction (mock/S3 MinIO). 24 unit tests pasando. Material scoping: solo `comision_id` (no materia_id ni problema_id — ADR-003 lo defiere a F3+). Async ingestion via Redis Streams diseñada pero no implementada (sync con timeout HTTP en F2).
- **UI MaterialesView**: agregada en `apps/web-teacher/src/views/MaterialesView.tsx` + tab en `App.tsx` + `materialesApi` con `multipartUpload` helper en `apps/web-teacher/src/lib/api.ts`. Polling de estado cada 2s hasta `indexed`/`failed` con `useRef<Map<id, timeoutHandle>>`. Roles autorizados: `docente`, `docente_admin`, `superadmin`. Badges de tipo (PDF rojo, MD azul, ZIP verde, etc.) y estado (pulse animado si procesando). Comisión hardcoded a `DEMO_COMISION_ID` hasta que aparezca un selector. **Implicación pilot**: docentes ya no necesitan curl para subir contenido al RAG.

### TareaPractica entity completa (Camino C) — gap crítico cerrado

El sistema asumía `Episode.problema_id` UUID **sin validación, sin tabla destino, sin endpoints, sin UI**. Implementado end-to-end:

- **Backend (`academic-service`)**: modelo `TareaPractica` en `models/operacional.py` (campos: codigo, titulo, enunciado markdown, fecha_inicio/fin nullable, peso decimal 0-1, rubrica JSONB, estado `draft|published|archived`, version int, parent_tarea_id FK self, created_by, soft delete). Migración `20260421_0002_add_tareas_practicas.py` con RLS aplicada. Service `tarea_practica_service.py` con CRUD + audit log RN-016 + 409 inmutabilidad si estado != draft. Routes `routes/tareas_practicas.py` con 9 endpoints (POST/GET list+filter por comision/estado/GET one/PATCH/DELETE + transiciones `POST {id}/publish`, `POST {id}/archive`, `POST {id}/new-version` para cadena de versiones inmutable + `GET {id}/versions` con `is_current` flag). Casbin: +13 policies (`tarea_practica:CRUD` para superadmin/docente_admin/docente, read-only para estudiante). Bulk import extendido para `entity=tareas_practicas` con JSON parse de rubrica.
- **Validación cross-service**: nuevo `AcademicClient` en `apps/tutor-service/src/tutor_service/services/academic_client.py`. `tutor.open_episode()` ahora valida 6 condiciones antes de crear el episodio (TP existe / tenant matches / comision matches / estado=published / now >= fecha_inicio / now <= fecha_fin), retornando 404/403/409/400 según corresponda.
- **UI web-teacher**: `views/TareasPracticasView.tsx` (~934 líneas) con CRUD + transiciones publish/archive/new-version + timeline de versiones con `is_current` destacado + form con validación de rubrica JSON. Tab "Trabajos Prácticos" como PRIMER tab (antes de Materiales) — flow conceptual: primero TPs, después material RAG asociado.
- **UI web-student**: nuevo `components/TareaSelector.tsx` que lista TPs `published` para la comisión, muestra título/codigo/version/excerpt + deadline indicator color-coded (rojo <24h, ámbar <72h, gris resto). El estudiante elige TP antes de abrir episodio. **Hardcoded `problema_id: "cccccccc-..."` REMOVIDO** de `apps/web-student/src/pages/EpisodePage.tsx:40-41` — ahora viene del TP seleccionado. Botón "Cambiar TP" cierra episodio actual (con reason `student_switched_tarea` para preservar append-only del CTR) y vuelve al selector. Enunciado del TP pinned arriba del CodeEditor.
- **Tests**: ~49 tests nuevos verdes (10 facultad-style CRUD + 10 versioning + 9 tutor validation + 12 bulk + 8 otros). **Suite total academic+tutor: 123 passed, 0 errors, 0 failures**.
- **Drift Casbin policies — RESUELTO**: spec actualizadas para no hardcodear count (RN-018, HU-016, F1-STATE.md addendum). Source of truth es el código del seed (`casbin_policies.py`). Hoy el seed carga 92 policies (4 roles × N entidades crecientes), evoluciona naturalmente al agregar recursos.

### Polish post-Camino C (5 cleanups paralelos)

- **Markdown renderer**: instalado `react-markdown@9` + `remark-gfm@4` en web-teacher y web-student. Componente `MarkdownRenderer.tsx` (~95 líneas) duplicado en cada frontend (no shared package — overhead). Reemplazó `<pre>` por `<MarkdownRenderer>` en `TareasPracticasView` (modal Ver) y `EpisodePage` (EnunciadoPanel). XSS-safe by default (react-markdown 9 no renderea HTML embebido). Sin `@tailwindcss/typography` plugin — usa selectors arbitrarios `[&_h1]:text-lg [&_p]:my-2 [&_table]:...` para estilos básicos. Rubrica sigue como `<pre>{JSON.stringify(...)}</pre>`. Editor `<textarea>` del docente sigue plain (TODO: split-pane preview).
- **Comisión selector real**: backend nuevo `GET /api/v1/comisiones/mis` en `academic-service` con `ComisionService.list_for_user()` que JOINea `comisiones` con `usuarios_comision` filtrando por `user_id` activo. Componente `ComisionSelector.tsx` duplicado en web-teacher + web-student, persiste selección en localStorage key `selected-comision-id` con verificación de stale-id contra response del backend. App.tsx de cada frontend reemplaza `DEMO_COMISION_ID` constant por `useState`. Constant mantenida como **fallback dev** (commented). Placeholder cuando `selectedComisionId === null`. **4/4 tests pass** para `test_mis_comisiones.py`. **Caveat importante**: la tabla `usuarios_comision` es para docentes/JTP/auxiliares — los **estudiantes viven en `inscripciones` con `student_pseudonym`**, así que el selector retornará vacío para estudiantes reales hasta que F9 derive `comisiones_activas` del JWT claim de Keycloak. El docstring del endpoint lo documenta. Dropdown muestra solo `codigo + uuid prefix` (no nombre de materia — necesitaría JOIN extra).
- **Pagination "Cargar más" en TareaSelector**: cursor-based, botón solo si `nextCursor !== null`, edge cases: empty initial, error mid-load (inline error preserva lista existente), comisión change reset, double-click guard. **Caveat**: sin `AbortController` en handleLoadMore — si user spam-clickea durante comisión change, response stale podría appendarse (riesgo bajo para piloto, no fix urgente).
- **Race condition tutor — mitigada**: `tutor_core.open_episode()` ahora hace **doble validación** vía `_validate_tarea_practica(is_recheck=True)`. Primera llamada al inicio (existente), segunda llamada justo antes del CTR `EpisodioAbierto` event emission. Reduce ventana de race de ~50-500ms (HTTP + Redis + governance fetch) a **<1ms** (in-process Python entre recheck y `ctr.publish_event()`). NO es atómica — protege contra "docente archiva durante creación", NO contra TOCTOU de ms. Documentado como best-effort en docstring. Si recheck falla, session state en Redis queda orphan pero TTL la limpia (no CTR event = no episode visible). **12/12 tests pass** (8 + 1 backwards-compat + 3 race-specific con `AsyncMock(side_effect=[first, second])`).
- **BUG-30 cerrado** (UX, baja severidad — antes mal-numerado como BUG-28 segundo): client-side date validation agregada en `apps/web-teacher/src/views/TareasPracticasView.tsx::handleSubmit` (form de TP). Si docente setea `fecha_fin <= fecha_inicio`, el form rechaza con mensaje claro "La fecha de fin debe ser posterior a la fecha de inicio" en lugar de pegarle al backend y recibir un 400 genérico. Backend ya tenía Pydantic validator (defensa en profundidad).
- **BUG-29 cerrado** (test_health fixture systematic fix): Strategy A descartada (asyncio_mode ya estaba "auto" globalmente) y Strategy B descartada (cambiar `@pytest.fixture` a `@pytest_asyncio.fixture` no resolvía). Fix real: eliminados los 12 `apps/*/tests/__init__.py` vacíos que BUG-24 había creado — con `__init__.py` presente, pytest+importlib seguía colapsando los 12 `tests/test_health.py` en un único módulo `tests.test_health`, y sólo el primer servicio alfabético (`academic-service`) registraba su fixture `client`. Removidos los `__init__.py`, importlib usa file path para identidad única. **38/38 tests verdes** en `apps/*/tests/test_health.py` (antes `3 passed + 33 errors`).

### Lecciones promovidas a CLAUDE.md (permanentes)

- ⬆️ **NO `__init__.py` en `apps/<svc>/tests/` top level** con `--import-mode=importlib` — colapsa modules across services. SÍ está OK en `tests/unit/` y `tests/integration/`. Worth a `make check-tests-init` lint target preventivo en futuro PR.
- ⬆️ **Scripts con stdout en Windows: ASCII, no Unicode** — usar `[OK]`/`[FAIL]` o `sys.stdout.reconfigure(encoding='utf-8')`. Patrón aplicado a check-rls.py y casbin_policies.py.
- ⬆️ **Implementaciones compartidas viven en `packages/platform-ops/` y `packages/observability/`** — antes de declarar OBJ como missing, grep ahí. Lección de 2 falsos negativos (OBJ-10 privacy + OBJ-12 A/B profiles).

### Estado final del proyecto post-cleanup

- **30 bugs documentados** (todos cerrados o duplicados — BUG-18 dup de BUG-11; el segundo BUG-28 fue renumerado a BUG-30).
- Tests academic+tutor+content ~170+ verdes, casbin matrix 23/23 con 92 policies.
- 8 entidades académicas con CRUD+UI, 0 hardcoded `DEMO_COMISION_ID` activos en código (solo fallback dev).
- El piloto puede arrancar **sin reservas técnicas** — los docentes hacen TODO desde el browser.

---

## 2026-04-22 — Reorganización de docs + fix bring-up + sidebar UI (pilot)

### CLAUDE.md restructurado + extracción de SESSION-LOG

- **CLAUDE.md reescrito**: nueva estructura (Known issues al tope, comandos en grupos Daily/Migraciones/Operacional, ports infra agregados, "Estado actual" reducido a verdades permanentes). Lecciones operativas movidas a Gotchas (pytest sin `__init__.py` top-level, ASCII en scripts Windows). Coverage framing invertido (CI <60% HOY, target 80/85 a futuro). Política B explícita en health checks (NO sumar en PRs ad-hoc, swept dedicado en OBJ-16). `TareaPractica` promovida a invariante crítico. Path corregido en test reproducibilidad: `apps/classifier-service/tests/unit/test_pipeline_reproducibility.py` (era `test de integración` factualmente incorrecto).
- **SESSION-LOG.md creado**: este archivo. El changelog narrativo del 2026-04-21 (~700 líneas que ocupaban ~40% del CLAUDE.md) se movió acá. Convención: bloques dated por sesión, no editar viejos, agregar nuevos. BUG-28 duplicado renombrado a BUG-30 en el proceso.

### Fix bring-up: `make generate-protocol` y dep `docx`

- **Bug descubierto regenerando el protocolo**: `make generate-protocol` falla en checkout limpio porque `docx` no está declarado como dep en ningún `package.json` del repo. Fix: `pnpm add -wD docx@^9.6.1` al root. Plus dos paths Linux hardcoded en los generadores: `docs/pilot/generate_protocol.js:624` y `docs/pilot/generate_teacher_guide.js:534` (`/home/claude/...` → relativo).
- **Makefile extendido**: agregados `make generate-teacher-guide` (regenera la guía docente) y `make generate-docs` (atajo: corre los dos). `CLAUDE.md` actualizado en sección de comandos operacionales.
- **DOCX regenerados**: `docs/pilot/protocolo-piloto-unsl.docx` (~23 KB) y `docs/pilot/guia-capacitacion-docente.docx` (~21 KB).

### Sidebar colapsable en web-admin (pilot)

- **Goal**: reemplazar la topbar nav (`<nav>` horizontal con 9 botones) por un sidebar agrupado y colapsable. La topbar iba a quedar apretada a medida que la jerarquía académica crece (TPs, evaluaciones en F8+).
- **Where**: `apps/web-admin/src/components/Sidebar.tsx` (~225 líneas, nuevo) + `apps/web-admin/src/router/Router.tsx` (modificado: layout flex horizontal en vez de vertical, `<Sidebar>` reemplaza `<Nav>` inline). Componente **duplicado pattern** (igual que `MarkdownRenderer`) — no se sube a `packages/ui` hasta tener >=2 frontends usándolo.
- **Diseño**: colapsable con toggle (chevron-left/right), expanded ~256px / collapsed ~64px solo iconos. Tooltips en collapsed via `title` attr nativo (sin lib). Estado persiste en localStorage `web-admin-sidebar-collapsed`. Active route con `bg-gray-800 + border-l-2 border-blue-500`. Iconos de **`lucide-react`** (ya estaba en `package.json`, no agregó dep). Paleta dark (gray-900 fondo, gray-100 texto). Aria-labels + aria-current="page" + aria-expanded.
- **Agrupación final** (descubrió 2 rutas extra no listadas en mi spec inicial): `(sin header) Inicio` / `JERARQUÍA ACADÉMICA: Universidades, Facultades, Carreras, Planes, Materias, Comisiones` / `PEDAGOGÍA: Clasificaciones N4` / `OPERACIONAL: Importación masiva`.
- **Validación**: typecheck + lint en baseline pre-cambio (cero errores nuevos introducidos). Validado visualmente por user en browser (`http://localhost:5174` — Vite saltó del 5173 ocupado por otro proceso).
- **Caveats / TODOs explícitos**: (1) no es mobile-responsive (sidebar fijo aún en viewports chicos); (2) cuando F2-F3 migre a TanStack Router type-safe, el sidebar va a necesitar leer ruta activa de `useRouterState()` en vez de recibirla por props; (3) replicación a `web-teacher` queda para PR siguiente; (4) hay 7 typecheck errors pre-existentes en `pages/{BulkImport,Carreras,Comisiones,Materias,Planes}.tsx` + `vite.config.ts` por `exactOptionalPropertyTypes: true` — NO introducidos por este PR.

### Bug pre-existente descubierto durante validación

- **TanStack Router plugin mal configurado en `web-admin`**: `vite.config.ts` tiene el plugin `@tanstack/router-plugin` activo apuntando a `src/routes/` que no existe. Vite tira `ENOENT: no such file or directory` en startup pero igual sirve la app (el error es del plugin, no fatal). Fix futuro: o crear `src/routes/` (placeholder) o sacar el plugin de `vite.config.ts` hasta que migre el routing real (F2-F3). Candidato a issue/BUG aparte.

### Side effect: `pnpm install` sobre web-admin

- El agente del sidebar tuvo que correr `pnpm install --filter @platform/web-admin...` porque `apps/web-admin/node_modules` estaba vacío en el checkout. No agregó deps nuevas (solo levantó las existentes), pero el árbol de `node_modules` está poblado ahora.

### Sidebar colapsable en web-teacher (pilot completo en 2/3 frontends)

- **Goal**: replicar el patrón de sidebar de web-admin en web-teacher para unificar la navegación lateral. La topbar con 5 tabs horizontales se va a apretar a medida que aparezcan más vistas (analytics F8+).
- **Where**: `apps/web-teacher/src/components/Sidebar.tsx` (~213 líneas, nuevo, **patrón duplicado** del de web-admin) + `apps/web-teacher/src/App.tsx` (eliminada función `Header` completa, layout flex horizontal con `<Sidebar>` + `<main>`). NO se convirtieron tabs a rutas reales — sigue state-based switching (menos refactor, mismo resultado visual).
- **Diseño**: idem web-admin (gray-900, lucide-react, tooltips via `title` nativo, persistencia en localStorage `web-teacher-sidebar-collapsed` namespaced). Agrupación 3 bloques: **TRABAJO DEL DOCENTE** (TPs `ClipboardList`, Materiales `FolderOpen`), **ANÁLISIS** (Progresión `BarChart3`, Inter-rater `FileBarChart`), **OPERACIONAL** (Exportar `Download`). **Vista inicial cambiada** de `progression` a `tareas-practicas` para alinear con primer item del sidebar (cambio de UX, reversible en 1 línea si los docentes lo extrañan).
- **ComisionSelector**: integrado dentro del sidebar, debajo del header — visible solo cuando expanded. En collapsed se oculta (el `<select>` nativo no encaja en 64px y abrirlo programáticamente con `.showPicker()` es Chromium-only; refactor a popover custom sale del scope).
- **Validación**: typecheck delta 0 (10 errores pre-existentes intactos), lint delta -1 (formatter biome fixeó incidentalmente 1 error de format en `App.tsx`). User validó visualmente en browser (`http://localhost:5175` — Vite saltó del 5174 ocupado por web-admin).
- **Spec inicial mal scopeada**: el orchestrator dijo "2-3 tabs" en el plan; eran 5. El agente lo descubrió leyendo `App.tsx` y agrupó razonablemente. Lección operativa: NO asumir count de items — pedir al agente que verifique antes de groupear.

### TanStack Router plugin bug confirmado como cross-frontend

- El error `ENOENT: no such file or directory, scandir '...src/routes'` que vimos en web-admin se reproduce **idéntico en web-teacher** al levantar Vite. Ambos `vite.config.ts` tienen el plugin `@tanstack/router-plugin` activo apuntando a `src/routes/` que no existe en ninguno de los dos. **NO es un bug del sidebar** — es deuda pre-existente del setup. Probable también en web-student (no verificado en esta sesión). Fix: o sacar el plugin de los `vite.config.ts` hasta que migre el routing real (F2-F3), o crear `src/routes/` placeholder en cada frontend. **Candidato a issue/BUG aparte como cross-frontend**.

### Justificación creciente para `packages/ui` Sidebar

- Después de este PR hay **3 componentes duplicados** entre frontends: `MarkdownRenderer` (web-teacher + web-student), `Sidebar` (web-admin + web-teacher). El threshold para subir un genérico a `packages/ui` se cumple. **No se hizo en este PR** porque era out-of-scope explícito y `packages/ui` no está siendo usado activamente todavía. **Candidato a refactor**: `Sidebar` parametrizable por `NAV_GROUPS`, `STORAGE_KEY`, `HEADER_LABEL` y opcional `slot` arriba para `ComisionSelector` u otros componentes context-specific. Si el patrón se replica una vez más (web-student u otro frontend nuevo), pasa de "candidato" a "deuda inmediata".

### Estado del día (sidebar pilot completo en 2/3 frontends)

- web-admin: sidebar agrupado + colapsable funcional, validado.
- web-teacher: idem, validado.
- web-student: fuera de scope (single-page, sidebar no agrega valor).
- 0 errores nuevos introducidos en typecheck/lint en ninguno de los dos.
- Patrón visual consistente entre los dos frontends (gray-900, lucide-react, mismas clases Tailwind, mismo comportamiento de toggle + persistencia).
- 2 dev servers corriendo en background al cierre de la sesión: `bzsiq3av5` (web-admin :5174), `b3y47dypk` (web-teacher :5175). El user los matará cuando termine de testear.

### Ola 1 cleanup — TanStack Router plugin ENOENT removido

- **Causa**: los 3 `vite.config.ts` (web-admin, web-teacher, web-student) cargaban `TanStackRouterVite({ target: "react", autoCodeSplitting: true })` pero ningún `.ts`/`.tsx` importa de `@tanstack/react-router`. El plugin escaneaba `src/routes/` inexistente al startup y tiraba `ENOENT: no such file or directory, scandir '...src/routes'` (no fatal, ruido en logs).
- **Fix (Opción A)**: removido el `import { TanStackRouterVite }` y su entry del array `plugins` en los 3 `vite.config.ts`. Comentario in-place documenta cómo re-wirearlo cuando F2-F3 migre a routing type-safe. Deps `@tanstack/react-router` y `@tanstack/router-plugin` quedan en `package.json` (lockfile intacto, limpieza de deps va en PR aparte).
- **Verificación**: `pnpm tsc --noEmit` delta = web-admin 7→7, web-teacher 10→10, web-student 296→295 (un `TS2307 Cannot find module '@tanstack/router-plugin/vite'` menos en web-student por su tsconfig roto). Zero regresiones.
- **Archivos**: `apps/{web-admin,web-teacher,web-student}/vite.config.ts`.

### Hallazgo colateral: web-student tiene 295 errores de typecheck

- Surfeado durante la ola 1 al medir baseline. **NO es regresión** — es estado pre-existente. La causa raíz parece ser un `tsconfig.json` roto: faltan `@types/node` y los types de `vite`. Cantidad masiva de `TS2307 Cannot find module` y similares.
- **Severidad**: 🔴 Alta, pero NO urgente para piloto (web-student igual builda y corre — typecheck errors no bloquean Vite).
- **Acción**: deuda flagueada para PR aparte. NO se incluyó en la ola 2 (scope era web-admin + web-teacher). Cuando se aborde, probable fix: agregar `"@types/node"` a devDeps + revisar `compilerOptions.types` en el tsconfig del frontend.

### Ola 2 cleanup parte 3 — web-admin lint

- **Estado**: lint 17→0, typecheck 0→0 (intacto). Categorías idénticas a parte 2 (web-teacher): 9 `noLabelWithoutControl` + 8 `useExhaustiveDependencies`. `biome check --write` no aportó (safe-fix vacío, ningún format/imports issue).
- **Fix replicado mecánicamente del pattern de web-teacher**: 17 `biome-ignore` agregados con razón explícita — 6 sobre el helper `Field` (children es el control wrappeado, biome no lo ve estáticamente, mismo helper duplicado en `UniversidadesPage`/`CarrerasPage`/`FacultadesPage`/`PlanesPage`/`MateriasPage`/`ComisionesPage`) + 3 sobre labels inline con select bajo conditional ternario (`FacultadesPage`/`PlanesPage`/`MateriasPage`) + 8 sobre `useEffect` mount-only o single-arg-driven. Ningún cambio de runtime, sólo comentarios. **No se tocó** `Sidebar.tsx`, `Router.tsx`, `App.tsx`.

### Bring-up completo + bugs descubiertos durante runtime

- **`make init` end-to-end corrido**: 10 containers Docker (postgres/keycloak/redis/minio/grafana/prometheus/jaeger/loki/keycloak-db/otel-collector), `uv sync` (143 packages, 24 platform services built), `pnpm install`, migraciones Alembic en 4 bases (academic_main/ctr_store/classifier_db/content_db), permisos DB + rol `platform_app` + GUC `app.current_tenant` configurado, 93 Casbin policies seedeadas.
- **BUG nuevo del Makefile en Windows**: el target `setup-dev-perms` falla con `bash: C:\alberto\Penisi\AI-NativeV3-main: No such file or directory` — Make + Git Bash en Windows no manejan el path con `(1)` al invocar `@./scripts/setup-dev-permissions.sh`. **Workaround aplicado**: `bash scripts/setup-dev-permissions.sh` directo. **Fix sugerido en el Makefile**: cambiar `@./scripts/...` por `@bash ./scripts/...`. Candidato a entrada en `BUGS-PILOTO.md`.
- **12 backends levantados manualmente** vía `uv run uvicorn <svc_snake>.main:app --port <port> --host 127.0.0.1` (puertos 8000-8011). Pattern validado con api-gateway primero, replicado en los otros 11. Todos respondieron `/health` 200 — pero recordar CLAUDE.md: solo ctr-service tiene health check real, los otros 11 son stub `{"status":"ok"}`.
- **3 frontends vía `make dev`** con port shift por colisión externa: web-admin en **5174** (no 5173), web-student en **5175**, web-teacher en **5176**. El 5173 respondió HTTP 200 pero no era nuestro (proceso externo).

### Bugs runtime descubiertos + fixeados al pegar a la UI

Al usar la UI en browser (user reportó 500 al clickear "Clasificaciones N4" en web-admin sidebar):

- **Bug 1 — `.env` con DB URLs vacías**: `CTR_STORE_URL=` y `CLASSIFIER_DB_URL=` vacías + `CONTENT_DB_URL` faltaba del todo. El classifier-service cayó con `sqlalchemy.exc.ArgumentError: Could not parse SQLAlchemy URL from given URL string`. **Causa raíz**: el `.env.example` del repo nunca tuvo esos valores — las líneas 82-86 estaban pensadas "solo para analytics-service F8" pero classifier-service y content-service también leen `CLASSIFIER_DB_URL` y `CONTENT_DB_URL`, y para ellos no es opcional. **Fix aplicado**: pobladas las 3 URLs tanto en `.env` como en `.env.example`, con comentario explicando el dual-use y apuntando a la deuda de separar los namespaces (`ANALYTICS_CLASSIFIER_DB_URL` vs `CLASSIFIER_DB_URL`).
- **Bug 2 — `config.py` de classifier-service con default factualmente malo**: `classifier_db_url` default apuntaba a `ctr_store` ("las clasificaciones son derivados de eventos") pero la tabla `classifications` vive en `classifier_db` (ADR-003, y lo confirman `scripts/migrate-all.sh` + `seed-demo-data.py`). El comentario era stale — decisión arquitectónica cambió pero el default no se actualizó. **Fix**: default apunta a `classifier_user:classifier_pass@127.0.0.1:5432/classifier_db`, comentario actualizado mencionando ADR-003 y los users del setup-dev-permissions.
- **Bug 3 — `ClasificacionesPage.tsx` DEMO_COMISION_ID mismatch**: hardcode `"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"` — pero ese UUID es de **UNIVERSIDAD** en `seed-demo-data.py`, no una comisión. La comisión correcta del seed es `"aaaaaaaa-..."` (mismo UUID que TENANT_ID). Copy-paste error. **Fix**: UUID corregido + comentario `TODO(F9)` explícito que el hardcode es dev-only y va a ser reemplazado por `ComisionSelector` cuando el JWT de Keycloak traiga `comisiones_activas` como claim.
- **`scripts/seed-demo-data.py` ejecutado**: 6 estudiantes + 30 episodios CTR + 30 classifications en la comisión `aaaaaaaa-...`. El endpoint `GET /api/v1/classifications/aggregated` ahora devuelve data real (total_episodes=13 en últimos 30 días, distribution 0/6/7, CT=0.71, CCD=0.66, CII_stab=0.67, timeseries poblado).

### Estado al cierre del día

- **Plataforma corriendo end-to-end**: 10 containers + 12 backends + 3 frontends = 25 procesos. ~6-8 GB RAM.
- **ClasificacionesPage UI funcional con data real** — user validó en browser.
- Los 3 bugs runtime fixeados **en disco** (no commiteados porque el repo no está inicializado como git — pregunta pendiente desde hace rato: ¿es este el repo real o una copia de trabajo de un clone ajeno?).
- **Deuda que sigue abierta (para mañana o después)**:
  - ComisionSelector en web-admin (el hardcode ahora tiene TODO(F9) pero sigue siendo hardcode).
  - ~~Makefile target `setup-dev-perms` roto en Windows~~ ✅ FIXED (línea 146 ahora `@bash ./scripts/...`).
  - Separación namespace de env vars (CLASSIFIER_DB_URL compartida entre classifier-service y analytics-service fallback).
  - ~~web-student 295 typecheck errors~~ → **corregido el número**: baseline real es **2 typecheck + 15 lint**, no 295. Menor pero sigue pendiente cleanup.
  - ~~`packages/ui` refactor (6 componentes duplicados)~~ ✅ FIXED — Sidebar/MarkdownRenderer/ReadonlyField unificados. Los 6 duplicados eliminados.
  - `packages/ui` pre-existing lint errors en Button.tsx/Card.tsx/Label.tsx (4 errores del design system starter). No tocados hoy.
  - ⚠️ **La pregunta de git sigue sin resolverse** — si este `AI-NativeV3-main (1)/AI-NativeV3-main` es copia de trabajo, el riesgo de perder todo el laburo de hoy al reemplazar el directorio es real.

### Carrera.facultad_id pasa a NOT NULL + UI refactor

- **Pedido del user**: jerarquía real Facultad→Carrera (1-N). El modelo ya tenía `facultad_id` como FK a `facultades`, pero era **nullable**. El user pidió que sea requerido — que una carrera siempre pertenezca a una facultad.
- **Migración**: `20260422_0001_carrera_facultad_required.py` — `op.alter_column("carreras", "facultad_id", nullable=False)`. Corrió limpio sobre 1 row existente (ya tenía facultad_id seteado, sin backfill necesario).
- **Modelo**: `Carrera.facultad_id: Mapped[uuid.UUID]` (sin `| None`). Relación `.facultad` tipa `Facultad` directo.
- **Schema**: `CarreraCreate.facultad_id: UUID` required. **`universidad_id` REMOVIDO del payload de create** — se deriva del facultad en el service (API más limpia, invariante "facultad es el ancla" codificada en el type, elimina clase de error "mismatch universidad vs facultad.universidad"). `CarreraOut` sigue exponiendo `universidad_id` (denormalizado) + `facultad_id` (required). DB conserva ambas columnas por compatibilidad con queries existentes.
- **Service**: `CarreraService.create()` ahora valida `FacultadRepository.get_or_404(facultad_id)` + tenant match, luego inserta `universidad_id` denormalizado desde `facultad.universidad_id`.
- **Frontend `CarrerasPage.tsx`**: selector y columna de tabla pasaron de Universidad a Facultad. Carga `facultadesApi.list()` en vez de `universidadesApi.list()`. Botón "Nueva" disabled con tooltip si no hay facultades. `packages/web-admin/src/lib/api.ts` updated (`Carrera.facultad_id: string` required, `CarreraCreate` sin `universidad_id`). `BulkImportPage` + backend `bulk_import.py` ajustados — FK check de carreras ahora ancla en facultad, CSV require columna `facultad_id`.
- **Tests**: suite academic-service **107/107 pass**. Agregado `test_facultad_id_required`. Actualizado `test_bulk_import_carreras_validates_facultad_fk` (mockea `FacultadRepository.get_or_404`).
- **Validación runtime**: academic-service restarteado, `GET /api/v1/carreras` devuelve la row con `universidad_id` + `facultad_id` ambos populated, HTTP 200.
- **NO se hizo** (fuera de scope, deuda flagueada): mismo patrón en `PlanesPage` (Plan debería seleccionarse por Carrera, no por Universidad/Facultad), `MateriasPage` (por Plan), `ComisionesPage` (por Materia + Periodo). Cada uno necesita schema change + migración + UI refactor similar.

### Read-only context fields en forms de Materias/Planes/Comisiones

- **Pedido del user**: al crear una Materia/Plan/Comisión, el form solo muestra el selector del parent inmediato (plan, carrera, materia+periodo). Falta mostrar el contexto completo (Universidad, Facultad, Carrera, Plan, Materia, Periodo según corresponda) como campos read-only arriba del form, para que el creador sepa dónde va a caer el registro.
- **Pattern implementado**: chain fetch de parents + cache + display como `<ReadonlyField>` al tope del form.
  - **`MateriasPage.tsx`**: prop `context: Partial<PlanContext>` al `MateriaForm`, renderiza 3 read-only fields (Universidad / Carrera / Plan) en grid-3 con `rounded-md bg-slate-50 border p-3`. Chain cache ya existía desde antes (breadcrumb) — solo se reutilizó.
  - **`PlanesPage.tsx`**: mismo pattern `useEffect + useRef<Map>` para cache por `carreraId`. Chain: `carrera → facultad + universidad`. Form renderiza 2 read-only (Universidad / Facultad).
  - **`ComisionesPage.tsx`**: usa `useQuery` (el archivo ya usaba TanStack Query, se respetó el pattern intra-archivo) con compound `queryKey: ["comision-form-context", materiaId, periodoId]`, `staleTime: 5min`. Chain: `materia → plan → carrera → facultad + universidad`; periodo se resuelve del list cacheado (NO hay `GET /periodos/{id}` en academic-service). Form renderiza 5 read-only (Universidad / Carrera / Plan / Materia / Periodo) en grid-3 × 2 filas.
- **Helper `ReadonlyField`**: duplicado en los 3 archivos (~10 líneas cada uno). **Deuda DRY flagueada** — ahora son 3 duplicados más `Sidebar` x2 y `MarkdownRenderer` x2 = 5 componentes duplicados entre frontends. Candidato firme para `packages/ui` en el siguiente PR de cleanup.
- **Verificación**: typecheck 0 / lint 0 en los 3 pages. Pattern validado visualmente por user en MateriasPage, los otros 2 quedan para validar en browser.
- **Backend NO se tocó** en este paso — es UI-only. Todos los datos venían ya disponibles de los endpoints existentes (`carrerasApi.get`, `facultadesApi.get`, etc.).
- **Caveat ComisionesPage**: si `materiaId` seteado pero `periodoId` vacío (o viceversa), el context query queda disabled y los 5 fields muestran `"—"`. Aceptable — mismo comportamiento que MateriasPage sin plan seleccionado.

### Cascading selectors en ComisionesPage + limpieza de creación de Periodos

- **Pedido del user**: la página de Comisiones debe tener 4 selectores cascadeados (Universidad → Carrera → Plan → Materia) + el Periodo separado, en vez de un dropdown plano de Materia. Plus: remover cualquier UI para crear Periodos desde la página de Comisiones.
- **Refactor `ComisionesPage.tsx`**:
  - **5 selectores cascadeados**: Universidad → Carrera → Plan → Materia + Periodo (último separado). Cambiar un nivel resetea descendientes (ej. cambiar Carrera resetea Plan+Materia). Cambiar Periodo NO resetea el drill-down.
  - **Server-side filters**: `carrerasApi.list({ universidad_id })`, `planesApi.list({ carrera_id })`, `materiasApi.list({ plan_id })`. Verificado en `lib/api.ts` que ya soportan esos query params. Universidades sin filtro (eager load).
  - **Removido**: state `showPeriodoForm`, botón header "Crear periodo", componente `PeriodoForm` completo (~90 líneas), import `PeriodoCreate`. La página ya no permite crear Periodos.
  - **Simplificado**: eliminado `contextQuery` (chain fetch de 4 GETs que venía del paso anterior) — el read-only context del form ahora se deriva síncrono de los dropdowns ya cacheados. `ComisionForm` recibe `context: MateriaContext` (no `Partial`, sin fallbacks `?? "—"`).
  - **Gated**: lista de comisiones + botón "Nueva comisión" se habilitan solo cuando `materia && periodo` están ambos seteados.
  - **Banner amber**: si `periodos.length === 0`, mensaje "Creá uno desde la página de Periodos" (sin CTA inline).
- **Validación**: typecheck 0 / lint 0 / 0 biome-ignore nuevos.
- **🔴 Blocker UX flagueado**: **NO existe `PeriodosPage` en el router**. El mensaje amber "Creá uno desde la página de Periodos" es aspiracional. Si un tenant arranca sin periodos seedeados, el usuario queda bloqueado — no puede crear comisiones porque no puede crear periodos. **Follow-up obligatorio**: crear `PeriodosPage.tsx` + entry en Sidebar + ruta en Router. Prioridad alta si piloto UNSL levanta con DB fresh sin seed. ✅ **Cerrado en el mismo día** — ver siguientes 2 secciones.

### PeriodosPage creada + wireada (resolución parcial del blocker)

- Nueva página `/periodos` en web-admin: ruta en Router + entry Sidebar sección "OPERACIONAL" con ícono `CalendarDays` de lucide-react.
- **CRUD parcial (list + create)**: form con `codigo` (max 20, pattern `[A-Za-z0-9_-]+`), `nombre` (max 100), `fecha_inicio`/`fecha_fin` (dates), `estado` (`abierto|cerrado`, default `abierto`). Validación client `fecha_fin >= fecha_inicio` antes de POST.
- Tabla: columnas Código · Nombre · Inicio · Fin · Estado (badge verde/slate) · Creado.
- **Casbin OK**: recurso `periodo:*` ya seedeado en `casbin_policies.py:53-96` para superadmin/docente_admin CRUD, docente read-only.
- Banner amber en ComisionesPage ahora apunta a una página que existe — flow desbloqueado.
- **Gap inicial flagueado**: delete + update NO en `periodosApi` (api.ts) ni en backend (PATCH). **Motivo**: restricción del prompt orchestrator al agente ("no modifiques api.ts"), que resultó ser mi error de scoping. Se completó en el siguiente paso.

### CRUD completo de Periodos (delete + update estado)

- **Pedido**: cerrar el loop CRUD — poder borrar periodos y marcarlos como `cerrado` cuando termina el ciclo académico. El cierre NO es opcional para la tesis: el invariante CTR se sella al cierre del ciclo.
- **Reglas `reglas.md` respetadas**: RN-013 (Comisión solo si Periodo abierto — ya lo respeta `ComisionService.create`), RN-016 (audit log en misma tx — `PeriodoService.update` emite `periodo.update` con campos modificados), RN-017 (cross-validation `fecha_fin > fecha_inicio`). **No hay regla explícita sobre transición abierto→cerrado one-way** — se infirió del invariante CTR del `CLAUDE.md` ("el CTR se sella al cierre del ciclo").
- **Backend**:
  - Nuevo `PATCH /api/v1/periodos/{id}` en `routes/comisiones.py` con `require_permission("periodo","update")`.
  - Schema `PeriodoUpdate` en `schemas/comision.py`: `nombre`/`fecha_inicio`/`fecha_fin`/`estado` todos opcionales, `codigo` excluido (immutable — lo usan comisiones downstream).
  - `PeriodoService.update()` en `services/comision_service.py` con guards: 409 si `estado=cerrado` (frozen), 409 si intento `cerrado→abierto` con mensaje "usar audit log si se necesita trazabilidad", 400 si `fecha_fin ≤ fecha_inicio` (cross-check contra valores persistidos cuando solo uno viene en el PATCH).
  - DELETE ya existía (soft delete con 409 si tiene comisiones activas — verificado, no duplicado).
  - **Sin migración Alembic** — no hay cambio de schema SQL.
- **Frontend**:
  - `periodosApi` en `lib/api.ts` extendido con `update(id, data: PeriodoUpdate)` + `delete(id)`. Nueva interface `PeriodoUpdate`.
  - `PeriodosPage.tsx` — columna "Acciones" con 2 botones: **"Cerrar"** (ambar, solo si `estado=abierto`, confirm con advertencia IRREVERSIBLE → PATCH estado=cerrado) y **"Eliminar"** (rojo, siempre visible, confirm → DELETE, surface 409 si hay comisiones). State `busyId` evita doble-click y desactiva botones de la row en operación.
- **Tests**: 5 nuevos en `test_periodos_crud.py` (update nombre OK abierto, transición abierto→cerrado OK, REJECT cerrado→abierto 409, REJECT modificar cuando cerrado 409, validación fecha_fin>fecha_inicio). Full suite academic-service: **112 passed** (107 → 112).
- **Edit full (modal con nombre/fechas)**: NO implementado — diferido como follow-up. Para MVP el flujo "Cerrar" cubre el requisito CTR; edit de typos queda via DB directa o API raw hasta que se pida.
- **Validación runtime**: academic-service restarteado, `GET /api/v1/periodos` devuelve el periodo del seed (`2026-S1`) HTTP 200.

### Makefile fix — `setup-dev-perms` en Windows

- BUG reportado temprano en la sesión: `make setup-dev-perms` falla en Windows+Git Bash porque `@./scripts/setup-dev-permissions.sh` no maneja bien el path con `(1)`. Workaround aplicado hoy: correr con `bash scripts/setup-dev-permissions.sh` directo.
- **Fix aplicado al Makefile línea 146**: `@./scripts/...` → `@bash ./scripts/...`. 1 línea, funciona en Windows + Linux. Candidato a entrada en `BUGS-PILOTO.md` con el fix aplicado.

### Edit full de Periodos (modal)

- Cierre del CRUD de Periodos en web-admin: agregado botón "Editar" (visible solo si `estado=abierto`, junto a "Cerrar" y "Eliminar") y modal inline con Tailwind (overlay fixed `z-50` + card centrado + `backdrop-blur-sm`).
- Form del modal pre-populado con nombre/fecha_inicio/fecha_fin del periodo; `codigo` disabled (immutable); `estado` NO expuesto (la transición a cerrado va por el botón "Cerrar" separado con confirm de irreversibilidad).
- **Diff on submit**: solo envía en el PATCH los campos efectivamente modificados. Si no hay diff, short-circuit a `onClose` sin llamar API. 409 Conflict (periodo cerrado) y 400 Validation surfaced al user con mensajes claros.
- **A11y mínimo**: `role="dialog"` + `aria-modal` + `aria-labelledby`, tecla Esc cierra, click en overlay cierra, `aria-label` en close button. Focus trap NO implementado (fuera de scope).
- Icono `Pencil` de lucide-react (ya instalado). 0 typecheck / 0 lint.

### Validación de solapamiento de fechas en Periodos

- `PeriodoService.create()` y `update()` ahora rechazan con **409 Conflict** si las fechas pisan a otro periodo soft-non-deleted del mismo tenant (RLS). Adyacencia permitida (`fecha_fin == fecha_inicio` es válido — cierre de uno coincide con inicio del otro).
- **Query de overlap**: `WHERE fecha_inicio < :fin AND fecha_fin > :inicio [AND id != :exclude_id]`. RLS aplica el filtro de tenant automáticamente.
- **Mensaje de error claro**: `"Las fechas solapan con periodo(s) existente(s): [codigo1, codigo2, ...]"`.
- **NO hay constraint DB** — es validación en service. Para el piloto UNSL (baja concurrencia de admins) es aceptable. Follow-up si hace falta endurecer: `SELECT ... FOR UPDATE` o `EXCLUDE USING gist` con `btree_gist`.
- **No hay RN explícita** en `reglas.md` sobre overlap — implementado como regla emergente del invariante CTR de la tesis. **No se tocó `reglas.md`** (decisión del user).
- **4 tests nuevos** en `test_periodos_crud.py`: rechazo de overlap en create, adyacencia OK en create, rechazo de overlap en update, extensión sin overlap OK. Suite academic-service **112 → 116 passed**.

### Cascading selectors en PlanesPage + MateriasPage

- **Refactor replicado** del pattern de ComisionesPage a los otros 2 pages con jerarquía:
  - **PlanesPage**: Universidad → Carrera (filtrada por universidad) → lista de Planes. 2 selectors cascadeados en grid-cols-2.
  - **MateriasPage**: Universidad → Carrera (filtrada) → Plan (filtrado) → lista de Materias. 3 selectors cascadeados en grid-cols-3.
- **Server-side filters** (ya soportados en `lib/api.ts`): `carrerasApi.list({universidad_id})`, `planesApi.list({carrera_id})`, `materiasApi.list({plan_id})`. Sin tocar backend ni api.ts.
- **Resets descendentes**: cambiar Universidad resetea Carrera+Plan; cambiar Carrera resetea Plan. Disabled states en cadena.
- **Botones "Crear" gated** hasta que TODA la chain esté seteada.
- **Facultad fuera del chain** por consistencia con ComisionesPage. Sigue visible en los read-only context fields del form (sin cambios).
- **Breadcrumb en MateriasPage** mantenido (redundante con los dropdowns, pero alimenta también el contextCache que sirve al form). Follow-up trivial removerlo si el user lo pide.
- **Auto-select del primer item eliminado**: hacía sentido con dropdowns planos; con cascading arranca vacío (el user elige cada nivel).
- **Consistencia intra-archivo**: ambos usan `useState + useEffect` (no `useQuery`) porque los originales usaban ese pattern. ComisionesPage usa `useQuery` por el mismo principio. No unificado — fuera de scope.
- **Validación**: typecheck 0 / lint 0 / 0 errores nuevos. No se eliminaron `biome-ignore` existentes.

### Refactor `packages/ui`: componentes compartidos (Ola C parcial)

- **Hallazgo**: `packages/ui` NO estaba vacío como creíamos — ya tenía Badge/Button/Card/Input/Label + utils `clsx`+`tailwind-merge`. Era un design system starter parcialmente adoptado. El refactor suma 3 componentes más.
- **Extraídos a `packages/ui/src/components/`**:
  - **`Sidebar.tsx` parametrizable**: API `{ navGroups: NavGroup[], headerLabel, collapsedHeaderLabel, storageKey, activeItemId, onNavigate, topSlot? }`. `NavItem = { id, label, icon }`, `NavGroup = { label?, items }`. `topSlot` se renderiza sólo en expanded (para `ComisionSelector` en web-teacher). Mismo visual (gray-900, lucide-react, tooltips, chevron toggle, border-l azul).
  - **`MarkdownRenderer.tsx`**: copia exacta del de web-teacher (sin cambios de API).
  - **`ReadonlyField.tsx`**: `{ label, value }`, sin cambios.
- **Deps agregadas a `packages/ui/package.json`**: `react-markdown ^9.0.0` + `remark-gfm ^4.0.0` (las usa MarkdownRenderer).
- **Archivos ELIMINADOS**:
  - `apps/web-admin/src/components/Sidebar.tsx` (225 líneas).
  - `apps/web-teacher/src/components/Sidebar.tsx` (213 líneas).
  - `apps/web-teacher/src/components/MarkdownRenderer.tsx` (95 líneas).
  - `apps/web-student/src/components/MarkdownRenderer.tsx` (95 líneas).
  - 3× `ReadonlyField` inline en `apps/web-admin/src/pages/` (MateriasPage/PlanesPage/ComisionesPage).
- **Archivos MODIFICADOS** (imports + wiring): web-admin Router.tsx + 3 pages, web-teacher App.tsx + TareasPracticasView, web-student EpisodePage.
- **Validación post-refactor**:
  - web-admin: typecheck 0 / lint 0 (baseline).
  - web-teacher: typecheck 0 / lint 0 (baseline).
  - web-student: typecheck **2** / lint **15** (baseline pre-existente preservado — 0 regresiones).
- **Correcciones de log**: (1) `web-student 295 errors` era stale de una sesión vieja — baseline real hoy es 2. (2) `ReadonlyField` estaba en 3 pages, no 4 (PeriodosPage no lo usa).
- **Caveat**: `packages/ui` tiene 4 errores de lint pre-existentes en Button.tsx/Card.tsx/Label.tsx (design system starter) — fuera de scope hoy. Los 3 nuevos archivos (Sidebar/MarkdownRenderer/ReadonlyField) lintean clean.

### Cleanup final: web-student + packages/ui lint

- **web-student**: typecheck 2 → 0, lint 15 → 0.
  - `vite.config.ts`: mismo pattern ya validado en web-admin/web-teacher (`vitestConfig as const` + spread, sin acoplar tsc a `vitest/config`).
  - `EpisodePage.tsx:522`: `exactOptionalPropertyTypes` en `Meter.invertScale` — branching del JSX para no propagar `undefined` cuando el caller no lo fija (Meter usa default `false`).
  - `CodeEditor.tsx`: `editorRef: any` → `MonacoEditor.IStandaloneCodeEditor | null` vía `import type` (zero bundle cost). biome-ignore justificado en useEffect seed-only de Monaco (agregar `code` al deps rompe cursor/undo).
  - `ComisionSelector.tsx`: reemplazado `// eslint-disable-next-line` stale por `// biome-ignore lint/correctness/useExhaustiveDependencies` con razones explícitas, replicando el pattern de web-teacher.
  - Varios: `key={\`${x.ts}-${i}\`}` en vez de `key={i}`, organizeImports, format.
- **packages/ui**: lint 4 → 0.
  - Button/Card: format autosafe.
  - Label: `biome-ignore lint/a11y/noLabelWithoutControl` estructuralmente justificado (wrapper genérico del DS — el `htmlFor` llega vía `...props`, mismo pattern de los Field helpers de web-admin).
- **0 runtime bugs detectados**: todos los errores eran type-level o stylistic. Ninguno escondía un bug real (verificado explícitamente por el agente).
- **Verificación cruzada final**: **web-admin, web-teacher, web-student en 0 typecheck / 0 lint. `packages/ui` en 0 lint**. 4 workspaces alineados.

### Bug gemelo en content-service (descubierto post-cleanup)

- **Síntoma**: `GET /api/v1/materiales` (web-teacher) daba 500. `relation "materiales" does not exist`.
- **Causa raíz**: patrón gemelo al bug de classifier-service. El `config.py` de content-service tenía default apuntando a `academic_main` con comentario stale ("content vive en academic_main, ADR-003") — pero las migraciones efectivamente crearon la tabla `materiales` en `content_db` (verificado con `\dt`). Cuando content-service arrancó inicialmente, el `.env` NO tenía `CONTENT_DB_URL` definida (ni vacía — directamente faltaba), entonces pydantic-settings cayó al default erróneo.
- **Fix**:
  - `apps/content-service/src/content_service/config.py` default: `academic_main` → `content_db` con comentario actualizado explicando ADR-003 y apuntando al verification command.
  - content-service restarteado (nuevo BG ID `bbhiwvwx1`, el anterior `b8gtzi7zt` muerto).
  - El `.env` ya tenía `CONTENT_DB_URL` desde el fix del classifier bug, entonces esto más que nada evita futuros bring-ups fresh con el mismo problema.
- **Patrón detectado**: 2 servicios (classifier + content) con defaults de DB mal configurados. **Vale una auditoría preventiva** a los configs de los otros 10 servicios para ver si tienen el mismo issue antes de que aparezca en runtime. Candidato a entrada en `BUGS-PILOTO.md`.
- **Validación**: `GET /api/v1/materiales?comision_id=aaaa...` devuelve `{"data":[],"meta":{}}` HTTP 200 (empty pero válido — el seed no crea materiales).

### Auditoría preventiva de DB defaults en configs (post-bug content)

Tras el fix de classifier-service (apuntaba a `ctr_store`) y content-service (apuntaba a `academic_main`), auditamos los 12 `config.py` del backend para detectar el mismo patrón en otros servicios.

- **Cero bugs latentes adicionales**. Los 4 servicios con `*_db_url` default hardcodeado (academic, ctr, classifier, content) apuntan cada uno a su base correcta, consistente con `alembic/env.py` y `scripts/migrate-all.sh`.
- **6 servicios no tienen DB propia por diseño** (api-gateway, identity, tutor, governance, ai-gateway, enrollment/evaluation). Consistente con arquitectura — ninguno crea tablas SQL.
- **analytics-service** lee env vars en runtime sin default en config.py (`os.environ["CTR_STORE_URL"]` + `os.environ["CLASSIFIER_DB_URL"]`). Si faltan → cae a `_StubDataSource`. No revienta. OK para dev.
- **Deuda menor reconfirmada**: `CTR_STORE_URL` (usado por analytics) vs `CTR_DB_URL` (usado por ctr-service + migrate-all.sh) son 2 env vars para la misma DB. En `.env` ambas apuntan al mismo string, pero si alguien cambia una sola, analytics se desincroniza. Trampa latente — candidato a unificación.
- **Cosmético**: `.env` usa `localhost`, `config.py` usan `127.0.0.1`. Inconsistente con la gotcha IPv6/Windows de CLAUDE.md, pero no rompe (el `.env` sobrescribe).

### 🏆 Estado final de deuda al cierre del día

**Todos los 6 items originales del plan del día están ✅ cerrados**:
1. ✅ Edit full de Periodos
2. ✅ Cascading selectors en PlanesPage + MateriasPage
3. ✅ Validación solapamiento fechas en Periodos
4. ✅ `packages/ui` refactor (6 componentes duplicados unificados)
5. ✅ Makefile `setup-dev-perms` fix
6. ✅ web-student cleanup (número real era 2+15, no 295)

**Deuda que queda (para próximas sesiones)**:
- ⚠️ **La pregunta de git sigue sin resolverse** — sigue siendo el riesgo #1. Si este `AI-NativeV3-main (1)/AI-NativeV3-main` es copia de trabajo, cualquier rebuild del directorio borra el laburo del día.
- Separación namespace de env vars (`CLASSIFIER_DB_URL` dual-use entre classifier-service y analytics fallback).
- Edit full de Periodos NO cubre cambio de `estado` (para eso va el botón "Cerrar" separado). Si en algún momento se quiere reabrir un periodo cerrado, hoy es 409 — diseño intencional por invariante CTR.

---

## 2026-04-23 — ADR-016: TP template + instance

- ADR-016 aprobado e implementado: `TareaPracticaTemplate` a nivel `(materia_id, periodo_id)` + auto-instanciación en comisiones + `has_drift` tracking en instancias.
- Migration `20260423_0001_add_tareas_practicas_templates` aplicada: nueva tabla `tareas_practicas_templates` + columnas `template_id` (FK nullable) y `has_drift` (bool) en `tareas_practicas`.
- Nuevos endpoints: `/api/v1/tareas-practicas-templates` (10 métodos REST registrados en api-gateway, smoke test end-to-end OK).
- Casbin: 93 → 107 policies (+14 para `tarea_practica_template:CRUD` con superadmin/docente_admin/docente + read-only para estudiante). Test de matriz actualizado.
- Frontend: nueva `TemplatesView` en web-teacher + selector cascada Universidad → Período + badges de drift en `TareasPracticasView`.
- **CTR intacto**: `problema_id` sigue apuntando a la instancia (no al template) — reproducibilidad bit-a-bit preservada, cadena criptográfica SHA-256 sin cambios. Validado con `test_pipeline_reproducibility.py` (7/7 PASS) + `ctr-service` unit tests (19/19 PASS).
- **Tutor intacto**: las 6 validaciones de `tutor_core._validate_tarea_practica` siguen aplicando a la instancia. Test nuevo `test_open_episode_succeeds_with_tarea_practica_linked_to_template` verifica que una TP con `template_id != null` y `has_drift=true` no rompe el flujo del tutor — el `TareaPracticaResponse` ni siquiera expone esos campos (zero-impact).
- Smoke test end-to-end OK: `POST template → 3 instancias auto-creadas → PATCH una → drift aislado` en la instancia drifted sin tocar las otras 2.
- 121 tests integration academic-service PASS (+5 drift + 7 templates + 14 Casbin matrix = 26 casos nuevos).
- Regla nueva: `reglas.md` RN-013bis — "Plantillas de TP como fuente canónica" (Invariante / F1 / Severidad Media).
- Docs: `F1-STATE.md` anota el addendum de ADR-016 con pointer al RN-013bis.

**Deuda conocida (diferida)**:
- Auto-promoción de TPs existentes a templates: feature flag `AUTO_PROMOTE_UNIQUE_TPS` NO implementado por default (requeriría heurística "mismo codigo+titulo en 2+ comisiones de la misma materia+periodo").
- Endpoint `POST /api/v1/tareas-practicas/{id}/resync-to-template` para quitar `has_drift` (diferido — por ahora la única forma de "resync" es crear nueva versión del template).
- Re-instanciación en comisión nueva creada **después** del template: se decide en UI futura, hoy no auto-propaga.

**Bugs hallados durante validación (arreglados)**:
- **Casbin: rol `docente` sin `facultad:read`** — omisión pre-existente del seed (el docente tenía read sobre `universidad`, `carrera`, `plan`, `materia`, `periodo`, pero no `facultad`). Al probar el `AcademicContextSelector`, el segundo nivel del cascada devolvía 403 y el flow se colgaba. Fix: agregada la policy en `seeds/casbin_policies.py:123`. Count real: 93 → **108 policies** (el 107 documentado arriba era pre-fix).
- **Loop infinito en `AcademicContextSelector`** — los 6 fetchFn closures no estaban memoizados con `useCallback`; cada render creaba nueva referencia → `useEffect` del hook `useCascadeLevel` se disparaba → setState → re-render → 🔁. Resultado: ~36 req/s sostenidos hasta que el rate limiter devolvió 429 al ComisionSelector del sidebar (efecto colateral — el rate limit es por-cliente, no por-endpoint). Fix: envuelto cada fetchFn con `useCallback([id, getToken])`. Anotado como gotcha permanente en `CLAUDE.md` sección "Frontends React".
- **Seed Casbin no refresca el enforcer en memoria**: después de correr el seed, el `academic-service` seguía rechazando con las policies viejas porque el enforcer Casbin está cacheado. `--reload` de uvicorn no lo pickea. Workaround: kill + relaunch del servicio. Documentado en `CLAUDE.md` gotchas.
- **Migration FK name >63 chars**: el nombre auto-generado del FK self-referential de `tareas_practicas_templates.parent_template_id` excedía el límite de Postgres para identifiers. Renombrado a `fk_tp_templates_parent_template_id` en la migración antes de aplicar.
- **Governance: env var `GOVERNANCE_REPO_PATH` del `.env.example` NO la usa el código** — el governance-service lee `PROMPTS_REPO_PATH` en su `Settings`. Inconsistencia pre-existente del template; quedó sin fixear para no cruzar scope con ADR-016. Workaround: pasar la env var correcta en la línea de comando al arrancar el servicio (`PROMPTS_REPO_PATH=<ruta> uv run uvicorn governance_service.main:app ...`). Documentado como gotcha permanente en `CLAUDE.md` sección "Dev mode".
- **Governance: prompts no sembrados por default** — `make init` no crea el directorio `ai-native-prompts/prompts/tutor/v1.0.0/system.md`. Sin ese archivo, el tutor-service tira **500** en cada `POST /api/v1/episodes` con `httpx.HTTPStatusError: '404 Not Found' for '/api/v1/prompts/tutor/v1.0.0'` — el alumno NO puede abrir ningún episodio. Fix en sesión: creado el `system.md` con prompt socrático N4 mínimo (principios, formato, lo que NO hace) + relanzado governance con `PROMPTS_REPO_PATH` correcto. Vale como **task de setup futura**: agregar a `make init` o un `scripts/seed-governance-prompts.py` que cree el archivo automáticamente.
- **`vite.config.ts` del web-student con UUID de student del seed viejo** — hardcodeado `a1a1a1a1-0001-0001-0001-000000000001` (del `seed-demo-data.py` original) en vez de los UUIDs de `seed-3-comisiones.py` (`b1b1b1b1-...`, `b2b2b2b2-...`, `b3b3b3b3-...`). Con el seed nuevo, el frontend loguea como estudiante inexistente → `TareaSelector` viene vacío silenciosamente (sin error visible). Fix: actualizado a `b1b1b1b1-0001-0001-0001-000000000001` (estudiante 1 de A-Mañana) con comentario inline sobre cómo rotar estudiantes para testing (`b2...`/`b3...` para B y C respectivamente).
