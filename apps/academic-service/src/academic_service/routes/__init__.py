"""Rutas HTTP del academic-service."""
from academic_service.routes import carreras, comisiones, health, materias, universidades

__all__ = ["health", "universidades", "carreras", "materias", "comisiones"]
