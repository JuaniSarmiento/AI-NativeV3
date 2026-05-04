"""Endpoints analíticos del piloto UNSL.

POST /api/v1/analytics/kappa            calcula Cohen's Kappa de un batch de ratings
GET  /api/v1/analytics/cohort/export    descarga dataset académico anonimizado
"""

from __future__ import annotations

import logging
import time
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from platform_ops import (
    KappaRating,
    compute_cohen_kappa,
)
from pydantic import BaseModel, Field

from analytics_service.metrics import (
    classifier_kappa_rolling,
    classifier_kappa_rolling_last_update_unix_seconds,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


async def get_tenant_id(x_tenant_id: str | None = Header(default=None)) -> UUID:
    if not x_tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-Tenant-Id header required",
        )
    try:
        return UUID(x_tenant_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-Tenant-Id must be a valid UUID",
        )


async def get_user_id(x_user_id: str | None = Header(default=None)) -> UUID:
    if not x_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-User-Id header required",
        )
    try:
        return UUID(x_user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-User-Id must be a valid UUID",
        )


# ── Kappa endpoint ────────────────────────────────────────────────────


class KappaRatingIn(BaseModel):
    episode_id: str
    rater_a: Literal["delegacion_pasiva", "apropiacion_superficial", "apropiacion_reflexiva"]
    rater_b: Literal["delegacion_pasiva", "apropiacion_superficial", "apropiacion_reflexiva"]


class KappaRequest(BaseModel):
    ratings: list[KappaRatingIn] = Field(..., min_length=1, max_length=10000)
    # Optional cohort tag — si está presente, se actualiza el gauge
    # `classifier_kappa_rolling{cohort=...}` para visualización en Grafana
    # dashboard 5. Sin él, el κ se computa pero no se grafica longitudinalmente.
    cohort_id: UUID | None = None


class KappaResponse(BaseModel):
    kappa: float
    n_episodes: int
    observed_agreement: float
    expected_agreement: float
    interpretation: str
    per_class_agreement: dict[str, float]
    confusion_matrix: dict[str, dict[str, int]]


@router.post("/kappa", response_model=KappaResponse)
async def compute_kappa(
    req: KappaRequest,
    tenant_id: UUID = Depends(get_tenant_id),
    user_id: UUID = Depends(get_user_id),
) -> KappaResponse:
    """Calcula Cohen's Kappa sobre un batch de ratings.

    Los ratings vienen del frontend (docente revisa N episodios
    clasificados y marca si concuerda o no). El response incluye
    la interpretación de Landis & Koch + matriz de confusión para
    identificar clases problemáticas.

    Este endpoint es clave para el capítulo de validación empírica
    de la tesis.
    """
    ratings = [
        KappaRating(
            episode_id=r.episode_id,
            rater_a=r.rater_a,
            rater_b=r.rater_b,
        )
        for r in req.ratings
    ]
    try:
        result = compute_cohen_kappa(ratings)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    response = KappaResponse(
        kappa=result.kappa,
        n_episodes=result.n_episodes,
        observed_agreement=result.observed_agreement,
        expected_agreement=result.expected_agreement,
        interpretation=result.interpretation,
        per_class_agreement=result.per_class_agreement,
        confusion_matrix=result.confusion_matrix,
    )

    logger.info(
        "kappa_computed tenant_id=%s user_id=%s n_episodes=%d kappa=%s interpretation=%s",
        tenant_id,
        user_id,
        response.n_episodes,
        response.kappa,
        response.interpretation,
    )

    # Métrica: si el request trae cohort_id, actualizar los gauges para el
    # dashboard 5 (κ rolling). UpDownCounter — para "set value" emitimos
    # delta vs valor previo, simulado con add(value) que en práctica refleja
    # acumulado. En el período del piloto basta para visualización.
    if req.cohort_id is not None:
        cohort_label = {"window": "7d", "cohort": str(req.cohort_id)}
        classifier_kappa_rolling.add(response.kappa, cohort_label)
        classifier_kappa_rolling_last_update_unix_seconds.add(
            time.time(), {"cohort": str(req.cohort_id)}
        )

    return response


# ── Cohort export endpoint ─────────────────────────────────────────────
# El export real requiere acceso a varias DBs (episodes, events, classifications).
# Este endpoint es un stub que documenta la API; la integración con el
# data_source real se hace en F7.


class CohortExportRequest(BaseModel):
    comision_id: UUID
    period_days: int = Field(default=90, ge=1, le=365)
    include_prompts: bool = False
    salt: str = Field(
        ...,
        min_length=16,
        description="Salt de anonimización (16+ chars). Investigadores con el mismo salt pueden cross-referenciar.",
    )
    cohort_alias: str = "COHORT"


class ExportJobResponse(BaseModel):
    job_id: str
    status: str
    message: str


