"""Modelos del dominio académico.

Importar todo desde aquí asegura que SQLAlchemy registre todas las tablas
en el metadata antes de generar migraciones o crear el schema.
"""

from academic_service.models.base import Base, TenantMixin, TimestampMixin
from academic_service.models.institucional import (
    Carrera,
    Facultad,
    Materia,
    PlanEstudios,
    Universidad,
)
from academic_service.models.operacional import (
    Comision,
    Inscripcion,
    Periodo,
    TareaPractica,
    TareaPracticaTemplate,
    Unidad,
    UsuarioComision,
)
from academic_service.models.transversal import AuditLog, CasbinRule

__all__ = [
    # Transversal
    "AuditLog",
    "Base",
    "Carrera",
    "CasbinRule",
    "Comision",
    "Facultad",
    "Inscripcion",
    "Materia",
    # Operacional
    "Periodo",
    "PlanEstudios",
    "TareaPractica",
    "TareaPracticaTemplate",
    "TenantMixin",
    # Operacional (cont.)
    "Unidad",
    "TimestampMixin",
    # Institucional
    "Universidad",
    "UsuarioComision",
]
