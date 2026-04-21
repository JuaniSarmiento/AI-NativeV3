# Bugs detectados al levantar el piloto por primera vez en Windows

> Reporte generado durante el bootstrap inicial de la plataforma AI-Native N4 (tesis UNSL) desde un entorno Windows limpio. Los 13 bugs que siguen fueron detectados en secuencia al correr el flujo `make init` + `make dev` + `make test`, y todos fueron parcheados sobre la marcha para dejar el stack funcional. Este archivo sirve como insumo para abrir issues/PRs ordenados.

## Resumen ejecutivo

| BUG | Título | Severidad | Bloquea | Fix |
|-----|--------|-----------|---------|-----|
| BUG-01 | Pin imposible de casbin-sqlalchemy-adapter | Crítica | `uv sync` | Relajar pin a `>=1.4,<2.0` |
| BUG-02 | platform-postgres sin port mapping si 5432 está ocupado | Alta | migrate, seeds, tests integ | Liberar puerto + `--force-recreate` |
| BUG-03 | `.env.example` usa `CTR_DB_URL` en vez de `CTR_STORE_URL` | Alta | `migrate-all.sh` | Renombrar en `.env.example` |
| BUG-04 | Faltan `CLASSIFIER_DB_URL` y `CONTENT_DB_URL` en `.env.example` | Alta | `migrate-all.sh` | Agregar vars al example |
| BUG-05 | `migrate-all.sh` usa `alembic` del PATH en vez de `uv run` | Media/Alta | migrate en Windows | Prefijo `uv run` |
| BUG-06 | Migración CTR crea ROLE sin permisos | Alta | migrate ctr-service | Mover `CREATE ROLE` a `init-dbs.sql` |
| BUG-07 | SQL inválido `ALTER DATABASE current` en migración CTR | Alta | migrate ctr-service | Hardcodear nombre de DB |
| BUG-08 | Custom GUC sin `GRANT SET ON PARAMETER` (PG 15+) | Alta | migrate ctr-service | `GRANT SET ON PARAMETER` en init |
| BUG-09 | `down_revision` de classifier apunta a otro servicio | Crítica | migrate classifier | `down_revision = None` |
| BUG-10 | `down_revision` de content apunta a otro servicio | Crítica | migrate content | `down_revision = None` |
| BUG-11 | Seed Casbin rompe por `UnicodeEncodeError` en cp1252 | Alta | seed policies | `PYTHONUTF8=1` o reconfigure stdout |
| BUG-12 | `packages/observability` fuera del uv workspace | Crítica | boot de 12 servicios | Agregar a `[tool.uv.workspace]` |
| BUG-13 | `packages/platform-ops` fuera del uv workspace | Alta | boot analytics-service | Agregar a `[tool.uv.workspace]` |
| BUG-14 | Falta `aiosqlite` en deps de test de `packages/platform-ops` | Media | tests unit de platform-ops | Agregar `aiosqlite` y `sqlalchemy` a dep-groups dev |
| BUG-15 | `vitest run` sale con exit 1 cuando no hay test files | Baja | `make test` (paso TS) / turbo | `--passWithNoTests` o test placeholder |
| BUG-16 | `set_tenant_rls` usa bind parameter en `SET LOCAL` | Crítica | analytics-service en runtime | Interpolar UUID en f-string |
| BUG-17 | Policies RLS duplicadas en `ctr_store` | Crítica | cualquier query a ctr sin SET LOCAL previo | Drop de policies viejas en migración |

**Totales**: 17 bugs (6 Críticas + 8 Altas + 1 Media/Alta + 1 Media + 1 Baja).

## Bugs

### BUG-01 — Relajar pin imposible de casbin-sqlalchemy-adapter
**Severidad**: Crítica
**Tipo**: Dependencia
**Bloqueante para**: `uv sync` (y por ende todo el resto del bootstrap)
**Plataforma**: Ambos

**Síntoma observado**:
```
× No solution found when resolving dependencies:
  Because only casbin-sqlalchemy-adapter<=1.4.0 is available and
  platform-academic-service depends on casbin-sqlalchemy-adapter>=1.5,
  we can conclude that platform-academic-service's requirements are unsatisfiable.
```

**Causa raíz**:
El pin `>=1.5` no existe en PyPI. El último release publicado del adapter es `1.4.0` (hace más de un año). El resolver de uv no puede satisfacer el requirement.

**Ubicación**:
- `apps/academic-service/pyproject.toml`: línea 24

**Fix aplicado durante el bootstrap**:
```diff
- "casbin-sqlalchemy-adapter>=1.5",
+ "casbin-sqlalchemy-adapter>=1.4,<2.0",
```

**Recomendación para PR**:
Validar que el código del seed (`apps/academic-service/src/academic_service/seeds/casbin_policies.py`) funcione con 1.4.0. Si el pin original a 1.5 fue por alguna feature específica, documentar en un ADR qué feature y por qué. Alternativa más drástica: forkear el adapter y publicar una versión 1.5 propia bajo `platform-casbin-sqlalchemy-adapter`. Agregar test que cargue las policies contra la versión pineada para evitar regresiones.

