"""Clientes HTTP hacia los otros servicios.

El tutor depende de 4 servicios:
  - governance-service: prompt activo + hash
  - content-service: retrieval RAG con comision_id
  - ai-gateway: invocación al LLM con budget
  - ctr-service: emisión de eventos de la cadena criptográfica
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from uuid import UUID

import httpx

logger = logging.getLogger(__name__)


@dataclass
class PromptConfig:
    name: str
    version: str
    content: str
    hash: str


@dataclass
class RetrievedChunk:
    id: UUID
    contenido: str
    material_nombre: str
    score_rerank: float | None


@dataclass
class RetrievalResult:
    chunks: list[RetrievedChunk]
    chunks_used_hash: str
    latency_ms: float


class GovernanceClient:
    def __init__(self, base_url: str, timeout: float = 10.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def get_prompt(self, name: str, version: str) -> PromptConfig:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.get(f"{self.base_url}/api/v1/prompts/{name}/{version}")
            r.raise_for_status()
            data = r.json()
        return PromptConfig(
            name=data["name"],
            version=data["version"],
            content=data["content"],
            hash=data["hash"],
        )

    async def get_active_configs(self) -> dict:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.get(f"{self.base_url}/api/v1/active_configs")
            r.raise_for_status()
            return r.json()


class ContentClient:
    def __init__(self, base_url: str, timeout: float = 15.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def retrieve(
        self,
        query: str,
        comision_id: UUID,
        top_k: int,
        tenant_id: UUID,
        caller_id: UUID,
    ) -> RetrievalResult:
        headers = {
            # Service-account headers (F3). En F5 migramos a mTLS.
            "X-User-Id": str(caller_id),
            "X-Tenant-Id": str(tenant_id),
            "X-User-Email": "tutor-service@platform.internal",
            "X-User-Roles": "tutor_service",
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(
                f"{self.base_url}/api/v1/retrieve",
                json={
                    "query": query,
                    "comision_id": str(comision_id),
                    "top_k": top_k,
                    "score_threshold": 0.3,
                },
                headers=headers,
            )
            r.raise_for_status()
            data = r.json()
        chunks = [
            RetrievedChunk(
                id=UUID(c["id"]),
                contenido=c["contenido"],
                material_nombre=c["material_nombre"],
                score_rerank=c.get("score_rerank"),
            )
            for c in data["chunks"]
        ]
        return RetrievalResult(
            chunks=chunks,
            chunks_used_hash=data["chunks_used_hash"],
            latency_ms=data["latency_ms"],
        )


class AIGatewayClient:
    def __init__(self, base_url: str, timeout: float = 60.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def stream(
        self,
        messages: list[dict],
        model: str,
        tenant_id: UUID,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        materia_id: UUID | None = None,
    ) -> AsyncIterator[str]:
        """Yieldea chunks de texto desde el SSE del ai-gateway.

        Args:
            materia_id: ADR-040 (Sec 6.2). Cuando esta presente, el resolver
                BYOK del ai-gateway busca key con scope=materia primero;
                fallback a scope=tenant si no hay match. None = legacy o
                no resoluble — degrada a tenant_fallback.
        """
        headers = {
            "X-Tenant-Id": str(tenant_id),
            "X-Caller": "tutor-service",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        payload: dict[str, object] = {
            "messages": messages,
            "model": model,
            "feature": "tutor",
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if materia_id is not None:
            payload["materia_id"] = str(materia_id)
        body = json.dumps(payload)

        async with (
            httpx.AsyncClient(timeout=self.timeout) as client,
            client.stream(
                "POST",
                f"{self.base_url}/api/v1/stream",
                content=body,
                headers=headers,
            ) as response,
        ):
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                try:
                    event = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue
                if event.get("type") == "token":
                    yield event.get("content", "")
                elif event.get("type") == "error":
                    raise RuntimeError(event.get("message", "unknown error"))


class CTRClient:
    def __init__(self, base_url: str, timeout: float = 5.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def publish_event(self, event: dict, tenant_id: UUID, caller_id: UUID) -> str:
        headers = {
            "X-User-Id": str(caller_id),
            "X-Tenant-Id": str(tenant_id),
            "X-User-Email": "tutor-service@platform.internal",
            "X-User-Roles": "tutor_service",
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(
                f"{self.base_url}/api/v1/events",
                json=event,
                headers=headers,
            )
            r.raise_for_status()
            data = r.json()
        return data["message_id"]

    async def get_episode(self, episode_id: UUID, tenant_id: UUID, caller_id: UUID) -> dict | None:
        """Lee el episodio + sus eventos desde el ctr-service.

        Returns:
            Dict con la forma de `EpisodeWithEvents` (id, tenant_id,
            comision_id, problema_id, estado, opened_at, closed_at,
            events=[{event_type, seq, payload, ts, ...}, ...]) si existe.
            None si el ctr-service responde 404.

        Raises:
            httpx.HTTPStatusError: en caso de 5xx u otros errores.
        """
        headers = {
            "X-User-Id": str(caller_id),
            "X-Tenant-Id": str(tenant_id),
            "X-User-Email": "tutor-service@platform.internal",
            "X-User-Roles": "tutor_service",
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.get(
                f"{self.base_url}/api/v1/episodes/{episode_id}",
                headers=headers,
            )
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()