@router.post(
    "/cohort/export", response_model=ExportJobResponse, status_code=status.HTTP_202_ACCEPTED
)
async def export_cohort(
    req: CohortExportRequest,
    tenant_id: UUID = Depends(get_tenant_id),
    user_id: UUID = Depends(get_user_id),
) -> ExportJobResponse:
    """Encola un job de export académico anonymizado.

    F7: la implementación real encola contra el `ExportJobStore`
    global del analytics-service, y el worker lo consume en background.
    El investigador hace polling a `/cohort/export/{job_id}/status` y
    descarga con `/cohort/export/{job_id}/download` cuando está listo.
    """
    import hashlib
    from datetime import UTC, datetime
    from uuid import uuid4

    from platform_ops import ExportJob, JobStatus

    from analytics_service.services.export import get_job_store

    # Hash del salt para trazabilidad sin exponer el salt en claro
    salt_hash = hashlib.sha256(req.salt.encode()).hexdigest()[:16]

    job = ExportJob(
        job_id=uuid4(),
        status=JobStatus.PENDING,
        comision_id=req.comision_id,
        requested_by_user_id=user_id,
        requested_at=datetime.now(UTC),
        tenant_id=tenant_id,
        period_days=req.period_days,
        include_prompts=req.include_prompts,
        salt_hash=salt_hash,
        cohort_alias=req.cohort_alias,
    )

    store = get_job_store()
    await store.enqueue(job)

    return ExportJobResponse(
        job_id=str(job.job_id),
        status=job.status.value,
        message=(
            f"Export encolado. Polling: GET /cohort/export/{job.job_id}/status | "
            f"Descarga: GET /cohort/export/{job.job_id}/download"
        ),
    )


@router.get("/cohort/export/{job_id}/status")
async def get_export_status(job_id: UUID) -> dict:
    """Estado actual del export job."""
    from analytics_service.services.export import get_job_store

    store = get_job_store()
    job = await store.get(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Job {job_id} no encontrado"
        )
    return job.to_dict()


@router.get("/cohort/export/{job_id}/download")
async def download_export(job_id: UUID) -> dict:
    """Descarga el dataset exportado si el job está succeeded.

    En producción (F8+), esto devolvería un redirect a una URL firmada
    de S3/MinIO. En F7 devolvemos el payload inline (ok para datasets
    de ~MB; para 100+ MB conviene migrar a storage externo).
    """
    from platform_ops import JobStatus

    from analytics_service.services.export import get_job_store

    store = get_job_store()
    job = await store.get(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Job {job_id} no encontrado"
        )

    if job.status in (JobStatus.PENDING, JobStatus.RUNNING):
        raise HTTPException(
            status_code=status.HTTP_425_TOO_EARLY,
            detail=f"Job aún no terminado (estado: {job.status.value}). "
            f"Hacé polling al endpoint /status.",
        )
    if job.status == JobStatus.FAILED:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Job falló: {job.error}",
        )
    if job.result_payload is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Job succeeded pero sin payload (bug).",
        )

    return job.result_payload


# ── Progresión longitudinal (F7) ───────────────────────────────────────


class TrajectoryPoint(BaseModel):
    episode_id: str
    classified_at: str
    appropriation: str


class StudentTrajectoryOut(BaseModel):
    student_pseudonym: str
    n_episodes: int
    first_classification: str | None
    last_classification: str | None
    max_appropriation_reached: str | None
    progression_label: str  # "mejorando" | "estable" | "empeorando" | "insuficiente"
    tercile_means: tuple[float, float, float] | None
    points: list[TrajectoryPoint]


class CohortProgressionOut(BaseModel):
    comision_id: UUID
    n_students: int
    n_students_with_enough_data: int
    mejorando: int
    estable: int
    empeorando: int
    insuficiente: int
    net_progression_ratio: float
    trajectories: list[StudentTrajectoryOut]