---

### BUG-02 — Detectar port conflict en 5432 antes de `docker compose up`
**Severidad**: Alta
**Tipo**: Config
**Bloqueante para**: migrate, seeds, tests de integración, boot de todos los servicios Python
**Plataforma**: Windows (más frecuente; también puede pasar en Linux)

**Síntoma observado**:
`docker ps` muestra el container `platform-postgres` con `5432/tcp` (interno) sin mapeo al host. `docker port platform-postgres` devuelve vacío. Clientes externos (alembic, psql, tests) reciben `ConnectionRefusedError` contra `localhost:5432`.

**Causa raíz**:
`docker compose up -d` no falla si el port bind entra en conflicto: crea el container sin el mapeo pedido y sigue de largo. En Windows es común tener Postgres del sistema (servicio nativo) o containers de otros proyectos ocupando 5432.

**Ubicación**:
- `infrastructure/docker-compose.dev.yml`: servicio `postgres`

**Fix aplicado durante el bootstrap**:
```bash
docker stop <container_ajeno>
docker compose -f infrastructure/docker-compose.dev.yml up -d --force-recreate postgres
```

**Recomendación para PR**:
En `make dev-bootstrap`, antes de `docker compose up -d`, chequear que el 5432 esté libre:
```bash
if nc -z localhost 5432 2>/dev/null; then
  echo "ERROR: Port 5432 ocupado. Liberalo o detené el servicio que lo usa."
  exit 1
fi
```
Alternativa: documentar el troubleshooting en `docs/onboarding.md` con el procedimiento para identificar el proceso (`netstat -ano | findstr 5432` en Windows, `lsof -i :5432` en Unix).

---

### BUG-03 — Renombrar `CTR_DB_URL` a `CTR_STORE_URL` en `.env.example`
**Severidad**: Alta
**Tipo**: Config
**Bloqueante para**: `scripts/migrate-all.sh`
**Plataforma**: Ambos

**Síntoma observado**:
```
ERROR: variable CTR_STORE_URL no seteada
```
al correr `./scripts/migrate-all.sh`.

**Causa raíz**:
Inconsistencia entre el nombre declarado en `.env.example` (`CTR_DB_URL`) y el nombre que los scripts y el `CLAUDE.md` usan (`CTR_STORE_URL`). El `CLAUDE.md` documenta `CTR_STORE_URL` correctamente.

**Ubicación**:
- `.env.example`: línea con `CTR_DB_URL=...`
- `scripts/migrate-all.sh`: líneas 9 y 45 (`_require_env CTR_STORE_URL`)

**Fix aplicado durante el bootstrap**:
Agregué `CTR_STORE_URL` al `.env` local (sin tocar el `.env.example`).

**Recomendación para PR**:
Renombrar en `.env.example` de `CTR_DB_URL` a `CTR_STORE_URL`. Si se quiere mantener retrocompatibilidad, que el script acepte cualquiera de los dos nombres:
```bash
: "${CTR_STORE_URL:=${CTR_DB_URL:-}}"
_require_env CTR_STORE_URL
```
Pero mejor: un solo nombre, consistente con el ADR-003 ("ctr_store" es el nombre canónico de la base).

---

### BUG-04 — Declarar `CLASSIFIER_DB_URL` y `CONTENT_DB_URL` en `.env.example`
**Severidad**: Alta
**Tipo**: Config
**Bloqueante para**: `scripts/migrate-all.sh` (no corre hasta el final)
**Plataforma**: Ambos

**Síntoma observado**:
Mismo tipo que BUG-03, pero para classifier y content:
```
ERROR: variable CLASSIFIER_DB_URL no seteada
ERROR: variable CONTENT_DB_URL no seteada
```

**Causa raíz**:
`scripts/migrate-all.sh` exige cuatro env vars (`ACADEMIC_DB_URL`, `CTR_STORE_URL`, `CLASSIFIER_DB_URL`, `CONTENT_DB_URL`) pero `.env.example` define sólo tres — ninguna de las últimas dos.

**Ubicación**:
- `.env.example`

**Fix aplicado durante el bootstrap**:
Agregué ambas al `.env` local:
```
CLASSIFIER_DB_URL=postgresql+asyncpg://classifier_user:classifier_pass@localhost:5432/classifier_db
CONTENT_DB_URL=postgresql+asyncpg://content_user:content_pass@localhost:5432/content_db
```

**Recomendación para PR**:
Agregarlas a `.env.example` con los mismos valores default que usa `infrastructure/postgres/init-dbs.sql` (users y passwords). Validar que los servicios realmente leen exactamente esos nombres de env var (no `CLASSIFIER_STORE_URL` o alguna variante). Agregar al CI un check que lea el `.env.example` y valide que todas las vars requeridas por los scripts están declaradas.

---

