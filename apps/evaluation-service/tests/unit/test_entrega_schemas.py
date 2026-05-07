"""Tests unitarios del ciclo de vida de Entrega y Calificacion.

Cubre validacion de schemas Pydantic sin DB. Los tests de flujo completo
(create/submit/grade) requieren la integracion — se documentan en TODO
para cuando se agregue la fixture de testcontainers a este servicio.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from pydantic import ValidationError

from evaluation_service.schemas.entrega import (
    CalificacionCreate,
    CriterioCalificacion,
    EntregaCreate,
    EntregaOut,
)
from uuid import uuid4
from datetime import datetime


class TestEntregaCreate:
    def test_crea_valido(self) -> None:
        e = EntregaCreate(
            tarea_practica_id=uuid4(),
            comision_id=uuid4(),
        )
        assert e.tarea_practica_id is not None
        assert e.comision_id is not None


class TestCalificacionCreate:
    def test_crea_valido(self) -> None:
        cal = CalificacionCreate(
            nota_final=Decimal("7.5"),
            feedback_general="Buen trabajo",
            detalle_criterios=[
                CriterioCalificacion(
                    criterio="Correctitud",
                    puntaje=Decimal("3.0"),
                    max_puntaje=Decimal("4.0"),
                    comentario="Funciona bien",
                )
            ],
        )
        assert cal.nota_final == Decimal("7.5")
        assert len(cal.detalle_criterios) == 1

    def test_rechaza_nota_negativa(self) -> None:
        with pytest.raises(ValidationError):
            CalificacionCreate(nota_final=Decimal("-1"))

    def test_rechaza_nota_mayor_diez(self) -> None:
        with pytest.raises(ValidationError):
            CalificacionCreate(nota_final=Decimal("10.5"))

    def test_nota_cero_valida(self) -> None:
        cal = CalificacionCreate(nota_final=Decimal("0"))
        assert cal.nota_final == Decimal("0")

    def test_nota_diez_valida(self) -> None:
        cal = CalificacionCreate(nota_final=Decimal("10"))
        assert cal.nota_final == Decimal("10")

    def test_sin_criterios_es_valido(self) -> None:
        cal = CalificacionCreate(nota_final=Decimal("5.0"))
        assert cal.detalle_criterios == []


class TestEntregaEstados:
    """Verifica que los estados validos del schema de entrega funcionan."""

    def _build_out(self, estado: str) -> EntregaOut:
        return EntregaOut(
            id=uuid4(),
            tenant_id=uuid4(),
            tarea_practica_id=uuid4(),
            student_pseudonym=uuid4(),
            comision_id=uuid4(),
            estado=estado,
            ejercicio_estados=[],
            submitted_at=None,
            created_at=datetime.utcnow(),
            deleted_at=None,
        )

    def test_estado_draft(self) -> None:
        e = self._build_out("draft")
        assert e.estado == "draft"

    def test_estado_submitted(self) -> None:
        e = self._build_out("submitted")
        assert e.estado == "submitted"

    def test_estado_graded(self) -> None:
        e = self._build_out("graded")
        assert e.estado == "graded"

    def test_estado_returned(self) -> None:
        e = self._build_out("returned")
        assert e.estado == "returned"

    def test_estado_invalido(self) -> None:
        with pytest.raises(ValidationError):
            self._build_out("pendiente")
