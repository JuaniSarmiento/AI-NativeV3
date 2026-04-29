"""Seed determinista con 3 comisiones en el tenant demo.

Para qué sirve
--------------
Extiende el demo original (`seed-demo-data.py`, que crea 1 comision con 6
estudiantes) a 3 comisiones dentro del MISMO tenant, con cohortes
diferenciadas para que el dashboard comparativo del web-teacher muestre
progresiones distintas.

Shape resultante
----------------
- 1 Universidad / Facultad / Carrera / Plan / Materia / Periodo
- 3 Comisiones (codigo A, B, C) con 1 docente asignado a las tres
- 18 estudiantes (6 por comision, pseudonyms distintos)
- ~90 episodios CTR (cadena SHA-256 valida por episodio)
- ~90 classifications append-only (is_current=true)

Cohortes
--------
- Comision A "Manana"  -> balanceada (como el demo original)
- Comision B "Tarde"   -> cohorte fuerte (mayor proporcion reflexiva)
- Comision C "Noche"   -> cohorte con dificultades (mas empeorando/superficial)

Idempotencia
------------
Borra previo por tenant_id antes de insertar. Seguro de re-correr.
Pisa lo que haya dejado `seed-demo-data.py` (mismo tenant).

Ejecucion
---------
    python scripts/seed-3-comisiones.py

Con env vars custom:
    ACADEMIC_DB_URL=...  CTR_STORE_URL=...  CLASSIFIER_DB_URL=...  \
    python scripts/seed-3-comisiones.py
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import cast
from uuid import UUID

# Permitir imports de los servicios sin instalacion editable
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "apps" / "ctr-service" / "src"))
sys.path.insert(0, str(ROOT / "apps" / "classifier-service" / "src"))
sys.path.insert(0, str(ROOT / "apps" / "academic-service" / "src"))

# Hashing helpers del proyecto (source of truth, ADR-010)
from ctr_service.services.hashing import (
    GENESIS_HASH,
    compute_chain_hash,
    compute_self_hash,
)
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# ---------------------------------------------------------------------
# Constantes del piloto
# ---------------------------------------------------------------------

TENANT_ID = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

# Jerarquia academica compartida por las 3 comisiones
UNIVERSIDAD_ID = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
FACULTAD_ID = UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")
CARRERA_ID = UUID("dddddddd-dddd-dddd-dddd-dddddddddddd")
PLAN_ID = UUID("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")
MATERIA_ID = UUID("ffffffff-ffff-ffff-ffff-ffffffffffff")
PERIODO_ID = UUID("12345678-1234-1234-1234-123456789abc")

DOCENTE_USER_ID = UUID("11111111-1111-1111-1111-111111111111")

PROMPT_SYSTEM_HASH = hashlib.sha256(b"prompt-system-demo-v1").hexdigest()
PROMPT_SYSTEM_VERSION = "v1.0.0"
CLASSIFIER_CONFIG_HASH = hashlib.sha256(b"classifier-config-demo-v1").hexdigest()
CURSO_CONFIG_HASH = hashlib.sha256(b"curso-config-demo-v1").hexdigest()

PROBLEMA_ID = UUID("99999999-9999-9999-9999-999999999999")

# ---------------------------------------------------------------------
# Plantillas de TP (ADR-016) — fuente canonica por (materia, periodo)
# ---------------------------------------------------------------------
# Cada plantilla se auto-instancia en las 3 comisiones al seedear.
# Los estudiantes de A, B, C reciben el MISMO enunciado (cero divergencia).
# Si un docente edita una instancia directamente, queda con has_drift=true.

TEMPLATE_01_ID = UUID("11110000-0000-0000-0000-000000000001")
TEMPLATE_02_ID = UUID("11110000-0000-0000-0000-000000000002")

TEMPLATES_DEMO: list[dict[str, str | float | UUID]] = [
    {
        "id": TEMPLATE_01_ID,
        "codigo": "TP-01",
        "titulo": "Recursion y complejidad temporal",
        "enunciado": (
            "# TP-01 - Recursion y complejidad temporal\n\n"
            "## Objetivos\n"
            "1. Implementar la secuencia de Fibonacci en **dos variantes**: "
            "recursiva clasica e iterativa con acumulador.\n"
            "2. Medir empiricamente el tiempo de ejecucion para N = 10, 20, 30, 40.\n"
            "3. Proponer una tercera variante con **memoization** y justificar "
            "la mejora de complejidad de O(2^n) a O(n).\n\n"
            "## Entregable\n"
            "Un archivo `fibonacci.py` con las tres funciones + un script "
            "`benchmark.py` que imprima una tabla comparativa.\n\n"
            "## Criterios de evaluacion\n"
            "- Correccion (tests unitarios pasan): 40%\n"
            "- Analisis de complejidad escrito: 30%\n"
            "- Benchmark reproducible: 30%\n"
        ),
        "peso": 0.20,
    },
    {
        "id": TEMPLATE_02_ID,
        "codigo": "TP-02",
        "titulo": "Listas enlazadas simples",
        "enunciado": (
            "# TP-02 - Listas enlazadas simples\n\n"
            "## Objetivos\n"
            "Implementar una clase `LinkedList` con las operaciones:\n\n"
            "- `insert(value)` - al final, O(n)\n"
            "- `insert_head(value)` - al principio, O(1)\n"
            "- `delete(value)` - primera ocurrencia, O(n)\n"
            "- `reverse()` - in-place, O(n)\n"
            "- `__len__()` y `__iter__()`\n\n"
            "## Restricciones\n"
            "- Prohibido usar `list` o `collections.deque` por dentro.\n"
            "- Cada metodo debe tener docstring con la complejidad temporal.\n\n"
            "## Entregable\n"
            "`linked_list.py` + suite de tests con al menos 8 casos, "
            "incluyendo edge cases (lista vacia, un solo elemento, reverse de "
            "lista vacia).\n"
        ),
        "peso": 0.25,
    },
]

# ---------------------------------------------------------------------
# Configuracion de las 3 comisiones
# ---------------------------------------------------------------------
# Los pseudonyms se prefijan con b1/b2/b3 para no chocar con los del
# seed-demo-data.py original (que usa a1a1a1a1-...).
# La comision A mantiene el UUID clasico del demo para retro-compat.

COHORTES = [
    {
        "comision_id": UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        "codigo": "A",
        "nombre": "Manana",
        "students": [
            UUID("b1b1b1b1-0001-0001-0001-000000000001"),
            UUID("b1b1b1b1-0002-0002-0002-000000000002"),
            UUID("b1b1b1b1-0003-0003-0003-000000000003"),
            UUID("b1b1b1b1-0004-0004-0004-000000000004"),
            UUID("b1b1b1b1-0005-0005-0005-000000000005"),
            UUID("b1b1b1b1-0006-0006-0006-000000000006"),
        ],
        # Patron balanceado (identico al demo original)
        "patterns": [
            ["apropiacion_superficial"] * 2 + ["apropiacion_reflexiva"] * 4,
            ["delegacion_pasiva"] * 2
            + ["apropiacion_superficial"] * 2
            + ["apropiacion_reflexiva"] * 2,
            ["apropiacion_superficial"] * 5,
            ["apropiacion_reflexiva"] * 5,
            ["apropiacion_reflexiva"] * 3 + ["apropiacion_superficial"] * 3,
            ["apropiacion_superficial"] * 2,
        ],
    },
    {
        "comision_id": UUID("bbbb0002-bbbb-bbbb-bbbb-bbbbbbbb0002"),
        "codigo": "B",
        "nombre": "Tarde",
        "students": [
            UUID("b2b2b2b2-0001-0001-0001-000000000001"),
            UUID("b2b2b2b2-0002-0002-0002-000000000002"),
            UUID("b2b2b2b2-0003-0003-0003-000000000003"),
            UUID("b2b2b2b2-0004-0004-0004-000000000004"),
            UUID("b2b2b2b2-0005-0005-0005-000000000005"),
            UUID("b2b2b2b2-0006-0006-0006-000000000006"),
        ],
        # Cohorte fuerte: 4 reflexivas, 2 estables
        "patterns": [
            ["apropiacion_reflexiva"] * 6,
            ["apropiacion_superficial"] * 2 + ["apropiacion_reflexiva"] * 4,
            ["apropiacion_superficial"] * 1 + ["apropiacion_reflexiva"] * 5,
            ["apropiacion_reflexiva"] * 6,
            ["apropiacion_reflexiva"] * 4,
            ["apropiacion_superficial"] * 3 + ["apropiacion_reflexiva"] * 3,
        ],
    },
    {
        "comision_id": UUID("cccc0003-cccc-cccc-cccc-cccccccc0003"),
        "codigo": "C",
        "nombre": "Noche",
        "students": [
            UUID("b3b3b3b3-0001-0001-0001-000000000001"),
            UUID("b3b3b3b3-0002-0002-0002-000000000002"),
            UUID("b3b3b3b3-0003-0003-0003-000000000003"),
            UUID("b3b3b3b3-0004-0004-0004-000000000004"),
            UUID("b3b3b3b3-0005-0005-0005-000000000005"),
            UUID("b3b3b3b3-0006-0006-0006-000000000006"),
        ],
        # Cohorte con dificultades: empeoran, muchos superficiales
        "patterns": [
            ["apropiacion_reflexiva"] * 2 + ["apropiacion_superficial"] * 4,
            ["apropiacion_superficial"] * 6,
            ["delegacion_pasiva"] * 3 + ["apropiacion_superficial"] * 3,
            ["apropiacion_superficial"] * 5,
            ["apropiacion_reflexiva"] * 1 + ["apropiacion_superficial"] * 4,
            ["delegacion_pasiva"] * 2,
        ],
    },
]

# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------


def _dt(ts: datetime) -> str:
    return ts.isoformat().replace("+00:00", "Z")


def _build_event_canonical(
    *,
    event_uuid: UUID,
    episode_id: UUID,
    tenant_id: UUID,
    seq: int,
    event_type: str,
    ts: datetime,
    payload: dict,
) -> dict:
    return {
        "event_uuid": str(event_uuid),
        "episode_id": str(episode_id),
        "tenant_id": str(tenant_id),
        "seq": seq,
        "event_type": event_type,
        "ts": _dt(ts),
        "payload": payload,
        "prompt_system_hash": PROMPT_SYSTEM_HASH,
        "prompt_system_version": PROMPT_SYSTEM_VERSION,
        "classifier_config_hash": CLASSIFIER_CONFIG_HASH,
    }


def _build_events_for_episode(
    *,
    episode_id: UUID,
    tenant_id: UUID,
    comision_id: UUID,
    student_pseudonym: UUID,
    opened_at: datetime,
    closed_at: datetime,
) -> list[dict]:
    specs = [
        {
            "event_type": "episodio_abierto",
            "ts": opened_at,
            "payload": {
                "student_pseudonym": str(student_pseudonym),
                "problema_id": str(PROBLEMA_ID),
                "comision_id": str(comision_id),
                "curso_config_hash": CURSO_CONFIG_HASH,
            },
        },
        {
            "event_type": "prompt_enviado",
            "ts": opened_at + timedelta(minutes=5),
            "payload": {
                "content": "Como encaro el problema de las listas enlazadas?",
                "prompt_kind": "aclaracion_enunciado",
                "chunks_used_hash": None,
            },
        },
        {
            "event_type": "tutor_respondio",
            "ts": opened_at + timedelta(minutes=6),
            "payload": {
                "content": "Pensemos juntos: que diferencia ves entre una lista y un array?",
                "model_used": "claude-sonnet-4-6",
                "socratic_compliance": 0.95,
                "violations": [],
            },
        },
        {
            "event_type": "codigo_ejecutado",
            "ts": opened_at + timedelta(minutes=20),
            "payload": {
                "passed": 3,
                "failed": 1,
                "total": 4,
                "stdout": "test_empty OK\ntest_single OK\ntest_multi OK\ntest_reverse FAILED",
                "failed_test_names": ["test_reverse"],
            },
        },
        {
            "event_type": "episodio_cerrado",
            "ts": closed_at,
            "payload": {
                "final_chain_hash": "",
                "total_events": 5,
                "duration_seconds": (closed_at - opened_at).total_seconds(),
            },
        },
    ]

    results: list[dict] = []
    prev_chain = GENESIS_HASH
    for seq, spec in enumerate(specs):
        event_uuid = UUID(int=(episode_id.int ^ (seq + 1) * 0x9E3779B97F4A7C15) & ((1 << 128) - 1))
        canonical = _build_event_canonical(
            event_uuid=event_uuid,
            episode_id=episode_id,
            tenant_id=tenant_id,
            seq=seq,
            event_type=spec["event_type"],
            ts=spec["ts"],
            payload=spec["payload"],
        )
        self_hash = compute_self_hash(canonical)
        chain_hash = compute_chain_hash(self_hash, prev_chain)
        results.append(
            {
                "event_uuid": event_uuid,
                "seq": seq,
                "event_type": spec["event_type"],
                "ts_dt": spec["ts"],
                "payload": spec["payload"],
                "self_hash": self_hash,
                "chain_hash": chain_hash,
                "prev_chain_hash": prev_chain,
            }
        )
        prev_chain = chain_hash
    return results


async def _set_tenant(session: AsyncSession, tenant_id: UUID) -> None:
    await session.execute(
        text("SELECT set_config('app.current_tenant', :t, true)"),
        {"t": str(tenant_id)},
    )


# ---------------------------------------------------------------------
# Seeds
# ---------------------------------------------------------------------


async def seed_academic(academic_url: str) -> None:
    engine = create_async_engine(academic_url, pool_size=2)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    today = date.today()

    try:
        async with maker() as session:
            await _set_tenant(session, TENANT_ID)
            # Orden de DELETE respeta FKs:
            # - tareas_practicas (instancias) -> tareas_practicas_templates (por template_id FK)
            # - usuarios_comision / inscripciones / tareas_practicas -> comisiones
            # - comisiones -> periodos / materias
            # - materias -> planes_estudio -> carreras -> facultades
            for table in (
                "tareas_practicas",
                "tareas_practicas_templates",
                "usuarios_comision",
                "inscripciones",
                "comisiones",
                "periodos",
                "materias",
                "planes_estudio",
                "carreras",
                "facultades",
            ):
                await session.execute(
                    text(f"DELETE FROM {table} WHERE tenant_id = :t"),
                    {"t": str(TENANT_ID)},
                )
            await session.execute(
                text("DELETE FROM universidades WHERE id = :u"),
                {"u": str(UNIVERSIDAD_ID)},
            )
            await session.commit()

        async with maker() as session:
            await _set_tenant(session, TENANT_ID)

            # Universidad (sin tenant_id: es el tenant)
            await session.execute(
                text(
                    "INSERT INTO universidades (id, nombre, codigo, dominio_email, keycloak_realm, config) "
                    "VALUES (:id, :nombre, :codigo, :dominio, :realm, '{}'::jsonb)"
                ),
                {
                    "id": str(UNIVERSIDAD_ID),
                    "nombre": "UNSL demo",
                    "codigo": "UNSL-DEMO",
                    "dominio": "unsl.edu.ar",
                    "realm": "demo_uni",
                },
            )
            await session.execute(
                text(
                    "INSERT INTO facultades (id, tenant_id, universidad_id, nombre, codigo) "
                    "VALUES (:id, :t, :uni, :nombre, :codigo)"
                ),
                {
                    "id": str(FACULTAD_ID),
                    "t": str(TENANT_ID),
                    "uni": str(UNIVERSIDAD_ID),
                    "nombre": "FCFMyN demo",
                    "codigo": "FCFMYN",
                },
            )
            await session.execute(
                text(
                    "INSERT INTO carreras (id, tenant_id, universidad_id, facultad_id, nombre, codigo) "
                    "VALUES (:id, :t, :uni, :fac, :nombre, :codigo)"
                ),
                {
                    "id": str(CARRERA_ID),
                    "t": str(TENANT_ID),
                    "uni": str(UNIVERSIDAD_ID),
                    "fac": str(FACULTAD_ID),
                    "nombre": "TSU IA",
                    "codigo": "TSU-IA",
                },
            )
            await session.execute(
                text(
                    "INSERT INTO planes_estudio (id, tenant_id, carrera_id, version, año_inicio) "
                    "VALUES (:id, :t, :car, :v, :anio)"
                ),
                {
                    "id": str(PLAN_ID),
                    "t": str(TENANT_ID),
                    "car": str(CARRERA_ID),
                    "v": "2024",
                    "anio": 2024,
                },
            )
            await session.execute(
                text(
                    "INSERT INTO materias (id, tenant_id, plan_id, nombre, codigo) "
                    "VALUES (:id, :t, :p, :nombre, :codigo)"
                ),
                {
                    "id": str(MATERIA_ID),
                    "t": str(TENANT_ID),
                    "p": str(PLAN_ID),
                    "nombre": "Programacion 2",
                    "codigo": "PROG2",
                },
            )
            await session.execute(
                text(
                    "INSERT INTO periodos (id, tenant_id, codigo, nombre, fecha_inicio, fecha_fin, estado) "
                    "VALUES (:id, :t, :codigo, :nombre, :ini, :fin, 'abierto')"
                ),
                {
                    "id": str(PERIODO_ID),
                    "t": str(TENANT_ID),
                    "codigo": f"{today.year}-S1",
                    "nombre": f"Cuatrimestre {today.year}-S1",
                    "ini": today - timedelta(days=60),
                    "fin": today + timedelta(days=60),
                },
            )

            # 3 comisiones
            for cohort in COHORTES:
                await session.execute(
                    text(
                        "INSERT INTO comisiones (id, tenant_id, materia_id, periodo_id, codigo, curso_config_hash) "
                        "VALUES (:id, :t, :m, :p, :codigo, :cch)"
                    ),
                    {
                        "id": str(cohort["comision_id"]),
                        "t": str(TENANT_ID),
                        "m": str(MATERIA_ID),
                        "p": str(PERIODO_ID),
                        "codigo": cohort["codigo"],
                        "cch": CURSO_CONFIG_HASH,
                    },
                )
                # Docente como titular en las 3 comisiones
                await session.execute(
                    text(
                        "INSERT INTO usuarios_comision "
                        "(tenant_id, comision_id, user_id, rol, fecha_desde) "
                        "VALUES (:t, :c, :u, 'titular', :fd)"
                    ),
                    {
                        "t": str(TENANT_ID),
                        "c": str(cohort["comision_id"]),
                        "u": str(DOCENTE_USER_ID),
                        "fd": today - timedelta(days=60),
                    },
                )
                # Inscripciones
                for pseudo in cohort["students"]:
                    await session.execute(
                        text(
                            "INSERT INTO inscripciones "
                            "(tenant_id, comision_id, student_pseudonym, rol, estado, fecha_inscripcion) "
                            "VALUES (:t, :c, :s, 'regular', 'cursando', :fi)"
                        ),
                        {
                            "t": str(TENANT_ID),
                            "c": str(cohort["comision_id"]),
                            "s": str(pseudo),
                            "fi": today - timedelta(days=45),
                        },
                    )

            # Plantillas de TP (ADR-016) — fuente canonica por (materia, periodo).
            # Cada plantilla se auto-instancia en las 3 comisiones con el mismo
            # codigo/titulo/enunciado. `template_id` del TP apunta al template.
            # `has_drift=false` al inicio — cambia a true si un docente edita
            # la instancia directamente (NO via template).
            for tpl in TEMPLATES_DEMO:
                await session.execute(
                    text(
                        "INSERT INTO tareas_practicas_templates ("
                        "id, tenant_id, materia_id, periodo_id, codigo, titulo, "
                        "enunciado, peso, estado, version, created_by"
                        ") VALUES ("
                        ":id, :t, :m, :p, :codigo, :titulo, :enunciado, :peso, "
                        "'published', 1, :cb"
                        ")"
                    ),
                    {
                        "id": str(tpl["id"]),
                        "t": str(TENANT_ID),
                        "m": str(MATERIA_ID),
                        "p": str(PERIODO_ID),
                        "codigo": tpl["codigo"],
                        "titulo": tpl["titulo"],
                        "enunciado": tpl["enunciado"],
                        "peso": tpl["peso"],
                        "cb": str(DOCENTE_USER_ID),
                    },
                )

                # Instanciar en las 3 comisiones — UUID deterministico por
                # (template, cohort) para que el seed sea idempotente.
                for cohort_idx, cohort in enumerate(COHORTES):
                    instance_id = UUID(
                        int=(cast(UUID, tpl["id"]).int ^ ((cohort_idx + 1) * 0xC0DE_C0DE_C0DE_C0DE))
                        & ((1 << 128) - 1)
                    )
                    # Fechas: inicio hoy-15d, fin hoy+30d (TP en curso)
                    fecha_inicio = datetime.combine(
                        today - timedelta(days=15),
                        datetime.min.time(),
                        tzinfo=UTC,
                    )
                    fecha_fin = datetime.combine(
                        today + timedelta(days=30),
                        datetime.min.time(),
                        tzinfo=UTC,
                    )
                    await session.execute(
                        text(
                            "INSERT INTO tareas_practicas ("
                            "id, tenant_id, comision_id, template_id, has_drift, "
                            "codigo, titulo, enunciado, peso, fecha_inicio, fecha_fin, "
                            "estado, version, created_by"
                            ") VALUES ("
                            ":id, :t, :c, :tpl, false, "
                            ":codigo, :titulo, :enunciado, :peso, :fi, :ff, "
                            "'published', 1, :cb"
                            ")"
                        ),
                        {
                            "id": str(instance_id),
                            "t": str(TENANT_ID),
                            "c": str(cohort["comision_id"]),
                            "tpl": str(tpl["id"]),
                            "codigo": tpl["codigo"],
                            "titulo": tpl["titulo"],
                            "enunciado": tpl["enunciado"],
                            "peso": tpl["peso"],
                            "fi": fecha_inicio,
                            "ff": fecha_fin,
                            "cb": str(DOCENTE_USER_ID),
                        },
                    )

            await session.commit()
    finally:
        await engine.dispose()


async def seed_ctr(ctr_url: str) -> list[tuple[UUID, UUID, UUID, datetime]]:
    """Returns: list de (episode_id, comision_id, student_pseudonym, classified_at)."""
    engine = create_async_engine(ctr_url, pool_size=2)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    episode_refs: list[tuple[UUID, UUID, UUID, datetime]] = []

    try:
        async with maker() as session:
            await _set_tenant(session, TENANT_ID)
            await session.execute(
                text("DELETE FROM events WHERE tenant_id = :t"),
                {"t": str(TENANT_ID)},
            )
            await session.execute(
                text("DELETE FROM dead_letters WHERE tenant_id = :t"),
                {"t": str(TENANT_ID)},
            )
            await session.execute(
                text("DELETE FROM episodes WHERE tenant_id = :t"),
                {"t": str(TENANT_ID)},
            )
            await session.commit()

        async with maker() as session:
            await _set_tenant(session, TENANT_ID)
            base_time = datetime.now(UTC) - timedelta(days=45)

            for cohort_idx, cohort in enumerate(COHORTES):
                comision_id = cohort["comision_id"]
                for student_idx, (pseudo, pattern) in enumerate(
                    zip(cohort["students"], cohort["patterns"], strict=False)
                ):
                    for ep_idx in range(len(pattern)):
                        opened_at = base_time + timedelta(
                            days=(student_idx * 0.2) + (ep_idx * 5),
                            hours=cohort_idx * 2,  # desfasaje por comision
                        )
                        closed_at = opened_at + timedelta(minutes=45)

                        # Episode id deterministico (cohort_idx en bits altos)
                        episode_id = UUID(
                            int=(
                                (cohort_idx + 1) * 1_000_000
                                + (student_idx + 1) * 10_000
                                + (ep_idx + 1) * 100
                            )
                            | (1 << 127)
                        )

                        events = _build_events_for_episode(
                            episode_id=episode_id,
                            tenant_id=TENANT_ID,
                            comision_id=comision_id,
                            student_pseudonym=pseudo,
                            opened_at=opened_at,
                            closed_at=closed_at,
                        )
                        last_chain_hash = events[-1]["chain_hash"]

                        await session.execute(
                            text(
                                "INSERT INTO episodes ("
                                "id, tenant_id, comision_id, student_pseudonym, problema_id, "
                                "prompt_system_hash, prompt_system_version, "
                                "classifier_config_hash, curso_config_hash, "
                                "estado, opened_at, closed_at, "
                                "events_count, last_chain_hash, integrity_compromised, meta"
                                ") VALUES ("
                                ":id, :t, :c, :s, :pb, "
                                ":psh, :psv, :cch, :cuch, "
                                ":estado, :oa, :ca, "
                                ":ec, :lch, false, '{}'::jsonb"
                                ")"
                            ),
                            {
                                "id": str(episode_id),
                                "t": str(TENANT_ID),
                                "c": str(comision_id),
                                "s": str(pseudo),
                                "pb": str(PROBLEMA_ID),
                                "psh": PROMPT_SYSTEM_HASH,
                                "psv": PROMPT_SYSTEM_VERSION,
                                "cch": CLASSIFIER_CONFIG_HASH,
                                "cuch": CURSO_CONFIG_HASH,
                                "estado": "closed",
                                "oa": opened_at,
                                "ca": closed_at,
                                "ec": len(events),
                                "lch": last_chain_hash,
                            },
                        )

                        for ev in events:
                            await session.execute(
                                text(
                                    "INSERT INTO events ("
                                    "event_uuid, tenant_id, episode_id, seq, event_type, "
                                    "ts, payload, self_hash, chain_hash, prev_chain_hash, "
                                    "prompt_system_hash, prompt_system_version, classifier_config_hash"
                                    ") VALUES ("
                                    ":euid, :t, :eid, :seq, :et, "
                                    ":ts, CAST(:pl AS jsonb), :sh, :ch, :pch, "
                                    ":psh, :psv, :cch"
                                    ")"
                                ),
                                {
                                    "euid": str(ev["event_uuid"]),
                                    "t": str(TENANT_ID),
                                    "eid": str(episode_id),
                                    "seq": ev["seq"],
                                    "et": ev["event_type"],
                                    "ts": ev["ts_dt"],
                                    "pl": json.dumps(ev["payload"]),
                                    "sh": ev["self_hash"],
                                    "ch": ev["chain_hash"],
                                    "pch": ev["prev_chain_hash"],
                                    "psh": PROMPT_SYSTEM_HASH,
                                    "psv": PROMPT_SYSTEM_VERSION,
                                    "cch": CLASSIFIER_CONFIG_HASH,
                                },
                            )

                        classified_at = closed_at + timedelta(minutes=2)
                        episode_refs.append((episode_id, comision_id, pseudo, classified_at))

            await session.commit()
    finally:
        await engine.dispose()

    return episode_refs


async def seed_classifications(
    classifier_url: str,
    episode_refs: list[tuple[UUID, UUID, UUID, datetime]],
) -> None:
    engine = create_async_engine(classifier_url, pool_size=2)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    try:
        async with maker() as session:
            await _set_tenant(session, TENANT_ID)
            await session.execute(
                text("DELETE FROM classifications WHERE tenant_id = :t"),
                {"t": str(TENANT_ID)},
            )
            await session.commit()

        async with maker() as session:
            await _set_tenant(session, TENANT_ID)

            # Reconstruccion del mapping: episode_refs esta ordenado
            # por (cohort_idx, student_idx, ep_idx) exactamente como
            # iteramos en seed_ctr. Asi cada appropriation se asocia
            # con su episodio correcto.
            idx = 0
            for cohort in COHORTES:
                for student_idx, pattern in enumerate(cohort["patterns"]):
                    for ep_idx, appropriation in enumerate(pattern):
                        episode_id, comision_id, _pseudo, classified_at = episode_refs[idx]
                        idx += 1

                        if appropriation == "apropiacion_reflexiva":
                            ct, ccd, orph, stab, evo = 0.85, 0.80, 0.05, 0.78, 0.20
                        elif appropriation == "apropiacion_superficial":
                            ct, ccd, orph, stab, evo = 0.55, 0.50, 0.25, 0.55, 0.00
                        else:  # delegacion_pasiva
                            ct, ccd, orph, stab, evo = 0.20, 0.25, 0.60, 0.30, -0.15

                        reason = (
                            f"[{cohort['codigo']}] Arbol N4 - {appropriation}: "
                            f"CT={ct:.2f}, CCD={ccd:.2f}, orph={orph:.2f}, "
                            f"stab={stab:.2f}, evo={evo:+.2f} "
                            f"(episodio {ep_idx + 1}, estudiante #{student_idx + 1})"
                        )

                        await session.execute(
                            text(
                                "INSERT INTO classifications ("
                                "episode_id, tenant_id, comision_id, classifier_config_hash, "
                                "appropriation, appropriation_reason, "
                                "ct_summary, ccd_mean, ccd_orphan_ratio, "
                                "cii_stability, cii_evolution, "
                                "features, classified_at, is_current"
                                ") VALUES ("
                                ":eid, :t, :c, :cch, :app, :reason, "
                                ":ct, :ccd, :orph, :stab, :evo, "
                                "'{}'::jsonb, :ca, true)"
                            ),
                            {
                                "eid": str(episode_id),
                                "t": str(TENANT_ID),
                                "c": str(comision_id),
                                "cch": CLASSIFIER_CONFIG_HASH,
                                "app": appropriation,
                                "reason": reason,
                                "ct": ct,
                                "ccd": ccd,
                                "orph": orph,
                                "stab": stab,
                                "evo": evo,
                                "ca": classified_at,
                            },
                        )

            await session.commit()
    finally:
        await engine.dispose()


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------


async def main() -> None:
    academic_url = os.environ.get(
        "ACADEMIC_DB_URL",
        "postgresql+asyncpg://academic_user:academic_pass@localhost:5432/academic_main",
    )
    ctr_url = os.environ.get(
        "CTR_STORE_URL",
        "postgresql+asyncpg://ctr_user:ctr_pass@localhost:5432/ctr_store",
    )
    classifier_url = os.environ.get(
        "CLASSIFIER_DB_URL",
        "postgresql+asyncpg://classifier_user:classifier_pass@localhost:5432/classifier_db",
    )

    total_students = sum(len(c["students"]) for c in COHORTES)
    total_episodes = sum(sum(len(p) for p in c["patterns"]) for c in COHORTES)

    print(f"[seed] tenant      = {TENANT_ID}")
    print(
        f"[seed] comisiones  = {len(COHORTES)} ({', '.join(c['codigo'] + '-' + c['nombre'] for c in COHORTES)})"
    )
    print(f"[seed] estudiantes = {total_students}")
    print(f"[seed] episodios   = {total_episodes}")
    print(
        f"[seed] plantillas  = {len(TEMPLATES_DEMO)} (auto-instanciadas en las {len(COHORTES)} comisiones -> {len(TEMPLATES_DEMO) * len(COHORTES)} TPs)"
    )
    print(f"[seed] academic    -> {academic_url.split('@')[-1]}")
    print(f"[seed] ctr_store   -> {ctr_url.split('@')[-1]}")
    print(f"[seed] classifier  -> {classifier_url.split('@')[-1]}")

    print("[seed] 1/3 academic...")
    await seed_academic(academic_url)

    print("[seed] 2/3 ctr_store...")
    episode_refs = await seed_ctr(ctr_url)

    print("[seed] 3/3 classifications...")
    await seed_classifications(classifier_url, episode_refs)

    print(
        f"[seed] OK: {len(COHORTES)} comisiones, {total_students} estudiantes, "
        f"{len(episode_refs)} episodios, {len(episode_refs)} classifications"
    )
    print()
    print("Verifica con:")
    for c in COHORTES:
        print(
            f"  curl -s 'http://127.0.0.1:8000/api/v1/analytics/cohort/{c['comision_id']}/progression' \\"
        )
        print("    -H 'X-User-Id: 11111111-1111-1111-1111-111111111111' \\")
        print(f"    -H 'X-Tenant-Id: {TENANT_ID}' \\")
        print("    -H 'X-User-Roles: docente'")


if __name__ == "__main__":
    asyncio.run(main())
