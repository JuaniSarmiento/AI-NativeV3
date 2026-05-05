/**
 * Cliente de API del web-student.
 *
 * F6: reemplazado headers X-* dev por flow OIDC real. El token viene
 * del AuthContext (keycloak-js) y se agrega como Authorization: Bearer.
 *
 * El proxy de Vite (vite.config.ts) redirige /api/* al api-gateway.
 */

export interface OpenEpisodeRequest {
  comision_id: string
  problema_id: string
  curso_config_hash: string
  classifier_config_hash: string
}

export interface OpenEpisodeResponse {
  episode_id: string
}

export interface Classification {
  episode_id: string
  comision_id: string
  classifier_config_hash: string
  appropriation: "delegacion_pasiva" | "apropiacion_superficial" | "apropiacion_reflexiva"
  appropriation_reason: string
  ct_summary: number | null
  ccd_mean: number | null
  ccd_orphan_ratio: number | null
  cii_stability: number | null
  cii_evolution: number | null
  is_current: boolean
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

export async function openEpisode(
  req: OpenEpisodeRequest,
  getToken?: TokenGetter,
): Promise<OpenEpisodeResponse> {
  const r = await fetch("/api/v1/episodes", {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify(req),
  })
  if (!r.ok) throw new Error(`open episode failed: ${r.status}`)
  return r.json()
}

export async function closeEpisode(
  episodeId: string,
  reason = "student_closed",
  getToken?: TokenGetter,
): Promise<void> {
  const r = await fetch(`/api/v1/episodes/${episodeId}/close`, {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify({ reason }),
  })
  if (!r.ok) throw new Error(`close episode failed: ${r.status}`)
}

/**
 * Emite EpisodioAbandonado al CTR (ADR-025, G10-A).
 *
 * Idempotente: si el episodio ya fue cerrado/abandonado/expirado en el
 * backend, devuelve 204 sin emitir. Diseñada para ejecutarse en
 * `beforeunload` (cierre de pestaña / navegación), donde el browser
 * puede matar el fetch a mitad de camino.
 *
 * `navigator.sendBeacon` es preferible en `beforeunload`: es el unico
 * mecanismo garantizado para enviar un POST que sobrevive el unload.
 * Caveat: NO permite headers personalizados (Authorization). En dev
 * mode el proxy de Vite inyecta `X-User-Id` automáticamente, así que
 * funciona; en prod con OIDC real va a haber que firmar la URL u otra
 * estrategia (cookie con el JWT). Por ahora caemos a `fetch` con
 * `keepalive: true` cuando hay token, y a `sendBeacon` cuando no.
 */
export async function emitEpisodioAbandonado(
  episodeId: string,
  payload: { reason: "beforeunload" | "explicit"; last_activity_seconds_ago: number },
  getToken?: TokenGetter,
): Promise<void> {
  const url = `/api/v1/episodes/${episodeId}/abandoned`
  const body = JSON.stringify(payload)

  // Si tenemos getToken, usamos fetch con keepalive (mantiene la request
  // vivat después del unload hasta cierto budget). En navegadores que no
  // soportan keepalive cae al sendBeacon abajo.
  if (getToken) {
    try {
      const headers = await authHeaders(getToken)
      // keepalive es necesario para que la request sobreviva al unload.
      const r = await fetch(url, { method: "POST", headers, body, keepalive: true })
      if (r.ok || r.status === 204) return
      // Si el server rechaza por auth/payload, NO reintentar sendBeacon —
      // el usuario ya se está yendo y no podemos resolverlo.
      return
    } catch {
      // Fall through al sendBeacon.
    }
  }

  // Fallback: sendBeacon (sin Authorization header). En dev mode el proxy
  // de Vite inyecta los X-* headers, así que funciona. En prod sin token
  // el backend rechazaría con 401 (esperado).
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" })
    navigator.sendBeacon(url, blob)
  }
}

/**
 * Estado serializable de un episodio para recuperación post-refresh.
 * Backend: GET /api/v1/episodes/{episode_id}.
 *
 * 404 = episodio inexistente, 403 = cross-tenant. El caller distingue ambos
 * por `EpisodeStateError.status` para decidir si limpia sessionStorage o
 * sólo notifica al usuario.
 */
export interface EpisodeStateResponse {
  episode_id: string
  tarea_practica_id: string
  comision_id: string
  estado: "open" | "closed"
  opened_at: string
  closed_at: string | null
  last_code_snapshot: string | null
  messages: Array<{ role: "user" | "assistant"; content: string; ts: string }>
  notes: Array<{ contenido: string; ts: string }>
}

export class EpisodeStateError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "EpisodeStateError"
  }
}

export async function getEpisodeState(
  episodeId: string,
  getToken?: TokenGetter,
): Promise<EpisodeStateResponse> {
  const r = await fetch(`/api/v1/episodes/${episodeId}`, {
    headers: await authHeaders(getToken),
  })
  if (!r.ok) {
    throw new EpisodeStateError(r.status, `get episode state failed: ${r.status}`)
  }
  return (await r.json()) as EpisodeStateResponse
}

