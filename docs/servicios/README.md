# docs/servicios/

Documentación exhaustiva de los 12 microservicios backend y los 3 frontends del monorepo. Un archivo por servicio, estructura uniforme de 11 secciones (con excepción de `evaluation-service` que es un stub y lleva plantilla reducida). Útil como referencia única para onboarding técnico, defensa doctoral y auditoría académica.

## Tabla de servicios

| Servicio | Plano | Puerto | Base de datos | Correspondencia con tesis (inferida) | MD |
|---|---|---|---|---|---|
| [ctr-service](./ctr-service.md) | Pedagógico-evaluativo | 8007 | `ctr_store` | Servicio del Cuaderno de Trabajo Reflexivo | [→](./ctr-service.md) |
| [governance-service](./governance-service.md) | Pedagógico-evaluativo | 8010 | — (filesystem Git) | Servicio de gobernanza del prompt | [→](./governance-service.md) |
| [tutor-service](./tutor-service.md) | Pedagógico-evaluativo | 8006 | — | Servicio de tutor socrático | [→](./tutor-service.md) |
| [classifier-service](./classifier-service.md) | Pedagógico-evaluativo | 8008 | `classifier_db` | Clasificador N4 | [→](./classifier-service.md) |
| [content-service](./content-service.md) | Pedagógico-evaluativo | 8009 | `content_db` | Servicio de contenido / RAG | [→](./content-service.md) |
| [ai-gateway](./ai-gateway.md) | Transversal (IA) | 8011 | — (Redis counters) | — | [→](./ai-gateway.md) |
| [academic-service](./academic-service.md) | Académico-operacional | 8002 | `academic_main` | Servicio de dominio académico | [→](./academic-service.md) |
| [enrollment-service](./enrollment-service.md) | Académico-operacional | 8003 | — | — | [→](./enrollment-service.md) |
| [evaluation-service](./evaluation-service.md) | Académico-operacional | 8004 | — | — | [→](./evaluation-service.md) |
| [analytics-service](./analytics-service.md) | Académico-operacional | 8005 | lee cross-base RO | Servicio de analítica | [→](./analytics-service.md) |
| [identity-service](./identity-service.md) | Académico-operacional | 8001 | — (wrapper Keycloak) | — | [→](./identity-service.md) |
| [api-gateway](./api-gateway.md) | Transversal | 8000 | — (Redis counters) | — | [→](./api-gateway.md) |
| [web-admin](./web-admin.md) | Frontend | 5173 | — | — | [→](./web-admin.md) |
| [web-teacher](./web-teacher.md) | Frontend | 5174 | — | Panel del docente y del investigador | [→](./web-teacher.md) |
| [web-student](./web-student.md) | Frontend | 5175 | — | Aplicación web de estudiante | [→](./web-student.md) |

> **Disclaimer sobre la correspondencia con la tesis**: los nombres en la columna "Correspondencia con tesis (inferida)" son una **derivación nominal** del Capítulo 6 de la tesis (arquitectura C4 del sistema AI-Native). No hay un mapeo literal vigente en el repositorio (ni en `docs/architecture.md` ni en ADRs) que asocie cada servicio a un identificador formal de componente. El lector que tenga la tesis en mano puede identificar los componentes por el **nombre descriptivo**; si la tesis renumera o reorganiza en una versión futura, esta tabla puede quedar desincronizada — el nombre canónico del servicio (columna 1) es el que manda. Los servicios marcados `—` existen como infraestructura transversal sin correspondencia directa con un componente nominal de la tesis; cada MD explica por qué existe igual.

## Diagrama de dependencias en runtime

Representa quién llama a quién por HTTP (o import directo en el caso del acople intra-monorepo de analytics→classifier). No incluye infraestructura (Postgres, Redis, Keycloak, MinIO); ver [`docs/architecture.md`](../architecture.md) y el diagrama del README raíz para el panorama con infra.