@router.get(
    "/cohort/{comision_id}/progression",
    response_model=CohortProgressionOut,
)
async def get_cohort_progression(
    comision_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> CohortProgressionOut:
    """Analiza la progresión longitudinal de los estudiantes de una cohorte.

    Resultado:
      - Cada estudiante con su trayectoria de clasificaciones + etiqueta
        de progresión ("mejorando" si último tercio > primero)
      - Resumen agregado con `net_progression_ratio` (indicador de cohorte)

    F8: si las env vars `CTR_STORE_URL` + `CLASSIFIER_DB_URL` están
    configuradas, usa el adaptador real con RLS por tenant. Si no, cae a
    un stub vacío (modo dev).
    """
    from platform_ops import build_trajectories, summarize_cohort

    from analytics_service.services.export import (
        _real_data_source_enabled,
    )

    if _real_data_source_enabled():
        from platform_ops import RealLongitudinalDataSource, set_tenant_rls
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        from analytics_service.config import settings

        ctr_engine = create_async_engine(settings.ctr_store_url, pool_size=2)
        cls_engine = create_async_engine(settings.classifier_db_url, pool_size=2)
        ctr_maker = async_sessionmaker(ctr_engine, expire_on_commit=False)
        cls_maker = async_sessionmaker(cls_engine, expire_on_commit=False)
        try:
            async with ctr_maker() as ctr_s, cls_maker() as cls_s:
                await set_tenant_rls(ctr_s, tenant_id)
                await set_tenant_rls(cls_s, tenant_id)
                ds = RealLongitudinalDataSource(ctr_s, cls_s, tenant_id)
                # build_trajectories acepta cualquier objeto con
                # `list_classifications_grouped_by_student` (duck-typed); el
                # protocol _DataSource es interno al paquete platform-ops.
                trajectories = await build_trajectories(ds, comision_id)  # type: ignore[arg-type]
        finally:
            await ctr_engine.dispose()
            await cls_engine.dispose()
    else:
        # Stub para dev
        class _LongitudinalAdapter:
            async def list_classifications_grouped_by_student(self, comision_id):
                return {}

        trajectories = await build_trajectories(_LongitudinalAdapter(), comision_id)  # type: ignore[arg-type]

    summary = summarize_cohort(comision_id, trajectories)

    return CohortProgressionOut(
        comision_id=comision_id,
        n_students=summary.n_students,
        n_students_with_enough_data=summary.n_students_with_enough_data,
        mejorando=summary.mejorando,
        estable=summary.estable,
        empeorando=summary.empeorando,
        insuficiente=summary.insuficiente,
        net_progression_ratio=summary.net_progression_ratio,
        trajectories=[
            StudentTrajectoryOut(
                student_pseudonym=t.student_pseudonym,
                n_episodes=t.n_episodes,
                first_classification=t.first_classification,
                last_classification=t.last_classification,
                max_appropriation_reached=t.max_appropriation_reached(),
                progression_label=t.progression_label(),
                tercile_means=t.tercile_means(),
                points=[
                    TrajectoryPoint(
                        episode_id=str(p.episode_id),
                        classified_at=p.classified_at.isoformat().replace("+00:00", "Z"),
                        appropriation=p.appropriation,
                    )
                    for p in t.points
                ],
            )
            for t in trajectories
        ],
    )


# ── Etiquetador N1-N4 por evento (ADR-020) ────────────────────────────


class NLevelDistributionOut(BaseModel):
    """Distribución de tiempo y eventos por nivel analítico N1-N4.

    Componente C3.2 de la tesis (Sección 6.4). El etiquetador deriva el nivel
    en lectura — NO está almacenado en el payload del evento (preserva
    reproducibilidad bit-a-bit del self_hash).
    """

    episode_id: str
    labeler_version: str
    distribution_seconds: dict[str, float]
    distribution_ratio: dict[str, float]
    total_events_per_level: dict[str, int]


@router.get(
    "/episode/{episode_id}/n-level-distribution",
    response_model=NLevelDistributionOut,
)
async def get_n_level_distribution(
    episode_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
    user_id: UUID = Depends(get_user_id),
) -> NLevelDistributionOut:
    """Distribución de tiempo por nivel N1-N4 para un episodio (ADR-020).

    El etiquetador (`event_labeler.py`) aplica reglas de primer orden sobre
    `event_type` + `payload.origin` (para `edicion_codigo`). Las reglas son
    versionables vía `LABELER_VERSION` — bumpear re-etiqueta históricos sin
    tocar el CTR.

    Modo dev (sin CTR_STORE_URL): devuelve distribución vacía con
    `labeler_version`. Coherente con `/cohort/{id}/progression`.

    Modo real: lee eventos del CTR con RLS por tenant; 404 si el episodio
    no existe o no tiene eventos en este tenant.
    """
    # Import del labeler vía sys.path (mismo patrón que /ab-test-profiles)
    import sys
    from pathlib import Path

    classifier_src = Path(__file__).parent.parent.parent.parent.parent / "classifier-service/src"
    if str(classifier_src) not in sys.path:
        sys.path.insert(0, str(classifier_src))

    try:
        from classifier_service.services.event_labeler import n_level_distribution
    except ImportError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"event_labeler no disponible: {e}",
        )

    from analytics_service.services.export import _real_data_source_enabled

    if not _real_data_source_enabled():
        # Modo dev: distribución vacía. El labeler_version igual viaja.
        empty = n_level_distribution([])
        return NLevelDistributionOut(episode_id=str(episode_id), **empty)

    # Modo real: lectura del CTR con RLS por tenant.
    # Late import del modelo Event (evita ciclos en testing).
    from ctr_service.models import Event
    from platform_ops import set_tenant_rls
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from analytics_service.config import settings

    ctr_engine = create_async_engine(settings.ctr_store_url, pool_size=2)
    try:
        ctr_maker = async_sessionmaker(ctr_engine, expire_on_commit=False)
        async with ctr_maker() as ctr_s:
            await set_tenant_rls(ctr_s, tenant_id)
            stmt = (
                select(Event)
                .where(Event.episode_id == episode_id)
                .where(Event.tenant_id == tenant_id)  # doble filtro (defensivo)
                .order_by(Event.seq.asc())
            )
            result = await ctr_s.execute(stmt)
            events = [
                {
                    "seq": ev.seq,
                    "event_type": ev.event_type,
                    "ts": ev.ts.isoformat().replace("+00:00", "Z") if ev.ts else None,
                    "payload": ev.payload or {},
                }
                for ev in result.scalars().all()
            ]
    finally:
        await ctr_engine.dispose()

    if not events:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Episode {episode_id} no encontrado o sin eventos en este tenant",
        )

    distribution = n_level_distribution(events)
    logger.info(
        "n_level_distribution_computed tenant_id=%s user_id=%s episode_id=%s "
        "n_events=%d labeler_version=%s",
        tenant_id,
        user_id,
        episode_id,
        sum(distribution["total_events_per_level"].values()),
        distribution["labeler_version"],
    )
    return NLevelDistributionOut(episode_id=str(episode_id), **distribution)