### BUG-05 — Invocar `alembic` vía `uv run` en `migrate-all.sh`
**Severidad**: Media en Linux, Alta en Windows
**Tipo**: Script
**Bloqueante para**: `make migrate` en Windows
**Plataforma**: Windows crítico; Linux dependiendo del PATH

**Síntoma observado**:
`ModuleNotFoundError` en imports del propio proyecto. El traceback muestra rutas del estilo `C:\Users\...\Python\pythoncore-3.14-64\Lib\...` — es el Python del sistema, NO el `.venv` del proyecto.

**Causa raíz**:
El script hace `alembic current` y `alembic upgrade head` directo. En Windows, `alembic` en el PATH resuelve al Python del sistema, que no tiene el proyecto instalado. El `Makefile` en cambio usa `$(UV)` que envuelve todo en `uv run`, respetando el `.venv` del workspace.

**Ubicación**:
- `scripts/migrate-all.sh`: líneas 67-69

**Fix aplicado durante el bootstrap**:
Workaround: `source .venv/Scripts/activate` antes de correr el script.

**Recomendación para PR**:
Cambiar en el script:
```diff
- alembic current
- alembic upgrade head
+ uv run alembic current
+ uv run alembic upgrade head
```
Equivalente a lo que hace el resto del `Makefile`. Si preocupa el overhead de `uv run` por invocación, cachear con `uv run --no-sync` dentro del loop. Agregar smoke test al CI que corra `./scripts/migrate-all.sh` contra un Postgres de test sin activar venv, para detectar regresiones en Windows.

---

### BUG-06 — Mover `CREATE ROLE platform_app` a `init-dbs.sql`
**Severidad**: Alta
**Tipo**: Migración
**Bloqueante para**: migrate de ctr-service
**Plataforma**: Ambos

**Síntoma observado**:
```
sqlalchemy.exc.ProgrammingError: ... InsufficientPrivilegeError:
permission denied to create role
```
al ejecutar `CREATE ROLE platform_app NOLOGIN` dentro de la migración.

**Causa raíz**:
La migración se ejecuta como `ctr_user` (owner de `ctr_store`), que no tiene `CREATEROLE`. En Postgres, sólo un superuser (`postgres`) o un role con `CREATEROLE` explícito puede crear nuevos roles. Ser owner de una DB no alcanza.

**Ubicación**:
- `apps/ctr-service/alembic/versions/20260721_0002_enable_rls_on_ctr_tables.py`: línea 46

**Fix aplicado durante el bootstrap**:
```bash
docker exec platform-postgres psql -U postgres -c "CREATE ROLE platform_app NOLOGIN;"
```
como superuser, antes de correr migrate.

**Recomendación para PR**:
Mover la creación del role `platform_app` desde esta migración a `infrastructure/postgres/init-dbs.sql` (que ya corre como superuser en el `docker-entrypoint-initdb.d`). En la migración, sólo verificar que el role exista y hacer los `GRANT` / `ALTER`:
```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_app') THEN
    RAISE EXCEPTION 'Role platform_app no existe. Corré init-dbs.sql primero.';
  END IF;
END $$;
```
Agregar test que ejecute la migración contra una DB recién inicializada desde cero — es la mejor forma de detectar esto en CI.

---

### BUG-07 — Reemplazar `ALTER DATABASE current` por el nombre real de la DB
**Severidad**: Alta
**Tipo**: Migración
**Bloqueante para**: migrate de ctr-service (después de resolver BUG-06)
**Plataforma**: Ambos

**Síntoma observado**:
```
sqlalchemy.exc.DBAPIError: ... InvalidCatalogNameError:
database "current" does not exist
```
al ejecutar literalmente `ALTER DATABASE current SET app.current_tenant = ''`.

**Causa raíz**:
`current` NO es una palabra clave de Postgres en `ALTER DATABASE`. Alguien la confundió con `CURRENT_DATABASE` (función), pero ni siquiera esa sintaxis funciona en `ALTER DATABASE` — hay que hardcodear el nombre real o usar `EXECUTE` dinámico.

**Ubicación**:
- `apps/ctr-service/alembic/versions/20260721_0002_enable_rls_on_ctr_tables.py`: línea 74

**Fix aplicado durante el bootstrap**:
```diff
- ALTER DATABASE current SET app.current_tenant = ''
+ ALTER DATABASE ctr_store SET app.current_tenant = ''
```

**Recomendación para PR**:
El fix aplicado (hardcodear el nombre) es correcto y explícito. Si se quiere mayor robustez y que la migración funcione contra cualquier nombre de DB (útil para tests con `testcontainers`), usar un bloque `DO` con `EXECUTE` y `current_database()`:
```sql
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET app.current_tenant = %L',
                 current_database(), '');
END $$;
```
Agregar smoke test que corra toda la cadena de migraciones en un Postgres nuevo (cada servicio, en orden).

---

