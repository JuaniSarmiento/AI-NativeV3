"""Eventos del CTR (Cognitive Trace Record).

Cada evento del episodio es registrado con cadena SHA-256 encadenada.
Ver docs/plan-detallado-fases.md → F3.1 para detalles de implementación.

Convención de naming (F1, alineada con runtime):
- Las clases Pydantic conservan PascalCase (idioma Python).
- El campo `event_type` es el string que viaja en el bus y se persiste:
  va en snake_case porque es lo que ya emite el tutor-service en producción.
  Cambiar el string en runtime obliga a migrar seeds, tests, dashboards y
  CTRs ya persistidos — por eso alineamos los contracts al código vigente.
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
    event_type: Literal["episodio_abierto"] = "episodio_abierto"
    payload: EpisodioAbiertoPayload


class EpisodioCerradoPayload(BaseModel):
    final_chain_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    total_events: int = Field(ge=1)
    duration_seconds: float = Field(ge=0)


class EpisodioCerrado(CTRBaseEvent):
    event_type: Literal["episodio_cerrado"] = "episodio_cerrado"
    payload: EpisodioCerradoPayload


class EpisodioAbandonadoPayload(BaseModel):
    reason: str  # "timeout", "beforeunload", "explicit"
    last_activity_seconds_ago: float


class EpisodioAbandonado(CTRBaseEvent):
    event_type: Literal["episodio_abandonado"] = "episodio_abandonado"
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
    event_type: Literal["prompt_enviado"] = "prompt_enviado"
    payload: PromptEnviadoPayload


# F2 + F8: renombrado RespuestaRecibida → TutorRespondio (alinea con runtime)
# y `socratic_compliance`/`violations` pasan a ser opcionales hasta que el
# postprocesamiento real (detección de jailbreak, cálculo de compliance)
# se implemente. Ver 02-cambios-codigo-grandes.md → G3.
class TutorRespondioPayload(BaseModel):
    content: str
    model_used: str  # ej. "claude-sonnet-4-6"
    chunks_used_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    socratic_compliance: float | None = Field(default=None, ge=0.0, le=1.0)
    violations: list[str] = Field(default_factory=list)


class TutorRespondio(CTRBaseEvent):
    event_type: Literal["tutor_respondio"] = "tutor_respondio"
    payload: TutorRespondioPayload


# ── Actividad del estudiante ──────────────────────────────────────────


class LecturaEnunciadoPayload(BaseModel):
    duration_seconds: float = Field(ge=0)


class LecturaEnunciado(CTRBaseEvent):
    event_type: Literal["lectura_enunciado"] = "lectura_enunciado"
    payload: LecturaEnunciadoPayload


# F3: renombrado NotaPersonal → AnotacionCreada (alinea con runtime).
# "Anotación" es más neutra que "Nota" y transmite mejor la idea de marca
# reflexiva. La tesis sigue hablando de "Nota personal" en la teoría.
class AnotacionCreadaPayload(BaseModel):
    content: str
    words: int = Field(ge=0)


class AnotacionCreada(CTRBaseEvent):
    event_type: Literal["anotacion_creada"] = "anotacion_creada"
    payload: AnotacionCreadaPayload


# F6: campo `origin` opcional para distinguir "el estudiante tipeó" de
# "copió del tutor" o "pasteó externo". Permite evidencia directa de
# delegación/apropiación sin depender solo de inferencia temporal (CCD).
class EdicionCodigoPayload(BaseModel):
    snapshot: str  # código completo en el momento del evento
    diff_chars: int  # cantidad de caracteres cambiados desde evento anterior
    language: str
    origin: Literal["student_typed", "copied_from_tutor", "pasted_external"] | None = (
        Field(default=None, description="Procedencia del cambio. None = legacy/desconocido.")
    )


class EdicionCodigo(CTRBaseEvent):
    event_type: Literal["edicion_codigo"] = "edicion_codigo"
    payload: EdicionCodigoPayload


# F4: renombrado TestsEjecutados → CodigoEjecutado (alinea con runtime).
# El payload se ampliá: passed/failed/total son opcionales (ejecución
# genérica de Pyodide puede no llevar tests). Se agregan campos de
# ejecución que el frontend ya manda (code/stdout/stderr/duration_ms/runtime).
class CodigoEjecutadoPayload(BaseModel):
    code: str
    stdout: str | None = None
    stderr: str | None = None
    duration_ms: int = Field(ge=0)
    runtime: str  # "pyodide", "python", etc.
    # Opcionales: solo presentes si se ejecutaron tests
    passed: int | None = Field(default=None, ge=0)
    failed: int | None = Field(default=None, ge=0)
    total: int | None = Field(default=None, ge=0)
    failed_test_names: list[str] = Field(default_factory=list)


class CodigoEjecutado(CTRBaseEvent):
    event_type: Literal["codigo_ejecutado"] = "codigo_ejecutado"
    payload: CodigoEjecutadoPayload
