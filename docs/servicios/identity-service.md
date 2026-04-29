# identity-service

## 1. Qué hace (una frase)

Es el wrapper **nominal** de la Admin API de Keycloak + la gestión de pseudonimización del plano académico; hoy (F9) está reducido a un entrypoint FastAPI con endpoint de health — las responsabilidades reales viven en `packages/platform-ops` (LDAP federation, privacy, onboarding) y en la propia Keycloak instance via realm templates.

## 2. Rol en la arquitectura

Pertenece al **plano académico-operacional**. Infraestructura transversal del plano académico, sin correspondencia directa con un componente de la arquitectura de la tesis. Existe porque [ADR-002](../adr/002-keycloak-iam-federado.md) decidió Keycloak como IAM central con federación SAML/OIDC/LDAP al IdP institucional de cada universidad — y el patrón previsto era un servicio propio que encapsule las llamadas a la Admin API de Keycloak (crear realms, sincronizar usuarios LDAP, mappear claims). En la práctica el wrapper nunca se materializó: las operaciones de bootstrap se hacen via `packages/platform-ops` (scripts como `onboard-unsl`), y el plano aplicativo valida JWTs en el [api-gateway](./api-gateway.md) sin pasar por este servicio.

## 3. Responsabilidades

- **Nominalmente** (según título del `pyproject.toml` y docstring de `main.py`): wrapper de la Admin API de Keycloak + gestión de pseudonimización.
- **En la práctica** (F9): correr el proceso FastAPI con observability wireado + responder `/health`. Nada más.
- Placeholder para alojar, cuando se materialicen, los endpoints de:
  - Creación/gestión de realms Keycloak por tenant.
  - Sincronización LDAP federada READ-ONLY (condición del convenio UNSL, HU-081, HU-124).
  - Rotación de `student_pseudonym` como parte del flujo de anonimización (`packages/platform-ops/privacy.py::anonymize_student`).
  - Audit de operaciones críticas de identidad (HU-080).

## 4. Qué NO hace (anti-responsabilidades)

- **NO valida JWTs de requests**: eso lo hace [api-gateway](./api-gateway.md) en su middleware `JWTMiddleware` con `JWKS` de Keycloak. Los servicios internos confían en los headers `X-*` que inyecta el gateway.
- **NO persiste el estado de identidad**: la fuente de verdad es Keycloak (realm + users + groups + roles) + el IdP institucional via federación LDAP. Este servicio no tiene DB.
- **NO corre las operaciones de onboarding**: `make onboard-unsl` ejecuta `examples/unsl_onboarding.py` que usa las funciones de `packages/platform-ops`. El servicio no es parte de esa cadena.
- **NO implementa la pseudonimización**: vive en `packages/platform-ops/privacy.py`. La función `anonymize_student()` rota `student_pseudonym` en `academic_main.episodes` directamente (la tabla `episodes` está en el plano académico porque guarda el alias pseudonimizado, a diferencia del `ctr_store.episodes` que guarda el pseudónimo para la cadena cripto).
- **NO modifica el directorio institucional**: LDAP federation es READ-ONLY (condición del convenio UNSL). Cualquier escritura a LDAP sería una violación formal del convenio — verificada por test `HU-124`.

## 5. Endpoints HTTP

| Método | Path | Qué hace | Auth |
|---|---|---|---|
| `GET` | `/health`, `/health/ready` | Stub `{"status": "ready", "checks": {}}`. Tiene `TODO` de chequeo real de DB/Redis/Keycloak. | Ninguna. |
| `GET` | `/health/live` | Liveness trivial. | Ninguna. |

No hay otros endpoints al momento de esta documentación.

## 6. Dependencias

**Depende de (infraestructura):**
- Keycloak — nominalmente. En la práctica no hay cliente activo desde este servicio.

**Depende de (otros servicios):** ninguno.

**Dependen de él:** ninguno directamente. Los consumidores nominales (cuando se materialice) serían:
- [academic-service](./academic-service.md) — para resolver `keycloak_realm` de una universidad al crearla.
- [analytics-service](./analytics-service.md) — para la rotación de pseudónimos en el flujo del export académico.
- Scripts de onboarding — pero hoy usan directamente `packages/platform-ops`.

## 7. Modelo de datos

**No tiene DB propia**. La fuente de verdad de identidad es Keycloak (con su propia DB interna al container `keycloak` de `docker-compose.dev.yml`). Los pseudónimos derivados viven en `academic_main.episodes.student_pseudonym` (tabla propiedad de [academic-service](./academic-service.md)).

## 8. Archivos clave para entender el servicio

- `apps/identity-service/src/identity_service/main.py` — entrypoint FastAPI mínimo + CORS + observability.
- `apps/identity-service/src/identity_service/routes/health.py` — único router, con TODO pendiente.
- `apps/identity-service/src/identity_service/config.py` — settings genéricos (`keycloak_url`, `keycloak_realm` declarados pero no usados).