# ── CII evolution longitudinal por estudiante (ADR-018) ──────────────


class CIIEvolutionTemplateOut(BaseModel):
    """Slope longitudinal de un estudiante sobre un template específico."""

    template_id: UUID
    n_episodes: int
    scores_ordinal: list[int]
    slope: float | None
    insufficient_data: bool


class CIIEvolutionLongitudinalOut(BaseModel):
    """Distribución de evolution longitudinal de un estudiante (ADR-018).

    Componente operacional de la Sección 15.4 de la tesis. Cada entry de
    `evolution_per_template` es un slope ordinal sobre `APPROPRIATION_ORDINAL`
    (0=delegacion, 1=superficial, 2=reflexiva). Slope > 0 = mejora
    longitudinal en ese problema lógico.
    """

    student_pseudonym: str
    comision_id: str
    n_groups_evaluated: int
    n_groups_insufficient: int
    n_episodes_total: int
    evolution_per_template: list[CIIEvolutionTemplateOut]
    mean_slope: float | None
    sufficient_data: bool
    labeler_version: str


@router.get(
    "/student/{student_pseudonym}/cii-evolution-longitudinal",
    response_model=CIIEvolutionLongitudinalOut,
)
async def get_cii_evolution_longitudinal(
    student_pseudonym: UUID,
    comision_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
    user_id: UUID = Depends(get_user_id),
) -> CIIEvolutionLongitudinalOut:
    """CII evolution longitudinal del estudiante en una comisión (ADR-018).

    Agrupa episodios cerrados del estudiante por `TareaPractica.template_id`
    (problemas análogos definidos por ADR-016). Para cada grupo con N>=3
    calcula el slope de la regresión lineal sobre `APPROPRIATION_ORDINAL`
    ordenados por `classified_at`.

    Modo dev (sin DBs configuradas): devuelve estructura vacía con 200,
    coherente con `/cohort/{id}/progression` y `/n-level-distribution`.

    Modo real: triple cross-DB (CTR + classifier + academic) con RLS por
    tenant. La query está limitada a la comisión para acotar el scope —
    para análisis cross-comisión hay que llamar el endpoint N veces, una
    por comisión del estudiante.
    """
    from platform_ops import compute_cii_evolution_longitudinal

    from analytics_service.services.export import _real_data_source_enabled

    if not _real_data_source_enabled():
        # Modo dev: estructura vacía con labeler_version
        empty = compute_cii_evolution_longitudinal([])
        return CIIEvolutionLongitudinalOut(
            student_pseudonym=str(student_pseudonym),
            comision_id=str(comision_id),
            **empty,
        )

    # Modo real: 3 sesiones (ctr + classifier + academic) con RLS
    from platform_ops import RealLongitudinalDataSource, set_tenant_rls
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from analytics_service.config import settings

    ctr_engine = create_async_engine(settings.ctr_store_url, pool_size=2)
    cls_engine = create_async_engine(settings.classifier_db_url, pool_size=2)
    acad_engine = create_async_engine(settings.academic_db_url, pool_size=2)
    try:
        async with (
            async_sessionmaker(ctr_engine, expire_on_commit=False)() as ctr_s,
            async_sessionmaker(cls_engine, expire_on_commit=False)() as cls_s,
            async_sessionmaker(acad_engine, expire_on_commit=False)() as acad_s,
        ):
            await set_tenant_rls(ctr_s, tenant_id)
            await set_tenant_rls(cls_s, tenant_id)
            await set_tenant_rls(acad_s, tenant_id)
            ds = RealLongitudinalDataSource(ctr_s, cls_s, tenant_id)
            classifications = await ds.list_classifications_with_templates_for_student(
                student_pseudonym=student_pseudonym,
                comision_id=comision_id,
                academic_session=acad_s,
            )
    finally:
        await ctr_engine.dispose()
        await cls_engine.dispose()
        await acad_engine.dispose()

    distribution = compute_cii_evolution_longitudinal(classifications)
    logger.info(
        "cii_evolution_longitudinal_computed tenant_id=%s user_id=%s "
        "student_pseudonym=%s comision_id=%s n_episodes_total=%d "
        "n_groups_evaluated=%d mean_slope=%s labeler_version=%s",
        tenant_id,
        user_id,
        student_pseudonym,
        comision_id,
        distribution["n_episodes_total"],
        distribution["n_groups_evaluated"],
        distribution["mean_slope"],
        distribution["labeler_version"],
    )
    return CIIEvolutionLongitudinalOut(
        student_pseudonym=str(student_pseudonym),
        comision_id=str(comision_id),
        **distribution,
    )


