"""Jerarquía operativa: Periodo → Comisión → Inscripción + Usuario_Comision."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import Date, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
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

    El estudiante aparece por su pseudónimo; la identidad real vive en
    identity_store (ADR-003).
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
