"""Modelos del content-service."""
from content_service.models.base import (
    Base,
    TenantMixin,
    TimestampMixin,
    utc_now,
)
from content_service.models.material import Chunk, Material, EMBEDDING_DIM

__all__ = [
    "Base",
    "TenantMixin",
    "TimestampMixin",
    "utc_now",
    "Material",
    "Chunk",
    "EMBEDDING_DIM",
]
