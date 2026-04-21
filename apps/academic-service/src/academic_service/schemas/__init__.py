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
from academic_service.schemas.comision import (
    ComisionCreate,
    ComisionOut,
    ComisionUpdate,
    PeriodoCreate,
    PeriodoOut,
)
from academic_service.schemas.materia import MateriaCreate, MateriaOut, MateriaUpdate

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
    "MateriaCreate",
    "MateriaOut",
    "MateriaUpdate",
    "ComisionCreate",
    "ComisionOut",
    "ComisionUpdate",
    "PeriodoCreate",
    "PeriodoOut",
]