### BUG-08 — `GRANT SET ON PARAMETER app.current_tenant` a users por tenant
**Severidad**: Alta
**Tipo**: Config Postgres
**Bloqueante para**: migrate ctr-service (después de BUG-07)
**Plataforma**: Ambos (Postgres 15+)

**Síntoma observado**:
```
InsufficientPrivilegeError: permission denied to set parameter "app.current_tenant"
```
al ejecutar `ALTER DATABASE ctr_store SET app.current_tenant = ''`.

**Causa raíz**:
Desde Postgres 15, los parámetros custom (namespaced `app.*`) requieren el privilegio explícito `SET ON PARAMETER` para usuarios no-superuser. Ser owner de la DB no alcanza — es un privilegio separado introducido en la 15.

**Ubicación**:
- La instrucción aparece en varias migraciones: `apps/ctr-service/...`, `apps/classifier-service/...`, `apps/content-service/...` (todas las que habilitan RLS con GUC custom).

**Fix aplicado durante el bootstrap**:
```bash
docker exec platform-postgres psql -U postgres -c \
  "GRANT SET ON PARAMETER app.current_tenant TO ctr_user, classifier_user, content_user, academic_user;"
```

**Recomendación para PR**:
Mover ese `GRANT` a `infrastructure/postgres/init-dbs.sql` (corre como superuser en el init). Documentar en `ADR-001` (multi-tenancy RLS) la dependencia explícita de Postgres 15+ y este privilegio — hoy el ADR probablemente no lo menciona. Si el piloto quisiera soportar PG 14, habría que rediseñar el mecanismo de current_tenant (por ejemplo, `SET LOCAL` sin `ALTER DATABASE` persistente), pero para el piloto UNSL PG 16 ya está fijado en el docker-compose.

---

### BUG-09 — Corregir `down_revision` roto en classifier-service
**Severidad**: Crítica
**Tipo**: Migración
**Bloqueante para**: migrate de classifier-service (cadena alembic rota)
**Plataforma**: Ambos

**Síntoma observado**:
```
KeyError: '20260720_0001'
```
al correr `alembic upgrade head` en classifier-service.

**Causa raíz**:
Scaffolding cruzado: alguien copió un archivo de migration de otro servicio y no ajustó el `down_revision`. La revision `20260720_0001` existe en ctr-service, pero **cada servicio tiene su propia tabla `alembic_version` en su propia base** — no puede (ni debe) apuntar a revisiones de otros servicios.

**Ubicación**:
- `apps/classifier-service/alembic/versions/20260901_0001_classifier_schema.py`: línea 18

**Fix aplicado durante el bootstrap**:
```diff
- down_revision: str | None = "20260720_0001"
+ down_revision: str | None = None
```
(es la primera migration del classifier, así que `None` es correcto).

**Recomendación para PR**:
El fix es correcto. Agregar validación al CI: `uv run alembic check` en cada servicio, que detecta cadenas rotas. También un test unitario por servicio que haga:
```python
from alembic.config import Config
from alembic.script import ScriptDirectory

def test_alembic_chain_integrity():
    cfg = Config("alembic.ini")
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    assert len(heads) == 1, f"Multiple heads: {heads}"
    # Walk de raíz a head sin excepciones
    list(script.walk_revisions())
```
Esto detecta cross-references cruzadas, múltiples heads y revisiones huérfanas.

---

### BUG-10 — Corregir `down_revision` roto en content-service
**Severidad**: Crítica
**Tipo**: Migración
**Bloqueante para**: migrate de content-service
**Plataforma**: Ambos

**Síntoma observado**:
Idem BUG-09, pero `KeyError: '20260420_0001'`.

**Causa raíz**:
Misma causa que BUG-09: el `down_revision` `20260420_0001` existe en academic-service, no en content. Es otro caso de scaffolding cruzado — la primera migration de content apunta por error a una revision de otra base.

**Ubicación**:
- `apps/content-service/alembic/versions/20260521_0001_content_schema_with_rls.py`: línea 19

**Fix aplicado durante el bootstrap**:
```diff
- down_revision: str | None = "20260420_0001"
+ down_revision: str | None = None
```

**Recomendación para PR**:
Idem BUG-09 — mismo fix, mismos tests. Vale la pena auditar el resto de las migraciones iniciales de cada servicio (`grep -r "down_revision" apps/*/alembic/versions/` y verificar que todas las "primeras" sean `None`).

---

### BUG-11 — Hacer el seed de Casbin UTF-8-safe en Windows
**Severidad**: Alta
**Tipo**: Código / compatibilidad Windows
**Bloqueante para**: seed de policies (silenciosamente — el rollback deja la DB con 0 policies)
**Plataforma**: Windows (en Linux stdout ya es UTF-8 por default)

**Síntoma observado**:
```
UnicodeEncodeError: 'charmap' codec can't encode character '\u2713'
in position 0: character maps to <undefined>
```
al hacer `print(f"✓ {count} policies...")` al final del seed.

