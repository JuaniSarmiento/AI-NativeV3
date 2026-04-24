"""Tests del servicio de bulk import vía CSV.

Mock-based: cubre parseo CSV (UTF-8 + BOM), dry-run con validación + FK,
commit atómico (rollback si alguna fila falla), entidades no soportadas y
errores de FK. Sigue el estilo de test_facultades_crud.py.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from academic_service.auth.dependencies import User
from academic_service.models import AuditLog, Comision, Facultad, TareaPractica, Universidad
from academic_service.services.bulk_import import (
    MAX_CSV_BYTES,
    BulkImportCommitResult,
    BulkImportReport,
    BulkImportService,
)


@pytest.fixture
def mock_session():
    session = MagicMock()
    session.flush = AsyncMock()
    session.refresh = AsyncMock()
    session.add = MagicMock()
    return session


@pytest.fixture
def tenant_a_id() -> UUID:
    return UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")


@pytest.fixture
def user_docente_admin_a(tenant_a_id: UUID) -> User:
    return User(
        id=uuid4(),
        tenant_id=tenant_a_id,
        email="admin-a@unsl.edu.ar",
        roles=frozenset({"docente_admin"}),
        realm=str(tenant_a_id),
    )


def _fake_universidad(uid: UUID) -> MagicMock:
    u = MagicMock(spec=Universidad)
    u.id = uid
    u.nombre = "U"
    u.codigo = "U"
    u.keycloak_realm = "u"
    return u


def _fake_facultad(fid: UUID, tenant_id: UUID, universidad_id: UUID) -> MagicMock:
    f = MagicMock(spec=Facultad)
    f.id = fid
    f.tenant_id = tenant_id
    f.universidad_id = universidad_id
    f.nombre = "FCFMyN"
    f.codigo = "FCFMYN"
    f.decano_user_id = None
    f.deleted_at = None
    return f


def _patch_universidad_repo(monkeypatch, exists: bool, tenant_id: UUID) -> None:
    """Stubea UniversidadRepository.get_or_404 para todas las instancias."""
    from academic_service.repositories import UniversidadRepository

    if exists:
        async def _ok(self, _id):
            return _fake_universidad(tenant_id)

        monkeypatch.setattr(UniversidadRepository, "get_or_404", _ok)
    else:
        async def _missing(self, _id):
            raise HTTPException(status_code=404, detail="Universidad no encontrada")

        monkeypatch.setattr(UniversidadRepository, "get_or_404", _missing)


def _csv_facultades_valid(universidad_id: UUID, n: int = 3) -> bytes:
    lines = ["nombre,codigo,universidad_id"]
    for i in range(n):
        lines.append(f"Facultad {i},FAC{i:02d},{universidad_id}")
    # BOM + UTF-8 (simula export Excel)
    return ("﻿" + "\n".join(lines) + "\n").encode("utf-8")


# ── parse / dry-run ───────────────────────────────────────


async def test_bulk_import_facultades_dry_run_happy_path(
    mock_session, user_docente_admin_a: User, tenant_a_id: UUID, monkeypatch
) -> None:
    """3 filas válidas, dry_run=true → reporte con 3/3 válidas."""
    _patch_universidad_repo(monkeypatch, exists=True, tenant_id=tenant_a_id)

    svc = BulkImportService(mock_session)
    csv_bytes = _csv_facultades_valid(tenant_a_id, n=3)
    rows = svc.parse_csv(csv_bytes, "facultades")

    report = await svc.dry_run("facultades", rows, user_docente_admin_a)

    assert isinstance(report, BulkImportReport)
    assert report.total_rows == 3
    assert report.valid_rows == 3
    assert report.invalid_rows == 0
    assert report.errors == []
    # dry_run NO debe escribir en la sesión
    mock_session.add.assert_not_called()


async def test_bulk_import_facultades_dry_run_with_errors(
    mock_session, user_docente_admin_a: User, tenant_a_id: UUID, monkeypatch
) -> None:
    """2 válidas + 1 con campo requerido faltante → reporte 2/1."""
    _patch_universidad_repo(monkeypatch, exists=True, tenant_id=tenant_a_id)

    csv_text = (
        "nombre,codigo,universidad_id\n"
        f"Facultad A,FACA,{tenant_a_id}\n"
        f",FACB,{tenant_a_id}\n"  # nombre vacío
        f"Facultad C,FACC,{tenant_a_id}\n"
    )
    svc = BulkImportService(mock_session)
    rows = svc.parse_csv(csv_text.encode("utf-8"), "facultades")

    report = await svc.dry_run("facultades", rows, user_docente_admin_a)

    assert report.total_rows == 3
    assert report.valid_rows == 2
    assert report.invalid_rows == 1
    assert len(report.errors) == 1
    err = report.errors[0]
    assert err.row_number == 3  # header=1, primera data=2, segunda=3
    assert err.column is not None
    assert "nombre" in err.column


# ── commit ───────────────────────────────────────────────


async def test_bulk_import_facultades_commit_happy_path(
    mock_session, user_docente_admin_a: User, tenant_a_id: UUID, monkeypatch
) -> None:
    """2 filas válidas, commit → 2 creadas con IDs devueltos."""
    _patch_universidad_repo(monkeypatch, exists=True, tenant_id=tenant_a_id)

    svc = BulkImportService(mock_session)
    csv_bytes = _csv_facultades_valid(tenant_a_id, n=2)
    rows = svc.parse_csv(csv_bytes, "facultades")

    # Stubear el create del FacultadRepository (lo crea el FacultadService internamente)
    created_ids: list[UUID] = []

    async def _fake_create(self, payload: dict):
        fid = payload["id"]
        created_ids.append(fid)
        return _fake_facultad(fid, payload["tenant_id"], payload["universidad_id"])

    from academic_service.repositories import FacultadRepository

    monkeypatch.setattr(FacultadRepository, "create", _fake_create)

    result = await svc.commit("facultades", rows, user_docente_admin_a)

    assert isinstance(result, BulkImportCommitResult)
    assert result.created_count == 2
    assert len(result.created_ids) == 2
    assert set(result.created_ids) == set(created_ids)

    # 1 audit log por cada fila confirmada (RN-016)
    audit_calls = [
        c.args[0]
        for c in mock_session.add.call_args_list
        if isinstance(c.args[0], AuditLog)
    ]
    assert len(audit_calls) == 2
    assert all(a.action == "facultad.create" for a in audit_calls)
    assert all(a.tenant_id == tenant_a_id for a in audit_calls)


async def test_bulk_import_facultades_commit_rolls_back_on_any_error(
    mock_session, user_docente_admin_a: User, tenant_a_id: UUID, monkeypatch
) -> None:
    """2 válidas + 1 con FK inválida → 422, NINGUNA fila se crea."""
    bogus_universidad_id = uuid4()
    real_universidad_id = tenant_a_id

    # Patch: el universidad real existe, el bogus 404
    from academic_service.repositories import FacultadRepository, UniversidadRepository

    async def _selective_get(self, _id):
        if _id == real_universidad_id:
            return _fake_universidad(real_universidad_id)
        raise HTTPException(status_code=404, detail="Universidad no encontrada")

    monkeypatch.setattr(UniversidadRepository, "get_or_404", _selective_get)

    create_calls: list[dict] = []

    async def _fake_create(self, payload: dict):
        create_calls.append(payload)
        return _fake_facultad(payload["id"], payload["tenant_id"], payload["universidad_id"])

    monkeypatch.setattr(FacultadRepository, "create", _fake_create)

    csv_text = (
        "nombre,codigo,universidad_id\n"
        f"Facultad A,FACA,{real_universidad_id}\n"
        f"Facultad B,FACB,{bogus_universidad_id}\n"  # FK inválida
        f"Facultad C,FACC,{real_universidad_id}\n"
    )

    svc = BulkImportService(mock_session)
    rows = svc.parse_csv(csv_text.encode("utf-8"), "facultades")

    with pytest.raises(HTTPException) as exc_info:
        await svc.commit("facultades", rows, user_docente_admin_a)

    assert exc_info.value.status_code == 422
    detail = exc_info.value.detail
    assert isinstance(detail, dict)
    assert detail["report"]["invalid_rows"] == 1

    # CRÍTICO: ninguna fila se creó (rollback total)
    assert create_calls == []
    audit_calls = [
        c.args[0]
        for c in mock_session.add.call_args_list
        if isinstance(c.args[0], AuditLog)
    ]
    assert audit_calls == []


# ── validaciones de entrada ──────────────────────────────


async def test_bulk_import_unsupported_entity_400(
    mock_session, user_docente_admin_a: User
) -> None:
    """Entidad fuera de la lista soportada → HTTPException 400."""
    svc = BulkImportService(mock_session)
    with pytest.raises(HTTPException) as exc_info:
        svc.parse_csv(b"a,b\n1,2\n", "universidades")
    assert exc_info.value.status_code == 400
    assert "no soportada" in str(exc_info.value.detail).lower()


async def test_bulk_import_csv_malformed_400(
    mock_session, user_docente_admin_a: User
) -> None:
    """CSV con bytes no UTF-8 → HTTPException 400."""
    svc = BulkImportService(mock_session)
    bad_bytes = b"\xff\xfe\x00\x00not utf8 at all \xc3\x28"
    with pytest.raises(HTTPException) as exc_info:
        svc.parse_csv(bad_bytes, "facultades")
    assert exc_info.value.status_code == 400


async def test_bulk_import_csv_too_large_413(
    mock_session, user_docente_admin_a: User
) -> None:
    """CSV > MAX_CSV_BYTES (5 MB) → HTTPException 413 sin parsearlo en memoria."""
    svc = BulkImportService(mock_session)
    oversized = b"x" * (MAX_CSV_BYTES + 1)
    with pytest.raises(HTTPException) as exc_info:
        svc.parse_csv(oversized, "facultades")
    assert exc_info.value.status_code == 413
    assert "demasiado grande" in str(exc_info.value.detail).lower()


async def test_bulk_import_carreras_validates_facultad_fk(
    mock_session, user_docente_admin_a: User, tenant_a_id: UUID, monkeypatch
) -> None:
    """Carrera con facultad_id (FK) inexistente → reportada como error."""
    bogus_facultad_id = uuid4()

    from academic_service.repositories import FacultadRepository

    async def _missing(self, _id):
        raise HTTPException(status_code=404, detail="Facultad no encontrada")

    monkeypatch.setattr(FacultadRepository, "get_or_404", _missing)

    csv_text = (
        "nombre,codigo,duracion_semestres,modalidad,facultad_id\n"
        f"Lic. en Ciencias,LCC,8,presencial,{bogus_facultad_id}\n"
    )
    svc = BulkImportService(mock_session)
    rows = svc.parse_csv(csv_text.encode("utf-8"), "carreras")

    report = await svc.dry_run("carreras", rows, user_docente_admin_a)

    assert report.total_rows == 1
    assert report.valid_rows == 0
    assert report.invalid_rows == 1
    assert len(report.errors) == 1
    assert "Facultad" in report.errors[0].message


# ── tareas_practicas ─────────────────────────────────────


def _fake_comision(cid: UUID, tenant_id: UUID) -> MagicMock:
    c = MagicMock(spec=Comision)
    c.id = cid
    c.tenant_id = tenant_id
    c.codigo = "COM-A"
    c.deleted_at = None
    return c


def _fake_tarea(tid: UUID, tenant_id: UUID, comision_id: UUID, **kwargs: Any) -> MagicMock:
    t = MagicMock(spec=TareaPractica)
    t.id = tid
    t.tenant_id = tenant_id
    t.comision_id = comision_id
    t.estado = "draft"
    t.version = 1
    t.parent_tarea_id = None
    for k, v in kwargs.items():
        setattr(t, k, v)
    return t


def _patch_comision_repo(monkeypatch, exists: bool, tenant_id: UUID) -> None:
    from academic_service.repositories import ComisionRepository

    if exists:
        async def _ok(self, _id):
            return _fake_comision(_id, tenant_id)

        monkeypatch.setattr(ComisionRepository, "get_or_404", _ok)
    else:
        async def _missing(self, _id):
            raise HTTPException(status_code=404, detail="Comisión no encontrada")

        monkeypatch.setattr(ComisionRepository, "get_or_404", _missing)


async def test_bulk_import_tareas_practicas_dry_run_happy_path(
    mock_session, user_docente_admin_a: User, tenant_a_id: UUID, monkeypatch
) -> None:
    """3 filas válidas, dry_run=true → reporte 3/3 válidas."""
    _patch_comision_repo(monkeypatch, exists=True, tenant_id=tenant_a_id)
    comision_id = uuid4()

    csv_text = (
        "comision_id,codigo,titulo,enunciado,peso\n"
        f"{comision_id},TP01,Tarea 1,Resolver ejercicio 1,0.3\n"
        f"{comision_id},TP02,Tarea 2,Resolver ejercicio 2,0.3\n"
        f"{comision_id},TP03,Tarea 3,\"Resolver, con coma\",0.4\n"
    )
    svc = BulkImportService(mock_session)
    rows = svc.parse_csv(csv_text.encode("utf-8"), "tareas_practicas")

    report = await svc.dry_run("tareas_practicas", rows, user_docente_admin_a)

    assert isinstance(report, BulkImportReport)
    assert report.total_rows == 3
    assert report.valid_rows == 3
    assert report.invalid_rows == 0
    assert report.errors == []
    mock_session.add.assert_not_called()


async def test_bulk_import_tareas_practicas_dry_run_with_invalid_rubrica(
    mock_session, user_docente_admin_a: User, tenant_a_id: UUID, monkeypatch
) -> None:
    """1 fila con JSON malformado en rubrica → error con column='rubrica'."""
    _patch_comision_repo(monkeypatch, exists=True, tenant_id=tenant_a_id)
    comision_id = uuid4()

    csv_text = (
        "comision_id,codigo,titulo,enunciado,rubrica\n"
        f"{comision_id},TP01,Tarea 1,Enunciado,\"{{not valid json}}\"\n"
    )
    svc = BulkImportService(mock_session)
    rows = svc.parse_csv(csv_text.encode("utf-8"), "tareas_practicas")

    report = await svc.dry_run("tareas_practicas", rows, user_docente_admin_a)

    assert report.total_rows == 1
    assert report.valid_rows == 0
    assert report.invalid_rows == 1
    assert len(report.errors) == 1
    err = report.errors[0]
    assert err.column == "rubrica"
    assert "JSON" in err.message


async def test_bulk_import_tareas_practicas_commit_happy_path(
    mock_session, user_docente_admin_a: User, tenant_a_id: UUID, monkeypatch
) -> None:
    """2 filas válidas, commit → 2 creadas en draft."""
    _patch_comision_repo(monkeypatch, exists=True, tenant_id=tenant_a_id)
    comision_id = uuid4()

    create_payloads: list[dict] = []

    async def _fake_create(self, payload: dict):
        create_payloads.append(payload)
        return _fake_tarea(
            payload["id"],
            payload["tenant_id"],
            payload["comision_id"],
            codigo=payload["codigo"],
            titulo=payload["titulo"],
            enunciado=payload["enunciado"],
            estado=payload["estado"],
            version=payload["version"],
        )

    from academic_service.repositories import TareaPracticaRepository

    monkeypatch.setattr(TareaPracticaRepository, "create", _fake_create)

    csv_text = (
        "comision_id,codigo,titulo,enunciado\n"
        f"{comision_id},TP01,Tarea 1,Enunciado uno\n"
        f"{comision_id},TP02,Tarea 2,Enunciado dos\n"
    )
    svc = BulkImportService(mock_session)
    rows = svc.parse_csv(csv_text.encode("utf-8"), "tareas_practicas")

    result = await svc.commit("tareas_practicas", rows, user_docente_admin_a)

    assert isinstance(result, BulkImportCommitResult)
    assert result.created_count == 2
    assert len(result.created_ids) == 2
    assert all(p["estado"] == "draft" for p in create_payloads)
    assert all(p["version"] == 1 for p in create_payloads)
    assert all(p["parent_tarea_id"] is None for p in create_payloads)

    audit_calls = [
        c.args[0]
        for c in mock_session.add.call_args_list
        if isinstance(c.args[0], AuditLog)
    ]
    assert len(audit_calls) == 2
    assert all(a.action == "tarea_practica.create" for a in audit_calls)
    assert all(a.tenant_id == tenant_a_id for a in audit_calls)


async def test_bulk_import_tareas_practicas_carga_rubrica_como_dict(
    mock_session, user_docente_admin_a: User, tenant_a_id: UUID, monkeypatch
) -> None:
    """rubrica JSON-string en CSV se persiste como dict en el payload."""
    _patch_comision_repo(monkeypatch, exists=True, tenant_id=tenant_a_id)
    comision_id = uuid4()

    create_payloads: list[dict] = []

    async def _fake_create(self, payload: dict):
        create_payloads.append(payload)
        return _fake_tarea(
            payload["id"],
            payload["tenant_id"],
            payload["comision_id"],
            codigo=payload["codigo"],
            titulo=payload["titulo"],
            enunciado=payload["enunciado"],
            estado=payload["estado"],
            version=payload["version"],
        )

    from academic_service.repositories import TareaPracticaRepository

    monkeypatch.setattr(TareaPracticaRepository, "create", _fake_create)

    rubrica_json = '{"criterios": [{"nombre": "correctitud", "peso": 0.7}]}'
    rubrica_csv_field = '"' + rubrica_json.replace('"', '""') + '"'
    csv_text = (
        "comision_id,codigo,titulo,enunciado,rubrica\n"
        f"{comision_id},TP01,Tarea 1,Enunciado,{rubrica_csv_field}\n"
    )
    svc = BulkImportService(mock_session)
    rows = svc.parse_csv(csv_text.encode("utf-8"), "tareas_practicas")

    result = await svc.commit("tareas_practicas", rows, user_docente_admin_a)

    assert result.created_count == 1
    assert len(create_payloads) == 1
    rubrica = create_payloads[0]["rubrica"]
    assert isinstance(rubrica, dict)
    assert rubrica == {"criterios": [{"nombre": "correctitud", "peso": 0.7}]}
