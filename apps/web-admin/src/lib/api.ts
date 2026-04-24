/**
 * Cliente HTTP tipado hacia el api-gateway.
 *
 * Usa fetch con el JWT inyectado automáticamente desde auth-client.
 */

export interface ApiError {
  status: number
  title: string
  detail?: string
}

export interface ListMeta {
  cursor_next: string | null
  total: number | null
}

export interface ListResponse<T> {
  data: T[]
  meta: ListMeta
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public title: string,
    public detail?: string,
  ) {
    super(title)
  }
}

const API_BASE = "/api/v1"

async function request<T>(
  path: string,
  init: RequestInit = {},
  getToken?: () => Promise<string | null>,
): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has("Content-Type") && init.method && init.method !== "GET") {
    headers.set("Content-Type", "application/json")
  }

  if (getToken) {
    const token = await getToken()
    if (token) headers.set("Authorization", `Bearer ${token}`)
  } else {
    // Modo dev: inyectar headers X-* del admin de prueba.
    // Deben coincidir con los que inyecta el proxy de Vite (vite.config.ts).
    headers.set("X-User-Id", "33333333-3333-3333-3333-333333333333")
    headers.set("X-Tenant-Id", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    headers.set("X-User-Email", "admin@demo-uni.edu")
    headers.set("X-User-Roles", "docente_admin,superadmin")
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers })

  if (!response.ok) {
    const raw = await response.text()
    let detail = raw
    try {
      const body = JSON.parse(raw)
      detail = body.detail ?? body.title ?? raw
    } catch {
      /* not JSON, use raw text */
    }
    throw new HttpError(response.status, response.statusText, detail)
  }

  if (response.status === 204) return undefined as T

  return response.json()
}

// ── Universidades ────────────────────────────────────────────────────

export interface Universidad {
  id: string
  nombre: string
  codigo: string
  dominio_email: string | null
  keycloak_realm: string
  config: Record<string, unknown>
  created_at: string
}

export interface UniversidadCreate {
  nombre: string
  codigo: string
  dominio_email?: string
  keycloak_realm: string
}

export const universidadesApi = {
  list: (params?: { cursor?: string; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.cursor) qs.set("cursor", params.cursor)
    if (params?.limit) qs.set("limit", String(params.limit))
    const query = qs.toString()
    return request<ListResponse<Universidad>>(`/universidades${query ? `?${query}` : ""}`)
  },
  get: (id: string) => request<Universidad>(`/universidades/${id}`),
  create: (data: UniversidadCreate) =>
    request<Universidad>("/universidades", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<UniversidadCreate>) =>
    request<Universidad>(`/universidades/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/universidades/${id}`, { method: "DELETE" }),
}

// ── Carreras ─────────────────────────────────────────────────────────

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
}

export interface CarreraCreate {
  facultad_id: string
  nombre: string
  codigo: string
  duracion_semestres?: number
  modalidad?: "presencial" | "virtual" | "hibrida"
}

export const carrerasApi = {
  list: (params?: { universidad_id?: string; cursor?: string; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.universidad_id) qs.set("universidad_id", params.universidad_id)
    if (params?.cursor) qs.set("cursor", params.cursor)
    if (params?.limit) qs.set("limit", String(params.limit))
    const query = qs.toString()
    return request<ListResponse<Carrera>>(`/carreras${query ? `?${query}` : ""}`)
  },
  get: (id: string) => request<Carrera>(`/carreras/${id}`),
  create: (data: CarreraCreate) =>
    request<Carrera>("/carreras", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<CarreraCreate>) =>
    request<Carrera>(`/carreras/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/carreras/${id}`, { method: "DELETE" }),
}

// ── Planes de estudio ────────────────────────────────────────────────

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

export interface PlanCreate {
  carrera_id: string
  version: string
  año_inicio: number
  ordenanza?: string
  vigente?: boolean
}

export const planesApi = {
  list: (params?: { carrera_id?: string; cursor?: string; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.carrera_id) qs.set("carrera_id", params.carrera_id)
    if (params?.cursor) qs.set("cursor", params.cursor)
    if (params?.limit) qs.set("limit", String(params.limit))
    const query = qs.toString()
    return request<ListResponse<Plan>>(`/planes${query ? `?${query}` : ""}`)
  },
  get: (id: string) => request<Plan>(`/planes/${id}`),
  create: (data: PlanCreate) =>
    request<Plan>("/planes", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<PlanCreate>) =>
    request<Plan>(`/planes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/planes/${id}`, { method: "DELETE" }),
}

// ── Materias ─────────────────────────────────────────────────────────

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

export interface MateriaCreate {
  plan_id: string
  nombre: string
  codigo: string
  horas_totales?: number
  cuatrimestre_sugerido?: number
  objetivos?: string
  correlativas_cursar?: string[]
  correlativas_rendir?: string[]
}

export const materiasApi = {
  list: (params?: { plan_id?: string; cursor?: string; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.plan_id) qs.set("plan_id", params.plan_id)
    if (params?.cursor) qs.set("cursor", params.cursor)
    if (params?.limit) qs.set("limit", String(params.limit))
    const query = qs.toString()
    return request<ListResponse<Materia>>(`/materias${query ? `?${query}` : ""}`)
  },
  get: (id: string) => request<Materia>(`/materias/${id}`),
  create: (data: MateriaCreate) =>
    request<Materia>("/materias", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<Omit<MateriaCreate, "plan_id">>) =>
    request<Materia>(`/materias/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/materias/${id}`, { method: "DELETE" }),
}

