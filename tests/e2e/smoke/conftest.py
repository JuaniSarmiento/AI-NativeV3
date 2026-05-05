"""Fixtures compartidas de la suite smoke E2E.

La suite asume el stack already-up (12 servicios + infra docker + DB seedeada).
NO levanta containers ni servicios — falla fast si algo no responde.

Auth: el api-gateway corre con `dev_trust_headers=True` (default en dev). Sin
JWT validator activo, basta con mandar `X-User-Id` + `X-Tenant-Id` (+ opcional
`X-User-Email`, `X-User-Roles`). El gateway pasa el request al servicio
downstream con esos headers tal cual. Los frontends del repo usan exactamente
este patrón en sus `vite.config.ts`.

Si en algún momento el JWT validator se activa (env `jwt_issuer` no vacío),
estas fixtures van a fallar con 401 — habría que generar un Bearer firmado.
Para piloto-1 dev, headers X-* es suficiente.
"""

from __future__ import annotations

import sys
import time
import uuid
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

# Hacer importable a `_helpers` desde los modulos de test (path absoluto).
_HERE = Path(__file__).parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from _helpers import (  # noqa: E402  (path mutation + import en mismo archivo)
    COMISION_A_MANANA,
    DOCENTE_DEMO,
    SERVICES_HEALTH,
    STUDENT_A1,
    SUPERADMIN_DEMO,
    TENANT_DEMO,
    tail_log,
)


def pytest_configure(config: pytest.Config) -> None:
    """Registra el marker `smoke`."""
    config.addinivalue_line(
        "markers",
        "smoke: smoke E2E tests contra stack already-up (api-gateway:8000)",
    )


# ── Auth + HTTP client ─────────────────────────────────────────────────


def _headers_for_role(role: str, user_id: str | None = None) -> dict[str, str]:
    """Genera el dict de headers X-* que el api-gateway acepta en dev mode."""
    defaults = {
        "estudiante": (STUDENT_A1, "alumno@demo-uni.edu"),
        "docente": (DOCENTE_DEMO, "docente@demo-uni.edu"),
        "docente_admin": (DOCENTE_DEMO, "docente-admin@demo-uni.edu"),
        "superadmin": (SUPERADMIN_DEMO, "super@demo-uni.edu"),
    }
    if role not in defaults:
        raise ValueError(f"role no soportado: {role}")
    default_uid, email = defaults[role]
    return {
        "X-User-Id": user_id or default_uid,
        "X-Tenant-Id": TENANT_DEMO,
        "X-User-Email": email,
        "X-User-Roles": role,
    }


@pytest.fixture(scope="session")
def api_base_url() -> str:
    import os

    return os.environ.get("SMOKE_API_BASE_URL", "http://127.0.0.1:8000")


@pytest.fixture(scope="session")
def auth_headers():
    """Factory: `auth_headers("docente")` → dict de headers para esa rol."""
    return _headers_for_role


@pytest.fixture(scope="session")
def client(api_base_url: str) -> Iterator[httpx.Client]:
    """HTTP client compartido. timeout=10s — los smoke deben ser rápidos."""
    with httpx.Client(base_url=api_base_url, timeout=10.0) as c:
        yield c


# ── Seed-derived IDs ───────────────────────────────────────────────────


@pytest.fixture(scope="session")
def tenant_id() -> str:
    return TENANT_DEMO


@pytest.fixture(scope="session")
def comision_id() -> str:
    return COMISION_A_MANANA


@pytest.fixture(scope="session")
def student_id() -> str:
    return STUDENT_A1


@pytest.fixture(scope="session")
def docente_id() -> str:
    return DOCENTE_DEMO


@pytest.fixture(scope="session")
def superadmin_id() -> str:
    return SUPERADMIN_DEMO


@pytest.fixture(scope="session")
def tarea_practica_id() -> str:
    """Primera TP `published` de la comisión A-Mañana del seed."""
    return "11110000-0000-0000-c0de-c0dec0dec0df"


@pytest.fixture(scope="session")
def seeded_episode_id() -> str:
    """Un episodio cerrado del seed con ≥5 events íntegros."""
    return "80000000-0000-0000-0000-0000000f69b4"


# ── Health gate ────────────────────────────────────────────────────────


@pytest.fixture(scope="session", autouse=True)
def _wait_for_health() -> None:
    """Verifica al inicio que los 12 servicios responden /health."""
    failed: list[str] = []
    for port, name in SERVICES_HEALTH:
        url = f"http://127.0.0.1:{port}/health"
        try:
            resp = httpx.get(url, timeout=3.0)
        except Exception as exc:
            failed.append(f"  - {name} (:{port}) no responde: {exc}")
            continue
        if resp.status_code not in (200, 503):
            failed.append(
                f"  - {name} (:{port}) respondió {resp.status_code} (esperado 200 o 503 degraded)"
            )
    if failed:
        msg = (
            "Pre-condicion de smoke FALLO — los siguientes servicios no estan up:\n"
            + "\n".join(failed)
            + "\n\nPista: arrancalos con `bash scripts/dev-start-all.sh` o tu launcher local.\n"
            "Cada servicio escribe a /tmp/piloto-logs/<svc>.log."
        )
        pytest.exit(msg, returncode=2)


# ── Unique-id helper ──────────────────────────────────────────────────


@pytest.fixture
def unique_uuid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def unique_suffix() -> str:
    return f"{int(time.time())}-{uuid.uuid4().hex[:8]}"


# Re-export para tests que lo necesiten via `from conftest import ...`
__all__ = ["tail_log"]
