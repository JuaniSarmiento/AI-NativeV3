/**
 * Vista de drill-down N1-N4 por episodio (ADR-020, RN-130).
 *
 * Cumple componente C3.2 de la tesis (Sección 6.4) + Sección 15.2
 * (proporción de tiempo por nivel). Permite al docente explorar cómo
 * un estudiante distribuyó su tiempo entre los 4 niveles analíticos.
 *
 * Visualización con SVG inline (no chart libs — patrón del repo,
 * coherente con ProgressionView).
 */
import { Button, Input, Label, PageContainer } from "@platform/ui"
import { useEffect, useState } from "react"
import { type NLevel, type NLevelDistribution, getEpisodeNLevelDistribution } from "../lib/api"
import { helpContent } from "../utils/helpContent"

interface Props {
  getToken: () => Promise<string | null>
  /** Si se pasa, se carga automáticamente al montar la vista (drill-down). */
  initialEpisodeId?: string
}

const LEVEL_COLORS: Record<NLevel, string> = {
  N1: "#22c55e", // green-500 — comprensión/planificación
  N2: "#3b82f6", // blue-500 — elaboración estratégica
  N3: "#eab308", // yellow-500 — validación
  N4: "#f97316", // orange-500 — interacción IA
  meta: "#94a3b8", // slate-400 — apertura/cierre
}

const LEVEL_LABELS: Record<NLevel, string> = {
  N1: "N1 - Comprensión/planificación",
  N2: "N2 - Elaboración estratégica",
  N3: "N3 - Validación",
  N4: "N4 - Interacción con IA",
  meta: "meta - Apertura/cierre",
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${m}m ${rest.toFixed(0)}s`
}

function StackedBar({ data }: { data: NLevelDistribution }) {
  const total = Object.values(data.distribution_seconds).reduce((a, b) => a + b, 0)
  const levels: NLevel[] = ["N1", "N2", "N3", "N4", "meta"]

  if (total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
        Sin datos de duración. El episodio aún no tiene eventos persistidos o el modo dev del
        analytics-service no tiene CTR configurado.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex h-12 w-full overflow-hidden rounded-lg border border-slate-200 shadow-sm">
        {levels.map((lvl) => {
          const secs = data.distribution_seconds[lvl] ?? 0
          const ratio = total > 0 ? secs / total : 0
          if (ratio === 0) return null
          return (
            <div
              key={lvl}
              className="flex items-center justify-center text-xs font-medium text-white"
              style={{
                width: `${ratio * 100}%`,
                backgroundColor: LEVEL_COLORS[lvl],
              }}
              title={`${LEVEL_LABELS[lvl]} - ${formatSeconds(secs)} (${(ratio * 100).toFixed(1)}%)`}
            >
              {ratio > 0.08 ? `${(ratio * 100).toFixed(0)}%` : ""}
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
        {levels.map((lvl) => {
          const secs = data.distribution_seconds[lvl] ?? 0
          const count = data.total_events_per_level[lvl] ?? 0
          const ratio = data.distribution_ratio[lvl] ?? 0
          return (
            <div
              key={lvl}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
            >
              <div
                className="h-4 w-4 rounded shrink-0"
                style={{ backgroundColor: LEVEL_COLORS[lvl] }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900 truncate">
                  {LEVEL_LABELS[lvl]}
                </div>
                <div className="text-xs text-slate-500">
                  {formatSeconds(secs)} · {(ratio * 100).toFixed(1)}% · {count} ev.
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function EpisodeNLevelView({ getToken, initialEpisodeId }: Props) {
  const [episodeIdInput, setEpisodeIdInput] = useState(initialEpisodeId ?? "")
  const [data, setData] = useState<NLevelDistribution | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSearch = () => {
    if (!episodeIdInput.trim()) return
    setLoading(true)
    setError(null)
    setData(null)
    getEpisodeNLevelDistribution(episodeIdInput.trim(), getToken)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }

  // Drill-down navegacional (ADR-022): si la URL trae ?episodeId=X, autocargar.
  useEffect(() => {
    if (!initialEpisodeId) return
    setEpisodeIdInput(initialEpisodeId)
    setLoading(true)
    setError(null)
    setData(null)
    getEpisodeNLevelDistribution(initialEpisodeId, getToken)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [initialEpisodeId, getToken])

  return (
    <PageContainer
      title="Distribución N1-N4 por episodio"
      description="Drill-down del tiempo invertido por el estudiante en cada nivel analítico de un episodio (componente C3.2 de la tesis, ADR-020)"
      helpContent={helpContent.episodeNLevel}
    >
      <div className="space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <Label htmlFor="episode-id-input">UUID del episodio</Label>
          <div className="mt-2 flex gap-2">
            <Input
              id="episode-id-input"
              value={episodeIdInput}
              onChange={(e) => setEpisodeIdInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
              placeholder="ej. 12345678-1234-1234-1234-123456789012"
              className="flex-1 font-mono text-sm"
            />
            <Button onClick={handleSearch} disabled={loading || !episodeIdInput.trim()}>
              {loading ? "Cargando..." : "Analizar"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            El UUID se obtiene de la vista Progresión (lista de episodios por estudiante) o del CTR.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="font-medium">Error consultando el episodio</div>
            <div className="mt-1 font-mono text-xs">{error}</div>
          </div>
        )}

        {data && (
          <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-500">Episodio</div>
                <div className="font-mono text-sm text-slate-900 break-all">{data.episode_id}</div>
              </div>
              <div className="text-right text-xs text-slate-500 shrink-0">
                <div>labeler v{data.labeler_version}</div>
                <div>
                  {Object.values(data.total_events_per_level).reduce((a, b) => a + b, 0)} eventos
                  totales
                </div>
              </div>
            </div>
            <StackedBar data={data} />
          </div>
        )}
      </div>
    </PageContainer>
  )
}
