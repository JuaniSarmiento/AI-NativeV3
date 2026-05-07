"""Eventos del plano académico."""

from platform_contracts.academic.events import (
    CarreraCreada,
    ComisionCreada,
    EstudianteInscripto,
    MaterialIngerido,
    UniversidadCreada,
)
from platform_contracts.academic.schemas import EjercicioSchema, EjerciciosValidator

__all__ = [
    "CarreraCreada",
    "ComisionCreada",
    "EjercicioSchema",
    "EjerciciosValidator",
    "EstudianteInscripto",
    "MaterialIngerido",
    "UniversidadCreada",
]
