"""Repositorios específicos por entidad del dominio."""
from __future__ import annotations

from academic_service.models import (
    Carrera,
    Comision,
    Facultad,
    Inscripcion,
    Materia,
    Periodo,
    PlanEstudios,
    Universidad,
    UsuarioComision,
)
from academic_service.repositories.base import BaseRepository


class UniversidadRepository(BaseRepository[Universidad]):
    model = Universidad


class FacultadRepository(BaseRepository[Facultad]):
    model = Facultad


class CarreraRepository(BaseRepository[Carrera]):
    model = Carrera


class PlanEstudiosRepository(BaseRepository[PlanEstudios]):
    model = PlanEstudios


class MateriaRepository(BaseRepository[Materia]):
    model = Materia


class PeriodoRepository(BaseRepository[Periodo]):
    model = Periodo


class ComisionRepository(BaseRepository[Comision]):
    model = Comision


class InscripcionRepository(BaseRepository[Inscripcion]):
    model = Inscripcion


class UsuarioComisionRepository(BaseRepository[UsuarioComision]):
    model = UsuarioComision