// ── Periodos ─────────────────────────────────────────────────────────

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

export interface PeriodoCreate {
  codigo: string
  nombre: string
  fecha_inicio: string
  fecha_fin: string
  estado?: "abierto" | "cerrado"
}

export interface PeriodoUpdate {
  nombre?: string
  fecha_inicio?: string
  fecha_fin?: string
  estado?: "abierto" | "cerrado"
}

export const periodosApi = {
  list: (params?: { cursor?: string; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.cursor) qs.set("cursor", params.cursor)
    if (params?.limit) qs.set("limit", String(params.limit))
    const query = qs.toString()
    return request<ListResponse<Periodo>>(`/periodos${query ? `?${query}` : ""}`)
  },
  create: (data: PeriodoCreate) =>
    request<Periodo>("/periodos", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: PeriodoUpdate) =>
    request<Periodo>(`/periodos/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/periodos/${id}`, { method: "DELETE" }),
}

// ── Comisiones ───────────────────────────────────────────────────────

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

export interface ComisionCreate {
  materia_id: string
  periodo_id: string
  codigo: string
  cupo_maximo?: number
  horario?: Record<string, unknown>
  ai_budget_monthly_usd?: string | number
}

export interface ComisionUpdate {
  cupo_maximo?: number
  horario?: Record<string, unknown>
  ai_budget_monthly_usd?: string | number
}

export const comisionesApi = {
  list: (params?: {
    materia_id?: string
    periodo_id?: string
    cursor?: string
    limit?: number
  }) => {
    const qs = new URLSearchParams()
    if (params?.materia_id) qs.set("materia_id", params.materia_id)
    if (params?.periodo_id) qs.set("periodo_id", params.periodo_id)
    if (params?.cursor) qs.set("cursor", params.cursor)
    if (params?.limit) qs.set("limit", String(params.limit))
    const query = qs.toString()
    return request<ListResponse<Comision>>(`/comisiones${query ? `?${query}` : ""}`)
  },
  get: (id: string) => request<Comision>(`/comisiones/${id}`),
  create: (data: ComisionCreate) =>
    request<Comision>("/comisiones", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: ComisionUpdate) =>
    request<Comision>(`/comisiones/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/comisiones/${id}`, { method: "DELETE" }),
}

// ── Facultades ───────────────────────────────────────────────────────

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

export interface FacultadCreate {
  universidad_id: string
  nombre: string
  codigo: string
  decano_user_id?: string
}

export interface FacultadUpdate {
  nombre?: string
  decano_user_id?: string
}

export const facultadesApi = {
  list: (params?: {
    universidad_id?: string
    cursor?: string
    limit?: number
  }) => {
    const qs = new URLSearchParams()
    if (params?.universidad_id) qs.set("universidad_id", params.universidad_id)
    if (params?.cursor) qs.set("cursor", params.cursor)
    if (params?.limit) qs.set("limit", String(params.limit))
    const query = qs.toString()
    return request<ListResponse<Facultad>>(`/facultades${query ? `?${query}` : ""}`)
  },
  get: (id: string) => request<Facultad>(`/facultades/${id}`),
  create: (data: FacultadCreate) =>
    request<Facultad>("/facultades", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: FacultadUpdate) =>
    request<Facultad>(`/facultades/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/facultades/${id}`, { method: "DELETE" }),
}

// ── Bulk import (multipart) ──────────────────────────────────────────

export interface BulkImportRowError {
  row_number: number
  column: string | null
  message: string
}

export interface BulkImportReport {
  total_rows: number
  valid_rows: number
  invalid_rows: number
  errors: BulkImportRowError[]
}

export interface BulkImportCommitResult {
  created_count: number
  created_ids: string[]
}

/**
 * Subida multipart al api-gateway. No usa `request()` porque éste setea
 * `Content-Type: application/json` por default — para multipart hay que
 * dejar que el browser arme el boundary solo.
 */
async function multipartUpload<T>(
  path: string,
  file: File,
  getToken?: () => Promise<string | null>,
): Promise<T> {
  const headers = new Headers()

  if (getToken) {
    const token = await getToken()
    if (token) headers.set("Authorization", `Bearer ${token}`)
  } else {
    // Modo dev: idénticos headers X-* que `request()`.
    headers.set("X-User-Id", "33333333-3333-3333-3333-333333333333")
    headers.set("X-Tenant-Id", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    headers.set("X-User-Email", "admin@demo-uni.edu")
    headers.set("X-User-Roles", "docente_admin,superadmin")
  }

  const body = new FormData()
  body.append("file", file)

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body,
  })

  if (!response.ok) {
    const raw = await response.text()
    let detail: unknown = raw
    try {
      const parsed = JSON.parse(raw)
      detail = parsed.detail ?? parsed.title ?? raw
    } catch {
      /* not JSON */
    }
    // 422 con dry-run report estructurado: lo serializamos a string para
    // que HttpError no se pierda la info — la página lo re-parsea.
    const detailStr = typeof detail === "string" ? detail : JSON.stringify(detail)
    throw new HttpError(response.status, response.statusText, detailStr)
  }

  if (response.status === 204) return undefined as T
  return response.json()
}

export const bulkApi = {
  dryRun: (entity: string, file: File) =>
    multipartUpload<BulkImportReport>(`/bulk/${encodeURIComponent(entity)}?dry_run=true`, file),
  commit: (entity: string, file: File) =>
    multipartUpload<BulkImportCommitResult>(
      `/bulk/${encodeURIComponent(entity)}?dry_run=false`,
      file,
    ),
}