**Causa raíz**:
En Windows, `print()` usa el stdout default que es `cp1252` (windows-1252) y no soporta el carácter `✓` (U+2713). La excepción se propaga por fuera del `async with engine.begin()`, que rollbackea el `INSERT` de policies — el script reporta éxito parcial pero la DB queda vacía. Lo peor: **falla silenciosa** (el error aparece después del commit aparente).

**Ubicación**:
- `apps/academic-service/src/academic_service/seeds/casbin_policies.py`: línea 145

**Fix aplicado durante el bootstrap**:
```bash
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1
```
antes de correr el seed.

**Recomendación para PR**:
Varias opciones (elegir una):
1. **Recomendada**: En el script, al principio:
   ```python
   import sys
   sys.stdout.reconfigure(encoding='utf-8')  # Python 3.7+
   ```
   La más robusta — no depende de env vars del usuario.
2. Cambiar `print(f"✓ ...")` por `print(f"[OK] ...")` (ASCII-safe). Menos lindo pero cero dependencias.
3. Agregar `PYTHONUTF8 = "1"` al `.env.example` y al `Makefile`.

La opción 1 es la más sólida. Además, correr el seed en CI desde un runner Windows para detectar regresiones de este tipo en el resto de scripts Python.

**Nota adicional**: el rollback silencioso es el bug subyacente más grave. El script debería hacer `commit` antes de imprimir, o envolver el `print` en un `try/except` que no rompa la transacción.

---

### BUG-12 — Agregar `packages/observability` al uv workspace
**Severidad**: Crítica
**Tipo**: Workspace
**Bloqueante para**: boot de los 12 servicios Python
**Plataforma**: Ambos

**Síntoma observado**:
Los 12 servicios Python crashean en startup con:
```
ModuleNotFoundError: No module named 'platform_observability'
```

**Causa raíz**:
`packages/observability/` existe con su `pyproject.toml` (`name = "platform-observability"`) y su código Python funcional, pero **NO está listado** en `[tool.uv.workspace].members` del `pyproject.toml` raíz. Por eso `uv sync` no lo instala en el `.venv` compartido. Sin instalarlo, cualquier `from platform_observability import setup_observability as _setup` rompe al arranque.

**Ubicación**:
- `pyproject.toml` raíz: secciones `[tool.uv.workspace]` y `[tool.uv.sources]`

**Fix aplicado durante el bootstrap**:
```diff
 [tool.uv.workspace]
 members = [
   ...
   "packages/contracts",
   "packages/test-utils",
+  "packages/observability",
 ]

 [tool.uv.sources]
   ...
+platform-observability = { workspace = true }
```

**Recomendación para PR**:
El fix es correcto. Agregar test de smoke al CI:
```bash
uv run python -c "from platform_observability import setup_observability; from platform_ops import ctx; print('OK')"
```
para detectar packages que se olviden del workspace. Idealmente, cada uno de los 12 servicios debería declarar `platform-observability` explícitamente en sus `dependencies` de `pyproject.toml` (hoy dependen transitivamente del workspace, lo cual es frágil).

---

### BUG-13 — Agregar `packages/platform-ops` al uv workspace
**Severidad**: Alta
**Tipo**: Workspace
**Bloqueante para**: boot de analytics-service
**Plataforma**: Ambos

**Síntoma observado**:
analytics-service crashea al importar rutas:
```
ModuleNotFoundError: No module named 'platform_ops'
```

**Causa raíz**:
Misma que BUG-12, pero para `packages/platform-ops/` (con `name = "platform-ops"` en su `pyproject.toml`). No estaba declarado en el workspace raíz.

**Ubicación**:
- `pyproject.toml` raíz: secciones `[tool.uv.workspace]` y `[tool.uv.sources]`

**Fix aplicado durante el bootstrap**:
```diff
 [tool.uv.workspace]
 members = [
   ...
   "packages/observability",
+  "packages/platform-ops",
 ]

 [tool.uv.sources]
   ...
+platform-ops = { workspace = true }
```

**Recomendación para PR**:
Idem BUG-12 — mismo test de smoke. Auditoría complementaria de `ls packages/` real:
- `auth-client` — TypeScript (pnpm workspace)
- `contracts` — Python + TypeScript (ya en uv workspace)
- `ctr-client` — TypeScript
- `observability` — Python (incorporado en BUG-12)
- `platform-ops` — Python (incorporado en BUG-13)
- `test-utils` — Python (ya en uv workspace)
- `ui` — TypeScript

Los 4 packages Python (`contracts`, `test-utils`, `observability`, `platform-ops`) deben estar en `[tool.uv.workspace].members`. Actualmente — con los fixes de BUG-12 y BUG-13 — los 4 están. Mantener un test que compare `packages/*/pyproject.toml` contra `[tool.uv.workspace].members` para prevenir regresiones.

---

### BUG-14 — Falta `aiosqlite` en deps de test de `packages/platform-ops`
**Severidad**: Media
**Tipo**: Dependencia
**Bloqueante para**: tests unit de `packages/platform-ops`
**Plataforma**: Ambos

