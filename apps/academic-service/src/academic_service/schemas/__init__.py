"""Schemas Pydantic para request/response."""

from academic_service.schemas.base import (
    BaseResponse,
    ListMeta,
    ListResponse,
    ProblemDetail,
)
from academic_service.schemas.carrera import CarreraCreate, CarreraOut, CarreraUpdate
from academic_service.schemas.comision import (
    ComisionCreate,
    ComisionOut,
    ComisionUpdate,
    PeriodoCreate,
    PeriodoOut,
    PeriodoUpdate,
)
from academic_service.schemas.facultad import (
    FacultadCreate,
    FacultadOut,
    FacultadUpdate,
)
from academic_service.schemas.inscripcion import (
    InscripcionCreate,
    InscripcionOut,
    MateriaInscripta,
)
from academic_service.schemas.materia import MateriaCreate, MateriaOut, MateriaUpdate
from academic_service.schemas.plan import PlanCreate, PlanOut, PlanUpdate
from academic_service.schemas.tarea_practica import (
    TareaPracticaCreate,
    TareaPracticaOut,
    TareaPracticaUpdate,
    TareaPracticaVersionRef,
)
from academic_service.schemas.universidad import (
    UniversidadCreate,
    UniversidadOut,
    UniversidadUpdate,
)

__all__ = [
    "BaseResponse",
    "CarreraCreate",
    "CarreraOut",
    "CarreraUpdate",
    "ComisionCreate",
    "ComisionOut",
    "ComisionUpdate",
    "FacultadCreate",
    "FacultadOut",
    "FacultadUpdate",
    "InscripcionCreate",
    "InscripcionOut",
    "ListMeta",
    "ListResponse",
    "MateriaCreate",
    "MateriaInscripta",
    "MateriaOut",
    "MateriaUpdate",
    "PeriodoCreate",
    "PeriodoOut",
    "PeriodoUpdate",
    "PlanCreate",
    "PlanOut",
    "PlanUpdate",
    "ProblemDetail",
    "TareaPracticaCreate",
    "TareaPracticaOut",
    "TareaPracticaUpdate",
    "TareaPracticaVersionRef",
    "UniversidadCreate",
    "UniversidadOut",
    "UniversidadUpdate",
]