Archivos **relacionados que NO viven en este servicio** pero implementan lo que este servicio nominalmente debería hacer:
- `packages/platform-ops/src/platform_ops/ldap_federation.py` — `LDAPFederator` READ-ONLY (HU-081, HU-124).
- `packages/platform-ops/src/platform_ops/privacy.py` — `export_student_data()`, `anonymize_student()` (rotación de `student_pseudonym`). HU-110 (incidente I06 del runbook) usa `anonymize_student` sin tocar el CTR.
- `packages/platform-ops/src/platform_ops/onboarding.py` + `examples/unsl_onboarding.py` — bootstrap del realm UNSL + federación LDAP + feature flags (HU-063).
- `infrastructure/keycloak/realm-templates/` — templates de realms para `platform`, `demo_uni`, `test_tenant`.

## 9. Configuración y gotchas

**Env vars críticas**: ninguna específica en uso. `KEYCLOAK_URL` y `KEYCLOAK_REALM` están declaradas en `Settings` pero hoy no se consumen.

**Puerto de desarrollo**: `8001`.

**Gotchas específicos**:

- **Servicio hueco, mantener arrancado igual**: `make dev` no lo levanta (como a ningún backend). Si se quiere tener el puerto tomado para los diagnósticos del `make status`, hay que arrancarlo manual con `uv run uvicorn identity_service.main:app --port 8001 --reload`. Para el flujo mínimo del piloto NO es necesario (tutor, CTR, governance, ai-gateway, academic, api-gateway son suficientes).
- **Health check stub peligroso por el nombre**: si un operador monitorea este servicio como proxy de "Keycloak está funcionando", está leyendo mal — el `/health` no verifica Keycloak. Para health real de Keycloak hay que pegarle a `http://keycloak:8080/health` directo.
- **No confundir con api-gateway**: la validación del JWT del usuario es competencia del api-gateway (`JWTValidator` en `apps/api-gateway/`). Este servicio no participa en el path de request autenticada.
- **Realm templates versus código**: `infrastructure/keycloak/realm-templates/*.json` son la fuente de verdad de qué roles/clients existen. `make onboard-unsl` los importa via Admin API. Si se quiere cambiar el modelo de identidad (agregar rol nuevo, cambiar federación), se edita el template, no este servicio.

## 10. Relación con la tesis doctoral

El identity-service no implementa componentes de la tesis. La decisión de **IAM federado con Keycloak** ([ADR-002](../adr/002-keycloak-iam-federado.md)) es operativa: el convenio con UNSL exige que los estudiantes usen su identidad institucional (directorio LDAP de la universidad) sin que la plataforma cree cuentas paralelas. Keycloak es el middleware que lo habilita; este servicio era el wrapper previsto.

En la práctica, las tres propiedades de identidad que la tesis/piloto necesitan están sostenidas fuera de este servicio:

1. **Pseudonimización de estudiantes** (condición del comité de ética): `student_pseudonym` UUID generado en el onboarding y rotable via `anonymize_student` — implementado en `packages/platform-ops/privacy.py`.
2. **LDAP federation READ-ONLY** (condición del convenio UNSL): `LDAPFederator` en `packages/platform-ops/ldap_federation.py`, test dedicado (HU-124) verifica que no hay escrituras.
3. **Un realm por universidad** (multi-tenancy a nivel IAM): `universidades.keycloak_realm` en el modelo de [academic-service](./academic-service.md) — el realm se crea via Admin API durante `onboard-unsl`, no desde este servicio.

**Lectura para futuro**: si se quiere materializar el wrapper, el uso más claro es exponer `POST /api/v1/realms` (crear realm al crear universidad) + `POST /api/v1/users/{id}/pseudonym/rotate` (endpoint del flujo de ética). Ambas funcionalidades ya existen en `platform-ops` — moverlas a endpoints HTTP es un refactor mecánico.

## 11. Estado de madurez

**Tests** (1 archivo): `tests/test_health.py` — smoke del endpoint health.

**Known gaps**:
- **El servicio es un stub funcional**: sólo corre, no hace nada de lo que su nombre sugiere.
- `/health` es stub — no valida Keycloak.
- Las responsabilidades nominales viven dispersas entre `packages/platform-ops`, scripts de bootstrap, y realm templates de Keycloak — no hay punto único de documentación.

**Fase de consolidación**:
- F0 — scaffold inicial (`docs/F0-STATE.md`).
- F5 — platform-ops absorbió onboarding, privacy, LDAP federation — el servicio quedó sin migrar.
- F6 — `make onboard-unsl` consolidado, pero sin endpoints HTTP en este servicio.

Si el piloto UNSL se extiende a un segundo tenant (otra universidad), probablemente empuje la materialización de los endpoints que hoy son placeholder.
