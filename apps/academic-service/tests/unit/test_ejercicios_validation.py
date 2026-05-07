"""Tests unitarios para la validacion de ejercicios JSONB en TareaPractica.

Cubre: ordenes unicos, suma de pesos = 1.0, inmutabilidad post-publish
(se verifica via HTTP 409 que ya cubre el servicio; este archivo cubre
la capa de schemas Pydantic).
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from pydantic import ValidationError

from platform_contracts.academic.schemas import EjercicioSchema, EjerciciosValidator


class TestEjercicioSchema:
    def test_crea_minimo(self) -> None:
        e = EjercicioSchema(
            orden=1,
            titulo="Ejercicio 1",
            enunciado_md="Dado un entero...",
            peso=Decimal("0.5"),
        )
        assert e.orden == 1
        assert e.test_cases == []
        assert e.inicial_codigo is None

    def test_rechaza_orden_cero(self) -> None:
        with pytest.raises(ValidationError):
            EjercicioSchema(
                orden=0,
                titulo="E",
                enunciado_md="x",
                peso=Decimal("1.0"),
            )

    def test_rechaza_peso_cero(self) -> None:
        with pytest.raises(ValidationError):
            EjercicioSchema(
                orden=1,
                titulo="E",
                enunciado_md="x",
                peso=Decimal("0"),
            )

    def test_rechaza_peso_mayor_uno(self) -> None:
        with pytest.raises(ValidationError):
            EjercicioSchema(
                orden=1,
                titulo="E",
                enunciado_md="x",
                peso=Decimal("1.1"),
            )


class TestEjerciciosValidator:
    def _e(self, orden: int, peso: Decimal) -> EjercicioSchema:
        return EjercicioSchema(
            orden=orden,
            titulo=f"Ejercicio {orden}",
            enunciado_md="Enunciado.",
            peso=peso,
        )

    def test_valida_dos_ejercicios_correctos(self) -> None:
        v = EjerciciosValidator(
            ejercicios=[self._e(1, Decimal("0.5")), self._e(2, Decimal("0.5"))]
        )
        assert len(v.ejercicios) == 2

    def test_valida_array_vacio(self) -> None:
        v = EjerciciosValidator(ejercicios=[])
        assert v.ejercicios == []

    def test_rechaza_ordenes_duplicados(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            EjerciciosValidator(
                ejercicios=[self._e(1, Decimal("0.5")), self._e(1, Decimal("0.5"))]
            )
        assert "unicos" in str(exc_info.value)

    def test_rechaza_suma_pesos_diferente_uno(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            EjerciciosValidator(
                ejercicios=[self._e(1, Decimal("0.3")), self._e(2, Decimal("0.3"))]
            )
        assert "pesos" in str(exc_info.value)

    def test_tolera_imprecision_float(self) -> None:
        """0.1 + 0.2 + 0.7 puede tener imprecision de punto flotante; toleramos 0.001."""
        v = EjerciciosValidator(
            ejercicios=[
                self._e(1, Decimal("0.1")),
                self._e(2, Decimal("0.2")),
                self._e(3, Decimal("0.7")),
            ]
        )
        assert len(v.ejercicios) == 3

    def test_tres_ejercicios_correctos(self) -> None:
        v = EjerciciosValidator(
            ejercicios=[
                self._e(1, Decimal("0.25")),
                self._e(2, Decimal("0.25")),
                self._e(3, Decimal("0.50")),
            ]
        )
        assert len(v.ejercicios) == 3
