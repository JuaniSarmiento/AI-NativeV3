"""Tests unitarios para los schemas de UsuarioComision e InscripcionCreateIndividual.

Validan que los payloads nuevos de los endpoints de docentes e inscripciones
individuales (task 1.1-1.4) se construyen y rechazan correctamente.
"""

from __future__ import annotations

from datetime import date
from uuid import uuid4

import pytest
from pydantic import ValidationError

from academic_service.schemas.usuario_comision import UsuarioComisionCreate, UsuarioComisionOut
from academic_service.schemas.inscripcion import InscripcionCreateIndividual


class TestUsuarioComisionCreate:
    def test_crea_con_campos_obligatorios(self) -> None:
        uc = UsuarioComisionCreate(
            user_id=uuid4(),
            rol="titular",
            fecha_desde=date(2026, 3, 1),
        )
        assert uc.rol == "titular"
        assert uc.fecha_hasta is None

    def test_acepta_todos_los_roles(self) -> None:
        for rol in ("titular", "adjunto", "jtp", "ayudante", "corrector"):
            uc = UsuarioComisionCreate(
                user_id=uuid4(),
                rol=rol,
                fecha_desde=date(2026, 3, 1),
            )
            assert uc.rol == rol

    def test_rechaza_rol_invalido(self) -> None:
        with pytest.raises(ValidationError):
            UsuarioComisionCreate(
                user_id=uuid4(),
                rol="rectorado",  # no existe
                fecha_desde=date(2026, 3, 1),
            )

    def test_acepta_fecha_hasta(self) -> None:
        uc = UsuarioComisionCreate(
            user_id=uuid4(),
            rol="jtp",
            fecha_desde=date(2026, 3, 1),
            fecha_hasta=date(2026, 7, 31),
        )
        assert uc.fecha_hasta == date(2026, 7, 31)


class TestInscripcionCreateIndividual:
    def test_crea_con_campos_obligatorios(self) -> None:
        insc = InscripcionCreateIndividual(
            student_pseudonym=uuid4(),
            fecha_inscripcion=date(2026, 3, 1),
        )
        assert insc.rol == "regular"
        assert insc.estado == "activa"
        assert insc.nota_final is None

    def test_acepta_rol_oyente(self) -> None:
        insc = InscripcionCreateIndividual(
            student_pseudonym=uuid4(),
            fecha_inscripcion=date(2026, 3, 1),
            rol="oyente",
        )
        assert insc.rol == "oyente"

    def test_rechaza_rol_invalido(self) -> None:
        with pytest.raises(ValidationError):
            InscripcionCreateIndividual(
                student_pseudonym=uuid4(),
                fecha_inscripcion=date(2026, 3, 1),
                rol="superadmin",
            )

    def test_rechaza_estado_invalido(self) -> None:
        with pytest.raises(ValidationError):
            InscripcionCreateIndividual(
                student_pseudonym=uuid4(),
                fecha_inscripcion=date(2026, 3, 1),
                estado="desconocido",
            )

    def test_acepta_nota_final_en_rango(self) -> None:
        from decimal import Decimal

        insc = InscripcionCreateIndividual(
            student_pseudonym=uuid4(),
            fecha_inscripcion=date(2026, 3, 1),
            nota_final=Decimal("8.5"),
        )
        assert insc.nota_final == Decimal("8.5")

    def test_rechaza_nota_fuera_de_rango(self) -> None:
        with pytest.raises(ValidationError):
            InscripcionCreateIndividual(
                student_pseudonym=uuid4(),
                fecha_inscripcion=date(2026, 3, 1),
                nota_final=11,  # > 10
            )
