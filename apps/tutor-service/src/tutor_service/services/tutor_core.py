"""Tutor core — orquestación del flujo socrático.

Flujo de una interacción:
  1. Recibir query del estudiante
  2. Retrieval al content-service por comision_id → chunks + chunks_used_hash
  3. Armar messages con prompt sistema + contexto RAG + historia + query
  4. Emitir evento `PromptEnviado` al CTR (con chunks_used_hash)
  5. Invocar al ai-gateway con streaming
  6. Stream al cliente; acumular respuesta
  7. Emitir evento `TutorRespondio` al CTR
  8. Actualizar session state
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import UUID, uuid4

from tutor_service.services.clients import (
    AIGatewayClient,
    CTRClient,
    ContentClient,
    GovernanceClient,
    PromptConfig,
)
from tutor_service.services.session import SessionManager, SessionState

logger = logging.getLogger(__name__)


# UUID fijo del service-account del tutor (no cambia entre tenants)
TUTOR_SERVICE_USER_ID = UUID("00000000-0000-0000-0000-000000000010")


class TutorCore:
    def __init__(
        self,
        governance: GovernanceClient,
        content: ContentClient,
        ai_gateway: AIGatewayClient,
        ctr: CTRClient,
        sessions: SessionManager,
        default_prompt_name: str = "tutor",
        default_prompt_version: str = "v1.0.0",
        default_model: str = "claude-sonnet-4-6",
    ) -> None:
        self.governance = governance
        self.content = content
        self.ai_gateway = ai_gateway
        self.ctr = ctr
        self.sessions = sessions
        self.default_prompt_name = default_prompt_name
        self.default_prompt_version = default_prompt_version
        self.default_model = default_model

    # ── Abrir episodio ─────────────────────────────────────────────────

    async def open_episode(
        self,
        tenant_id: UUID,
        comision_id: UUID,
        student_pseudonym: UUID,
        problema_id: UUID,
        curso_config_hash: str,
        classifier_config_hash: str,
        model: str | None = None,
    ) -> UUID:
        """Crea un nuevo episodio y emite EpisodioAbierto al CTR.

        Args:
            model: override del modelo para este episodio (F6 feature flags).
              Si None, usa self.default_model.

        Devuelve el episode_id. El frontend recibe este id y lo usa en
        interacciones posteriores.
        """
        episode_id = uuid4()

        # 1. Cargar prompt activo (con verificación de hash)
        prompt = await self.governance.get_prompt(
            self.default_prompt_name, self.default_prompt_version
        )

        # 2. Crear session state en Redis
        state = SessionState(
            episode_id=episode_id,
            tenant_id=tenant_id,
            comision_id=comision_id,
            student_pseudonym=student_pseudonym,
            seq=0,
            messages=[{"role": "system", "content": prompt.content}],
            prompt_system_hash=prompt.hash,
            prompt_system_version=prompt.version,
            classifier_config_hash=classifier_config_hash,
            curso_config_hash=curso_config_hash,
            model=model or self.default_model,
        )
        await self.sessions.set(state)

        # 3. Emitir EpisodioAbierto (seq=0)
        event = self._build_event(
            state=state,
            event_type="episodio_abierto",
            payload={
                "student_pseudonym": str(student_pseudonym),
                "problema_id": str(problema_id),
                "comision_id": str(comision_id),
                "curso_config_hash": curso_config_hash,
                "model": state.model,
            },
        )
        await self.sessions.next_seq(state)
        await self.ctr.publish_event(event, tenant_id, TUTOR_SERVICE_USER_ID)

        return episode_id

    # ── Interacción (streaming) ────────────────────────────────────────

    async def interact(
        self, episode_id: UUID, user_message: str
    ) -> AsyncIterator[dict]:
        """Procesa una interacción en streaming.

        Yieldea eventos del formato:
          {"type": "chunk", "content": "..."}
          {"type": "done", "chunks_used_hash": "...", "tokens_delta": {"seq_prompt": N, "seq_response": N+1}}
        """
        state = await self.sessions.get(episode_id)
        if state is None:
            raise ValueError(f"Episode {episode_id} no existe o expiró")

        # 1. Retrieval con comision_id mandatorio (defensa en profundidad)
        retrieval = await self.content.retrieve(
            query=user_message,
            comision_id=state.comision_id,
            top_k=5,
            tenant_id=state.tenant_id,
            caller_id=TUTOR_SERVICE_USER_ID,
        )

        # 2. Armar contexto RAG para el LLM
        rag_context = self._format_rag_context(retrieval.chunks)

        # 3. Emitir PromptEnviado al CTR
        prompt_seq = await self.sessions.next_seq(state)
        prompt_event = self._build_event(
            state=state,
            seq=prompt_seq,
            event_type="prompt_enviado",
            payload={
                "content": user_message,
                "prompt_kind": "solicitud_directa",
                "chunks_used_hash": retrieval.chunks_used_hash,
            },
        )
        await self.ctr.publish_event(
            prompt_event, state.tenant_id, TUTOR_SERVICE_USER_ID
        )

        # 4. Armar messages para el LLM
        messages = state.messages.copy()
        if rag_context:
            # Inyectar contexto como mensaje system adicional
            messages.append({
                "role": "system",
                "content": f"Material de cátedra relevante:\n{rag_context}",
            })
        messages.append({"role": "user", "content": user_message})

        # 5. Stream del ai-gateway
        full_response = ""
        async for chunk in self.ai_gateway.stream(
            messages=messages,
            model=self.default_model,
            tenant_id=state.tenant_id,
            temperature=0.7,
        ):
            full_response += chunk
            yield {"type": "chunk", "content": chunk}

        # 6. Actualizar session con los mensajes nuevos
        state.messages.append({"role": "user", "content": user_message})
        state.messages.append({"role": "assistant", "content": full_response})
        await self.sessions.set(state)

        # 7. Emitir TutorRespondio
        response_seq = await self.sessions.next_seq(state)
        response_event = self._build_event(
            state=state,
            seq=response_seq,
            event_type="tutor_respondio",
            payload={
                "content": full_response,
                "chunks_used_hash": retrieval.chunks_used_hash,
                "model": self.default_model,
            },
        )
        await self.ctr.publish_event(
            response_event, state.tenant_id, TUTOR_SERVICE_USER_ID
        )

        yield {
            "type": "done",
            "chunks_used_hash": retrieval.chunks_used_hash,
            "seqs": {"prompt": prompt_seq, "response": response_seq},
        }

    # ── Cerrar episodio ─────────────────────────────────────────────────

    async def close_episode(
        self, episode_id: UUID, reason: str = "student_closed"
    ) -> None:
        state = await self.sessions.get(episode_id)
        if state is None:
            raise ValueError(f"Episode {episode_id} no existe o expiró")

        close_seq = await self.sessions.next_seq(state)
        event = self._build_event(
            state=state,
            seq=close_seq,
            event_type="episodio_cerrado",
            payload={"reason": reason, "total_events": close_seq + 1},
        )
        await self.ctr.publish_event(event, state.tenant_id, TUTOR_SERVICE_USER_ID)
        await self.sessions.delete(episode_id)

    # ── Evento codigo_ejecutado (emitido por el frontend con Pyodide) ───

    async def emit_codigo_ejecutado(
        self,
        episode_id: UUID,
        user_id: UUID,
        payload: dict,
    ) -> int:
        """Publica un evento codigo_ejecutado al CTR.

        El `user_id` es el del estudiante autenticado — no el service
        account del tutor. Esto es importante porque codigo_ejecutado es
        el único evento que el estudiante genera directamente (otros
        eventos son siempre emitidos por el tutor-service como servicio).

        Args:
            episode_id: episodio vigente en el session manager
            user_id: UUID del estudiante autenticado (del JWT)
            payload: code/stdout/stderr/duration_ms/runtime

        Returns:
            El seq asignado al evento (útil para debugging del cliente).
        """
        state = await self.sessions.get(episode_id)
        if state is None:
            raise ValueError(f"Episode {episode_id} no existe o expiró")

        seq = await self.sessions.next_seq(state)
        event = self._build_event(
            state=state,
            seq=seq,
            event_type="codigo_ejecutado",
            payload=payload,
        )
        # Publicar como el estudiante, no como el service account
        await self.ctr.publish_event(event, state.tenant_id, user_id)
        return seq

    # ── Helpers ─────────────────────────────────────────────────────────

    def _build_event(
        self,
        state: SessionState,
        event_type: str,
        payload: dict,
        seq: int | None = None,
    ) -> dict:
        """Construye el dict de evento en el formato que espera ctr-service.

        El `seq` se pasa explícitamente cuando ya lo reservamos con
        `sessions.next_seq()` (para que el orden de publicación refleje
        la reserva del seq).
        """
        if seq is None:
            seq = state.seq
        return {
            "event_uuid": str(uuid4()),
            "episode_id": str(state.episode_id),
            "tenant_id": str(state.tenant_id),
            "seq": seq,
            "event_type": event_type,
            "ts": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "payload": payload,
            "prompt_system_hash": state.prompt_system_hash,
            "prompt_system_version": state.prompt_system_version,
            "classifier_config_hash": state.classifier_config_hash,
        }

    def _format_rag_context(self, chunks) -> str:
        if not chunks:
            return ""
        blocks = []
        for i, c in enumerate(chunks, 1):
            blocks.append(
                f"[Fuente {i}: {c.material_nombre}]\n{c.contenido}"
            )
        return "\n\n".join(blocks)
