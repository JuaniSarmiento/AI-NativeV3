"""Session manager del tutor.

El tutor mantiene una sesión por episodio con:
- seq actual (próximo evento a publicar)
- mensajes previos de la conversación (para contexto multi-turno)

Estado en Redis con TTL de 6h (las sesiones típicas duran <1h). Al
cerrar episodio o al expirar, el state se elimina; la fuente de verdad
histórica es el CTR en Postgres.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

import redis.asyncio as redis


SESSION_TTL = 6 * 3600  # 6 horas


@dataclass
class SessionState:
    episode_id: UUID
    tenant_id: UUID
    comision_id: UUID
    student_pseudonym: UUID
    seq: int = 0
    messages: list[dict[str, str]] = field(default_factory=list)
    # [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]
    prompt_system_hash: str = ""
    prompt_system_version: str = ""
    classifier_config_hash: str = ""
    curso_config_hash: str = ""
    model: str = ""  # seleccionado por feature flag en open_episode


class SessionManager:
    def __init__(self, redis_client: redis.Redis) -> None:
        self.redis = redis_client

    def _key(self, episode_id: UUID) -> str:
        return f"tutor:session:{episode_id}"

    async def get(self, episode_id: UUID) -> SessionState | None:
        raw = await self.redis.get(self._key(episode_id))
        if raw is None:
            return None
        data = json.loads(raw)
        return SessionState(
            episode_id=UUID(data["episode_id"]),
            tenant_id=UUID(data["tenant_id"]),
            comision_id=UUID(data["comision_id"]),
            student_pseudonym=UUID(data["student_pseudonym"]),
            seq=data["seq"],
            messages=data["messages"],
            prompt_system_hash=data["prompt_system_hash"],
            prompt_system_version=data["prompt_system_version"],
            classifier_config_hash=data["classifier_config_hash"],
            curso_config_hash=data["curso_config_hash"],
        )

    async def set(self, state: SessionState) -> None:
        data = {
            "episode_id": str(state.episode_id),
            "tenant_id": str(state.tenant_id),
            "comision_id": str(state.comision_id),
            "student_pseudonym": str(state.student_pseudonym),
            "seq": state.seq,
            "messages": state.messages,
            "prompt_system_hash": state.prompt_system_hash,
            "prompt_system_version": state.prompt_system_version,
            "classifier_config_hash": state.classifier_config_hash,
            "curso_config_hash": state.curso_config_hash,
        }
        await self.redis.setex(
            self._key(state.episode_id), SESSION_TTL, json.dumps(data)
        )

    async def delete(self, episode_id: UUID) -> None:
        await self.redis.delete(self._key(episode_id))

    async def next_seq(self, state: SessionState) -> int:
        """Obtiene y actualiza el seq atómicamente. Devuelve el seq a usar
        para el próximo evento (el siguiente será seq+1)."""
        current = state.seq
        state.seq += 1
        await self.set(state)
        return current