**Síntoma observado**:
```
ModuleNotFoundError: No module named 'aiosqlite'
```
al intentar `create_async_engine("sqlite+aiosqlite:///:memory:")` en el fixture. 10 tests de `test_real_datasources.py` daban ERROR en setup (no failures).

**Causa raíz**:
Los tests usan SQLite in-memory para probar lógica de datasources sin Postgres. Pero `aiosqlite` (driver async) no estaba declarado en `[dependency-groups].dev` del pyproject. Antes del fix, ese grupo sólo tenía `pytest`, `pytest-asyncio` y `respx`.

**Ubicación**:
- `packages/platform-ops/pyproject.toml`: `[dependency-groups].dev`

**Fix aplicado durante el bootstrap**:
```diff
 dev = [
     "pytest>=8.3",
     "pytest-asyncio>=0.24",
     "respx>=0.21",
+    "aiosqlite>=0.20",
+    "sqlalchemy>=2.0",
 ]
```

**Recomendación para PR**:
El fix aplicado es correcto. Agregar un test de smoke al CI que importe fixtures críticos (`create_async_engine`) así estos errores de deps faltantes se detectan sin correr toda la suite.

---

### BUG-15 — `vitest run` sale con exit 1 cuando no hay test files
**Severidad**: Baja (no bloquea features, rompe `turbo test` / CI)
**Tipo**: Script / configuración
**Bloqueante para**: `make test` en su paso TypeScript (`pnpm turbo test`)
**Plataforma**: Ambos (más notable en Windows porque no hay tests aún)

**Síntoma observado**:
```
No test files found, exiting with code 1
```
en `@platform/ctr-client:test`. Turbo corta el pipeline apenas uno falla → `make test` marca fail aunque los 320 tests Python pasen.

**Causa raíz**:
Los 4 paquetes TypeScript con script `test: "vitest run"` (`web-student`, `web-teacher`, `web-admin`, `ctr-client`) no tienen todavía archivos `.test.ts*` ni `.spec.ts*`. `vitest run` en ese caso sale con exit 1 por default.

**Ubicación**:
- `apps/web-student/package.json`
- `apps/web-teacher/package.json`
- `apps/web-admin/package.json`
- `packages/ctr-client/package.json`
(campo `"scripts"."test"` en los cuatro)

**Fix aplicado durante el bootstrap**:
Ninguno (pendiente). Workaround manual: skippear el paso TS durante pruebas.

**Recomendación para PR**:
Dos opciones razonables:
1. Cambiar en cada `package.json`: `"test": "vitest run"` → `"test": "vitest run --passWithNoTests"`. Soluciona el fail pero oculta el hecho de que no hay tests.
2. Agregar un test placeholder (`tests/smoke.test.ts` con `it('smoke', () => expect(true).toBe(true))`) hasta que se escriban los reales. Más explícito — deja visible que falta cobertura.

La opción 2 es la más honesta para un piloto académico donde la falta de tests frontend es deuda conocida.

---

### BUG-16 — `set_tenant_rls` usa bind parameter en `SET LOCAL` (CRÍTICO para la tesis)
**Severidad**: Crítica (rompe en runtime el invariante ADR-001 multi-tenancy)
**Tipo**: Código
**Bloqueante para**: cualquier request que ejecute `analytics-service/routes/analytics.py` o `analytics-service/services/export.py` — esos dos callsites son los únicos que invocan `set_tenant_rls()` en runtime.
**Plataforma**: Ambos

**Síntoma observado**:
```
sqlalchemy.exc.ProgrammingError: ... PostgresSyntaxError:
syntax error at or near "$1"
[SQL: SET LOCAL app.current_tenant = $1]
```
al ejecutar tests RLS o cualquier request que use analytics.

**Causa raíz**:
Postgres **no admite bind parameters en utility statements** como `SET`. El código hacía:
```python
text("SET LOCAL app.current_tenant = :tid"),
{"tid": str(tenant_id)}
```
Eso genera `SET LOCAL ... = $1` al preparar el statement, y Postgres lo rechaza.

**Ubicación**:
- `packages/platform-ops/src/platform_ops/real_datasources.py:232`

**Fix aplicado durante el bootstrap**:
Interpolación f-string del UUID (seguro porque `tenant_id: UUID` viene validado por type — no puede contener comillas o caracteres SQL):
```diff
-await session.execute(
-    text("SET LOCAL app.current_tenant = :tid"),
-    {"tid": str(tenant_id)},
-)
+# SET LOCAL no admite bind parameters (Postgres utility statement).
+# Interpolamos literal: tenant_id es UUID validado por type hint,
+# no puede contener comillas ni caracteres que inyecten SQL.
+await session.execute(text(f"SET LOCAL app.current_tenant = '{tenant_id}'"))
```

