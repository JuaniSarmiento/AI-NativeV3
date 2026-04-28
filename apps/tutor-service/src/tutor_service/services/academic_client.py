"""Cliente HTTP del academic-service para validar TareaPractica.

Se usa al abrir un episodio para verificar que el `problema_id` apunta a
una TP existente, publicada, en plazo y de la comisión correcta.

Mirror del patrón `ContentClient`: usa headers de service-account
(`X-User-Id` con el UUID fijo del tutor, `X-Tenant-Id`, `X-User-Roles`).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

import httpx

logger = logging.getLogger(__name__)


@dataclass
class TareaPracticaResponse:
    """Subset de campos de TareaPractica que el tutor-service necesita."""

    id: UUID
    tenant_id: UUID
    comision_id: UUID
    estado: str
    fecha_inicio: datetime | None
    fecha_fin: datetime | None


class AcademicClient:
    """Cliente del academic-service.

    Propaga headers `X-*` del tutor-service como service-account para que
    el academic-service autorice la llamada (rol `tutor_service`).
    """

    def __init__(self, base_url: str, timeout: float = 10.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def get_tarea_practica(
        self,
        tarea_id: UUID,
        tenant_id: UUID,
        caller_id: UUID,
    ) -> TareaPracticaResponse | None:
        """Obtiene una TareaPractica por id.

        Returns:
            TareaPracticaResponse si existe (HTTP 200).
            None si la TP no existe (HTTP 404).

        Raises:
            httpx.HTTPStatusError: en caso de 5xx u otros errores HTTP no
                manejados (el caller decide cómo escalarlo).
        """
        headers = {
            "X-User-Id": str(caller_id),
            "X-Tenant-Id": str(tenant_id),
            "X-User-Email": "tutor-service@platform.internal",
            "X-User-Roles": "tutor_service",
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(
                f"{self.base_url}/api/v1/tareas-practicas/{tarea_id}",
                headers=headers,
            )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
        return TareaPracticaResponse(
            id=UUID(data["id"]),
            tenant_id=UUID(data["tenant_id"]),
            comision_id=UUID(data["comision_id"]),
            estado=data["estado"],
            fecha_inicio=_parse_datetime(data.get("fecha_inicio")),
            fecha_fin=_parse_datetime(data.get("fecha_fin")),
        )


def _parse_datetime(value: str | None) -> datetime | None:
    """Parsea ISO-8601 que puede venir con sufijo Z o con offset."""
    if value is None:
        return None
    # fromisoformat acepta `+00:00` pero no `Z` en Python <3.11; lo
    # normalizamos para mantener compatibilidad.
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)
