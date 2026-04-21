/**
 * Cliente API del web-teacher.
 *
 * F8: usa OIDC real con useAuthenticatedFetch. Todas las funciones toman
 * un TokenGetter como primer parámetro.
 */

export type AppropriationLabel =
  | "delegacion_pasiva"
  | "apropiacion_superficial"
  | "apropiacion_reflexiva"

export interface TrajectoryPoint {
  episode_id: string
  classified_at: string
  appropriation: AppropriationLabel
}

export interface StudentTrajectory {
  student_alias: string
  n_episodes: number
  first_classification: AppropriationLabel | null
  last_classification: AppropriationLabel | null
  max_appropriation_reached: AppropriationLabel | null
  progression_label: "mejorando" | "estable" | "empeorando" | "insuficiente"
  tercile_means: [number, number, number] | null
  points: TrajectoryPoint[]
}

export interface CohortProgression {
  comision_id: string
  n_students: number
  n_students_with_enough_data: number
  mejorando: number
  estable: number
  empeorando: number
  insuficiente: number
  net_progression_ratio: number
  trajectories: StudentTrajectory[]
}

export interface KappaRating {
  episode_id: string
  rater_a: AppropriationLabel
  rater_b: AppropriationLabel
}

export interface KappaResult {
  kappa: number
  n_episodes: number
  observed_agreement: number
  expected_agreement: number
  interpretation: string
  per_class_agreement: Record<string, number>
  confusion_matrix: Record<string, Record<string, number>>
}

export interface ExportJobStatus {
  job_id: string
  status: "pending" | "running" | "succeeded" | "failed"
  comision_id: string
  requested_at: string
  period_days: number
  include_prompts: boolean
  salt_hash: string
  cohort_alias: string
  started_at: string | null
  completed_at: string | null
  error: string | null
}

type TokenGetter = () => Promise<string | null>

async function authHeaders(getToken: TokenGetter): Promise<Record<string, string>> {
  const token = await getToken()
  if (!token) throw new Error("No hay token — requiere autenticación")
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }
}

// ── Progression ───────────────────────────────────────────────────────

export async function getCohortProgression(
  getToken: TokenGetter,
  comisionId: string,
): Promise<CohortProgression> {
  const r = await fetch(
    `/api/v1/analytics/cohort/${comisionId}/progression`,
    { headers: await authHeaders(getToken) },
  )
  if (!r.ok) throw new Error(`progression failed: ${r.status}`)
  return r.json()
}

// ── Kappa ─────────────────────────────────────────────────────────────

export async function computeKappa(
  getToken: TokenGetter,
  ratings: KappaRating[],
): Promise<KappaResult> {
  const r = await fetch("/api/v1/analytics/kappa", {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify({ ratings }),
  })
  if (!r.ok) throw new Error(`kappa failed: ${r.status}`)
  return r.json()
}

// ── Export dataset ────────────────────────────────────────────────────

export async function requestCohortExport(
  getToken: TokenGetter,
  params: {
    comision_id: string
    period_days?: number
    include_prompts?: boolean
    salt: string
    cohort_alias?: string
  },
): Promise<{ job_id: string; status: string }> {
  const r = await fetch("/api/v1/analytics/cohort/export", {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify(params),
  })
  if (!r.ok) throw new Error(`export request failed: ${r.status}`)
  return r.json()
}

export async function getExportStatus(
  getToken: TokenGetter,
  jobId: string,
): Promise<ExportJobStatus> {
  const r = await fetch(
    `/api/v1/analytics/cohort/export/${jobId}/status`,
    { headers: await authHeaders(getToken) },
  )
  if (!r.ok) throw new Error(`status failed: ${r.status}`)
  return r.json()
}

export async function downloadExport(
  getToken: TokenGetter,
  jobId: string,
): Promise<unknown> {
  const r = await fetch(
    `/api/v1/analytics/cohort/export/${jobId}/download`,
    { headers: await authHeaders(getToken) },
  )
  if (r.status === 425) throw new Error("Job aún no terminado")
  if (!r.ok) throw new Error(`download failed: ${r.status}`)
  return r.json()
}
