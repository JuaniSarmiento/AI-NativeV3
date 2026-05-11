# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estructura del directorio

Este directorio es un **wrapper** que contiene el monorepo real, no código directo. Layout:

```
.
├── AI-NativeV3-main/   ← Proyecto real (monorepo). Acá vive todo el código.
├── audita1.md          ← Auditoría inicial (2026-05-10) — inventario, brechas, riesgos. Tiene sección "⚠️ Errata" con falsos positivos detectados durante ejecución del plan.
├── plan-accion.md      ← Plan derivado de audita1.md con 26 acciones priorizadas + DAG + tabla de estado. Al 2026-05-10: 23/26 cerradas + F1-F7 + cambios kappa.
├── audi2.md            ← Auditoría de completitud profunda (2026-05-10) — evalúa 20 capabilities funcionales contra 4 criterios estrictos. Veredicto: 11/20 al 100% (post-A14 BYOK reclasificada).
├── ppconarev.md        ← Revisión paper ppcona.docx vs implementación (2026-05-10) — análisis en prosa narrativa de divergencias paper/código (umbral kappa, protocolo muestral, framing AI-Native, extensiones operativas, Caliper/xAPI, reconciliación 3→5 coherencias).
├── paper-draft.md      ← Draft del paper consolidado (2026-05-10) — 10/10 decisiones académicas resueltas (Camino 1 + protocolo dual + 4 temáticas). Listo para revisión coautoral con Ana Garis y eventual submisión.
├── loquehace.md        ← Documento narrativo descriptivo para comité doctoral.
└── CLAUDE.md           ← Este archivo (puntero al proyecto real).
```

**Relación entre docs**: `audita1.md` (qué hay en el código) → `plan-accion.md` (cómo arreglarlo) → ejecución → `audi2.md` (qué quedó terminado al 100%). Paralelamente: `ppconarev.md` (paper vs código) → `paper-draft.md` (paper consolidado con decisiones académicas resueltas). Cada uno actualiza la verdad de los anteriores. Si hay conflicto sobre estado del código, **`audi2.md` es la fuente más reciente**; sobre decisiones académicas, **`paper-draft.md` y ADR-046 son las fuentes vigentes**.

**Antes de cualquier comando** (build, test, dev, migrate, lint), entrá al subdirectorio:

```bash
cd "AI-NativeV3-main"
```

Sin ese `cd`, todos los `make`, `pnpm`, `uv`, `pytest` van a fallar — no hay `Makefile`, `package.json` ni `pyproject.toml` en este nivel.

## Source of truth

El CLAUDE.md operativo (invariantes, constantes hash, versiones pinned, gotchas Windows/IPv6/Vite, ports, decisiones non-obvious) vive en **`AI-NativeV3-main/CLAUDE.md`** (~247 líneas). Leelo antes de modificar cualquier cosa que toque:

- Reproducibilidad bit-a-bit (`classifier_config_hash`, `LABELER_VERSION=1.2.0`).
- CTR append-only (`GENESIS_HASH`, `chain_hash`, `self_hash`).
- BYOK encryption (`BYOK_MASTER_KEY`).
- k-anonymity (`MIN_STUDENTS_FOR_QUARTILES=5`, `MIN_EPISODES_FOR_LONGITUDINAL=3`).
- RLS multi-tenant + headers `X-Tenant-Id` / `X-User-Id` / `X-User-Roles`.

## Contexto del proyecto

Monorepo de la plataforma **AI-Native N4** — tesis doctoral UNSL (Cortez): "Modelo AI-Native con Trazabilidad Cognitiva N4 para la Formación en Programación Universitaria". **No es producto comercial**: piloto académico cuya aceptabilidad doctoral depende de invariantes criptográficas (append-only, reproducibilidad, k-anonymity).

Stack: **11 servicios Python activos** (FastAPI 0.100+ / SQLAlchemy 2.0 async / Alembic / structlog / OTel) + 3 frontends React 19 (web-admin, web-student, web-teacher con Vite 6 + TanStack Router/Query) + 7 packages compartidos. Workspace híbrido `uv` (Python) + `pnpm` + `turbo` (TS).

`identity-service` y `enrollment-service` **fueron borrados** del workspace (2026-05-10, A25 del plan-accion) — eran deprecated por ADR-041 y ADR-030 respectivamente. Auth movido al api-gateway, bulk-import movido a academic-service.

## Estado actual (resumen — ver `audi2.md`, `plan-accion.md` y `paper-draft.md` para detalle)

**Completitud del sistema (de `audi2.md`)**: 11/20 capabilities funcionales activas al 100% en los 4 criterios estrictos (código+tests+docs / invariantes / producción piloto / aprobación académica). Las otras 9 son parciales con bloqueador específico identificable. 6 capabilities en skeleton OFF / DEFERRED (agenda piloto-2 o gates externos).

**Núcleo defendible al 100%**: gestión multi-tenant, bulk-import, TP templates con auto-instanciación, dashboard cohorte, alertas k-anonymity, clasificación N4, reflexión post-cierre, longitudinal CII, auditoría criptográfica CTR, generación TP por IA, BYOK multi-provider (esta última reclasificada de parcial a 100% post-A14, sentinel pattern UUID v5 cerrando gap `byok_keys_usage` en env_fallback).

**Plan ejecutado (`plan-accion.md`)**: 23/26 acciones cerradas + 7 mejoras adicionales (F1-F7) + alineamiento paper/código por ADR-046. Quedan A15/A16/A18/A20 (riesgosos o de cierre) + 4 externos (A1 DB real, A2 intercoder, A3 Keycloak DI UNSL, A5 defensa).

