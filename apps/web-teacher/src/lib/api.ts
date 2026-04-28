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
  student_pseudonym: string
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
  } catch {
    /* not JSON, use raw text */
  }
  throw new Error(`${r.status}: ${detail}`)
}

// ── Progression ───────────────────────────────────────────────────────

export async function getCohortProgression(
  comisionId: string,
  getToken?: TokenGetter,
): Promise<CohortProgression> {
  const r = await fetch(`/api/v1/analytics/cohort/${comisionId}/progression`, {
    headers: await authHeaders(getToken),
  })
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
  const r = await fetch(`/api/v1/analytics/cohort/export/${jobId}/status`, {
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function downloadExport(jobId: string, getToken?: TokenGetter): Promise<unknown> {
  const r = await fetch(`/api/v1/analytics/cohort/export/${jobId}/download`, {
    headers: await authHeaders(getToken),
  })
  if (r.status === 425) throw new Error("Job aún no terminado")
  await throwIfNotOk(r)
  return r.json()
}

// ── Materiales (RAG) ──────────────────────────────────────────────────

export type MaterialTipo = "pdf" | "markdown" | "code_archive" | "video" | "text"
export type MaterialEstado =
  | "uploaded"
  | "extracting"
  | "chunking"
  | "embedding"
  | "indexed"
  | "failed"

export interface Material {
  id: string
  tenant_id: string
  comision_id: string
  tipo: MaterialTipo
  nombre: string
  tamano_bytes: number
  storage_path: string
  estado: MaterialEstado
  chunks_count: number | null
  error_message: string | null
  indexed_at: string | null
  uploaded_by: string
  created_at: string
  meta?: Record<string, unknown>
}

export interface MaterialListResponse {
  data: Material[]
  meta: { cursor_next: string | null }
}

/**
 * Subida multipart al api-gateway. No usa el flujo de `authHeaders()` con
 * Content-Type JSON — para multipart hay que dejar que el browser arme el
 * boundary solo. El proxy de Vite sigue inyectando los X-* en dev.
 */
async function multipartUpload<T>(
  path: string,
  fields: Record<string, string | Blob>,
  getToken?: TokenGetter,
): Promise<T> {
  const headers = new Headers()
  if (getToken) {
    const token = await getToken()
    if (token) headers.set("Authorization", `Bearer ${token}`)
  }

  const body = new FormData()
  for (const [key, val] of Object.entries(fields)) {
    body.append(key, val)
  }

  const r = await fetch(path, { method: "POST", headers, body })
  await throwIfNotOk(r)
  if (r.status === 204) return undefined as T
  return r.json()
}

export async function listMateriales(
  params: { comision_id: string; cursor?: string; limit?: number },
  getToken?: TokenGetter,
): Promise<MaterialListResponse> {
  const qs = new URLSearchParams({ comision_id: params.comision_id })
  if (params.cursor) qs.set("cursor", params.cursor)
  if (params.limit) qs.set("limit", String(params.limit))
  const r = await fetch(`/api/v1/materiales?${qs.toString()}`, {
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function getMaterial(id: string, getToken?: TokenGetter): Promise<Material> {
  const r = await fetch(`/api/v1/materiales/${id}`, {
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function uploadMaterial(
  comisionId: string,
  file: File,
  getToken?: TokenGetter,
): Promise<Material> {
  return multipartUpload<Material>(
    "/api/v1/materiales",
    { comision_id: comisionId, file },
    getToken,
  )
}

export async function deleteMaterial(id: string, getToken?: TokenGetter): Promise<void> {
  const r = await fetch(`/api/v1/materiales/${id}`, {
    method: "DELETE",
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
}

export const materialesApi = {
  list: listMateriales,
  get: getMaterial,
  upload: uploadMaterial,
  delete: deleteMaterial,
}

// ── Tareas Prácticas (TPs) ────────────────────────────────────────────

export type TareaEstado = "draft" | "published" | "archived"

export interface TareaPractica {
  id: string
  tenant_id: string
  comision_id: string
  codigo: string
  titulo: string
  enunciado: string // markdown
  fecha_inicio: string | null // ISO 8601
  fecha_fin: string | null
  peso: string // decimal serializado como string
  rubrica: Record<string, unknown> | null
  estado: TareaEstado
  version: number
  parent_tarea_id: string | null
  // ADR-016 — FK nullable al template canonico de la catedra. NULL = TP
  // huerfana (creada directo en la comision, sin plantilla).
  template_id: string | null
  // ADR-016 — true cuando el docente edito la instancia despues de que el
  // template la auto-instancio. El link al template se preserva.
  has_drift: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface TareaPracticaCreate {
  comision_id: string
  codigo: string
  titulo: string
  enunciado: string
  fecha_inicio?: string | null
  fecha_fin?: string | null
  peso?: string
  rubrica?: Record<string, unknown> | null
}

export interface TareaPracticaUpdate {
  codigo?: string
  titulo?: string
  enunciado?: string
  fecha_inicio?: string | null
  fecha_fin?: string | null
  peso?: string
  rubrica?: Record<string, unknown> | null
}

export interface TareaPracticaListResponse {
  data: TareaPractica[]
  meta: { cursor_next: string | null }
}

export interface TareaPracticaVersionRef {
  id: string
  version: number
  estado: TareaEstado
  titulo: string
  created_at: string
  is_current: boolean
}

export async function listTareasPracticas(
  params: {
    comision_id: string
    estado?: TareaEstado
    cursor?: string
    limit?: number
  },
  getToken?: TokenGetter,
): Promise<TareaPracticaListResponse> {
  const qs = new URLSearchParams({ comision_id: params.comision_id })
  if (params.estado) qs.set("estado", params.estado)
  if (params.cursor) qs.set("cursor", params.cursor)
  if (params.limit) qs.set("limit", String(params.limit))
  const r = await fetch(`/api/v1/tareas-practicas?${qs.toString()}`, {
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function getTareaPractica(id: string, getToken?: TokenGetter): Promise<TareaPractica> {
  const r = await fetch(`/api/v1/tareas-practicas/${id}`, {
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function createTareaPractica(
  body: TareaPracticaCreate,
  getToken?: TokenGetter,
): Promise<TareaPractica> {
  const r = await fetch("/api/v1/tareas-practicas", {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify(body),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function updateTareaPractica(
  id: string,
  patch: TareaPracticaUpdate,
  getToken?: TokenGetter,
): Promise<TareaPractica> {
  const r = await fetch(`/api/v1/tareas-practicas/${id}`, {
    method: "PATCH",
    headers: await authHeaders(getToken),
    body: JSON.stringify(patch),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function deleteTareaPractica(id: string, getToken?: TokenGetter): Promise<void> {
  const r = await fetch(`/api/v1/tareas-practicas/${id}`, {
    method: "DELETE",
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
}

export async function publishTareaPractica(
  id: string,
  getToken?: TokenGetter,
): Promise<TareaPractica> {
  const r = await fetch(`/api/v1/tareas-practicas/${id}/publish`, {
    method: "POST",
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function archiveTareaPractica(
  id: string,
  getToken?: TokenGetter,
): Promise<TareaPractica> {
  const r = await fetch(`/api/v1/tareas-practicas/${id}/archive`, {
    method: "POST",
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function newVersionTareaPractica(
  id: string,
  patch: TareaPracticaUpdate,
  getToken?: TokenGetter,
): Promise<TareaPractica> {
  const r = await fetch(`/api/v1/tareas-practicas/${id}/new-version`, {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify(patch),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function listVersionsTareaPractica(
  id: string,
  getToken?: TokenGetter,
): Promise<TareaPracticaVersionRef[]> {
  const r = await fetch(`/api/v1/tareas-practicas/${id}/versions`, {
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export const tareasPracticasApi = {
  list: listTareasPracticas,
  get: getTareaPractica,
  create: createTareaPractica,
  update: updateTareaPractica,
  delete: deleteTareaPractica,
  publish: publishTareaPractica,
  archive: archiveTareaPractica,
  newVersion: newVersionTareaPractica,
  versions: listVersionsTareaPractica,
}

// ── Comisiones ────────────────────────────────────────────────────────

export interface Comision {
  id: string
  tenant_id: string
  materia_id: string
  periodo_id: string
  codigo: string
  cupo_maximo: number
  horario: Record<string, unknown>
  ai_budget_monthly_usd: string
  curso_config_hash: string | null
  created_at: string
  deleted_at: string | null
}

/**
 * Devuelve las comisiones donde el user actual tiene un rol activo
 * (docente, jtp, ayudante…) según `usuarios_comision`. Backend:
 * `GET /api/v1/comisiones/mis`.
 *
 * Respuesta: la API académica usa `{data, meta}`; lo normalizamos al
 * shape `{items, next_cursor}` que ya consumen el resto de los selectors
 * del web-teacher (materiales, TPs).
 */
export async function listMyComisiones(
  getToken?: TokenGetter,
): Promise<{ items: Comision[]; next_cursor: string | null }> {
  const r = await fetch("/api/v1/comisiones/mis", {
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  const body = (await r.json()) as {
    data: Comision[]
    meta: { cursor_next: string | null }
  }
  return { items: body.data, next_cursor: body.meta.cursor_next }
}

export const comisionesApi = {
  listMine: listMyComisiones,
}

// ── Tareas Prácticas Templates (ADR-016) ──────────────────────────────

/**
 * Plantilla canonica de TP a nivel (materia, periodo). La catedra edita
 * aca; el servicio fan-out-ea `TareaPractica` (instancia) en cada comision
 * que comparte (materia, periodo). Cada instancia tiene su `problema_id`
 * estable para la cadena CTR; el template solo provee la fuente de
 * enunciado/rubrica/peso.
 */
export interface TareaPracticaTemplate {
  id: string
  tenant_id: string
  materia_id: string
  periodo_id: string
  codigo: string
  titulo: string
  enunciado: string // markdown
  inicial_codigo: string | null
  rubrica: Record<string, unknown> | null
  peso: string // decimal serializado como string
  fecha_inicio: string | null // ISO 8601
  fecha_fin: string | null
  estado: TareaEstado
  version: number
  parent_template_id: string | null
  created_by: string
  created_at: string
  deleted_at: string | null
}

export interface TareaPracticaTemplateCreate {
  materia_id: string
  periodo_id: string
  codigo: string
  titulo: string
  enunciado: string
  inicial_codigo?: string | null
  rubrica?: Record<string, unknown> | null
  peso?: string
  fecha_inicio?: string | null
  fecha_fin?: string | null
}

/**
 * Update parcial. `materia_id`, `periodo_id`, `codigo` y `version` son
 * inmutables (ADR-016: el template se versiona via new-version, no se
 * re-ancla). `estado` muta solo via publish/archive endpoints dedicados.
 */
export interface TareaPracticaTemplateUpdate {
  titulo?: string
  enunciado?: string
  inicial_codigo?: string | null
  rubrica?: Record<string, unknown> | null
  peso?: string
  fecha_inicio?: string | null
  fecha_fin?: string | null
}

export interface TareaPracticaTemplateVersionRef {
  id: string
  version: number
  estado: TareaEstado
  created_at: string
  is_current: boolean
}

export interface TareaPracticaInstancesResponse {
  template_id: string
  instances: TareaPractica[]
}

export interface TareaPracticaTemplateNewVersionBody {
  patch: TareaPracticaTemplateUpdate
  reinstance_non_drifted: boolean
}

export async function listTareasPracticasTemplates(
  params: {
    materia_id?: string
    periodo_id?: string
    estado?: TareaEstado
  },
  getToken?: TokenGetter,
): Promise<TareaPracticaTemplate[]> {
  const qs = new URLSearchParams()
  if (params.materia_id) qs.set("materia_id", params.materia_id)
  if (params.periodo_id) qs.set("periodo_id", params.periodo_id)
  if (params.estado) qs.set("estado", params.estado)
  const suffix = qs.toString() ? `?${qs.toString()}` : ""
  const r = await fetch(`/api/v1/tareas-practicas-templates${suffix}`, {
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function getTareaPracticaTemplate(
  id: string,
  getToken?: TokenGetter,
): Promise<TareaPracticaTemplate> {
  const r = await fetch(`/api/v1/tareas-practicas-templates/${id}`, {
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function createTareaPracticaTemplate(
  body: TareaPracticaTemplateCreate,
  getToken?: TokenGetter,
): Promise<TareaPracticaTemplate> {
  const r = await fetch("/api/v1/tareas-practicas-templates", {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify(body),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function updateTareaPracticaTemplate(
  id: string,
  patch: TareaPracticaTemplateUpdate,
  getToken?: TokenGetter,
): Promise<TareaPracticaTemplate> {
  const r = await fetch(`/api/v1/tareas-practicas-templates/${id}`, {
    method: "PATCH",
    headers: await authHeaders(getToken),
    body: JSON.stringify(patch),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function deleteTareaPracticaTemplate(
  id: string,
  getToken?: TokenGetter,
): Promise<void> {
  const r = await fetch(`/api/v1/tareas-practicas-templates/${id}`, {
    method: "DELETE",
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
}

export async function publishTareaPracticaTemplate(
  id: string,
  getToken?: TokenGetter,
): Promise<TareaPracticaTemplate> {
  const r = await fetch(`/api/v1/tareas-practicas-templates/${id}/publish`, {
    method: "POST",
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function archiveTareaPracticaTemplate(
  id: string,
  getToken?: TokenGetter,
): Promise<TareaPracticaTemplate> {
  const r = await fetch(`/api/v1/tareas-practicas-templates/${id}/archive`, {
    method: "POST",
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function newVersionTareaPracticaTemplate(
  id: string,
  body: TareaPracticaTemplateNewVersionBody,
  getToken?: TokenGetter,
): Promise<TareaPracticaTemplate> {
  const r = await fetch(`/api/v1/tareas-practicas-templates/${id}/new-version`, {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify(body),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function getTareaPracticaTemplateInstances(
  id: string,
  getToken?: TokenGetter,
): Promise<TareaPracticaInstancesResponse> {
  const r = await fetch(`/api/v1/tareas-practicas-templates/${id}/instances`, {
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export async function listVersionsTareaPracticaTemplate(
  id: string,
  getToken?: TokenGetter,
): Promise<TareaPracticaTemplateVersionRef[]> {
  const r = await fetch(`/api/v1/tareas-practicas-templates/${id}/versions`, {
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export const tareasPracticasTemplatesApi = {
  list: listTareasPracticasTemplates,
  get: getTareaPracticaTemplate,
  create: createTareaPracticaTemplate,
  update: updateTareaPracticaTemplate,
  delete: deleteTareaPracticaTemplate,
  publish: publishTareaPracticaTemplate,
  archive: archiveTareaPracticaTemplate,
  newVersion: newVersionTareaPracticaTemplate,
  instances: getTareaPracticaTemplateInstances,
  versions: listVersionsTareaPracticaTemplate,
}

// ── Catalogo academico (para el selector cascada Univ → ... → Periodo) ─

export interface Universidad {
  id: string
  nombre: string
  codigo: string
  dominio_email: string | null
  keycloak_realm: string
  created_at: string
  deleted_at: string | null
}

export interface Facultad {
  id: string
  tenant_id: string
  universidad_id: string
  nombre: string
  codigo: string
  decano_user_id: string | null
  created_at: string
  deleted_at: string | null
}

export interface Carrera {
  id: string
  tenant_id: string
  universidad_id: string
  facultad_id: string
  nombre: string
  codigo: string
  duracion_semestres: number
  modalidad: "presencial" | "virtual" | "hibrida"
  director_user_id: string | null
  created_at: string
  deleted_at: string | null
}

export interface Plan {
  id: string
  tenant_id: string
  carrera_id: string
  version: string
  año_inicio: number
  ordenanza: string | null
  vigente: boolean
  created_at: string
  deleted_at: string | null
}

export interface Materia {
  id: string
  tenant_id: string
  plan_id: string
  nombre: string
  codigo: string
  horas_totales: number
  cuatrimestre_sugerido: number
  objetivos: string | null
  correlativas_cursar: string[]
  correlativas_rendir: string[]
  created_at: string
  deleted_at: string | null
}

export interface Periodo {
  id: string
  tenant_id: string
  codigo: string
  nombre: string
  fecha_inicio: string
  fecha_fin: string
  estado: "abierto" | "cerrado"
  created_at: string
}

interface ListMetaDto {
  cursor_next: string | null
}
interface ListDto<T> {
  data: T[]
  meta: ListMetaDto
}

async function fetchList<T>(path: string, getToken?: TokenGetter): Promise<T[]> {
  const r = await fetch(path, { headers: await authHeaders(getToken) })
  await throwIfNotOk(r)
  const body = (await r.json()) as ListDto<T>
  return body.data
}

export async function listUniversidades(getToken?: TokenGetter): Promise<Universidad[]> {
  return fetchList<Universidad>("/api/v1/universidades?limit=200", getToken)
}

export async function listFacultades(
  universidadId: string,
  getToken?: TokenGetter,
): Promise<Facultad[]> {
  return fetchList<Facultad>(
    `/api/v1/facultades?universidad_id=${universidadId}&limit=200`,
    getToken,
  )
}

export async function listCarreras(facultadId: string, getToken?: TokenGetter): Promise<Carrera[]> {
  return fetchList<Carrera>(`/api/v1/carreras?facultad_id=${facultadId}&limit=200`, getToken)
}

export async function listPlanes(carreraId: string, getToken?: TokenGetter): Promise<Plan[]> {
  return fetchList<Plan>(`/api/v1/planes?carrera_id=${carreraId}&limit=200`, getToken)
}

export async function listMaterias(planId: string, getToken?: TokenGetter): Promise<Materia[]> {
  return fetchList<Materia>(`/api/v1/materias?plan_id=${planId}&limit=200`, getToken)
}

export async function listPeriodos(getToken?: TokenGetter): Promise<Periodo[]> {
  return fetchList<Periodo>("/api/v1/periodos?limit=200", getToken)
}

export const catalogoApi = {
  universidades: listUniversidades,
  facultades: listFacultades,
  carreras: listCarreras,
  planes: listPlanes,
  materias: listMaterias,
  periodos: listPeriodos,
}

// ── ADR-020: Distribución N1-N4 por episodio ─────────────────────────

export type NLevel = "N1" | "N2" | "N3" | "N4" | "meta"

export interface NLevelDistribution {
  episode_id: string
  labeler_version: string
  distribution_seconds: Record<NLevel, number>
  distribution_ratio: Record<NLevel, number>
  total_events_per_level: Record<NLevel, number>
}

export async function getEpisodeNLevelDistribution(
  episodeId: string,
  getToken?: TokenGetter,
): Promise<NLevelDistribution> {
  const r = await fetch(`/api/v1/analytics/episode/${episodeId}/n-level-distribution`, {
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

// ── ADR-018: CII evolution longitudinal por estudiante ───────────────

export interface CIIEvolutionTemplate {
  template_id: string
  n_episodes: number
  scores_ordinal: number[]
  slope: number | null
  insufficient_data: boolean
}

export interface CIIEvolutionLongitudinal {
  student_pseudonym: string
  comision_id: string
  n_groups_evaluated: number
  n_groups_insufficient: number
  n_episodes_total: number
  evolution_per_template: CIIEvolutionTemplate[]
  mean_slope: number | null
  sufficient_data: boolean
  labeler_version: string
}

export async function getStudentCIIEvolution(
  studentPseudonym: string,
  comisionId: string,
  getToken?: TokenGetter,
): Promise<CIIEvolutionLongitudinal> {
  const r = await fetch(
    `/api/v1/analytics/student/${studentPseudonym}/cii-evolution-longitudinal?comision_id=${comisionId}`,
    { headers: await authHeaders(getToken) },
  )
  await throwIfNotOk(r)
  return r.json()
}

// ── ADR-019: Eventos adversos por cohorte ─────────────────────────────

export interface AdversarialRecentEvent {
  episode_id: string
  student_pseudonym: string
  ts: string
  category: string
  severity: number
  pattern_id: string
  matched_text: string
}

export interface AdversarialTopStudent {
  student_pseudonym: string
  n_events: number
}

export interface CohortAdversarialEvents {
  comision_id: string
  n_events_total: number
  counts_by_category: Record<string, number>
  counts_by_severity: Record<string, number>
  counts_by_student: Record<string, number>
  top_students_by_n_events: AdversarialTopStudent[]
  recent_events: AdversarialRecentEvent[]
}

export async function getCohortAdversarialEvents(
  comisionId: string,
  getToken?: TokenGetter,
): Promise<CohortAdversarialEvents> {
  const r = await fetch(`/api/v1/analytics/cohort/${comisionId}/adversarial-events`, {
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

// ── ADR-022: drill-down navegacional + cuartiles + alertas ────────────

export interface StudentEpisode {
  episode_id: string
  problema_id: string
  tarea_codigo: string | null
  tarea_titulo: string | null
  template_id: string | null
  opened_at: string | null
  closed_at: string | null
  events_count: number
  appropriation: AppropriationLabel | null
  classified_at: string | null
}

export interface StudentEpisodesPayload {
  student_pseudonym: string
  comision_id: string
  n_episodes: number
  episodes: StudentEpisode[]
}

export async function getStudentEpisodes(
  studentPseudonym: string,
  comisionId: string,
  getToken?: TokenGetter,
): Promise<StudentEpisodesPayload> {
  const r = await fetch(
    `/api/v1/analytics/student/${studentPseudonym}/episodes?comision_id=${comisionId}`,
    { headers: await authHeaders(getToken) },
  )
  await throwIfNotOk(r)
  return r.json()
}

export interface CohortCIIQuartiles {
  comision_id: string
  labeler_version: string
  min_students_for_quartiles: number
  n_students_evaluated: number
  insufficient_data: boolean
  q1: number | null
  median: number | null
  q3: number | null
  min: number | null
  max: number | null
  mean: number | null
  stdev: number | null
}

export async function getCohortCIIQuartiles(
  comisionId: string,
  getToken?: TokenGetter,
): Promise<CohortCIIQuartiles> {
  const r = await fetch(`/api/v1/analytics/cohort/${comisionId}/cii-quartiles`, {
    headers: await authHeaders(getToken),
  })
  await throwIfNotOk(r)
  return r.json()
}

export interface StudentAlert {
  code: string
  severity: "low" | "medium" | "high"
  title: string
  detail: string
  threshold_used: string
  z_score: number | null
}

export interface StudentAlertsPayload {
  student_pseudonym: string
  comision_id: string
  labeler_version: string
  student_slope: number | null
  cohort_stats: CohortCIIQuartiles
  quartile: "Q1" | "Q2" | "Q3" | "Q4" | null
  alerts: StudentAlert[]
  n_alerts: number
  highest_severity: "low" | "medium" | "high" | null
}

export async function getStudentAlerts(
  studentPseudonym: string,
  comisionId: string,
  getToken?: TokenGetter,
): Promise<StudentAlertsPayload> {
  const r = await fetch(
    `/api/v1/analytics/student/${studentPseudonym}/alerts?comision_id=${comisionId}`,
    { headers: await authHeaders(getToken) },
  )
  await throwIfNotOk(r)
  return r.json()
}