# ── Listado de episodios cerrados del estudiante (drill-down nav) ────


class StudentEpisodeOut(BaseModel):
    episode_id: str
    problema_id: str
    tarea_codigo: str | None
    tarea_titulo: str | None
    template_id: str | None
    opened_at: str | None
    closed_at: str | None
    events_count: int
    appropriation: str | None
    classified_at: str | None


class StudentEpisodesOut(BaseModel):
    student_pseudonym: str
    comision_id: str
    n_episodes: int
    episodes: list[StudentEpisodeOut]


@router.get(
    "/student/{student_pseudonym}/episodes",
    response_model=StudentEpisodesOut,
)
async def get_student_episodes(
    student_pseudonym: UUID,
    comision_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
    user_id: UUID = Depends(get_user_id),
) -> StudentEpisodesOut:
    """Listado de episodios CERRADOS del estudiante con classification + template_id.

    Para que el frontend muestre dropdown de episodios en lugar de exigir
    pegar UUIDs (ADR-022 — drill-down navegacional).
    """
    from analytics_service.services.export import _real_data_source_enabled

    if not _real_data_source_enabled():
        return StudentEpisodesOut(
            student_pseudonym=str(student_pseudonym),
            comision_id=str(comision_id),
            n_episodes=0,
            episodes=[],
        )

    from platform_ops import RealLongitudinalDataSource, set_tenant_rls
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from analytics_service.config import settings

    ctr_engine = create_async_engine(settings.ctr_store_url, pool_size=2)
    cls_engine = create_async_engine(settings.classifier_db_url, pool_size=2)
    acad_engine = create_async_engine(settings.academic_db_url, pool_size=2)
    try:
        async with (
            async_sessionmaker(ctr_engine, expire_on_commit=False)() as ctr_s,
            async_sessionmaker(cls_engine, expire_on_commit=False)() as cls_s,
            async_sessionmaker(acad_engine, expire_on_commit=False)() as acad_s,
        ):
            await set_tenant_rls(ctr_s, tenant_id)
            await set_tenant_rls(cls_s, tenant_id)
            await set_tenant_rls(acad_s, tenant_id)
            ds = RealLongitudinalDataSource(ctr_s, cls_s, tenant_id)
            episodes = await ds.list_episodes_with_classifications_for_student(
                student_pseudonym=student_pseudonym,
                comision_id=comision_id,
                academic_session=acad_s,
            )
    finally:
        await ctr_engine.dispose()
        await cls_engine.dispose()
        await acad_engine.dispose()

    logger.info(
        "student_episodes_listed tenant_id=%s user_id=%s student_pseudonym=%s "
        "comision_id=%s n_episodes=%d",
        tenant_id,
        user_id,
        student_pseudonym,
        comision_id,
        len(episodes),
    )
    return StudentEpisodesOut(
        student_pseudonym=str(student_pseudonym),
        comision_id=str(comision_id),
        n_episodes=len(episodes),
        episodes=[StudentEpisodeOut(**e) for e in episodes],
    )


# ── Cuartiles agregados de cohorte (ADR-022, privacidad-safe) ─────────


class CohortCIIQuartilesOut(BaseModel):
    """Cuartiles agregados de los `mean_slope` longitudinales de la cohorte.

    NO expone slopes individuales — solo Q1/Q2/Q3/min/max/mean/std agregados.
    Si la cohorte tiene <5 estudiantes con slope no-null, devuelve
    `insufficient_data: true` (privacidad — cohortes muy chicas son
    des-anonimizables vía cuartiles).
    """

    comision_id: str
    labeler_version: str
    min_students_for_quartiles: int
    n_students_evaluated: int
    insufficient_data: bool
    q1: float | None
    median: float | None
    q3: float | None
    min: float | None
    max: float | None
    mean: float | None
    stdev: float | None


