"""Endpoints analíticos del piloto UNSL.

POST /api/v1/analytics/kappa            calcula Cohen's Kappa de un batch de ratings
GET  /api/v1/analytics/cohort/export    descarga dataset académico anonimizado
"""
from __future__ import annotations

import logging
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field

from platform_ops import (
    KappaRating,
    compute_cohen_kappa,
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
        "kappa_computed tenant_id=%s user_id=%s "
        "n_episodes=%d kappa=%s interpretation=%s",
        tenant_id,
        user_id,
        response.n_episodes,
        response.kappa,
        response.interpretation,
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


@router.post("/cohort/export", response_model=ExportJobResponse, status_code=status.HTTP_202_ACCEPTED)
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
    from analytics_service.services.export import get_job_store, get_worker_salt
    from datetime import UTC, datetime
    from uuid import uuid4
    import hashlib
    from platform_ops import ExportJob, JobStatus

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Job {job_id} no encontrado")
    return job.to_dict()


@router.get("/cohort/export/{job_id}/download")
async def download_export(job_id: UUID) -> dict:
    """Descarga el dataset exportado si el job está succeeded.

    En producción (F8+), esto devolvería un redirect a una URL firmada
    de S3/MinIO. En F7 devolvemos el payload inline (ok para datasets
    de ~MB; para 100+ MB conviene migrar a storage externo).
    """
    from analytics_service.services.export import get_job_store
    from platform_ops import JobStatus

    store = get_job_store()
    job = await store.get(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Job {job_id} no encontrado")

    if job.status == JobStatus.PENDING or job.status == JobStatus.RUNNING:
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
    student_alias: str
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
    from analytics_service.services.export import (
        _StubDataSource, _real_data_source_enabled,
    )
    from platform_ops import build_trajectories, summarize_cohort

    if _real_data_source_enabled():
        from analytics_service.config import settings
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
        from platform_ops import RealLongitudinalDataSource, set_tenant_rls

        ctr_engine = create_async_engine(settings.ctr_store_url, pool_size=2)
        cls_engine = create_async_engine(settings.classifier_db_url, pool_size=2)
        ctr_maker = async_sessionmaker(ctr_engine, expire_on_commit=False)
        cls_maker = async_sessionmaker(cls_engine, expire_on_commit=False)
        try:
            async with ctr_maker() as ctr_s, cls_maker() as cls_s:
                await set_tenant_rls(ctr_s, tenant_id)
                await set_tenant_rls(cls_s, tenant_id)
                ds = RealLongitudinalDataSource(ctr_s, cls_s, tenant_id)
                trajectories = await build_trajectories(ds, comision_id)
        finally:
            await ctr_engine.dispose()
            await cls_engine.dispose()
    else:
        # Stub para dev
        class _LongitudinalAdapter:
            async def list_classifications_grouped_by_student(self, comision_id):
                return {}
        trajectories = await build_trajectories(_LongitudinalAdapter(), comision_id)

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
                student_alias=t.student_alias,
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
