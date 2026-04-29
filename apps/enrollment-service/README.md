# enrollment-service — DEPRECATED

> **Estado: DEPRECATED desde 2026-04-29 ([ADR-030](../../docs/adr/030-deprecate-enrollment-service.md))**

Este servicio fue diseñado en F0 para ingestar inscripciones de estudiantes vía CSV. La iter 2 de auditoría (`audi2.md`) detectó que **ningún frontend lo consumía** y que el endpoint `POST /api/v1/imports/{id}/commit` tenía un TODO sin resolver: *"integrate academic-service"*.

[ADR-029](../../docs/adr/029-bulk-import-inscripciones.md) cerró el gap centralizando el bulk-import de **todas** las entidades académicas (incluyendo `inscripciones`) en `academic-service`. Este servicio quedó redundante y se deprecó por ADR-030.

## Cómo se usa hoy el alta masiva de inscripciones

Reemplazo unificado: **`POST /api/v1/bulk/inscripciones`** del [academic-service](../academic-service/).

Frontend: web-admin / [`BulkImportPage`](../web-admin/src/pages/BulkImportPage.tsx) ahora incluye la entidad **"Inscripciones (estudiantes)"** en el dropdown de selección.

Schema CSV requerido:

| Columna | Requerida | Tipo |
|---|---|---|
| `comision_id` | ✅ | UUID |
| `student_pseudonym` | ✅ | UUID (pre-derivado por federación LDAP) |
| `fecha_inscripcion` | ✅ | ISO date |
| `rol` | ❌ | `regular` (default) / `oyente` / `reinscripcion` |
| `estado` | ❌ | `activa` (default) / `cursando` / `aprobado` / `desaprobado` / `abandono` |
| `nota_final` | ❌ | Decimal[0,10] |
| `fecha_cierre` | ❌ | ISO date |

Ver [ADR-029](../../docs/adr/029-bulk-import-inscripciones.md) para detalles completos del flow.

## Qué se removió de la infraestructura

- **`pyproject.toml` (raíz)**: sacado de `[tool.uv.workspace].members` — no se sincroniza con `uv sync` ni aparece en `pytest apps/*/tests/`.
- **`apps/api-gateway/src/api_gateway/routes/proxy.py`**: removido `"/api/v1/imports": settings.enrollment_service_url` del `ROUTE_MAP`. El endpoint queda **inalcanzable** desde frontend.
- **`infrastructure/helm/platform/values.yaml`**: removido el bloque `enrollment-service:` del config de servicios. **No se deploya en staging/prod** post-ADR-030.
- **`CLAUDE.md`**: tabla de puertos marca el puerto 8003 como deprecated; mención en plano académico-operacional removida.

## Por qué NO se eliminó el directorio

Decisión deliberada en ADR-030: **preservar el código en disco** facilita revisitar la decisión más adelante (si emerge un caso de uso para sync con SIS institucional que no encaje en el bulk de academic-service). Los archivos del directorio NO afectan al sistema en runtime — sólo viven como histórico.

Si en el futuro se decide **revivir** el servicio:

1. Re-incluir `"apps/enrollment-service"` en `pyproject.toml` `[tool.uv.workspace].members`.
2. Re-agregar `"/api/v1/imports": settings.enrollment_service_url` en `proxy.py` `ROUTE_MAP`.
3. Re-agregar el bloque `enrollment-service:` en `infrastructure/helm/platform/values.yaml`.
4. Resolver el TODO original en [`routes/imports.py`](src/enrollment_service/routes/imports.py) (commit que persiste a través de academic-service).
5. Marcar ADR-030 como `Superseded por ADR-XXX` y redactar el ADR de revival explicando el caso de uso nuevo.

## Por qué NO se completó el commit en su momento

audi2.md G10 timing prescribió la ruta mínima para defensa. El alta masiva de estudiantes era bloqueante (B.1 de la auditoría 2026-04-29) — completar `enrollment-service` requería dependencia HTTP service-to-service entre dos servicios, latencia, transaccionalidad cross-service. **Centralizar en academic-service fue más simple y honesto** que mantener dos servicios para el mismo flow.

## Referencias

- [ADR-029](../../docs/adr/029-bulk-import-inscripciones.md) — bulk de inscripciones en academic-service.
- [ADR-030](../../docs/adr/030-deprecate-enrollment-service.md) — esta decisión (deprecación).
- [audi2.md](../../audi2.md) — auditoría doctoral que motivó iter 2.
- Auditoría de coherencia backend ↔ frontend (2026-04-29) — gaps B.1, D.6.
