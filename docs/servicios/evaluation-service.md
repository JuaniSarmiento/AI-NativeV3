# evaluation-service

## Estado: stub F0 (placeholder)

Este servicio existe como reserva arquitectónica en el monorepo pero no tiene lógica implementada al momento de esta documentación. Su espacio en el diseño está reservado para **rúbricas, corrección asistida y calificaciones finales** según el título del `pyproject.toml` y la sección "Servicios" de [`docs/architecture.md`](../architecture.md#servicios) que lo lista como `evaluation-service — rúbricas + corrección`.

## Qué existe hoy

- `apps/evaluation-service/src/evaluation_service/main.py` — entrypoint FastAPI mínimo con CORS + observability setup.
- `apps/evaluation-service/src/evaluation_service/routes/health.py` — endpoints de health (`/health`, `/health/ready`, `/health/live`). El `ready` tiene un TODO de chequeo real de dependencias; hoy devuelve `{"status": "ready", "checks": {}}` hardcoded.
- `apps/evaluation-service/src/evaluation_service/config.py` — sólo settings genéricos del monorepo (puerto, OTel, Keycloak).
- Sin modelos, sin servicios, sin workers, sin endpoints de dominio.
- Sin migraciones Alembic.
- Sin tests funcionales (sólo `tests/test_health.py`).
- Puerto de desarrollo asignado: **8004**.

## Por qué existe igual

La `TareaPractica` persistida en [academic-service](./academic-service.md) lleva un campo `rubrica: JSONB` desde F8 que hoy se renderiza crudo en los frontends (`<pre>{JSON.stringify(...)}</pre>` — ver CLAUDE.md "Modelos no obvios desde el código"). La **aplicación** de esa rúbrica contra las entregas del estudiante — corrección asistida, cálculo de nota, agregación con `peso` para la nota final del período — es lo que este servicio está reservado para implementar.

No hay ADR dedicado a evaluation-service. La referencia más formal es [`docs/architecture.md`](../architecture.md) que lo declara como parte del plano académico-operacional y no desarrolla las responsabilidades. `historias.md` no tiene HUs asignadas a este servicio. `reglas.md` lo menciona una sola vez (RN sobre estrategia de deploy blue-green aplicable a todos los servicios HTTP).

Al momento de esta documentación **no hay roadmap formalizado** en un ADR de qué funcionalidad específica va a aterrizar acá ni en qué fase. El README raíz lo marca como "rúbricas (futuro)".

## Dependencias potenciales (cuando se implemente)

Si el servicio se materializa siguiendo el alcance nominal, las dependencias previsibles son:
- [academic-service](./academic-service.md) — para leer `TareaPractica.rubrica` y persistir la calificación en `Inscripcion.nota_final`.
- [ctr-service](./ctr-service.md) — para consumir eventos `codigo_ejecutado` y decidir si la entrega compila/pasa tests.
- [classifier-service](./classifier-service.md) — para que la nota sumativa pondere la categoría N4 del episodio.
- [ai-gateway](./ai-gateway.md) — si la corrección asistida usa LLM (previsible).

## Cuándo actualizar este documento

Cuando `apps/evaluation-service/src/evaluation_service/` deje de ser un stub — esto es, cuando aparezcan `models/`, `services/` u otros routes más allá de health. En ese momento, reescribir según la plantilla estándar de 11 secciones usada por el resto de los servicios del monorepo.