export async function* sendMessage(
  episodeId: string,
  content: string,
  getToken?: TokenGetter,
): AsyncGenerator<
  | { type: "chunk"; content: string }
  | { type: "done"; chunks_used_hash: string; seqs: Record<string, number> }
  | { type: "error"; message: string },
  void,
  unknown
> {
  const headers = await authHeaders(getToken)
  const response = await fetch(`/api/v1/episodes/${episodeId}/message`, {
    method: "POST",
    headers: { ...headers, Accept: "text/event-stream" },
    body: JSON.stringify({ content }),
  })
  if (!response.ok || !response.body) throw new Error(`message failed: ${response.status}`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      try {
        yield JSON.parse(line.slice(6))
      } catch {
        /* ignore */
      }
    }
  }
}

export async function classifyEpisode(
  episodeId: string,
  getToken?: TokenGetter,
): Promise<Classification> {
  const r = await fetch(`/api/v1/classify_episode/${episodeId}`, {
    method: "POST",
    headers: await authHeaders(getToken),
  })
  if (!r.ok) throw new Error(`classify failed: ${r.status}`)
  return r.json()
}

export async function getClassification(
  episodeId: string,
  getToken?: TokenGetter,
): Promise<Classification> {
  const r = await fetch(`/api/v1/classifications/${episodeId}`, {
    headers: await authHeaders(getToken),
  })
  if (!r.ok) throw new Error(`get classification failed: ${r.status}`)
  return r.json()
}

/** Respuesta común de los endpoints de emisión de eventos CTR.
 * El tutor-service agrega seq + chain_hash y persiste el evento; el cliente
 * recibe únicamente el seq asignado para correlación si lo necesitase.
 */
export interface EventEmitResponse {
  seq: number
}

/** Emite un evento codigo_ejecutado al CTR via tutor-service.
 * El tutor-service agrega seq + chain_hash + persiste el evento.
 */
export async function emitCodigoEjecutado(
  episodeId: string,
  payload: { code: string; stdout: string; stderr: string; duration_ms: number },
  getToken?: TokenGetter,
): Promise<EventEmitResponse> {
  const r = await fetch(`/api/v1/episodes/${episodeId}/events/codigo_ejecutado`, {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify(payload),
  })
  if (!r.ok) throw new Error(`emit codigo_ejecutado failed: ${r.status}`)
  return (await r.json()) as EventEmitResponse
}

export type EdicionCodigoOrigin = "student_typed" | "copied_from_tutor" | "pasted_external"

/** Emite un evento edicion_codigo al CTR. Disparado por el editor con
 * debouncing (1s) — el snapshot es el estado actual del buffer y diff_chars
 * el delta de caracteres respecto a la última emisión.
 *
 * F6: `origin` opcional indica de dónde vino el cambio (tipeo / copia /
 * paste). Lo usa el clasificador para distinguir delegación pasiva de
 * apropiación reflexiva sin depender solo de inferencia temporal.
 */
export async function emitEdicionCodigo(
  episodeId: string,
  payload: {
    snapshot: string
    diff_chars: number
    language: string
    origin?: EdicionCodigoOrigin | null
  },
  getToken?: TokenGetter,
): Promise<EventEmitResponse> {
  const r = await fetch(`/api/v1/episodes/${episodeId}/events/edicion_codigo`, {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify(payload),
  })
  if (!r.ok) throw new Error(`emit edicion_codigo failed: ${r.status}`)
  return (await r.json()) as EventEmitResponse
}

/** Emite un evento lectura_enunciado al CTR (F5).
 *
 * `duration_seconds` es el delta acumulado desde la última emisión
 * (no el total del episodio). El frontend lo mide con IntersectionObserver
 * + visibilitychange en el panel del enunciado y flushea cada ~30s o
 * al cerrar el episodio.
 */
export async function emitLecturaEnunciado(
  episodeId: string,
  payload: { duration_seconds: number },
  getToken?: TokenGetter,
): Promise<EventEmitResponse> {
  const r = await fetch(`/api/v1/episodes/${episodeId}/events/lectura_enunciado`, {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify(payload),
  })
  if (!r.ok) throw new Error(`emit lectura_enunciado failed: ${r.status}`)
  return (await r.json()) as EventEmitResponse
}

/** Emite un evento anotacion_creada al CTR. El backend valida que
 * `contenido` tenga entre 1 y 5000 chars (responde 422 si no).
 */
