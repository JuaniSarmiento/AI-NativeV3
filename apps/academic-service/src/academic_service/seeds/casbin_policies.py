"""Seeds de la matriz de permisos Casbin.

Se ejecuta una vez después de las migraciones iniciales. Idempotente.
La matriz replica la tabla del documento de arquitectura sección 6.2.

Uso:
    python -m academic_service.seeds.casbin_policies
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# Permitir ejecutar como script desde la raíz del servicio
SRC = Path(__file__).parent.parent.parent
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


# Matriz de permisos (sujeto, recurso, acción)
# "sub" es role:<rol>. Casbin resuelve la pertenencia via g (role inheritance),
# pero para simplicidad F1 definimos las policies directamente sobre role:<nombre>.
# En F5 el matcher se extiende para verificar comisiones específicas.
POLICIES: list[tuple[str, str, str, str]] = [
    # ── Superadmin: todo ──────────────────────────────────────────────
    # (superadmin bypasa en check_permission, pero mantenemos policies
    # explícitas para documentación y para que el test de matriz pase)
    ("role:superadmin", "*", "universidad:*", "create"),
    ("role:superadmin", "*", "universidad:*", "read"),
    ("role:superadmin", "*", "universidad:*", "update"),
    ("role:superadmin", "*", "universidad:*", "delete"),
    ("role:superadmin", "*", "facultad:*", "create"),
    ("role:superadmin", "*", "facultad:*", "read"),
    ("role:superadmin", "*", "facultad:*", "update"),
    ("role:superadmin", "*", "facultad:*", "delete"),
    ("role:superadmin", "*", "carrera:*", "create"),
    ("role:superadmin", "*", "carrera:*", "read"),
    ("role:superadmin", "*", "carrera:*", "update"),
    ("role:superadmin", "*", "carrera:*", "delete"),
    ("role:superadmin", "*", "plan:*", "create"),
    ("role:superadmin", "*", "plan:*", "read"),
    ("role:superadmin", "*", "plan:*", "update"),
    ("role:superadmin", "*", "materia:*", "create"),
    ("role:superadmin", "*", "materia:*", "read"),
    ("role:superadmin", "*", "materia:*", "update"),
    ("role:superadmin", "*", "materia:*", "delete"),
    ("role:superadmin", "*", "periodo:*", "create"),
    ("role:superadmin", "*", "periodo:*", "read"),
    ("role:superadmin", "*", "periodo:*", "update"),
    ("role:superadmin", "*", "comision:*", "create"),
    ("role:superadmin", "*", "comision:*", "read"),
    ("role:superadmin", "*", "comision:*", "update"),
    ("role:superadmin", "*", "comision:*", "delete"),
    ("role:superadmin", "*", "inscripcion:*", "create"),
    ("role:superadmin", "*", "inscripcion:*", "read"),
    ("role:superadmin", "*", "inscripcion:*", "update"),
    ("role:superadmin", "*", "usuario_comision:*", "create"),
    ("role:superadmin", "*", "usuario_comision:*", "read"),
    ("role:superadmin", "*", "usuario_comision:*", "update"),
    ("role:superadmin", "*", "audit:*", "read"),

    # ── Docente admin: gestión institucional completa de su tenant ────
    # (dom "*" acá es metafórico — en F5 se filtra por tenant)
    ("role:docente_admin", "*", "universidad:*", "read"),
    ("role:docente_admin", "*", "universidad:*", "update"),  # solo la propia
    ("role:docente_admin", "*", "facultad:*", "create"),
    ("role:docente_admin", "*", "facultad:*", "read"),
    ("role:docente_admin", "*", "facultad:*", "update"),
    ("role:docente_admin", "*", "facultad:*", "delete"),
    ("role:docente_admin", "*", "carrera:*", "create"),
    ("role:docente_admin", "*", "carrera:*", "read"),
    ("role:docente_admin", "*", "carrera:*", "update"),
    ("role:docente_admin", "*", "carrera:*", "delete"),
    ("role:docente_admin", "*", "plan:*", "create"),
    ("role:docente_admin", "*", "plan:*", "read"),
    ("role:docente_admin", "*", "plan:*", "update"),
    ("role:docente_admin", "*", "materia:*", "create"),
    ("role:docente_admin", "*", "materia:*", "read"),
    ("role:docente_admin", "*", "materia:*", "update"),
    ("role:docente_admin", "*", "materia:*", "delete"),
    ("role:docente_admin", "*", "periodo:*", "create"),
    ("role:docente_admin", "*", "periodo:*", "read"),
    ("role:docente_admin", "*", "periodo:*", "update"),
    ("role:docente_admin", "*", "comision:*", "create"),
    ("role:docente_admin", "*", "comision:*", "read"),
    ("role:docente_admin", "*", "comision:*", "update"),
    ("role:docente_admin", "*", "comision:*", "delete"),
    ("role:docente_admin", "*", "inscripcion:*", "create"),
    ("role:docente_admin", "*", "inscripcion:*", "read"),
    ("role:docente_admin", "*", "inscripcion:*", "update"),
    ("role:docente_admin", "*", "usuario_comision:*", "create"),
    ("role:docente_admin", "*", "usuario_comision:*", "read"),
    ("role:docente_admin", "*", "usuario_comision:*", "update"),
    ("role:docente_admin", "*", "audit:*", "read"),

    # ── Docente: solo comisiones asignadas + lectura del árbol ─────────
    ("role:docente", "*", "universidad:*", "read"),
    ("role:docente", "*", "carrera:*", "read"),
    ("role:docente", "*", "plan:*", "read"),
    ("role:docente", "*", "materia:*", "read"),
    ("role:docente", "*", "periodo:*", "read"),
    ("role:docente", "*", "comision:*", "read"),
    ("role:docente", "*", "inscripcion:*", "read"),
    # En F2+, docente tendrá create/update sobre material, ejercicios, rúbricas
    # y correcciones de SUS comisiones (se enforza con ABAC adicional).

    # ── Estudiante: lectura muy limitada ──────────────────────────────
    ("role:estudiante", "*", "universidad:*", "read"),
    ("role:estudiante", "*", "carrera:*", "read"),
    ("role:estudiante", "*", "comision:*", "read"),
    ("role:estudiante", "*", "inscripcion:*", "read"),
    # En F2+: propio material, problemas de sus comisiones, tutor socrático
]


async def seed() -> None:
    db_url = os.environ.get(
        "ACADEMIC_DB_URL",
        "postgresql+asyncpg://academic_user:academic_pass@127.0.0.1:5432/academic_main",
    )
    engine = create_async_engine(db_url)

    async with engine.begin() as conn:
        # Borrar policies previas (seed idempotente)
        await conn.execute(text("DELETE FROM casbin_rules WHERE ptype = 'p'"))

        # Insertar matriz
        for sub, dom, obj, act in POLICIES:
            await conn.execute(
                text("""
                    INSERT INTO casbin_rules (ptype, v0, v1, v2, v3)
                    VALUES ('p', :sub, :dom, :obj, :act)
                """),
                {"sub": sub, "dom": dom, "obj": obj, "act": act},
            )

        count = await conn.scalar(
            text("SELECT COUNT(*) FROM casbin_rules WHERE ptype = 'p'")
        )
        print(f"✓ {count} policies Casbin cargadas")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
