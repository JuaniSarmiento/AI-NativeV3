"""Base declarativa del ctr-service.

El CTR (Cuaderno de Trabajo Reflexivo) es una cadena criptográfica
append-only. Cada evento tiene:
  - self_hash = SHA256(event_payload_canónico)
  - chain_hash = SHA256(self_hash || prev_chain_hash)

El GENESIS_HASH es el prev_chain_hash del primer evento de cada episodio.

Propiedades que debemos preservar:
1. Integridad: cualquier manipulación de un evento rompe la cadena.
2. Orden estricto: los eventos de un episodio se procesan en orden de `seq`.
3. Idempotencia: eventos duplicados (mismo event_uuid) se ignoran.
4. Append-only: nunca UPDATE ni DELETE de eventos persistidos.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import DateTime, MetaData, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


GENESIS_HASH = "0" * 64  # SHA-256 de cero bytes; alias criptográfico de "cadena vacía"


NAMING_CONVENTION: dict[str, str] = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {
        dict[str, Any]: "JSONB",
    }


def utc_now() -> datetime:
    return datetime.now(UTC)


class TenantMixin:
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), nullable=False, index=True
    )


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        PgUUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
