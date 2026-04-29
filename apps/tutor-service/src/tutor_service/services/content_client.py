"""Cliente HTTP del content-service para retrieval."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx

logger = logging.getLogger(__name__)


@dataclass
class RetrievedChunk:
    id: UUID
    contenido: str
    material_id: UUID
    material_nombre: str
    position: int
    chunk_type: str
    score_rerank: float | None
    score_vector: float
    meta: dict[str, Any]


@dataclass
class RetrievalResult:
    chunks: list[RetrievedChunk]
    chunks_used_hash: str
    latency_ms: float
    rerank_applied: bool


class ContentClient:
    """Cliente del content-service.

    Propaga headers `X-*` del tutor-service como service-account para que
    el content-service autorice la llamada (rol `tutor_service`).
    """

    def __init__(self, base_url: str, timeout: float = 15.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def retrieve(
        self,
        query: str,
        comision_id: UUID,
        tenant_id: UUID,
        top_k: int = 5,
        score_threshold: float = 0.3,
    ) -> RetrievalResult:
        payload = {
            "query": query,
            "comision_id": str(comision_id),
            "top_k": top_k,
            "score_threshold": score_threshold,
        }
        headers = {
            "Content-Type": "application/json",
            "X-User-Id": "00000000-0000-0000-0000-000000000099",  # service-account
            "X-Tenant-Id": str(tenant_id),
            "X-User-Email": "tutor-service@platform.internal",
            "X-User-Roles": "tutor_service",
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/retrieve",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()

        chunks = [
            RetrievedChunk(
                id=UUID(c["id"]),
                contenido=c["contenido"],
                material_id=UUID(c["material_id"]),
                material_nombre=c["material_nombre"],
                position=c["position"],
                chunk_type=c["chunk_type"],
                score_rerank=c.get("score_rerank"),
                score_vector=c["score_vector"],
                meta=c.get("meta") or {},
            )
            for c in data["chunks"]
        ]

        return RetrievalResult(
            chunks=chunks,
            chunks_used_hash=data["chunks_used_hash"],
            latency_ms=data["latency_ms"],
            rerank_applied=data.get("rerank_applied", False),
        )
