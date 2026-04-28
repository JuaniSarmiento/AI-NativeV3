"""Jerarquía operativa: Periodo → Comisión → Inscripción + Usuario_Comision."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

import sqlalchemy as sa
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from academic_service.models.base import (
    Base,
    TenantMixin,
    TimestampMixin,
    fk_uuid,
    uuid_pk,
)

if TYPE_CHECKING:
    from academic_service.models.institucional import Materia


class Periodo(Base, TenantMixin, TimestampMixin):
    """Período lectivo (ej. 2026-S1, 2026-S2)."""

    __tablename__ = "periodos"

    id: Mapped[uuid.UUID] = uuid_pk()
    codigo: Mapped[str] = mapped_column(String(20), nullable=False)
    nombre: Mapped[str] = mapped_column(String(100), nullable=False)
    fecha_inicio: Mapped[date] = mapped_column(Date, nullable=False)
    fecha_fin: Mapped[date] = mapped_column(Date, nullable=False)
    estado: Mapped[str] = mapped_column(String(20), default="abierto")  # abierto|cerrado

    comisiones: Mapped[list[Comision]] = relationship(back_populates="periodo")

    __table_args__ = (
        UniqueConstraint("tenant_id", "codigo", name="uq_periodo_tenant_codigo"),
    )


class Comision(Base, TenantMixin, TimestampMixin):
    """Instancia concreta de una Materia en un Periodo específico.

    Es la unidad operativa principal del sistema: docentes asignados,
    estudiantes inscriptos, material de cátedra, tutor socrático y CTR
    viven TODOS al nivel de Comisión.
    """

    __tablename__ = "comisiones"

    id: Mapped[uuid.UUID] = uuid_pk()
    materia_id: Mapped[uuid.UUID] = fk_uuid("materias.id")
    periodo_id: Mapped[uuid.UUID] = fk_uuid("periodos.id")
    codigo: Mapped[str] = mapped_column(String(50), nullable=False)
    cupo_maximo: Mapped[int] = mapped_column(Integer, default=50)
    horario: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # Hash de la configuración completa del curso AI-Native (prompt +
    # reference_profile + classifier_config); forma parte de cada evento
    # CTR de esta comisión, ver ADR-009.
    curso_config_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Presupuesto mensual de IA en USD
    ai_budget_monthly_usd: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), default=Decimal("100.00")
    )

    materia: Mapped[Materia] = relationship(back_populates="comisiones")
    periodo: Mapped[Periodo] = relationship(back_populates="comisiones")
    inscripciones: Mapped[list[Inscripcion]] = relationship(back_populates="comision")
    usuarios_comision: Mapped[list[UsuarioComision]] = relationship(
        back_populates="comision"
    )

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "materia_id", "periodo_id", "codigo",
            name="uq_comision_codigo",
        ),
    )


class Inscripcion(Base, TenantMixin, TimestampMixin):
    """Relación estudiante-comisión.

    El estudiante aparece por su pseudónimo. La identidad real vive en
    Keycloak (no en este monorepo); el pseudónimo es opaco — para
    des-identificar, ver packages/platform-ops/privacy.py.
    """

    __tablename__ = "inscripciones"

    id: Mapped[uuid.UUID] = uuid_pk()
    comision_id: Mapped[uuid.UUID] = fk_uuid("comisiones.id")
    student_pseudonym: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), nullable=False, index=True
    )
    rol: Mapped[str] = mapped_column(String(20), default="regular")  # regular|oyente|reinscripcion
    estado: Mapped[str] = mapped_column(String(20), default="activa")
    # activa|cursando|aprobado|desaprobado|abandono
    fecha_inscripcion: Mapped[date] = mapped_column(Date, nullable=False)
    nota_final: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    fecha_cierre: Mapped[date | None] = mapped_column(Date, nullable=True)

    comision: Mapped[Comision] = relationship(back_populates="inscripciones")

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "comision_id", "student_pseudonym",
            name="uq_inscripcion_student",
        ),
    )


class UsuarioComision(Base, TenantMixin, TimestampMixin):
    """Asignación de rol de docente/auxiliar/JTP a una comisión.

    Es independiente de las Inscripciones (estudiantes) porque un mismo
    usuario puede ser docente en varias comisiones y estudiante en otras.
    """

    __tablename__ = "usuarios_comision"

    id: Mapped[uuid.UUID] = uuid_pk()
    comision_id: Mapped[uuid.UUID] = fk_uuid("comisiones.id")
    user_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    rol: Mapped[str] = mapped_column(String(20), nullable=False)
    # titular|adjunto|jtp|ayudante|corrector
    permisos_extra: Mapped[list[str]] = mapped_column(JSONB, default=list)
    fecha_desde: Mapped[date] = mapped_column(Date, nullable=False)
    fecha_hasta: Mapped[date | None] = mapped_column(Date, nullable=True)

    comision: Mapped[Comision] = relationship(back_populates="usuarios_comision")

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "comision_id", "user_id", "rol",
            name="uq_usuario_comision",
        ),
    )


class TareaPractica(Base, TenantMixin, TimestampMixin):
    """Trabajo Práctico (TP) asignado a una comisión.

    Entidad central del piloto UNSL. Cada estudiante abre episodios CTR
    referenciando un TP; el classifier agrupa resultados por TP. Las
    versiones publicadas son inmutables — una nueva versión crea una fila
    nueva con `version++` y `parent_tarea_id` apuntando a la predecesora.
    """

    __tablename__ = "tareas_practicas"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    comision_id: Mapped[uuid.UUID] = fk_uuid("comisiones.id")

    codigo: Mapped[str] = mapped_column(String(20), nullable=False)
    titulo: Mapped[str] = mapped_column(String(200), nullable=False)
    enunciado: Mapped[str] = mapped_column(Text, nullable=False)
    inicial_codigo: Mapped[str | None] = mapped_column(Text, nullable=True)

    fecha_inicio: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    fecha_fin: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    peso: Mapped[Decimal] = mapped_column(
        Numeric(5, 4), nullable=False, default=Decimal("1.0")
    )

    rubrica: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    estado: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    parent_tarea_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("tareas_practicas.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    # ADR-016 — vínculo opcional con la plantilla de cátedra (fuente canónica
    # por (materia_id, periodo_id)). NULL para TPs creadas sin template.
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("tareas_practicas_templates.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    # True si la instancia divergió del template (edición directa de campos
    # canónicos). El CHECK `ck_tp_drift_needs_template` impide has_drift=true
    # sin template_id.
    has_drift: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=sa.false()
    )

    created_by: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), nullable=False
    )

    template: Mapped[TareaPracticaTemplate | None] = relationship(
        back_populates="instances"
    )

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "comision_id", "codigo", "version",
            name="uq_tarea_codigo_version",
        ),
        CheckConstraint(
            "estado IN ('draft', 'published', 'archived')",
            name="ck_tareas_practicas_estado",
        ),
        CheckConstraint(
            "peso >= 0 AND peso <= 1",
            name="ck_tareas_practicas_peso",
        ),
        CheckConstraint(
            "version >= 1",
            name="ck_tareas_practicas_version",
        ),
        CheckConstraint(
            "has_drift = false OR template_id IS NOT NULL",
            name="ck_tp_drift_needs_template",
        ),
    )


class TareaPracticaTemplate(Base, TenantMixin, TimestampMixin):
    """Plantilla canónica de Trabajo Práctico por (Materia, Período).

    Introducida por ADR-016 para que una cátedra con múltiples comisiones
    pueda mantener una fuente única editable del enunciado/rúbrica/peso.
    Al crear un template, el service auto-instancia una `TareaPractica`
    por cada comisión de esa (materia, periodo) con `template_id` apuntando
    a esta fila y `has_drift=false`.

    Versionado inmutable análogo a `TareaPractica`: publicados no se editan,
    se versionan con `parent_template_id` apuntando a la fila previa.

    El CTR NO toca esta tabla: `Episode.problema_id` sigue apuntando a la
    instancia (`TareaPractica`), no al template — la cadena criptográfica
    queda intacta (ADR-010, RN-034, RN-036).
    """

    __tablename__ = "tareas_practicas_templates"

    id: Mapped[uuid.UUID] = uuid_pk()
    materia_id: Mapped[uuid.UUID] = fk_uuid("materias.id")
    periodo_id: Mapped[uuid.UUID] = fk_uuid("periodos.id")

    codigo: Mapped[str] = mapped_column(String(20), nullable=False)
    titulo: Mapped[str] = mapped_column(String(200), nullable=False)
    enunciado: Mapped[str] = mapped_column(Text, nullable=False)
    inicial_codigo: Mapped[str | None] = mapped_column(Text, nullable=True)
    rubrica: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    peso: Mapped[Decimal] = mapped_column(
        Numeric(5, 4), nullable=False, default=Decimal("1.0")
    )

    fecha_inicio: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    fecha_fin: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    estado: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    parent_template_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("tareas_practicas_templates.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    created_by: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), nullable=False
    )

    parent: Mapped[TareaPracticaTemplate | None] = relationship(
        "TareaPracticaTemplate",
        remote_side="TareaPracticaTemplate.id",
        foreign_keys=[parent_template_id],
    )
    instances: Mapped[list[TareaPractica]] = relationship(back_populates="template")

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "materia_id", "periodo_id", "codigo", "version",
            name="uq_template_codigo_version",
        ),
        CheckConstraint(
            "estado IN ('draft', 'published', 'archived')",
            name="ck_template_estado",
        ),
        CheckConstraint(
            "peso >= 0 AND peso <= 1",
            name="ck_template_peso",
        ),
        CheckConstraint(
            "version >= 1",
            name="ck_template_version",
        ),
    )
