# web-teacher

## 1. Qué hace (una frase)

Es el panel del docente y del investigador: combina autoría de trabajos prácticos (instancias y templates ADR-016), gestión de materiales de cátedra, y las vistas analíticas del piloto (progresión longitudinal, rating intercoder para Cohen's κ, export académico anonimizado).

## 2. Rol en la arquitectura

Pertenece a los **frontends**. Materializa la interfaz del componente "Panel del docente y del investigador" descrito en el Capítulo 6 de la tesis (arquitectura C4 del sistema AI-Native), cuyas responsabilidades nominales son: dar al docente la autoría curricular (TPs, materiales) y al investigador las herramientas de análisis empírico que sostienen el capítulo de validación de la tesis (κ, progresión, export).

Es el frontend más cargado en cantidad de vistas: 6 views por >3.700 líneas (las dos de TP/Templates pesan ~1.000 cada una por el versionado inmutable + drift detection + modales de create/edit/publish).

## 3. Responsabilidades

- Renderizar 6 vistas agrupadas en 3 bloques navegacionales ("Trabajo del docente", "Análisis", "Operacional"):
  - **Trabajo del docente**: `TemplatesView` (plantillas canónicas ADR-016 por Materia+Periodo), `TareasPracticasView` (instancias por comisión), `MaterialesView` (upload + listado por comisión).
  - **Análisis**: `ProgressionView` (trayectoria longitudinal con SVG nativo), `KappaRatingView` (rating intercoder episodio por episodio, computa κ en vivo).
  - **Operacional**: `ExportView` (enqueue job de export anonimizado + polling de status + download).
- Exponer el selector de comisión (`ComisionSelector`) y el selector cascada Universidad → Facultad → Carrera → Plan → Materia → Período (`AcademicContextSelector`) para filtrar las vistas por ámbito académico.
- Gestionar el ciclo de vida de TPs y templates: draft → published (inmutable) → new-version (clona con `parent_id`) → archived.
- Implementar el rating intercoder del workflow de κ (`KappaRatingView`): el docente revisa N episodios con su `classifier_label` ya asignado y marca su propia etiqueta (`rater_a` vs `rater_b`), luego el frontend pega a `POST /api/v1/analytics/kappa` con el batch.
- Renderizar visualizaciones empíricas: distribución N4 por comisión, trayectorias estudiantiles con color por `appropriation`, timeseries de progresión.
- Enqueue jobs de export + polling de status + download del payload JSON con el dataset anonymizado.
- Soportar el sistema de ayuda in-app con 5 entries en `helpContent.tsx` (una por vista, Export consolida con KappaRating).
- En dev mode, inyectar headers como docente (`x-user-id: 11111111-...`, role `docente`).

## 4. Qué NO hace (anti-responsabilidades)

- **NO es donde el estudiante trabaja**: los episodios se abren desde [web-student](./web-student.md). Acá el docente **observa** episodios cerrados (via KappaRating que consume episodios clasificados) o **autora** el material que los estudiantes van a usar.
- **NO ejecuta Pyodide ni el editor de código**: eso es web-student.
- **NO valida permisos localmente**: como los otros frontends, delega al api-gateway + Casbin del backend. En dev el role es `docente` hardcoded por el proxy Vite.
- **NO tiene gestión institucional**: universidades/facultades/carreras/planes son de [web-admin](./web-admin.md). El `AcademicContextSelector` **lee** la jerarquía pero no la modifica.
- **NO consume WebSockets ni SSE**: todas las vistas son request-response. El SSE del tutor-service no lo usa (eso es para web-student).
- **NO tiene UI para A/B de profiles todavía**: `POST /analytics/ab-test-profiles` es API-only por diseño en F7 (CLAUDE.md). El investigador arma el JSON con gold + profiles y pega con curl. UI con drag-and-drop deferida F8+.

## 5. Rutas principales

Routing "basado en useState" (`App.tsx` hace state-based switching, no TanStack Router todavía — mismo patrón que web-admin):

| `View` id | Componente | Consume |
|---|---|---|
| `progression` | `ProgressionView.tsx` | `GET /api/v1/analytics/cohort/{id}/progression` |
| `kappa` | `KappaRatingView.tsx` | `POST /api/v1/analytics/kappa` con batch de ratings |
| `tareas-practicas` | `TareasPracticasView.tsx` | CRUD `/api/v1/tareas-practicas` + publish/archive/new-version |
| `templates` | `TemplatesView.tsx` | CRUD `/api/v1/tareas-practicas-templates` + instances + drift detection |
| `materiales` | `MaterialesView.tsx` | `POST/GET/DELETE /api/v1/materiales` — upload a content-service |
| `export` | `ExportView.tsx` | Enqueue + polling + download de `/api/v1/analytics/cohort/export` |

## 6. Dependencias

**Depende de (servicios):**
- [api-gateway](./api-gateway.md) via proxy Vite `/api`.
- Aguas abajo: [academic-service](./academic-service.md) (TPs, templates, comisiones, selector cascada), [content-service](./content-service.md) (materiales), [analytics-service](./analytics-service.md) (κ, progression, export), [classifier-service](./classifier-service.md) (agregado por comisión).

**Depende de (packages workspace):**
- `@platform/ui` — `Sidebar`, `Modal`, `HelpButton`, `PageContainer`, tokens CSS.
- `@platform/auth-client`, `@platform/contracts`, `react-markdown@9` + `remark-gfm@4`, `lucide-react`.

**Dependen de él:** nadie (consumidor humano — docente y investigador del piloto).

## 7. Modelo de datos

Frontend — sin persistencia propia. State local con `useState` + `useEffect` (patrón "Promise.then()"). Las vistas más complejas (TareasPracticasView, TemplatesView) consolidan 5 booleans mutex de modales en un `ModalState` discriminated union — ajuste hecho en el repo por una race condition real de "dos modales abiertos simultáneos por handlers que no apagaban el previo" (CLAUDE.md "Sistema de ayuda in-app").

## 8. Archivos clave para entender el servicio

- `apps/web-teacher/src/App.tsx` — routing state-based, `NAV_GROUPS` agrupado en 3 bloques, `DEMO_COMISION_ID` + `DEMO_EPISODES` de fallback.
- `apps/web-teacher/src/views/TareasPracticasView.tsx` — 1018 líneas. Ciclo completo de TP instance con versionado inmutable, publish/archive, new-version. El ejemplo canónico del patrón CRUD + modales + discriminated union para ModalState.
- `apps/web-teacher/src/views/TemplatesView.tsx` — 1036 líneas. ADR-016: vista cascada Universidad→Facultad→Carrera→Plan→Materia→Período, create template → auto-fan-out a instancias, drift badge, re-instance non-drifted.
- `apps/web-teacher/src/views/ProgressionView.tsx` — **SVG nativo** (no Recharts — decisión de simplicidad). Colores por `appropriation` y `progression_label`. Trayectoria por estudiante + resumen de cohorte.
- `apps/web-teacher/src/views/KappaRatingView.tsx` — UI para que el docente rate episodio por episodio, computa κ client-side antes de enviar (re-computa en backend para autoridad).
- `apps/web-teacher/src/views/ExportView.tsx` — formulario (comision_id, period_days, include_prompts, salt ≥16, cohort_alias) → enqueue → polling cada N segundos hasta `succeeded`/`failed` → download.
- `apps/web-teacher/src/views/MaterialesView.tsx` — upload multipart (drag-and-drop), status del pipeline de ingesta, listado con filtro por `comision_id`.
- `apps/web-teacher/src/components/AcademicContextSelector.tsx` — el componente con el fix canónico de `useCallback` documentado en CLAUDE.md (ver referencia a `AcademicContextSelector.tsx:94-128`).
- `apps/web-teacher/src/components/ComisionSelector.tsx` — selector compacto de comisiones del docente.
- `apps/web-teacher/src/components/MarkdownRenderer.tsx` — **duplicado** con el de web-student (CLAUDE.md "Modelos no obvios"); sin `@tailwindcss/typography`, estilos arbitrarios `[&_h1]:...`.
- `apps/web-teacher/src/utils/helpContent.tsx` — 5 entries de ayuda in-app.
- `apps/web-teacher/vite.config.ts` — headers dev como `docente`.

## 9. Configuración y gotchas

**Env vars**:
- `VITE_API_URL` — default `http://127.0.0.1:8000`.

**Puerto de desarrollo**: `5174`.

**Gotchas específicos**:

- **Headers hardcoded en dev**: `x-user-id: 11111111-1111-1111-1111-111111111111`, role `docente`. Debe existir en `usuarios_comision` del seed corriente. Seed B (`seed-3-comisiones.py`) crea este docente con 3 comisiones (A-Mañana, B-Tarde, C-Noche).
- **`useCallback` obligatorio en `AcademicContextSelector`**: el caso canónico documentado en CLAUDE.md. Sin memoizar los `fetchFn` dependientes de IDs, el selector entró a loop infinito con ~36 req/s → rate limiter 429 con miles de requests en 60s. Fix en `AcademicContextSelector.tsx:94-128`.
- **Discriminated union para ModalState**: en `TareasPracticasView.tsx`, consolidación de 5 booleans mutex a un `ModalState` eliminó una race condition real. Patrón: si una vista tiene ≥3 modales mutex, usar discriminated union en lugar de booleans.
- **`MarkdownRenderer` duplicado con web-student**: no hay shared package. Sin `@tailwindcss/typography` — estilos via selectors arbitrarios. Rubrica de TPs queda como `<pre>{JSON.stringify(...)}</pre>` (markdown wrapper sobre JSON luce raro). Documentado en CLAUDE.md.
- **Seed Casbin desactualiza enforcer**: si agregás policies para `docente` sobre un recurso nuevo y hay backends corriendo, **matar y relanzar** (no basta con `--reload` de uvicorn).
- **ProgressionView depende de `_real_data_source_enabled()` del backend**: si `CTR_STORE_URL`/`CLASSIFIER_DB_URL` no están declaradas en el `Settings` de analytics-service, la vista devuelve `n_students=0` silenciosamente. Trap del `pydantic_settings` documentado en CLAUDE.md (caso resuelto 2026-04-23).
- **`HelpButton` en headers con espacio limitado**: si el espacio ya está comprometido (caso `EpisodePage` de web-student), usar `size="sm"` — pero en web-teacher los headers tienen espacio, usar default.

## 10. Relación con la tesis doctoral

El web-teacher es la UI donde se ejecutan **dos de los tres experimentos empíricos** que sostienen los resultados publicables:

1. **Rating intercoder para κ** (`KappaRatingView`): es la operacionalización UI del workflow descrito en `docs/pilot/kappa-workflow.md`. Dos docentes etiquetan independientemente los mismos 50 episodios, el frontend arma el batch `{episode_id, rater_a, rater_b}` y pega a analytics-service. κ ≥ 0.6 es la meta de la tesis (Capítulo 8). Si κ < 0.6, el profile del árbol N4 debe recalibrarse — el A/B testing de profiles (hoy API-only) es el siguiente paso.

2. **Progresión longitudinal** (`ProgressionView`): la narrativa empírica de "los estudiantes mejoran con el tutor socrático" o "no mejoran" sale de esta vista. El `net_progression_ratio` de una cohorte es la cifra que aparece en el capítulo de resultados. El SVG nativo es deliberado — la tesis prefiere que la visualización sea reproducible y auditable (SVG simple > Recharts opaco).

3. **Export académico** (`ExportView`): la entrega del dataset al comité de ética UNSL pasa por acá. El formulario fuerza `salt ≥ 16 chars`, `include_prompts=False` por default, y el `cohort_alias` identifica la cohorte en los datasets publicables sin revelar identidad institucional. Es el punto de cumplimiento formal del convenio.

Las vistas de `TareasPracticasView` y `TemplatesView` materializan [ADR-016](../adr/016-tp-template-instance.md) — fan-out automático de plantillas en instancias por comisión, con `has_drift` para instancias editadas manualmente. Sin la UI, ADR-016 sería un modelo teórico del backend; con la UI, un docente con 3 comisiones puede mantener un enunciado único sin copiar-pegar manualmente.

## 11. Estado de madurez

**Tests**: sin suite activa de componentes. Los tests de la foundation viven en `packages/ui/`.

**Known gaps**:
- A/B testing de profiles (HU-118) sin UI — API-only, el investigador arma el JSON con curl. Drag-and-drop deferida F8+.
- `MarkdownRenderer` duplicado entre web-teacher y web-student — overhead aceptado.
- Sin tests e2e de los flujos completos (rating κ, export job con polling).
- Routing state-based — migración a TanStack Router prevista F2-F3.
- Rubrica de TPs renderizada como JSON crudo (no markdown wrapper) — documentado como gap estético.
- `ProgressionView` con SVG nativo — interactividad limitada (no tooltips on hover, no zoom).

**Fase de consolidación**:
- F6 — κ workflow + rating UI básico (`docs/F6-STATE.md`).
- F7 — progresión + export con polling (`docs/F7-STATE.md`).
- F8 — adaptadores DB reales + TareasPracticasView con versionado.
- F9 — Templates (ADR-016) + auto-fan-out UI.
