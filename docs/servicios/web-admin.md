# web-admin

## 1. Qué hace (una frase)

Es la consola de gestión académica del tenant: permite a roles `docente_admin` y `superadmin` administrar la jerarquía completa (universidades, facultades, carreras, planes, materias, periodos, comisiones), hacer import masivo desde CSV y revisar clasificaciones N4.

## 2. Rol en la arquitectura

Pertenece a los **frontends**. Sin correspondencia directa con un componente de la arquitectura de la tesis. Existe como UI institucional para operar el plano académico-operacional — es la cara de [academic-service](./academic-service.md) y [enrollment-service](./enrollment-service.md) para el coordinador académico del tenant (rol `docente_admin`) y el superadmin de la plataforma.

## 3. Responsabilidades

- Renderizar 10 páginas CRUD sobre las entidades del dominio académico (Universidades, Facultades, Carreras, Planes, Materias, Periodos, Comisiones) + Home + BulkImport + Clasificaciones.
- Ejecutar CRUD completo sobre cada entidad via `/api/v1/*` ruteado por [api-gateway](./api-gateway.md): listar, crear (modal), editar (modal), soft-delete (confirm dialog).
- Soportar la UI del import masivo (`BulkImportPage.tsx`): upload CSV → reporte de dry-run (filas válidas, errores) → botón de commit (apunta al stub de [enrollment-service](./enrollment-service.md) que hoy no persiste).
- Exponer la vista de Clasificaciones agregadas por comisión (consume `/api/v1/classifications/aggregated` de [classifier-service](./classifier-service.md) via gateway).
- Renderizar el sistema de ayuda in-app uniforme (`HelpButton` en toda page + `helpContent.tsx` con entries) — `web-admin` tiene 10 entries (una por página) — ver sección "Sistema de ayuda in-app" en CLAUDE.md.
- En dev mode, inyectar headers `X-User-Id`/`X-Tenant-Id`/`X-User-Email`/`X-User-Roles` en el proxy de Vite (`vite.config.ts`) para que el api-gateway con `dev_trust_headers=True` acepte requests sin JWT real.

## 4. Qué NO hace (anti-responsabilidades)

- **NO interactúa con el CTR, ni episodios, ni tutor**: su dominio es la gestión académica, no la interacción pedagógica. Eso es [web-student](./web-student.md).
- **NO maneja rúbricas ni evaluación**: es parte del alcance nominal de [evaluation-service](./evaluation-service.md) (stub F0).
- **NO tiene progresión longitudinal ni κ**: esas vistas viven en [web-teacher](./web-teacher.md).
- **NO valida localmente identidad**: se apoya enteramente en el api-gateway (JWT o `dev_trust_headers`). En dev, el header inyectado es `docente_admin,superadmin` hardcoded para no requerir realm Keycloak activo.
- **NO tiene test runner activo**: `package.json` tiene `vitest` declarado y `test: "vitest run --passWithNoTests"`. La suite de tests UI es mínima (los tests del frontend hoy viven en `packages/ui/`).

## 5. Rutas principales

Routing "basado en useState" (no TanStack Router type-safe todavía — previsto F2-F3, ver comentario en `vite.config.ts`). Un `Sidebar` agrupa las rutas por dominio:

| `Route` id | Página | Entidad |
|---|---|---|
| `home` | `HomePage.tsx` | Landing con atajos |
| `universidades` | `UniversidadesPage.tsx` | Universidades |
| `facultades` | `FacultadesPage.tsx` | Facultades |
| `carreras` | `CarrerasPage.tsx` | Carreras |
| `planes` | `PlanesPage.tsx` | Planes de estudios |
| `materias` | `MateriasPage.tsx` | Materias |
| `periodos` | `PeriodosPage.tsx` | Periodos lectivos (+ modal `EditPeriodoModal` migrado al `Modal` del design system) |
| `comisiones` | `ComisionesPage.tsx` | Comisiones — la más grande (637 líneas) |
| `bulk-import` | `BulkImportPage.tsx` | CSV → dry-run → commit |
| `clasificaciones` | `ClasificacionesPage.tsx` | Distribución N4 por comisión |

## 6. Dependencias

**Depende de (servicios):**
- [api-gateway](./api-gateway.md) via proxy `/api` de Vite (default `http://127.0.0.1:8000`).
- Aguas abajo del gateway: [academic-service](./academic-service.md) (la mayoría de las operaciones), [enrollment-service](./enrollment-service.md) (BulkImportPage), [classifier-service](./classifier-service.md) (ClasificacionesPage).

**Depende de (packages workspace):**
- `@platform/ui` — `Sidebar`, `Modal`, `HelpButton`, `PageContainer`, tokens de CSS.
- `@platform/auth-client` — keycloak-js + `authenticatedFetch` (hoy no invocado activamente en dev porque el proxy inyecta headers directo).
- `@platform/contracts` — schemas TypeScript sincronizados con los Pydantic del backend.

**Dependen de él:** nadie — es consumidor humano.

## 7. Modelo de datos

Frontend — no tiene persistencia propia. Usa los contratos TS de `@platform/contracts` para tipar requests/responses contra los servicios backend.

