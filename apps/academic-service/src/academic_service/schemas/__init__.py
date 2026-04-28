"""Schemas Pydantic para request/response."""
from academic_service.schemas.base import (
    BaseResponse,
    ListMeta,
    ListResponse,
    ProblemDetail,
)
from academic_service.schemas.universidad import (
    UniversidadCreate,
    UniversidadOut,
    UniversidadUpdate,
)
from academic_service.schemas.carrera import CarreraCreate, CarreraOut, CarreraUpdate
from academic_service.schemas.facultad import (
    FacultadCreate,
    FacultadOut,
    FacultadUpdate,
)
from academic_service.schemas.comision import (
    ComisionCreate,
    ComisionOut,
    ComisionUpdate,
    PeriodoCreate,
    PeriodoOut,
    PeriodoUpdate,
)
from academic_service.schemas.materia import MateriaCreate, MateriaOut, MateriaUpdate
from academic_service.schemas.plan import PlanCreate, PlanOut, PlanUpdate
from academic_service.schemas.tarea_practica import (
    TareaPracticaCreate,
    TareaPracticaOut,
    TareaPracticaUpdate,
    TareaPracticaVersionRef,
)

__all__ = [
    "BaseResponse",
    "ListMeta",
    "ListResponse",
    "ProblemDetail",
    "UniversidadCreate",
    "UniversidadOut",
    "UniversidadUpdate",
    "CarreraCreate",
    "CarreraOut",
    "CarreraUpdate",
    "FacultadCreate",
    "FacultadOut",
    "FacultadUpdate",
    "MateriaCreate",
    "MateriaOut",
    "MateriaUpdate",
    "PlanCreate",
    "PlanOut",
    "PlanUpdate",
    "ComisionCreate",
    "ComisionOut",
    "ComisionUpdate",
    "PeriodoCreate",
    "PeriodoOut",
    "PeriodoUpdate",
    "TareaPracticaCreate",
    "TareaPracticaOut",
    "TareaPracticaUpdate",
    "TareaPracticaVersionRef",
]