```
                    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
                    │  web-admin   │    │ web-teacher  │    │  web-student │
                    │    (5173)    │    │    (5174)    │    │    (5175)    │
                    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
                           │                   │                   │
                           └───────────────────┼───────────────────┘
                                               │
                                               ▼
                                       ┌───────────────┐
                                       │  api-gateway  │  (única puerta externa)
                                       │     (8000)    │  JWT + rate limit + proxy
                                       └───────┬───────┘
                                               │ routes por prefijo
          ┌──────────────┬────────────┬────────┴────────┬────────────┬──────────────┐
          ▼              ▼            ▼                 ▼            ▼              ▼
  ┌──────────────┐ ┌──────────┐ ┌──────────┐   ┌──────────────┐ ┌──────────┐ ┌──────────────┐
  │   academic   │ │enrollment│ │ content  │   │    tutor     │ │classifier│ │  analytics   │
  │    (8002)    │ │  (8003)  │ │  (8009)  │   │    (8006)    │ │  (8008)  │ │    (8005)    │
  └──────┬───────┘ └──────────┘ └────┬─────┘   └──┬───────────┘ └──────┬───┘ └──────┬───────┘
         │                           │            │                   │            │
         │          valida TP        │            │                   │            │
         │◄──────────────────────────┼────────────┤                   │            │
         │                           │            │                   │            │
         │                  retrieve │            │                   │            │
         │                           │◄───────────┤                   │            │
         │                           │            │                   │            │
         │                           │            │  publica eventos  │            │
         │                           │            ├──────────┐        │            │
         │                           │            │          ▼        │            │
         │                           │            │   ┌──────────────┐│            │
         │                           │            │   │     ctr      ││ lee cross- │
         │                           │            │   │    (8007)    ││  base RO   │
         │                           │            │   └──────────────┘│◄───────────┤
         │                           │            │          ▲        │            │
         │                           │            │          │        │            │
         │                           │            │          └────────┤            │
         │                           │            │           fetch   │            │
         │                           │            │           events  │            │
         │                           │            │                   │            │
         │                           │            │         ┌─────────┴──────────┐ │
         │                           │            │         │   (import directo  │ │
         │                           │            │         │    para A/B de     │◄┘
         │                           │            │         │    profiles)       │
         │                           │            │         └────────────────────┘
         │                           │            │
         │                           │            ▼
         │                           │   ┌────────────────┐
         │                           │   │   governance   │
         │                           │   │     (8010)     │
         │                           │   │ (FS Git repo)  │
         │                           │   └────────────────┘
         │                           │            ▲
         │                           │            │  GET prompt al abrir episodio
         │                           │            │
         │                           │   ┌────────────────┐
         │                           └──►│   ai-gateway   │
         │                               │     (8011)     │  ← único autorizado
         │                               │  (LLM proxy)   │    a llamar LLMs
         │                               └────────────────┘
         │
         ▼
  (compartido por lectura read-only con analytics vía
   sesiones separadas, SET LOCAL app.current_tenant)


  identity-service (8001)  ←  stub funcional, responsabilidades nominales
                                en packages/platform-ops (LDAP, privacy, onboarding)

  evaluation-service (8004) ←  stub F0, placeholder para rúbricas (futuro)
```

**Notas del diagrama**:

- El gateway (`api-gateway`) es la única entrada externa. Los clientes humanos (los 3 frontends) sólo conocen `:8000`.
- `tutor-service` es el **orquestador** del plano pedagógico: pega a `academic` (validar TP), `content` (retrieval), `governance` (prompt), `ai-gateway` (LLM), y publica al `ctr-service` (eventos).
- `ctr-service` es **hoja**: recibe eventos, persiste la cadena, no llama a nadie. Los hashes de configuración viajan embebidos desde el productor.
- `classifier-service` **lee** del `ctr_store` para traer los eventos de un episodio vía HTTP (`GET /episodes/{id}` del ctr-service) y persiste su resultado en `classifier_db` propia.
- `analytics-service` es el único que **lee cross-base** (ctr_store + classifier_db + academic_main) con sesiones separadas y RLS por tenant. Además tiene un acople intra-monorepo: importa `classifier_service.services.pipeline` para el A/B de profiles (ver nota del diagrama).
- `identity-service` y `evaluation-service` están fuera del camino crítico. El primero es stub funcional; el segundo un placeholder F0.
- `ai-gateway` es el único autorizado a invocar LLMs externos (Anthropic, OpenAI). Los consumidores (tutor, classifier si lo necesita, content si el embedder es remoto) pegan sólo a él.

