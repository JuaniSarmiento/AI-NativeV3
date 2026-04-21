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
  req: OpenEpisodeRequest, getToken?: TokenGetter,
): Promise<OpenEpisodeResponse> {
  const r = await fetch("/api/v1/episodes", {
    method: "POST", headers: await authHeaders(getToken), body: JSON.stringify(req),
  })
  if (!r.ok) throw new Error(`open episode failed: ${r.status}`)
  return r.json()
}


export async function closeEpisode(
  episodeId: string, reason = "student_closed", getToken?: TokenGetter,
): Promise<void> {
  const r = await fetch(`/api/v1/episodes/${episodeId}/close`, {
    method: "POST", headers: await authHeaders(getToken), body: JSON.stringify({ reason }),
  })
  if (!r.ok) throw new Error(`close episode failed: ${r.status}`)
}


export async function* sendMessage(
  episodeId: string, content: string, getToken?: TokenGetter,
): AsyncGenerator<
  | { type: "chunk"; content: string }
  | { type: "done"; chunks_used_hash: string; seqs: Record<string, number> }
  | { type: "error"; message: string },
  void, unknown
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
      try { yield JSON.parse(line.slice(6)) } catch { /* ignore */ }
    }
  }
}


export async function classifyEpisode(
  episodeId: string, getToken?: TokenGetter,
): Promise<Classification> {
  const r = await fetch(`/api/v1/classify_episode/${episodeId}`, {
    method: "POST", headers: await authHeaders(getToken),
  })
  if (!r.ok) throw new Error(`classify failed: ${r.status}`)
  return r.json()
}


export async function getClassification(
  episodeId: string, getToken?: TokenGetter,
): Promise<Classification> {
  const r = await fetch(`/api/v1/classifications/${episodeId}`, {
    headers: await authHeaders(getToken),
  })
  if (!r.ok) throw new Error(`get classification failed: ${r.status}`)
  return r.json()
}


/** Emite un evento codigo_ejecutado al CTR via tutor-service.
 * El tutor-service agrega seq + chain_hash + persiste el evento.
 */
export async function emitCodeExecuted(
  episodeId: string,
  payload: { code: string; stdout: string; stderr: string; duration_ms: number },
  getToken?: TokenGetter,
): Promise<void> {
  const r = await fetch(`/api/v1/episodes/${episodeId}/events/codigo_ejecutado`, {
    method: "POST", headers: await authHeaders(getToken), body: JSON.stringify(payload),
  })
  if (!r.ok) throw new Error(`emit codigo_ejecutado failed: ${r.status}`)
}