export async function emitAnotacionCreada(
  episodeId: string,
  payload: { contenido: string },
  getToken?: TokenGetter,
): Promise<EventEmitResponse> {
  const r = await fetch(`/api/v1/episodes/${episodeId}/events/anotacion_creada`, {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    // Propagamos el status para que el caller pueda distinguir 422 (validación).
    const err = new Error(`emit anotacion_creada failed: ${r.status}`)
    ;(err as Error & { status?: number }).status = r.status
    throw err
  }
  return (await r.json()) as EventEmitResponse
}

/**
 * Envia la reflexion metacognitiva post-cierre del episodio (ADR-035).
 *
 * Es OPCIONAL y NO BLOQUEANTE — el cierre del episodio ya fue appendeado
 * al CTR antes de que se llame esta funcion. El backend valida que el
 * episodio este en estado=closed (responde 409 si no) y que cada campo
 * sea <=500 chars (responde 422 si no).
 *
 * Cada campo puede ir vacio (el alumno puede dejar uno o varios en blanco).
 */
export async function submitReflection(
  episodeId: string,
  payload: {
    que_aprendiste: string
    dificultad_encontrada: string
    que_haria_distinto: string
    prompt_version: string
    tiempo_completado_ms: number
  },
  getToken?: TokenGetter,
): Promise<EventEmitResponse> {
  const r = await fetch(`/api/v1/episodes/${episodeId}/reflection`, {
    method: "POST",
    headers: await authHeaders(getToken),
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const err = new Error(`submit reflection failed: ${r.status}`)
    ;(err as Error & { status?: number }).status = r.status
    throw err
  }
  return (await r.json()) as EventEmitResponse
}

// ── Tareas Prácticas (TPs) disponibles para el estudiante ─────────────

/**
 * Vista read-only de una TP publicada.
 *
 * El estudiante sólo ve TPs en estado=published dentro de la ventana
 * fecha_inicio..fecha_fin (el backend valida la ventana al abrir episodio).
 */
export interface AvailableTarea {
  id: string
  codigo: string
  titulo: string
  enunciado: string // markdown
  fecha_inicio: string | null // ISO 8601
  fecha_fin: string | null
  peso: string // decimal serializado como string
  estado: "published"
  version: number
  /** Plantilla de código inicial opcional (ej. firma de funciones, scaffold).
   * Si el docente no la define, viene null y el editor cae a su default.
   */
  inicial_codigo: string | null
}

/**
 * Página de TPs disponibles devuelta por el backend.
 *
 * `next_cursor` es el id (uuid) desde el cual continuar; null cuando no
 * hay más páginas.
 */
export interface AvailableTareasPage {
  data: AvailableTarea[]
  meta: { cursor_next: string | null }
}

/**
 * Lista una página de TPs publicadas para una comisión.
 *
 * Usa el endpoint compartido GET /api/v1/tareas-practicas filtrado por
 * estado=published. Soporta paginación cursor-based: pasá el `cursor`
 * recibido en la página anterior para traer la siguiente. Cuando
 * `next_cursor` viene null, no hay más páginas.
 */
export async function listAvailableTareas(
  comisionId: string,
  cursor?: string,
  getToken?: TokenGetter,
): Promise<AvailableTareasPage> {
  const qs = new URLSearchParams({
    comision_id: comisionId,
    estado: "published",
  })
  if (cursor) qs.set("cursor", cursor)
  const r = await fetch(`/api/v1/tareas-practicas?${qs.toString()}`, {
    headers: await authHeaders(getToken),
  })
  if (!r.ok) throw new Error(`list tareas failed: ${r.status}`)
  return (await r.json()) as AvailableTareasPage
}

/**
 * Trae una TP por id. Usado por el flujo de recuperación post-refresh
 * para rehidratar `selectedTarea` a partir del `tarea_practica_id` que
 * vuelve en `EpisodeStateResponse`.
 *
 * Devuelve null si la TP fue despublicada/borrada (404), para que el
 * caller pueda limpiar sessionStorage y volver al selector.
 */
export async function getTareaById(
  tareaId: string,
  getToken?: TokenGetter,
): Promise<AvailableTarea | null> {
  const r = await fetch(`/api/v1/tareas-practicas/${tareaId}`, {
    headers: await authHeaders(getToken),
  })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`get tarea failed: ${r.status}`)
  return (await r.json()) as AvailableTarea
}

export const tareasPracticasApi = {
  listAvailable: listAvailableTareas,
  getById: getTareaById,
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
 * Devuelve las comisiones donde el estudiante tiene asignación activa.
 * Backend: `GET /api/v1/comisiones/mis`. Normalizamos `{data, meta}` →
 * `{items, next_cursor}` para alinearlo con el resto de los listados.
 */
export async function listMyComisiones(
  getToken?: TokenGetter,
): Promise<{ items: Comision[]; next_cursor: string | null }> {
  const r = await fetch("/api/v1/comisiones/mis", {
    headers: await authHeaders(getToken),
  })
  if (!r.ok) throw new Error(`list mis comisiones failed: ${r.status}`)
  const body = (await r.json()) as {
    data: Comision[]
    meta: { cursor_next: string | null }
  }
  if (body.data.length > 0) {
    return { items: body.data, next_cursor: body.meta.cursor_next }
  }
  const fallback = await fetch("/api/v1/comisiones", {
    headers: await authHeaders(getToken),
  })
  if (!fallback.ok) return { items: [], next_cursor: null }
  const fb = (await fallback.json()) as {
    data: Comision[]
    meta: { cursor_next: string | null }
  }
  return { items: fb.data, next_cursor: fb.meta.cursor_next }
}

export const comisionesApi = {
  listMine: listMyComisiones,
}