## Por dónde empezar según rol

### Desarrollador nuevo al código

1. [`README.md`](../../README.md) raíz — panorama, stack, comandos `make init` / `make dev`.
2. [`CLAUDE.md`](../../CLAUDE.md) raíz — convenciones, gotchas de entorno, invariantes críticos. Lectura obligatoria antes de tocar código.
3. [`docs/architecture.md`](../architecture.md) — modelo de dos planos.
4. [`docs/adr/`](../adr/) en orden numérico, especialmente:
   - [ADR-001](../adr/001-multi-tenancy-rls.md) — RLS multi-tenant.
   - [ADR-003](../adr/003-separacion-bases-logicas.md) — 4 bases separadas.
   - [ADR-009](../adr/009-git-fuente-prompt.md) — Git como fuente del prompt.
   - [ADR-010](../adr/010-append-only-clasificaciones.md) — append-only de clasificaciones.
   - [ADR-016](../adr/016-tp-template-instance.md) — TareaPractica template + instancia.
5. Este directorio (`docs/servicios/`) **en este orden de lectura**:
   - `ctr-service.md` primero — es el núcleo conceptual, el resto se interpreta a partir de él.
   - `tutor-service.md` — el orquestador; una vez que se entiende, el flujo de una interacción socrática es claro.
   - `governance-service.md` + `content-service.md` + `classifier-service.md` + `ai-gateway.md` — los 4 servicios con los que el tutor habla.
   - `academic-service.md` — columna vertebral estructural.
   - `analytics-service.md` — dónde cierra el análisis empírico.
   - Los frontends en orden `web-student` → `web-teacher` → `web-admin` (por frecuencia de uso real).
   - `api-gateway.md` al final — es transversal, tiene sentido cuando se entiende qué está protegiendo.
6. [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — workflow de PRs, branches, tests obligatorios.

### Docente participante del piloto UNSL

1. [`docs/pilot/README.md`](../pilot/README.md) — operativa diaria.
2. [`docs/pilot/protocolo-piloto-unsl.docx`](../pilot/protocolo-piloto-unsl.docx) — protocolo formal del piloto.
3. [`docs/pilot/runbook.md`](../pilot/runbook.md) — 10 incidentes codificados (I01 integridad CTR es la más crítica).
4. Este directorio, **sólo los MDs de las UIs que vas a usar**:
   - `web-teacher.md` si sos coordinador de cátedra o docente asignado (TPs, templates, materiales, progresión, κ, export).
   - `web-student.md` si participás en la prueba del flujo como estudiante.
5. `academic-service.md` como referencia cuando el coordinador edite comisiones o periodos desde el web-admin.

### Investigador académico (análisis de datos)

1. [`docs/pilot/protocolo-piloto-unsl.docx`](../pilot/protocolo-piloto-unsl.docx) — marco metodológico.
2. [`docs/pilot/kappa-workflow.md`](../pilot/kappa-workflow.md) — procedimiento intercoder para κ (OBJ-13).
3. Este directorio, en orden:
   - `analytics-service.md` — los 6 endpoints (κ, A/B profiles, progression, export) son las APIs que vas a consumir.
   - `ctr-service.md` + `classifier-service.md` — qué hay en las bases que los endpoints leen.
   - `web-teacher.md` — UI alternativa a la API para κ, progresión y export.
4. [`docs/pilot/analysis-template.ipynb`](../pilot/analysis-template.ipynb) — notebook de análisis.
5. [`reglas.md`](../../reglas.md) — RNs relevantes para el análisis: RN-095/RN-096 (κ), RN-111 (A/B profiles), RN-026 (`chunks_used_hash`).

---

Panorama formal con diagramas C4 y justificación arquitectónica en [`docs/architecture.md`](../architecture.md).
