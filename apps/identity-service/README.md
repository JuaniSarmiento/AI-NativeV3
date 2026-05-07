# identity-service (DEPRECATED)

**Status**: Deprecated por [ADR-041](../../docs/adr/041-deprecacion-identity-service.md), 2026-05-07.

## Por que quedo deprecated

El servicio nunca tuvo endpoints de negocio reales — solo `/health`, `/ready`, `/live`. Toda la auth de la plataforma vive en `api-gateway` (que emite headers `X-User-Id` / `X-Tenant-Id` / `X-User-Email` / `X-User-Roles`) + Casbin descentralizado en cada servicio (que carga policies de `academic_main.casbin_rules`). La pseudonimizacion vive en `packages/platform-ops/src/platform_ops/privacy.py`.

Mismo patron que `enrollment-service` (deprecated por ADR-030).

## Como revivirlo si en el futuro hace falta

Si emerge un caso de uso real (ej. wrapper REST para Keycloak Admin API que el gateway no cubra, gestion de cuentas server-side, scim provisioning), seguir estos pasos:

1. Reagregar `"apps/identity-service"` a `[tool.uv.workspace].members` en `pyproject.toml` raiz.
2. Reagregar bloque `identity-service:` (port 8001) en `infrastructure/helm/platform/values.yaml`.
3. Implementar los endpoints en `src/identity_service/routes/`.
4. Agregar al ROUTE_MAP del `api-gateway` (`apps/api-gateway/src/api_gateway/routes/proxy.py`) si los endpoints deben ser publicos para frontends.
5. Documentar en CLAUDE.md la nueva responsabilidad y marcar ADR-041 como `Superseded por ADR-XXX`.

## Por que preservamos el codigo

- Mantiene git history del servicio.
- Preserva el patron estructural FastAPI + uvicorn + structlog + observability para revival rapido.
- Cero costo de mantenimiento (no se levanta, no se sincroniza, no se testea).

## Referencias

- [ADR-041](../../docs/adr/041-deprecacion-identity-service.md) — esta decision.
- [ADR-030](../../docs/adr/030-deprecate-enrollment-service.md) — deprecacion de `enrollment-service` (mismo patron, antecedente directo).
- CLAUDE.md "Propiedades criticas" — *"api-gateway es el UNICO source of truth de identidad"*.
