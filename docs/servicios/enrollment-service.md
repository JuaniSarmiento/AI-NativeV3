# enrollment-service

## 1. Qué hace (una frase)

Recibe archivos CSV/TSV de padrones institucionales, valida en modo dry-run (reporta errores fila por fila) y ofrece un segundo paso de `commit` para aplicar las inscripciones — evitando cambios parciales de estado si el archivo tiene filas rotas.

## 2. Rol en la arquitectura

Pertenece al **plano académico-operacional**. Infraestructura transversal del plano académico, sin correspondencia directa con un componente de la arquitectura de la tesis. Existe porque el convenio del piloto UNSL requiere operar con padrones reales exportados desde el SIS institucional (y en otras universidades con otros formatos), y encapsular ese import en un servicio con modo dry-run es el patrón estándar que ADR-003 (separación de bases lógicas) sugiere para las integraciones externas que pueden fallar.

## 3. Responsabilidades

- Exponer `POST /api/v1/imports` que acepta un archivo CSV/TSV (≤10 MB), lo valida fila por fila (`validate_csv_bytes()`) y devuelve un reporte con `total_rows`, `valid_rows`, `errors` (con `row_number`, `field`, `message`) y `preview` de primeras filas.
- Asignar un `import_id` (UUID v4) por cada upload y guardar el archivo validado en un **store en memoria** (`_imports_cache: dict[UUID, dict]`) — intencionalmente efímero para el F0/F1 del piloto.
- Exponer `POST /api/v1/imports/{import_id}/commit` que toma un import en estado `validated` y lo marca `committed`.
- Rechazar commits sobre imports fallidos o inexistentes (`400` / `404`).

## 4. Qué NO hace (anti-responsabilidades)

- **NO persiste las inscripciones todavía**: el commit es un stub (`cached["status"] = "committed"` sin llamar a academic-service). El comentario `TODO F1-W7` en `routes/imports.py:85` lo deja explícito. En el estado actual, **el commit no aplica nada en `inscripciones`** — hay que persistir manualmente o via `POST /api/v1/bulk` de [academic-service](./academic-service.md).
- **NO tiene DB propia**: toda la persistencia de inscripciones vive en `academic_main.inscripciones` (propiedad de academic-service). Este servicio sólo orquesta el import.
- **NO sincroniza automáticamente con un SIS**: no hay cron job que pulle padrones. El docente sube el CSV manualmente (vía web-admin o curl).
- **NO valida permisos de modo robusto**: el endpoint `/imports` **no exige autenticación** en el código actual (`routes/imports.py` no usa `Depends(require_role(...))`). En prod con api-gateway el JWT igual se exige antes del routing, pero localmente es un endpoint abierto.
- **NO modifica el directorio institucional**: LDAP federation es READ-ONLY (condición del convenio, CLAUDE.md). La plataforma lee usuarios de Keycloak/LDAP; no crea cuentas.

## 5. Endpoints HTTP

| Método | Path | Qué hace | Auth |
|---|---|---|---|
| `POST` | `/api/v1/imports` | Valida CSV/TSV (≤10 MB) y devuelve reporte. 201 con `ImportResponse`. | **Ninguna en el código** (deuda — ver Sección 4). |
| `POST` | `/api/v1/imports/{import_id}/commit` | Marca como `committed`. 400 si no está `validated`. 404 si no existe. | Ninguna en el código. |
| `GET` | `/health` | Stub `{"status": "ok"}`. | Ninguna. |

## 6. Dependencias

**Depende de (infraestructura):** ninguna persistente. El store en memoria se pierde al reiniciar el servicio.

**Depende de (otros servicios):**
- [academic-service](./academic-service.md) — **previsto** (TODO F1-W7) para aplicar las inscripciones en commit. Hoy no hay llamada HTTP.

**Dependen de él:**
- [web-admin](./web-admin.md) — desde la página `BulkImportPage.tsx`.

## 7. Modelo de datos

**No tiene DB propia**. Store en memoria (`_imports_cache`) por cada import en curso. Estructura:

```python
{
    import_id: UUID → {
        "content": bytes,           # CSV crudo
        "result": ValidationResult,  # rows/errores del dry-run
        "status": "validated" | "failed" | "committed",
    }
}
```

