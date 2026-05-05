"""Conftest global del monorepo Python.

Agrega los paths de src/ de cada servicio y paquete al sys.path para que
pytest resuelva imports correctamente en los tests.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).parent

# enrollment-service deprecado por ADR-030: sacado del workspace uv pero preservado
# en disco con README. Tiene `import pandas` que no está en el venv unificado, asi
# que excluirlo de la collection de pytest evita ImportError en `pytest apps packages`.
collect_ignore_glob = ["apps/enrollment-service/**"]

# Agregar src/ de cada paquete y servicio
for base in (ROOT / "packages", ROOT / "apps"):
    if not base.exists():
        continue
    for subdir in base.iterdir():
        src = subdir / "src"
        if src.is_dir():
            sys.path.insert(0, str(src))