@router.get(
    "/cohort/{comision_id}/cii-quartiles",
    response_model=CohortCIIQuartilesOut,
)
async def get_cohort_cii_quartiles(
    comision_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
    user_id: UUID = Depends(get_user_id),
) -> CohortCIIQuartilesOut:
    """Cuartiles agregados de mean_slope longitudinales de la cohorte (ADR-022).

    Itera por estudiante de la comisión, computa su `mean_slope`, agrega.
    Modo dev devuelve estructura vacía con `insufficient_data: true`.
    """
    from platform_ops import compute_cohort_quartiles_payload

    from analytics_service.services.export import _real_data_source_enabled

    if not _real_data_source_enabled():
        empty = compute_cohort_quartiles_payload([])
        return CohortCIIQuartilesOut(comision_id=str(comision_id), **empty)

    from platform_ops import (
        RealLongitudinalDataSource,
        compute_cii_evolution_longitudinal,
        set_tenant_rls,
    )
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from analytics_service.config import settings

    ctr_engine = create_async_engine(settings.ctr_store_url, pool_size=2)
    cls_engine = create_async_engine(settings.classifier_db_url, pool_size=2)
    acad_engine = create_async_engine(settings.academic_db_url, pool_size=2)
    student_slopes: list[float] = []
    try:
        async with (
            async_sessionmaker(ctr_engine, expire_on_commit=False)() as ctr_s,
            async_sessionmaker(cls_engine, expire_on_commit=False)() as cls_s,
            async_sessionmaker(acad_engine, expire_on_commit=False)() as acad_s,
        ):
            await set_tenant_rls(ctr_s, tenant_id)
            await set_tenant_rls(cls_s, tenant_id)
            await set_tenant_rls(acad_s, tenant_id)
            ds = RealLongitudinalDataSource(ctr_s, cls_s, tenant_id)

            # Iterar por estudiante: obtener student list, luego cii por cada uno
            from ctr_service.models import Episode
            from sqlalchemy import select

            ep_stmt = (
                select(Episode.student_pseudonym)
                .where(Episode.comision_id == comision_id)
                .where(Episode.tenant_id == tenant_id)
                .distinct()
            )
            students_result = await ctr_s.execute(ep_stmt)
            student_ids = [row.student_pseudonym for row in students_result.all()]

            for student_id in student_ids:
                classifications = await ds.list_classifications_with_templates_for_student(
                    student_pseudonym=student_id,
                    comision_id=comision_id,
                    academic_session=acad_s,
                )
                evolution = compute_cii_evolution_longitudinal(classifications)
                if evolution["mean_slope"] is not None:
                    student_slopes.append(evolution["mean_slope"])
    finally:
        await ctr_engine.dispose()
        await cls_engine.dispose()
        await acad_engine.dispose()

    payload = compute_cohort_quartiles_payload(student_slopes)
    logger.info(
        "cohort_cii_quartiles_computed tenant_id=%s user_id=%s comision_id=%s "
        "n_students_evaluated=%d insufficient_data=%s",
        tenant_id,
        user_id,
        comision_id,
        payload["n_students_evaluated"],
        payload["insufficient_data"],
    )
    return CohortCIIQuartilesOut(comision_id=str(comision_id), **payload)


# ── Alertas longitudinales del estudiante (ADR-022) ───────────────────


class StudentAlertOut(BaseModel):
    code: str
    severity: Literal["low", "medium", "high"]
    title: str
    detail: str
    threshold_used: str
    z_score: float | None = None


class StudentAlertsOut(BaseModel):
    student_pseudonym: str
    comision_id: str
    labeler_version: str
    student_slope: float | None
    cohort_stats: dict[str, Any]
    quartile: Literal["Q1", "Q2", "Q3", "Q4"] | None
    alerts: list[StudentAlertOut]
    n_alerts: int
    highest_severity: Literal["low", "medium", "high"] | None


