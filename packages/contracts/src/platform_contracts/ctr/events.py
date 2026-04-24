"""Eventos del CTR (Cognitive Trace Record).

Cada evento del episodio es registrado con cadena SHA-256 encadenada.
Ver docs/plan-detallado-fases.md → F3.1 para detalles de implementación.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CTRBaseEvent(BaseModel):
    """Base de todos los eventos del CTR.

    Los campos obligatorios son los que permiten reconstruir la cadena y
    verificar integridad. Los payloads específicos viven en subclases.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    event_uuid: UUID = Field(description="Identidad global del evento (idempotencia)")
    episode_id: UUID = Field(description="Clave de partición del stream")
    tenant_id: UUID = Field(description="Universidad (tenant raíz)")
    seq: int = Field(ge=0, description="Secuencia ordinal dentro del episodio")
    ts: datetime = Field(description="Timestamp del evento en UTC ISO 8601")
    event_type: str
    prompt_system_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    prompt_system_version: str = Field(description="Versión semver del prompt activo")
    classifier_config_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


# ── Eventos de apertura y cierre ──────────────────────────────────────


class EpisodioAbiertoPayload(BaseModel):
    student_pseudonym: UUID
    problema_id: UUID
    comision_id: UUID
    curso_config_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class EpisodioAbierto(CTRBaseEvent):
    event_type: Literal["EpisodioAbierto"] = "EpisodioAbierto"
    payload: EpisodioAbiertoPayload


class EpisodioCerradoPayload(BaseModel):
    final_chain_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    total_events: int = Field(ge=1)
    duration_seconds: float = Field(ge=0)


class EpisodioCerrado(CTRBaseEvent):
    event_type: Literal["EpisodioCerrado"] = "EpisodioCerrado"
    payload: EpisodioCerradoPayload


class EpisodioAbandonadoPayload(BaseModel):
    reason: str  # "timeout", "beforeunload", "explicit"
    last_activity_seconds_ago: float


class EpisodioAbandonado(CTRBaseEvent):
    event_type: Literal["EpisodioAbandonado"] = "EpisodioAbandonado"
    payload: EpisodioAbandonadoPayload


# ── Interacción con el tutor ──────────────────────────────────────────


class PromptEnviadoPayload(BaseModel):
    content: str
    prompt_kind: Literal[
        "solicitud_directa",
        "comparativa",
        "epistemologica",
        "validacion",
        "aclaracion_enunciado",
    ]
    chunks_used_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class PromptEnviado(CTRBaseEvent):
    event_type: Literal["PromptEnviado"] = "PromptEnviado"
    payload: PromptEnviadoPayload


class RespuestaRecibidaPayload(BaseModel):
    content: str
    model_used: str  # ej. "claude-sonnet-4-6"
    socratic_compliance: float = Field(ge=0.0, le=1.0)
    violations: list[str] = Field(default_factory=list)


class RespuestaRecibida(CTRBaseEvent):
    event_type: Literal["RespuestaRecibida"] = "RespuestaRecibida"
    payload: RespuestaRecibidaPayload


# ── Actividad del estudiante ──────────────────────────────────────────


class LecturaEnunciadoPayload(BaseModel):
    duration_seconds: float = Field(ge=0)


class LecturaEnunciado(CTRBaseEvent):
    event_type: Literal["LecturaEnunciado"] = "LecturaEnunciado"
    payload: LecturaEnunciadoPayload


class NotaPersonalPayload(BaseModel):
    content: str
    words: int = Field(ge=0)


class NotaPersonal(CTRBaseEvent):
    event_type: Literal["NotaPersonal"] = "NotaPersonal"
    payload: NotaPersonalPayload


class EdicionCodigoPayload(BaseModel):
    snapshot: str  # código completo en el momento del evento
    diff_chars: int  # cantidad de caracteres cambiados desde evento anterior
    language: str


class EdicionCodigo(CTRBaseEvent):
    event_type: Literal["EdicionCodigo"] = "EdicionCodigo"
    payload: EdicionCodigoPayload


class TestsEjecutadosPayload(BaseModel):
    passed: int = Field(ge=0)
    failed: int = Field(ge=0)
    total: int = Field(ge=0)
    stdout: str | None = None
    failed_test_names: list[str] = Field(default_factory=list)


class TestsEjecutados(CTRBaseEvent):
    event_type: Literal["TestsEjecutados"] = "TestsEjecutados"
    payload: TestsEjecutadosPayload
