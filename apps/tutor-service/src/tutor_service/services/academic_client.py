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


@dataclass
class ComisionResponse:
    """Subset de campos de Comision que el tutor-service necesita.

    ADR-040: el tutor consume `materia_id` para propagarlo al ai-gateway en cada
    turno (resolver BYOK con scope=materia primero, fallback a scope=tenant).
    """

    id: UUID
    tenant_id: UUID
    materia_id: UUID
    periodo_id: UUID


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

    async def get_comision(
        self,
        comision_id: UUID,
        tenant_id: UUID,
        caller_id: UUID,
    ) -> ComisionResponse | None:
        """Obtiene una Comision por id.

        ADR-040 (Sec 6.2): se invoca al abrir un episodio para resolver
        `materia_id` y cachearlo en `SessionState`. Si la comision no existe
        (404) o el caller no tiene permiso (4xx), devuelve None — el caller
        degrada a `materia_id=None` (BYOK fallback a scope=tenant).

        Returns:
            ComisionResponse si existe (HTTP 200).
            None si la comision no existe (HTTP 404).

        Raises:
            httpx.HTTPStatusError: en caso de 5xx.
        """
        headers = {
            "X-User-Id": str(caller_id),
            "X-Tenant-Id": str(tenant_id),
            "X-User-Email": "tutor-service@platform.internal",
            "X-User-Roles": "tutor_service",
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(
                f"{self.base_url}/api/v1/comisiones/{comision_id}",
                headers=headers,
            )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
        return ComisionResponse(
            id=UUID(data["id"]),
            tenant_id=UUID(data["tenant_id"]),
            materia_id=UUID(data["materia_id"]),
            periodo_id=UUID(data["periodo_id"]),
        )


    async def get_tarea_practica_full(
        self,
        tarea_id: UUID,
        tenant_id: UUID,
        caller_id: UUID,
    ) -> dict | None:
        """Obtiene la TP completa incluyendo rubrica y ejercicios.

        tutor-context-rag-rubrica: se usa al abrir el episodio para resolver
        la rubrica de la TP (o del ejercicio especifico si ejercicio_orden!=None)
        y cachearla en SessionState. Best-effort: si falla, el caller ignora y
        el episodio se abre sin contexto de rubrica.

        Returns:
            Dict con todos los campos del response del academic-service
            (incluye rubrica JSONB y ejercicios JSONB array), o None si 404.
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
        return resp.json()

    async def get_ejercicio(
        self,
        tarea_id: UUID,
        ejercicio_orden: int,
        tenant_id: UUID,
        caller_id: UUID,
    ) -> dict | None:
        """Obtiene un ejercicio especifico de una TP (tp-entregas-correccion).

        Returns:
            Dict con {orden, titulo, enunciado_md, inicial_codigo, test_cases, peso}
            o None si la TP no existe o el ejercicio con ese orden no existe.
        """
        headers = {
            "X-User-Id": str(caller_id),
            "X-Tenant-Id": str(tenant_id),
            "X-User-Email": "tutor-service@platform.internal",
            "X-User-Roles": "tutor_service",
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(
                f"{self.base_url}/api/v1/tareas-practicas/{tarea_id}/ejercicios",
                headers=headers,
            )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
        ejercicios = data.get("ejercicios", [])
        for ej in ejercicios:
            if ej.get("orden") == ejercicio_orden:
                return ej
        return None


def _parse_datetime(value: str | None) -> datetime | None:
    """Parsea ISO-8601 que puede venir con sufijo Z o con offset."""
    if value is None:
        return None
    # fromisoformat acepta `+00:00` pero no `Z` en Python <3.11; lo
    # normalizamos para mantener compatibilidad.
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)