@router.get(
    "/student/{student_pseudonym}/alerts",
    response_model=StudentAlertsOut,
)
async def get_student_alerts(
    student_pseudonym: UUID,
    comision_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
    user_id: UUID = Depends(get_user_id),
) -> StudentAlertsOut:
    """Alertas longitudinales del estudiante vs. cohorte (ADR-022, audit G7).

    Compara `mean_slope` del estudiante con la distribución agregada de la
    cohorte y emite alertas si está >1σ debajo de la media o en Q1.
    Modo dev devuelve estructura vacía sin alertas.
    """
    from platform_ops import compute_alerts_payload, compute_cohort_quartiles_payload

    from analytics_service.services.export import _real_data_source_enabled

    if not _real_data_source_enabled():
        empty_cohort = compute_cohort_quartiles_payload([])
        empty_alerts = compute_alerts_payload(None, empty_cohort)
        return StudentAlertsOut(
            student_pseudonym=str(student_pseudonym),
            comision_id=str(comision_id),
            **empty_alerts,
        )

    from platform_ops import (
        RealLongitudinalDataSource,
        compute_cii_evolution_longitudinal,
        set_tenant_rls,
    )
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from analytics_service.config import settings

    ctr_engine = create_async_engine(settings.ctr_store_url, pool_size=2)
    cls_engine = create_async_engine(settings.classifier_db_url, pool_size=2)
    acad_engine = create_async_engine(settings.academic_db_url, pool_size=2)
    student_slope: float | None = None
    cohort_slopes: list[float] = []
    try:
        async with (
            async_sessionmaker(ctr_engine, expire_on_commit=False)() as ctr_s,
            async_sessionmaker(cls_engine, expire_on_commit=False)() as cls_s,
            async_sessionmaker(acad_engine, expire_on_commit=False)() as acad_s,
        ):
            await set_tenant_rls(ctr_s, tenant_id)
            await set_tenant_rls(cls_s, tenant_id)
            await set_tenant_rls(acad_s, tenant_id)
            ds = RealLongitudinalDataSource(ctr_s, cls_s, tenant_id)

            # 1. Slope del estudiante target
            student_classifications = await ds.list_classifications_with_templates_for_student(
                student_pseudonym=student_pseudonym,
                comision_id=comision_id,
                academic_session=acad_s,
            )
            student_evolution = compute_cii_evolution_longitudinal(student_classifications)
            student_slope = student_evolution["mean_slope"]

            # 2. Slopes de toda la cohorte (para cuartiles)
            from ctr_service.models import Episode
            from sqlalchemy import select

            ep_stmt = (
                select(Episode.student_pseudonym)
                .where(Episode.comision_id == comision_id)
                .where(Episode.tenant_id == tenant_id)
                .distinct()
            )
            students_result = await ctr_s.execute(ep_stmt)
            student_ids = [row.student_pseudonym for row in students_result.all()]
            for sid in student_ids:
                cls = await ds.list_classifications_with_templates_for_student(
                    student_pseudonym=sid,
                    comision_id=comision_id,
                    academic_session=acad_s,
                )
                evo = compute_cii_evolution_longitudinal(cls)
                if evo["mean_slope"] is not None:
                    cohort_slopes.append(evo["mean_slope"])
    finally:
        await ctr_engine.dispose()
        await cls_engine.dispose()
        await acad_engine.dispose()

    cohort_stats = compute_cohort_quartiles_payload(cohort_slopes)
    alerts_payload = compute_alerts_payload(student_slope, cohort_stats)
    logger.info(
        "student_alerts_computed tenant_id=%s user_id=%s student_pseudonym=%s "
        "comision_id=%s n_alerts=%d highest_severity=%s",
        tenant_id,
        user_id,
        student_pseudonym,
        comision_id,
        alerts_payload["n_alerts"],
        alerts_payload["highest_severity"],
    )
    return StudentAlertsOut(
        student_pseudonym=str(student_pseudonym),
        comision_id=str(comision_id),
        **alerts_payload,
    )


# ── Eventos adversos por cohorte (ADR-019, agregación al docente) ────


class AdversarialRecentEventOut(BaseModel):
    episode_id: str
    student_pseudonym: str
    ts: str
    category: str
    severity: int
    pattern_id: str
    matched_text: str


class AdversarialTopStudentOut(BaseModel):
    student_pseudonym: str
    n_events: int


class CohortAdversarialEventsOut(BaseModel):
    """Agregado de eventos `intento_adverso_detectado` para una cohorte."""

    comision_id: str
    n_events_total: int
    counts_by_category: dict[str, int]
    counts_by_severity: dict[str, int]
    counts_by_student: dict[str, int]
    top_students_by_n_events: list[AdversarialTopStudentOut]
    recent_events: list[AdversarialRecentEventOut]


@router.get(
    "/cohort/{comision_id}/adversarial-events",
    response_model=CohortAdversarialEventsOut,
)
async def get_cohort_adversarial_events(
    comision_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
    user_id: UUID = Depends(get_user_id),
) -> CohortAdversarialEventsOut:
    """Agregado de eventos adversos para visibilidad pedagógica del docente.

    Lee eventos `intento_adverso_detectado` (ADR-019, RN-129) de los episodios
    de una comisión, los agrega por categoría/severidad/estudiante, y devuelve
    los más recientes con `matched_text` truncado a 200 chars.

    Modo dev: estructura vacía con 200. Modo real: cross-DB CTR con RLS.
    """
    from platform_ops import aggregate_adversarial_events

    from analytics_service.services.export import _real_data_source_enabled

    if not _real_data_source_enabled():
        empty = aggregate_adversarial_events([])
        return CohortAdversarialEventsOut(comision_id=str(comision_id), **empty)

    from platform_ops import RealLongitudinalDataSource, set_tenant_rls
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from analytics_service.config import settings

    ctr_engine = create_async_engine(settings.ctr_store_url, pool_size=2)
    cls_engine = create_async_engine(settings.classifier_db_url, pool_size=2)
    try:
        async with (
            async_sessionmaker(ctr_engine, expire_on_commit=False)() as ctr_s,
            async_sessionmaker(cls_engine, expire_on_commit=False)() as cls_s,
        ):
            await set_tenant_rls(ctr_s, tenant_id)
            await set_tenant_rls(cls_s, tenant_id)
            ds = RealLongitudinalDataSource(ctr_s, cls_s, tenant_id)
            events = await ds.list_adversarial_events_by_comision(comision_id)
    finally:
        await ctr_engine.dispose()
        await cls_engine.dispose()

    aggregated = aggregate_adversarial_events(events)
    logger.info(
        "cohort_adversarial_events_computed tenant_id=%s user_id=%s "
        "comision_id=%s n_events=%d n_categories=%d",
        tenant_id,
        user_id,
        comision_id,
        aggregated["n_events_total"],
        len(aggregated["counts_by_category"]),
    )
    return CohortAdversarialEventsOut(comision_id=str(comision_id), **aggregated)


