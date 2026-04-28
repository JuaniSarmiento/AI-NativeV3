"""Eventos del CTR."""
from platform_contracts.ctr.events import (
    AnotacionCreada,
    CodigoEjecutado,
    CTRBaseEvent,
    EdicionCodigo,
    EpisodioAbandonado,
    EpisodioAbierto,
    EpisodioCerrado,
    IntentoAdversoDetectado,
    LecturaEnunciado,
    PromptEnviado,
    TutorRespondio,
)
from platform_contracts.ctr.hashing import (
    GENESIS_HASH,
    compute_chain_hash,
    compute_self_hash,
    verify_chain_integrity,
)

__all__ = [
    "CTRBaseEvent",
    "EpisodioAbierto",
    "EpisodioCerrado",
    "EpisodioAbandonado",
    "IntentoAdversoDetectado",
    "PromptEnviado",
    "TutorRespondio",
    "LecturaEnunciado",
    "AnotacionCreada",
    "EdicionCodigo",
    "CodigoEjecutado",
    "compute_self_hash",
    "compute_chain_hash",
    "verify_chain_integrity",
    "GENESIS_HASH",
]
