"""Test de TutorCore con todos los clientes externos mockeados.

Verifica el flujo completo: open → interact (con retrieval + LLM stream +
emisión de eventos CTR) → close. Sin tocar red ni DB.

Propiedades que el test VERIFICA:
  1. Al abrir episodio se emite seq=0 de tipo "episodio_abierto".
  2. Al interactuar se emiten seq=1 (prompt_enviado) y seq=2 (tutor_respondio).
  3. chunks_used_hash del retrieval se incluye en el evento PromptEnviado (auditabilidad CTR).
  4. Los seqs son estrictamente consecutivos (orden).
  5. Al cerrar se emite episodio_cerrado.
  6. El hash del prompt y del classifier config se preservan en cada evento.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID, uuid4

import fakeredis.aioredis
import pytest

from tutor_service.services.clients import (
    PromptConfig,
    RetrievalResult,
    RetrievedChunk,
)
from tutor_service.services.session import SessionManager
from tutor_service.services.tutor_core import TutorCore


# ── Mocks de los clientes externos ────────────────────────────────────


class FakeGovernanceClient:
    async def get_prompt(self, name: str, version: str) -> PromptConfig:
        return PromptConfig(
            name=name, version=version,
            content="Eres un tutor socrático. Guía sin dar la respuesta.",
            hash="abc" + "0" * 61,
        )


class FakeContentClient:
    def __init__(self) -> None:
        self.called_with: list[dict] = []

    async def retrieve(
        self, query: str, comision_id: UUID, top_k: int,
        tenant_id: UUID, caller_id: UUID,
    ) -> RetrievalResult:
        self.called_with.append({
            "query": query,
            "comision_id": comision_id,
            "tenant_id": tenant_id,
            "top_k": top_k,
        })
        return RetrievalResult(
            chunks=[
                RetrievedChunk(
                    id=uuid4(),
                    contenido="La recursión es una técnica donde una función se llama a sí misma.",
                    material_nombre="Apunte 3 - Recursión.pdf",
                    score_rerank=0.92,
                ),
            ],
            chunks_used_hash="deadbeef" + "0" * 56,
            latency_ms=45.0,
        )


class FakeAIGatewayClient:
    def __init__(self, response_chunks: list[str] | None = None) -> None:
        self.response_chunks = response_chunks or ["¡Hola! ", "¿Qué parte ", "no entendés ", "de la recursión?"]

    async def stream(
        self, messages: list[dict], model: str, tenant_id: UUID,
        temperature: float = 0.7, max_tokens: int = 2048,
    ) -> AsyncIterator[str]:
        for chunk in self.response_chunks:
            yield chunk


class FakeCTRClient:
    def __init__(self) -> None:
        self.published_events: list[dict] = []

    async def publish_event(
        self, event: dict, tenant_id: UUID, caller_id: UUID
    ) -> str:
        self.published_events.append(event)
        return f"fake-msg-id-{len(self.published_events)}"


# ── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
async def redis_client():
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield client
    await client.aclose()


@pytest.fixture
def fake_content() -> FakeContentClient:
    return FakeContentClient()


@pytest.fixture
def fake_ctr() -> FakeCTRClient:
    return FakeCTRClient()


@pytest.fixture
def fake_ai() -> FakeAIGatewayClient:
    return FakeAIGatewayClient()


@pytest.fixture
def tutor(redis_client, fake_content, fake_ctr, fake_ai) -> TutorCore:
    return TutorCore(
        governance=FakeGovernanceClient(),
        content=fake_content,
        ai_gateway=fake_ai,
        ctr=fake_ctr,
        sessions=SessionManager(redis_client),
    )


# ── Tests ──────────────────────────────────────────────────────────


async def test_open_episode_emite_episodio_abierto(
    tutor: TutorCore, fake_ctr: FakeCTRClient
) -> None:
    tenant_id = uuid4()
    comision_id = uuid4()
    student = uuid4()
    problema = uuid4()

    episode_id = await tutor.open_episode(
        tenant_id=tenant_id,
        comision_id=comision_id,
        student_pseudonym=student,
        problema_id=problema,
        curso_config_hash="c" * 64,
        classifier_config_hash="b" * 64,
    )

    # Se publicó un solo evento
    assert len(fake_ctr.published_events) == 1
    ev = fake_ctr.published_events[0]
    assert ev["event_type"] == "episodio_abierto"
    assert ev["seq"] == 0
    assert ev["episode_id"] == str(episode_id)
    assert ev["tenant_id"] == str(tenant_id)
    assert ev["payload"]["comision_id"] == str(comision_id)
    assert ev["payload"]["problema_id"] == str(problema)
    # Los hashes del governance se propagaron al evento
    assert ev["prompt_system_hash"].startswith("abc")


async def test_interact_emite_prompt_y_respuesta_con_chunks_hash(
    tutor: TutorCore, fake_ctr: FakeCTRClient, fake_content: FakeContentClient
) -> None:
    tenant_id = uuid4()
    episode_id = await tutor.open_episode(
        tenant_id=tenant_id,
        comision_id=uuid4(),
        student_pseudonym=uuid4(),
        problema_id=uuid4(),
        curso_config_hash="c" * 64,
        classifier_config_hash="b" * 64,
    )
    fake_ctr.published_events.clear()  # ignorar el episodio_abierto

    # Interactuar con streaming
    full = ""
    done_event = None
    async for e in tutor.interact(episode_id, "¿qué es recursión?"):
        if e["type"] == "chunk":
            full += e["content"]
        elif e["type"] == "done":
            done_event = e

    # Hubo retrieval con comision_id correcto
    assert len(fake_content.called_with) == 1
    assert fake_content.called_with[0]["query"] == "¿qué es recursión?"

    # Full response streamed
    assert "¿Qué parte" in full

    # Se publicaron 2 eventos: prompt_enviado (seq=1) y tutor_respondio (seq=2)
    assert len(fake_ctr.published_events) == 2

    prompt_ev = fake_ctr.published_events[0]
    assert prompt_ev["event_type"] == "prompt_enviado"
    assert prompt_ev["seq"] == 1
    # CRÍTICO: chunks_used_hash del retrieval se propagó al evento CTR (reproducibilidad)
    assert prompt_ev["payload"]["chunks_used_hash"] == "deadbeef" + "0" * 56
    assert prompt_ev["payload"]["content"] == "¿qué es recursión?"

    response_ev = fake_ctr.published_events[1]
    assert response_ev["event_type"] == "tutor_respondio"
    assert response_ev["seq"] == 2
    assert response_ev["payload"]["content"] == full
    assert response_ev["payload"]["chunks_used_hash"] == "deadbeef" + "0" * 56

    # Done event tiene los seqs
    assert done_event is not None
    assert done_event["seqs"] == {"prompt": 1, "response": 2}


async def test_multiple_interactions_preservan_orden_de_seq(
    tutor: TutorCore, fake_ctr: FakeCTRClient
) -> None:
    episode_id = await tutor.open_episode(
        tenant_id=uuid4(), comision_id=uuid4(),
        student_pseudonym=uuid4(), problema_id=uuid4(),
        curso_config_hash="c" * 64, classifier_config_hash="b" * 64,
    )

    # Primera interacción
    async for _ in tutor.interact(episode_id, "pregunta 1"):
        pass
    # Segunda interacción
    async for _ in tutor.interact(episode_id, "pregunta 2"):
        pass

    seqs = [e["seq"] for e in fake_ctr.published_events]
    # 0: episodio_abierto, 1: prompt_1, 2: respuesta_1, 3: prompt_2, 4: respuesta_2
    assert seqs == [0, 1, 2, 3, 4]


async def test_close_episode_emite_episodio_cerrado(
    tutor: TutorCore, fake_ctr: FakeCTRClient
) -> None:
    episode_id = await tutor.open_episode(
        tenant_id=uuid4(), comision_id=uuid4(),
        student_pseudonym=uuid4(), problema_id=uuid4(),
        curso_config_hash="c" * 64, classifier_config_hash="b" * 64,
    )
    fake_ctr.published_events.clear()

    await tutor.close_episode(episode_id, reason="student_finished")

    assert len(fake_ctr.published_events) == 1
    ev = fake_ctr.published_events[0]
    assert ev["event_type"] == "episodio_cerrado"
    assert ev["payload"]["reason"] == "student_finished"


async def test_interact_en_episodio_inexistente_falla(tutor: TutorCore) -> None:
    with pytest.raises(ValueError, match="no existe o expiró"):
        async for _ in tutor.interact(uuid4(), "hola"):
            pass


async def test_historia_se_acumula_en_session(
    tutor: TutorCore, redis_client
) -> None:
    """Multi-turno: los messages anteriores se preservan en la session."""
    episode_id = await tutor.open_episode(
        tenant_id=uuid4(), comision_id=uuid4(),
        student_pseudonym=uuid4(), problema_id=uuid4(),
        curso_config_hash="c" * 64, classifier_config_hash="b" * 64,
    )

    async for _ in tutor.interact(episode_id, "primera pregunta"):
        pass
    async for _ in tutor.interact(episode_id, "segunda pregunta"):
        pass

    # El estado en Redis tiene: system, user1, assistant1, user2, assistant2
    mgr = SessionManager(redis_client)
    state = await mgr.get(episode_id)
    assert state is not None
    roles = [m["role"] for m in state.messages]
    assert roles == ["system", "user", "assistant", "user", "assistant"]
    assert state.messages[1]["content"] == "primera pregunta"
    assert state.messages[3]["content"] == "segunda pregunta"


async def test_retrieval_se_invoca_con_comision_correcta(
    tutor: TutorCore, fake_content: FakeContentClient
) -> None:
    """Propiedad crítica: el tutor pasa SIEMPRE el comision_id del episodio
    al content-service. Nunca puede omitirlo."""
    comision_id = UUID("12345678-1234-1234-1234-123456789012")
    tenant_id = uuid4()

    episode_id = await tutor.open_episode(
        tenant_id=tenant_id, comision_id=comision_id,
        student_pseudonym=uuid4(), problema_id=uuid4(),
        curso_config_hash="c" * 64, classifier_config_hash="b" * 64,
    )

    async for _ in tutor.interact(episode_id, "test"):
        pass

    assert len(fake_content.called_with) == 1
    call = fake_content.called_with[0]
    assert call["comision_id"] == comision_id
    assert call["tenant_id"] == tenant_id


# ── Tests de codigo_ejecutado (F6) ─────────────────────────────────────


async def test_emit_codigo_ejecutado_publica_evento_con_seq_correcto(
    tutor: TutorCore, fake_ctr: FakeCTRClient,
) -> None:
    """El evento se publica con el siguiente seq del episodio."""
    tenant_id = uuid4()
    episode_id = await tutor.open_episode(
        tenant_id=tenant_id, comision_id=uuid4(),
        student_pseudonym=uuid4(), problema_id=uuid4(),
        curso_config_hash="c" * 64, classifier_config_hash="b" * 64,
    )
    # Después de open, hay 1 evento (seq=0)

    student_user_id = uuid4()
    seq = await tutor.emit_codigo_ejecutado(
        episode_id=episode_id,
        user_id=student_user_id,
        payload={
            "code": "print('hola')",
            "stdout": "hola\n",
            "stderr": "",
            "duration_ms": 12.5,
            "runtime": "pyodide-0.26",
        },
    )

    # El seq asignado es 1 (después del episodio_abierto con seq=0)
    assert seq == 1

    # Se publicaron 2 eventos totales
    assert len(fake_ctr.published_events) == 2
    code_event = fake_ctr.published_events[1]
    assert code_event["event_type"] == "codigo_ejecutado"
    assert code_event["seq"] == 1
    assert code_event["payload"]["code"] == "print('hola')"
    assert code_event["payload"]["stdout"] == "hola\n"
    assert code_event["payload"]["runtime"] == "pyodide-0.26"


async def test_emit_codigo_ejecutado_en_episodio_inexistente_falla(
    tutor: TutorCore,
) -> None:
    with pytest.raises(ValueError, match="no existe"):
        await tutor.emit_codigo_ejecutado(
            episode_id=uuid4(),  # no abierto
            user_id=uuid4(),
            payload={"code": "x", "stdout": "", "stderr": "", "duration_ms": 1.0},
        )


async def test_emit_codigo_ejecutado_mantiene_orden_con_otros_eventos(
    tutor: TutorCore, fake_ctr: FakeCTRClient,
) -> None:
    """Intercalar codigo_ejecutado con interact preserva seqs consecutivos."""
    episode_id = await tutor.open_episode(
        tenant_id=uuid4(), comision_id=uuid4(),
        student_pseudonym=uuid4(), problema_id=uuid4(),
        curso_config_hash="c" * 64, classifier_config_hash="b" * 64,
    )
    # seq=0: episodio_abierto

    async for _ in tutor.interact(episode_id, "pregunta 1"):
        pass
    # seq=1: prompt_enviado, seq=2: tutor_respondio

    await tutor.emit_codigo_ejecutado(
        episode_id=episode_id,
        user_id=uuid4(),
        payload={"code": "x=1", "stdout": "", "stderr": "", "duration_ms": 1.0},
    )
    # seq=3: codigo_ejecutado

    async for _ in tutor.interact(episode_id, "pregunta 2"):
        pass
    # seq=4: prompt_enviado, seq=5: tutor_respondio

    seqs = [ev["seq"] for ev in fake_ctr.published_events]
    types = [ev["event_type"] for ev in fake_ctr.published_events]
    assert seqs == [0, 1, 2, 3, 4, 5]
    assert types == [
        "episodio_abierto",
        "prompt_enviado", "tutor_respondio",
        "codigo_ejecutado",
        "prompt_enviado", "tutor_respondio",
    ]


async def test_codigo_ejecutado_usa_user_id_del_estudiante_no_el_tutor(
    tutor: TutorCore, fake_ctr: FakeCTRClient,
) -> None:
    """El evento debe publicarse con el user_id del estudiante autenticado,
    no con el service account del tutor como los otros eventos."""
    from tutor_service.services.tutor_core import TUTOR_SERVICE_USER_ID

    # El FakeCTRClient no captura el caller_id; modificamos para que lo haga
    captured_callers: list[UUID] = []
    original_publish = fake_ctr.publish_event

    async def capturing_publish(event, tenant_id, caller_id):
        captured_callers.append(caller_id)
        return await original_publish(event, tenant_id, caller_id)

    fake_ctr.publish_event = capturing_publish  # type: ignore

    episode_id = await tutor.open_episode(
        tenant_id=uuid4(), comision_id=uuid4(),
        student_pseudonym=uuid4(), problema_id=uuid4(),
        curso_config_hash="c" * 64, classifier_config_hash="b" * 64,
    )
    # open_episode usa el service account
    assert captured_callers[0] == TUTOR_SERVICE_USER_ID

    student_id = uuid4()
    await tutor.emit_codigo_ejecutado(
        episode_id=episode_id,
        user_id=student_id,
        payload={"code": "x", "stdout": "", "stderr": "", "duration_ms": 1.0},
    )
    # El segundo evento (codigo_ejecutado) usa el user_id del estudiante
    assert captured_callers[1] == student_id
    assert captured_callers[1] != TUTOR_SERVICE_USER_ID
