"""Lógica de dominio."""
from academic_service.services.carrera_service import CarreraService
from academic_service.services.comision_service import (
    ComisionService,
    PeriodoService,
)
from academic_service.services.materia_service import MateriaService
from academic_service.services.universidad_service import UniversidadService

__all__ = [
    "UniversidadService",
    "CarreraService",
    "MateriaService",
    "PeriodoService",
    "ComisionService",
]