**State management**: `useState` local + `useEffect` con el patrón "Promise.then()" (no TanStack Query activo, aunque la dependencia está en `package.json`). El patrón del repo exige memoizar `fetchFn` con `useCallback` cuando son deps de `useEffect` — gotcha documentado en CLAUDE.md "Frontends React".

## 8. Archivos clave para entender el servicio

- `apps/web-admin/src/router/Router.tsx` — Routing state-based, `NAV_GROUPS`, switch de render.
- `apps/web-admin/src/App.tsx` — trivial (`<Router />`).
- `apps/web-admin/src/pages/ComisionesPage.tsx` — la página más extensa (637 líneas) — sirve de referencia del patrón CRUD completo con modales.
- `apps/web-admin/src/pages/BulkImportPage.tsx` — flujo dry-run → commit. Maneja `ImportResponse` de enrollment-service.
- `apps/web-admin/src/pages/ClasificacionesPage.tsx` — consume el endpoint `classifications/aggregated`, renderiza distribución + timeseries.
- `apps/web-admin/src/utils/helpContent.tsx` — **10 entries** del sistema de ayuda in-app, una por página. Español sin tildes (evita cp1252 en Windows).
- `apps/web-admin/src/lib/` — clientes HTTP tipados.
- `apps/web-admin/vite.config.ts` — proxy `/api` + inyección de headers en dev (user UUID `33333333-...`, roles `docente_admin,superadmin`).

## 9. Configuración y gotchas

**Env vars**:
- `VITE_API_URL` — override del target del proxy (default `http://127.0.0.1:8000`).

**Puerto de desarrollo**: `5173` (default de Vite). Si hay containers ajenos en ese puerto, Vite brinca al siguiente disponible — leer el log de `make dev`.

**Gotchas específicos** (documentados en CLAUDE.md):

- **Headers hardcoded en dev**: `vite.config.ts` inyecta `x-user-id: 33333333-3333-3333-3333-333333333333` + roles `docente_admin,superadmin`. El seed `seed-casbin` debe haber registrado ese UUID como docente_admin — si corriste otro seed, ajustar el UUID. Distinto al `11111111-...` de web-teacher.
- **Tailwind v4 + pnpm workspace**: `index.css` debe tener `@source "../../../packages/ui/src/**/*.{ts,tsx}"` — sin eso, Tailwind v4 no escanea las clases usadas en `@platform/ui` (symlink pnpm queda fuera de `node_modules` por default) y los modales se renderizan sin `max-width`. Silencioso en typecheck, visible sólo en browser.
- **Patrón `useCallback` obligatorio para fetchFn en useEffect**: ver CLAUDE.md "Frontends React" — sin `useCallback`, closures inline crean dep nueva en cada render → loop infinito → rate limiter 429. Aplica a todos los patrones "useState + Promise.then()".
- **Seed Casbin desactualiza enforcer en memoria**: si editás policies vía `make seed-casbin` con los backends corriendo, hay que **matar y relanzar** los servicios Python afectados — el enforcer cacheado no refresca con `--reload`.
- **Modal variant mismatch**: los form modals NO deben pasar `variant="dark"` o los labels `text-slate-700` quedan invisibles sobre fondo oscuro. El `Modal` default es `variant="light"`.
- **No usar `localStorage` ni `sessionStorage` para auth**: `@platform/auth-client` maneja tokens en memoria del keycloak-js. En dev el proxy los bypassa totalmente.

## 10. Relación con la tesis doctoral

El web-admin no implementa componentes de la tesis. Es la interfaz operativa del **plano académico-operacional** y habilita al rol institucional (`docente_admin`, `superadmin`) a hacer las operaciones de bootstrap y mantenimiento necesarias para que el piloto corra:

- Dar de alta una universidad, facultad, carrera, plan, materias.
- Crear periodos lectivos (el invariante "no crear comisión en período cerrado" lo valida el backend, la UI lo refleja).
- Crear comisiones con su `curso_config_hash` — el campo que después se propaga a todos los eventos CTR del piloto (ver [ctr-service](./ctr-service.md) Sección 10).
- Importar padrones CSV — hoy el commit no persiste; el workflow real usa `POST /bulk` de academic-service.

La vista de Clasificaciones es un **viewer** de las agregaciones que produce [classifier-service](./classifier-service.md) — no implementa análisis por sí misma. El análisis empírico (κ, progresión, A/B) vive en [web-teacher](./web-teacher.md).

## 11. Estado de madurez

**Tests**: no hay suite activa. Los tests unitarios de componentes UI (`Modal`, `HelpButton`, `PageContainer`) viven en `packages/ui/src/components/*.test.tsx` (25 tests totales de la foundation compartida).

**Known gaps**:
- Routing state-based — migración a TanStack Router type-safe prevista F2-F3 (la dep ya está en `package.json`).
- Sin tests e2e del flujo BulkImport end-to-end.
- BulkImport commit no persiste (gap del backend — ver [enrollment-service](./enrollment-service.md)).
- Test runner configurado con `--passWithNoTests` — no hay suite real.
- 10 entries de `helpContent.tsx` en español sin tildes (política del monorepo).

**Fase de consolidación**:
- F1 — scaffold inicial con Sidebar + 10 páginas CRUD (`docs/F1-STATE.md`).
- F5 — integración con keycloak-js (hoy latente, activada con `VITE_KEYCLOAK_URL`).
- F8+ — migración a TanStack Router pendiente.