# ── A/B testing de profiles (F7) ───────────────────────────────────────


class ABTestRequest(BaseModel):
    """Request para A/B testing de profiles contra gold standard humano."""

    episodes: list[dict]  # [{"episode_id": str, "events": [...], "human_label": str}]
    profiles: list[dict]  # [{"name": str, "version": str, "thresholds": {...}}]


class ProfileComparisonOut(BaseModel):
    profile_name: str
    profile_version: str
    profile_hash: str
    kappa: float
    interpretation: str
    predictions: dict[str, str]


class ABTestResponse(BaseModel):
    n_episodes: int
    winner_by_kappa: str | None
    results: list[ProfileComparisonOut]


@router.post("/ab-test-profiles", response_model=ABTestResponse)
async def ab_test_profiles(
    req: ABTestRequest,
    tenant_id: UUID = Depends(get_tenant_id),
    user_id: UUID = Depends(get_user_id),
) -> ABTestResponse:
    """Compara múltiples reference_profiles del clasificador contra un
    gold standard de etiquetado humano.

    Caso de uso: al calibrar el árbol N4 con datos reales del piloto,
    el investigador provee N episodios con etiqueta humana, pasa 2+
    profiles candidatos, y obtiene Kappa de cada uno. El ganador es el
    profile que más se acerca al juicio humano.

    Formato del episodio:
        {
            "episode_id": "ep_123",
            "events": [{ev1}, {ev2}, ...],
            "human_label": "apropiacion_reflexiva"
        }

    HU-088 audit trail: emite `ab_test_profiles_completed` por structlog
    (config global del servicio vía `platform_observability`). No persiste
    en tabla `audit_log` — la decisión es interpretación de "Los resultados
    quedan en AuditLog" como log estructurado a Loki/Grafana, dado que el
    endpoint es infra de investigación, no CRUD académico bajo compliance
    bit-exact. Ver entrada HU-088 en `BUGS-PILOTO.md`.
    """
    import sys
    from pathlib import Path

    # Permitir importar classifier-service en runtime
    classifier_src = Path(__file__).parent.parent.parent.parent.parent / "classifier-service/src"
    if str(classifier_src) not in sys.path:
        sys.path.insert(0, str(classifier_src))

    try:
        from classifier_service.services.pipeline import (
            classify_episode_from_events,
            compute_classifier_config_hash,
        )
    except ImportError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"classifier-service module no disponible: {e}",
        )

    from platform_ops import EpisodeForComparison, compare_profiles

    # Validar input
    if len(req.episodes) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Se requieren al menos 2 episodios para calcular Kappa",
        )
    if len(req.profiles) < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Al menos 1 profile es requerido",
        )

    episodes = [
        EpisodeForComparison(
            episode_id=e["episode_id"],
            events=e["events"],
            human_label=e["human_label"],
        )
        for e in req.episodes
    ]

    try:
        report = compare_profiles(
            episodes=episodes,
            profiles=req.profiles,
            classify_fn=classify_episode_from_events,
            compute_hash_fn=compute_classifier_config_hash,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    # HU-088 audit trail: log estructurado del A/B testing (no se persiste a DB).
    kappa_per_profile = {r.profile_name: r.kappa.kappa for r in report.results}
    config_hash_per_profile = {r.profile_name: r.profile_hash for r in report.results}
    logger.info(
        "ab_test_profiles_completed tenant_id=%s user_id=%s "
        "n_episodes_compared=%d n_profiles_compared=%d "
        "winner_profile_name=%s kappa_per_profile=%s classifier_config_hash=%s",
        tenant_id,
        user_id,
        report.n_episodes,
        len(report.results),
        report.winner_by_kappa,
        kappa_per_profile,
        config_hash_per_profile,
    )

    return ABTestResponse(
        n_episodes=report.n_episodes,
        winner_by_kappa=report.winner_by_kappa,
        results=[
            ProfileComparisonOut(
                profile_name=r.profile_name,
                profile_version=r.profile_version,
                profile_hash=r.profile_hash,
                kappa=r.kappa.kappa,
                interpretation=r.interpretation,
                predictions=r.predictions,
            )
            for r in report.results
        ],
    )