**Impacto sin el fix**: el mecanismo RLS **nunca funcionaba en runtime**. Cualquier request de `/analytics/cohort/{id}/progression`, `/analytics/cohort/export`, o los callsites internos de `export.py` tira 500. Los tests unit no lo detectaban (mocks). Los tests RLS **estaban skipped** por default en CI porque requieren `CTR_STORE_URL_FOR_RLS_TESTS`. Bug dormido esperando producción.

**Recomendación para PR**:
1. Mergear el fix aplicado.
2. **Habilitar los tests RLS en CI** (setear `CTR_STORE_URL_FOR_RLS_TESTS` en el workflow). Sin esto, bugs similares se escapan.
3. Agregar un comentario sobre la restricción de Postgres con un link a la doc oficial ([postgres docs SET](https://www.postgresql.org/docs/current/sql-set.html)).
4. Test de regresión: el que ya existe en `test_rls_postgres.py` cubre esto; mantener el gate de CI.

---

### BUG-17 — Policies RLS duplicadas en `ctr_store` (CRÍTICO para la tesis)
**Severidad**: Crítica (rompe el fail-safe de RLS — sin SET LOCAL, la query no devuelve vacío sino que CRASHEA)
**Tipo**: Migración
**Bloqueante para**: cualquier query a `episodes`, `events`, `dead_letters` de `ctr_store` ejecutada sin un `SET LOCAL app.current_tenant` previo. En vez del comportamiento fail-safe (ver 0 filas), el servicio tira `InvalidTextRepresentationError: invalid input syntax for type uuid: ""`.
**Plataforma**: Ambos

**Síntoma observado**:
```
sqlalchemy.exc.DBAPIError: ... InvalidTextRepresentationError:
invalid input syntax for type uuid: ""
[SQL: SELECT COUNT(*) FROM episodes]
```

**Causa raíz**:
Dos sets de policies coexistiendo en cada tabla de ctr. Inspección SQL:
```
tenant_isolation               | USING (tenant_id = current_setting(...)::uuid)    ← vieja, rompe
tenant_isolation_<tabla>       | USING ((tenant_id)::text = current_setting(...))  ← nueva, fail-safe
```
La migración inicial `20260720_0001_ctr_initial_schema.py` crea las policies con nombre genérico `tenant_isolation` usando cast `::uuid` (que explota cuando `current_setting` es `''`). La migración posterior `20260721_0002_enable_rls_on_ctr_tables.py` crea nuevas policies fail-safe con nombres distintos (`tenant_isolation_<tabla>`) pero **nunca dropea las viejas**. Ambas conviven; Postgres evalúa las dos y la vieja rompe antes de llegar a la nueva.

**Ubicación**:
- `apps/ctr-service/alembic/versions/20260720_0001_ctr_initial_schema.py` (creó las viejas rotas)
- `apps/ctr-service/alembic/versions/20260721_0002_enable_rls_on_ctr_tables.py` (creó las nuevas pero no dropeó las viejas)

**Fix aplicado durante el bootstrap**:
Drop manual como superuser:
```sql
DROP POLICY tenant_isolation ON episodes;
DROP POLICY tenant_isolation ON events;
DROP POLICY tenant_isolation ON dead_letters;
```

**Recomendación para PR** (tres caminos posibles, elegir uno):
1. **Editar la migración `0001`**: cambiar la policy original para usar `tenant_id::text = current_setting(...)` (fail-safe). Después de eso, la `0002` es redundante (sus policies duplican lo que ya hace la `0001`). Mergear las dos migraciones en una sola.
2. **Agregar DROP en la `0002`**: antes de crear las policies nuevas, hacer `DROP POLICY IF EXISTS tenant_isolation ON {tabla}`. Camino conservador que no toca la migración vieja pero limpia el legado.
3. **Nueva migración `0003`** que sólo hace el drop. Menos elegante pero más trazable.

La opción 1 es la más limpia; la 2 es la más segura si la `0001` ya está desplegada en algún ambiente. Hay que discutir antes de mergear.

**Notas adicionales**:
- Este bug **se esconde por completo en los tests con mocks**. Solo aparece contra Postgres real.
- Los tests RLS (`test_rls_postgres.py`) lo detectan — pero están skipped por default en CI por la env var.
- **Propuesta CI**: agregar un job nightly que corre con `CTR_STORE_URL_FOR_RLS_TESTS` seteado contra un Postgres efímero (docker run + migrate + tests). Detecta bugs de este tipo.

---

## Issues conocidos (no-bugs)

Estos puntos no son bugs bloqueantes, pero sí fricciones reales detectadas durante el bootstrap que deberían ir a `docs/onboarding.md` o resolverse en PRs menores.

1. **`scripts/check-health.sh` usa `localhost` en vez de `127.0.0.1`**: en Windows, `localhost` resuelve IPv6 (`::1`) primero. Si hay otros containers ocupando los puertos (como `integrador_backend` en `:8000`), el `curl` pega al container ajeno y marca falso "no responde". Fix recomendado: reemplazar `localhost` por `127.0.0.1` en el script — 1 cambio en 2 líneas.

2. **`CLAUDE.md` dice 65 policies Casbin; son realmente 75**: el seed carga 75 policies verificadas vs las 65 que menciona el `CLAUDE.md` (y `reglas.md` en el bloque `⚠ Verificar`). Actualizar ambos docs con el número correcto; si se agregan policies en el futuro, el seed debería imprimir el count y el doc referenciarlo dinámicamente (por ejemplo, generar la tabla desde el archivo de policies).

3. **`make` no viene en Git Bash por default en Windows**: los devs Windows tienen que instalar make vía `choco install make`, `scoop install make`, o correr los comandos del `Makefile` a mano. Mencionar en `docs/onboarding.md` que en Windows **se recomienda WSL** (Ubuntu 22.04+) para el piloto — los targets del `Makefile` asumen bash POSIX-compliant, y el stack completo corre más rápido en WSL que en Git Bash nativo.

4. **`corepack enable` requiere admin en Windows si Node está en `C:\Program Files\nodejs`**: workaround documentado:
   ```bash
   corepack enable --install-directory "$HOME/.local/bin"
   ```
   y asegurarse que `$HOME/.local/bin` esté en el PATH. Mencionar en onboarding junto con la recomendación de instalar Node con `fnm` o `volta` bajo `$HOME` para evitar el problema de root.

5. **Test `governance-service::test_load_sin_manifest_calcula_hash` falla en Windows por `UnicodeDecodeError`**: un archivo de fixture fue guardado en Latin-1 en vez de UTF-8. El test crashea al leerlo sin `encoding` explícito. **Workaround confirmado**: `export PYTHONIOENCODING=utf-8 PYTHONUTF8=1` antes de correr pytest hace pasar el test. Aplicar de forma permanente en `.env.example` o en el Makefile (ya pedimos esto en BUG-11 también). Con el fix de encoding aplicado, los 320 tests Python pasan limpios (incluido ese que antes fallaba). Fix de fondo: re-guardar el fixture con encoding UTF-8 y forzar `open(path, encoding='utf-8')` en el código de carga. Relacionado con BUG-11 — la plataforma entera debería ser UTF-8-only por default, y el CI debería validar que no haya archivos non-UTF-8 (`scripts/check-encoding.sh`).

6. **Los 12 servicios Python NO están integrados en `turbo`**: `make dev` sólo levanta los 3 frontends (web-student, web-teacher, web-admin). El `CLAUDE.md` actual menciona "12 servicios + 3 frontends" con `make dev` pero **en realidad los Python hay que arrancarlos a mano** con `uv run uvicorn <pkg>.main:app --port <n>`. Dos opciones:
   - Documentar bien en el `CLAUDE.md` y en `docs/onboarding.md` que hay que levantar los Python por separado, dando el comando exacto por servicio.
   - Agregar un script `scripts/start-all-services.sh` (o `Procfile` + `honcho` / `overmind`) que los lance en paralelo con logs prefijados y manejo de Ctrl+C. Esta es la opción saludable — el dev loop actual es hostil para onboarding.

---

## Próximos pasos recomendados

Ordenados por prioridad (los primeros bloquean el siguiente onboarding en Windows; los últimos son mejoras de DX):

1. **Fixes de workspace y dependencias** (BUG-01, BUG-12, BUG-13) — sin esto, `uv sync` no termina y nada arranca. Prioridad máxima.
2. **Fixes de migraciones** (BUG-06, BUG-07, BUG-08, BUG-09, BUG-10) — bloquean `make migrate` y por ende la primera puesta en marcha de cualquier base. Agregar `uv run alembic check` al CI.
3. **Fixes de `.env.example` y scripts** (BUG-03, BUG-04, BUG-05) — cero cambios de código, 5 minutos de trabajo, altísimo impacto para un dev nuevo.
4. **Fix UTF-8 del seed Casbin** (BUG-11) — crítico en Windows, silenciosamente deja la DB sin policies. Opción 1 del fix (reconfigure stdout) es la correcta.
5. **Detección de port conflict en `dev-bootstrap`** (BUG-02) — evita media hora de debugging al primer dev que tenga Postgres local.
6. **Integrar los 12 servicios Python en `make dev`** (issue no-bug #6) — cambio de mayor alcance pero el que más mejora el onboarding; hoy el `make dev` documentado no hace lo que dice.
7. **Normalización UTF-8 global** (BUG-11 + issue no-bug #5) — una pasada por todo el repo con un check en CI.
8. **Actualizar `docs/onboarding.md`** con todas las fricciones Windows (issues no-bug #1, #3, #4) y mencionar explícitamente la recomendación de WSL.
9. **Agregar ADR** que documente Postgres 15+ como requerimiento (BUG-08) y el manejo del role `platform_app` (BUG-06).
10. **CI smoke test end-to-end** que haga `make init` + `make migrate` + boot de todos los servicios en un runner Windows — hoy nada valida que el bootstrap inicial funcione en la plataforma del piloto.
