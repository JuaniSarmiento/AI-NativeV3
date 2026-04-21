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
    // Modo dev: inyectar headers X-* del admin de prueba
    headers.set("X-User-Id", "10000000-0000-0000-0000-000000000001")
    headers.set("X-Tenant-Id", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    headers.set("X-User-Email", "admin@demo-uni.edu")
    headers.set("X-User-Roles", "docente_admin")
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers })

  if (!response.ok) {
    let detail = ""
    try {
      const body = await response.json()
      detail = body.detail ?? body.title ?? ""
    } catch {
      detail = await response.text()
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
  list: (cursor?: string) =>
    request<ListResponse<Universidad>>(
      `/universidades${cursor ? `?cursor=${cursor}` : ""}`,
    ),
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
}

// ── Carreras ─────────────────────────────────────────────────────────

export interface Carrera {
  id: string
  tenant_id: string
  universidad_id: string
  facultad_id: string | null
  nombre: string
  codigo: string
  duracion_semestres: number
  modalidad: "presencial" | "virtual" | "hibrida"
  director_user_id: string | null
  created_at: string
}

export interface CarreraCreate {
  universidad_id: string
  facultad_id?: string
  nombre: string
  codigo: string
  duracion_semestres?: number
  modalidad?: "presencial" | "virtual" | "hibrida"
}

export const carrerasApi = {
  list: (params?: { universidad_id?: string; cursor?: string }) => {
    const qs = new URLSearchParams()
    if (params?.universidad_id) qs.set("universidad_id", params.universidad_id)
    if (params?.cursor) qs.set("cursor", params.cursor)
    const query = qs.toString()
    return request<ListResponse<Carrera>>(
      `/carreras${query ? `?${query}` : ""}`,
    )
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
  delete: (id: string) =>
    request<void>(`/carreras/${id}`, { method: "DELETE" }),
}
