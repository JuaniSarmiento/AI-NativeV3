"""Tests de integración end-to-end del ctr-service.

Requieren Docker. Levantan Postgres real, aplican las migraciones del
academic-service (para apply_tenant_rls) + ctr-service, ejercitan el
worker con Redis Streams real y verifican persistencia + RLS + cadena.

Skip automático si Docker no está disponible.
"""
from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from .conftest import requires_docker

pytestmark = [pytest.mark.integration, requires_docker]


@pytest.fixture(scope="module")
def pg_container():
    from testcontainers.postgres import PostgresContainer
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg


@pytest.fixture(scope="module")
def redis_container():
    from testcontainers.redis import RedisContainer
    with RedisContainer("redis:7-alpine") as r:
        yield r


@pytest.fixture
async def pg_engine(pg_container):
    """Engine conectado con función apply_tenant_rls() pre-cargada."""
    url = pg_container.get_connection_url().replace(
        "postgresql+psycopg2://", "postgresql+asyncpg://"
    )
    engine = create_async_engine(url, echo=False)

    # Setup inicial: extensiones + función apply_tenant_rls
    async with engine.begin() as conn:
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION apply_tenant_rls(tbl regclass)
            RETURNS void AS $$
            BEGIN
                EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
                EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
                EXECUTE format('
                    CREATE POLICY tenant_isolation ON %s
                    USING (tenant_id = current_setting(''app.current_tenant'')::uuid)
                ', tbl);
            END;
            $$ LANGUAGE plpgsql;
        """))

    # Aplicar schema del ctr-service (simulando la migración Alembic)
    from ctr_service.models import Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Aplicar RLS manualmente (fuera de metadata.create_all)
        for table in ("episodes", "events", "dead_letters"):
            await conn.execute(text(f"SELECT apply_tenant_rls('{table}')"))

    yield engine
    await engine.dispose()


@pytest.fixture
async def session_factory(pg_engine):
    return async_sessionmaker(pg_engine, expire_on_commit=False)


# ── Tests ──────────────────────────────────────────────────────────────


async def test_rls_bloquea_lecturas_cross_tenant(pg_engine, session_factory) -> None:
    """Un tenant no puede leer episodios de otro tenant aunque haga SELECT directo."""
    from ctr_service.models import Episode

    tenant_a = uuid4()
    tenant_b = uuid4()

    # Insertar episodio del tenant A (setear current_tenant correcto)
    async with session_factory() as s:
        await s.execute(
            text("SELECT set_config('app.current_tenant', :t, true)"),
            {"t": str(tenant_a)},
        )
        ep_a = Episode(
            id=uuid4(), tenant_id=tenant_a, comision_id=uuid4(),
            student_pseudonym=uuid4(), problema_id=uuid4(),
            prompt_system_hash="a" * 64, prompt_system_version="v1",
            classifier_config_hash="b" * 64, curso_config_hash="c" * 64,
        )
        s.add(ep_a)
        await s.commit()

    # Leer como tenant B: NO debería ver el episodio de A
    async with session_factory() as s:
        await s.execute(
            text("SELECT set_config('app.current_tenant', :t, true)"),
            {"t": str(tenant_b)},
        )
        from sqlalchemy import select
        result = await s.execute(select(Episode).where(Episode.id == ep_a.id))
        found = result.scalar_one_or_none()
        assert found is None, "RLS no bloqueó lectura cross-tenant"

    # Confirmación: leer como tenant A SÍ lo ve
    async with session_factory() as s:
        await s.execute(
            text("SELECT set_config('app.current_tenant', :t, true)"),
            {"t": str(tenant_a)},
        )
        from sqlalchemy import select
        result = await s.execute(select(Episode).where(Episode.id == ep_a.id))
        found = result.scalar_one_or_none()
        assert found is not None


async def test_worker_persiste_evento_con_cadena_correcta(
    pg_engine, session_factory, redis_container
) -> None:
    """End-to-end: publish → worker consume → persiste con chain_hash correcto."""
    import redis.asyncio as redis

    from ctr_service.services.producer import EventProducer
    from ctr_service.workers.partition_worker import (
        PartitionConfig,
        PartitionWorker,
    )

    redis_url = redis_container.get_connection_url()
    r = redis.from_url(redis_url, decode_responses=False)
    producer = EventProducer(r, num_partitions=1)

    tenant = uuid4()
    episode_id = uuid4()
    event = {
        "event_uuid": str(uuid4()),
        "episode_id": str(episode_id),
        "tenant_id": str(tenant),
        "seq": 0,
        "event_type": "episodio_abierto",
        "ts": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "payload": {
            "student_pseudonym": str(uuid4()),
            "problema_id": str(uuid4()),
            "comision_id": str(uuid4()),
            "curso_config_hash": "c" * 64,
        },
        "prompt_system_hash": "a" * 64,
        "prompt_system_version": "v1.0.0",
        "classifier_config_hash": "b" * 64,
    }

    # Publicar al stream
    await producer.publish(event)

    # Correr el worker brevemente
    worker = PartitionWorker(
        config=PartitionConfig(partition=0, block_ms=500),
        redis_client=r,
        session_factory=session_factory,
    )

    # Procesar un batch y salir
    await worker.ensure_consumer_group()
    await worker._process_batch()

    # Verificar persistencia
    from sqlalchemy import select
    from ctr_service.models import Episode, Event

    async with session_factory() as s:
        await s.execute(
            text("SELECT set_config('app.current_tenant', :t, true)"),
            {"t": str(tenant)},
        )
        ep = (await s.execute(select(Episode).where(Episode.id == episode_id))).scalar_one()
        assert ep.events_count == 1
        assert ep.last_chain_hash != "0" * 64  # ya avanzó

        events = (await s.execute(
            select(Event).where(Event.episode_id == episode_id).order_by(Event.seq)
        )).scalars().all()
        assert len(events) == 1
        assert events[0].seq == 0
        assert events[0].chain_hash == ep.last_chain_hash

    await r.aclose()


async def test_evento_duplicado_es_idempotente(
    pg_engine, session_factory, redis_container
) -> None:
    """Publicar el mismo event_uuid dos veces persiste una sola fila."""
    import redis.asyncio as redis

    from ctr_service.services.producer import EventProducer
    from ctr_service.workers.partition_worker import (
        PartitionConfig,
        PartitionWorker,
    )

    r = redis.from_url(redis_container.get_connection_url(), decode_responses=False)
    producer = EventProducer(r, num_partitions=1)

    tenant = uuid4()
    episode_id = uuid4()
    event_uuid = str(uuid4())

    event = {
        "event_uuid": event_uuid,
        "episode_id": str(episode_id),
        "tenant_id": str(tenant),
        "seq": 0,
        "event_type": "episodio_abierto",
        "ts": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "payload": {
            "student_pseudonym": str(uuid4()),
            "problema_id": str(uuid4()),
            "comision_id": str(uuid4()),
        },
        "prompt_system_hash": "a" * 64,
        "prompt_system_version": "v1.0.0",
        "classifier_config_hash": "b" * 64,
    }

    # Publicar el mismo evento dos veces
    await producer.publish(event)
    await producer.publish(event)

    worker = PartitionWorker(
        config=PartitionConfig(partition=0, block_ms=500),
        redis_client=r, session_factory=session_factory,
    )
    await worker.ensure_consumer_group()
    await worker._process_batch()
    await worker._process_batch()

    # Verificar: una sola fila persistida
    from sqlalchemy import func, select
    from ctr_service.models import Event

    async with session_factory() as s:
        await s.execute(
            text("SELECT set_config('app.current_tenant', :t, true)"),
            {"t": str(tenant)},
        )
        count = (await s.execute(
            select(func.count(Event.id)).where(
                Event.event_uuid == UUID(event_uuid)
            )
        )).scalar_one()
        assert count == 1

    await r.aclose()
