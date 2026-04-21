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

async function authHeaders(getToken?: TokenGetter): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (getToken) {
    const token = await getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }
  return headers
}

async function throwIfNotOk(r: Response): Promise<void> {
  if (r.ok) return
  const raw = await r.text()
  let detail = raw
  try {
    const body = JSON.parse(raw)
    detail = body.detail ?? body.title ?? raw
  } catch { /* not JSON, use raw text */ }
  throw new Error(`${r.status}: ${detail}`)
}

// ── Progression ───────────────────────────────────────────────────────

export async function getCohortProgression(
  comisionId: string,
  getToken?: TokenGetter,
): Promise<CohortProgression> {
  const r = await fetch(
    `/api/v1/analytics/cohort/${comisionId}/progression`,
    { headers: await authHeaders(getToken) },
  )
  await throwIfNotOk(r)
  return r.json()
}

// ── Kappa ─────────────────────────────────────────────────────────────

export async function computeKappa(
  ratings: KappaRating[],
  getToken?: TokenGetter,
): Promise<KappaResult> {
  const r = await fetch("/api/v1/analytics/kappa", {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify({ ratings }),
  })
  await throwIfNotOk(r)
  return r.json()
}

// ── Export dataset ────────────────────────────────────────────────────

export async function requestCohortExport(
  params: {
    comision_id: string
    period_days?: number
    include_prompts?: boolean
    salt: string
    cohort_alias?: string
  },
  getToken?: TokenGetter,
): Promise<{ job_id: string; status: string }> {
  const r = await fetch("/api/v1/analytics/cohort/export", {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify(params),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function getExportStatus(
  jobId: string,
  getToken?: TokenGetter,
): Promise<ExportJobStatus> {
  const r = await fetch(
    `/api/v1/analytics/cohort/export/${jobId}/status`,
    { headers: await authHeaders(getToken) },
  )
  await throwIfNotOk(r)
  return r.json()
}

export async function downloadExport(
  jobId: string,
  getToken?: TokenGetter,
): Promise<unknown> {
  const r = await fetch(
    `/api/v1/analytics/cohort/export/${jobId}/download`,
    { headers: await authHeaders(getToken) },
  )
  if (r.status === 425) throw new Error("Job aún no terminado")
  await throwIfNotOk(r)
  return r.json()
}