No hay TTL, no hay limpieza automática, no hay persistencia entre reinicios. Para F3+ está previsto Redis + aplicación real en academic-service.

## 8. Archivos clave para entender el servicio

- `apps/enrollment-service/src/enrollment_service/routes/imports.py` — los 2 endpoints. Tiene el TODO explícito sobre commit que no aplica inscripciones.
- `apps/enrollment-service/src/enrollment_service/services/csv_import.py` — `validate_csv_bytes()` y `ValidationResult`. Es la lógica real de validación fila por fila (headers esperados, tipos, unicidad, referencias cruzadas al modelo académico).
- `apps/enrollment-service/src/enrollment_service/config.py` — sólo envs comunes (Keycloak, OTel). No tiene URL a academic-service porque el commit no la usa todavía.

## 9. Configuración y gotchas

**Env vars críticas**: ninguna específica del servicio. Sólo las comunes del monorepo (observabilidad, Keycloak).

**Puerto de desarrollo**: `8003`.

**Gotchas específicos**:

- **Commit no persiste**: el endpoint `commit` cambia un flag del dict en memoria y devuelve 200, pero las inscripciones **no aparecen en `academic_main.inscripciones`**. Si se confía en el HTTP 200 como señal de éxito, los estudiantes nunca se matriculan. Documentado como `TODO F1-W7` en el código. Para uso real del piloto hoy, usar `POST /api/v1/bulk` de [academic-service](./academic-service.md).
- **Store in-memory se pierde al reiniciar**: un import validado pero no commiteado desaparece si el pod se reinicia. En prod K8s, el rolling update pierde todos los imports en vuelo.
- **Sin auth explícita en routes**: `routes/imports.py` no incluye `Depends(require_role(...))`. Depende enteramente de que el api-gateway valide el JWT antes de rutear. En tests unitarios corriendo contra el ASGI app directamente, el endpoint es abierto.
- **Límite de 10 MB**: hardcoded en `routes/imports.py:41`. Padrones grandes (ej. facultades enteras) pueden superar.
- **Formato de CSV esperado no documentado acá**: `validate_csv_bytes()` tiene la lista de columnas requeridas y el dominio de cada campo (ver implementación). Si el SIS institucional exporta con otro header, hay que mapear fuera.

## 10. Relación con la tesis doctoral

El enrollment-service no implementa componentes de la tesis. Su existencia es **operativa**: el piloto UNSL requiere matricular estudiantes de comisiones reales con padrones que vienen del SIS institucional en CSV, y el patrón dry-run + commit es defensivo ante padrones con errores (emails inválidos, DNIs duplicados, comisiones inexistentes).

En cuanto a la tesis: una vez que el commit aplique inscripciones reales, el `student_pseudonym` de cada fila es el que queda en `academic_main.inscripciones` y luego en los `Episode.student_pseudonym` del CTR. La pseudonimización en sí vive en `packages/platform-ops/privacy.py` — este servicio es aguas arriba de ese proceso.

El servicio es **el menos maduro del plano académico** y quedó en estado de stub parcial desde F1. Su rol completo está en la hoja de ruta pero no bloquea el piloto (se puede matricular via bulk de academic-service).

## 11. Estado de madurez

**Tests** (1 archivo): `tests/test_health.py` — solo el smoke del endpoint `/health`. No hay tests de `validate_csv_bytes()` ni del flujo dry-run → commit.

**Known gaps**:
- **Commit no aplica nada**: el gap más crítico del servicio. Todo lo demás deriva de esto.
- Store in-memory → no apto para prod.
- Sin auth explícita en los routes.
- Sin tests de validación del parser CSV.
- `/health` es stub.
- No hay sync automático desde SIS institucional.

**Fase de consolidación**:
- F0 — scaffold inicial (`docs/F0-STATE.md`).
- F1 — endpoint de validación + dry-run (HU-021 cubierto parcialmente). Commit marcado como `TODO F1-W7` y no cerrado.
- F3+ previsto — persistencia real + Redis para el store + HTTP hacia academic-service.