**Paper consolidado (`paper-draft.md`)**: 10/10 decisiones académicas resueltas en dos pasadas — Camino 1 + protocolo dual para κ ≥ 0,70 (formalizado en ADR-046) y 4 decisiones temáticas (aclaración 3→5 coherencias, mención única "AI-Native N4" como proyecto, párrafo único con extensiones operativas referenciando ADRs, suavización "inspirado en" para Caliper/xAPI).

**Stack levantado y operacional al 2026-05-10**: 11 servicios HTTP healthy en :8000-:8011 (excepto :8012 integrity-attestation que es 503 by design en dev local — vive en VPS UNSL), 8 ctr-workers consumiendo streams Redis, 3 frontends Vite en :5173/5174/5175. End-to-end verificado: api-gateway → analytics-service → DB devuelve clasificaciones reales del seed (3 comisiones, 18 estudiantes, 106 classifications). Bugfix Windows aplicado a `asyncio.add_signal_handler` no implementado en `ProactorEventLoop` — workers ahora arrancan limpios en Windows.

**2 riesgos académicos críticos vigentes**:
1. **106 classifications con hash legacy** pre-LABELER_VERSION 1.2.0 — pre-cond A12 ya cumplida (idempotencia `persist_classification`); falta A1 (worker batch sobre DB real del piloto).
2. **Validación intercoder κ ≥ 0,70** (post-ADR-046) sobre protocolo dual: 200 eventos estratificados 50 por nivel N1-N4 (Protocolo A) + 50 episodios cerrados en 3 categorías de apropiación (Protocolo B). Bloquea socratic_compliance (ADR-044) y lexical_anotacion (ADR-045) que siguen en feature-flag OFF. **Cuello de botella académico más grande** — requiere coordinación con 2 docentes UNSL (~25-30h por docente).

**Acciones humanas pendientes** (no son código): marcar `Smoke E2E API` como Required check en branch protection (A8); coordinar Keycloak claim `comisiones_activas` con DI UNSL (A3); coordinar etiquetadores UNSL para κ ≥ 0,70 con protocolo dual (A2); ejecutar re-clasificación con DB real (A1); revisión coautoral del paper-draft.md con Ana Garis previa a submisión; consolidar agradecimientos (Daniela Carbonari co-directora del PID, Bruno Roberti, Carlos Martínez, Claudia Naveda, Juan Sarmiento, Juan Robledo).

## Trabajar en este directorio vs. en el subdirectorio

- Editar / leer / referenciar `audita1.md`, `plan-accion.md`, `audi2.md`, `ppconarev.md`, `paper-draft.md` o `loquehace.md` → desde acá está bien. Son docs de gobierno del proyecto + análisis académico, no código.
- Cualquier cambio de código, infra, tests, docs internas, ADRs (incluido el ADR-046 sobre kappa), SESSION-LOG → siempre **desde `AI-NativeV3-main/`** (`cd "AI-NativeV3-main"` primero).
- Si vas a hacer trabajo sustancial de código, abrí Claude Code directamente en `AI-NativeV3-main/` y usá su CLAUDE.md (~250 líneas, recientemente actualizado con gotchas Windows asyncio + ownership cruzado entregas/calificaciones + dos patterns HelpButton) como guía principal — ese tiene los invariantes, gotchas, constantes hash y comandos operativos.
- Si vas a ejecutar acciones del `plan-accion.md`, primero leé la tabla de estado al inicio del archivo para confirmar qué ya está cerrado (evitar duplicar trabajo). Sub-agents que ejecutaron acciones pueden haber descubierto deuda no documentada — chequear engram con `topic_key: plan/action-2026-05/*`.
- Si vas a tocar el paper o discutir decisiones académicas, leé primero `ppconarev.md` (divergencias paper/código identificadas) y luego `paper-draft.md` (decisiones resueltas). El paper original `AI-NativeV3-main/ppcona.docx` queda intacto como insumo. Decisiones académicas formales viven en ADRs del repositorio (especialmente ADR-046 para kappa).

## Levantar el stack local

Requisitos previos: Docker corriendo con infraestructura (Postgres, Redis, Keycloak, MinIO), `uv` instalado, `pnpm` instalado, `.env` creado desde `.env.example` con `BYOK_MASTER_KEY` generada (`openssl rand -base64 32`).

Bootstrap (primera vez, ~5-10 min):

```bash
cd "AI-NativeV3-main"
uv sync --all-packages
pnpm install
ACADEMIC_DB_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/academic_main \
CTR_DB_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/ctr_store \
CTR_STORE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/ctr_store \
CLASSIFIER_DB_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/classifier_db \
CONTENT_DB_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/content_db \
bash scripts/migrate-all.sh
uv run python -m academic_service.seeds.casbin_policies
uv run python scripts/seed-3-comisiones.py
```

Levantar servicios (cada vez):

```bash
bash scripts/dev-start-all.sh   # 11 servicios HTTP + 8 ctr-workers en background
make dev                         # 3 frontends Vite en :5173/:5174/:5175
```

URLs útiles cuando el stack está levantado: web-admin :5173, web-teacher :5174, web-student :5175, api-gateway :8000, Grafana :3000, Jaeger :16686, Keycloak admin :8180.

Apagar: `bash scripts/dev-stop-all.sh` + Ctrl+C en el shell de `make dev`.
