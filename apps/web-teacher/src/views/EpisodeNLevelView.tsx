/**
 * Vista de drill-down N1-N4 por episodio (ADR-020, RN-130).
 *
 * Cumple componente C3.2 de la tesis (Seccion 6.4) + Seccion 15.2
 * (proporcion de tiempo por nivel). Permite al docente explorar como un
 * estudiante distribuyo su tiempo entre los 4 niveles analiticos.
 *
 * Visualizacion con SVG inline (no chart libs, patron del repo).
 *
 * Tokens: LEVEL_COLORS deriva de var(--color-level-n1..n4 + meta) del theme
 * compartido (packages/ui/src/tokens/theme.css). Los SVG necesitan un string
 * concreto, asi que resolvemos via getComputedStyle al mount.
 *
 * Drill-down: shape docente especifica que el episodeId entra por search
 * param (initialEpisodeId). El form input se preserva al fondo para casos
 * de auditoria donde el docente pega un UUID a mano (use-case secundario).
 */
import { Button, Input, Label, PageContainer } from "@platform/ui"
import { Link } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { type NLevel, type NLevelDistribution, getEpisodeNLevelDistribution } from "../lib/api"
import { helpContent } from "../utils/helpContent"

interface Props {
  getToken: () => Promise<string | null>
  /** Si se pasa, se carga automaticamente al montar (drill-down). */
  initialEpisodeId?: string
}

const LEVEL_LABELS: Record<NLevel, string> = {
  N1: "N1 - Comprensión/planificación",
  N2: "N2 - Elaboración estratégica",
  N3: "N3 - Validación",
  N4: "N4 - Interacción con IA",
  meta: "meta - Apertura/cierre",
}

const LEVEL_TOKEN_VAR: Record<NLevel, string> = {
  N1: "--color-level-n1",
  N2: "--color-level-n2",
  N3: "--color-level-n3",
  N4: "--color-level-n4",
  meta: "--color-level-meta",
}

/**
 * Resuelve los 5 colores de nivel desde los tokens compartidos. Cae a
 * defaults hex slate cuando getComputedStyle no puede resolver (jsdom).
 */
function resolveLevelColors(): Record<NLevel, string> {
  const fallback: Record<NLevel, string> = {
    N1: "#22c55e",
    N2: "#3b82f6",
    N3: "#eab308",
    N4: "#f97316",
    meta: "#94a3b8",
  }
  if (typeof window === "undefined") return fallback
  const root = window.getComputedStyle(document.documentElement)
  const out: Partial<Record<NLevel, string>> = {}
  ;(Object.keys(LEVEL_TOKEN_VAR) as NLevel[]).forEach((lvl) => {
    const raw = root.getPropertyValue(LEVEL_TOKEN_VAR[lvl]).trim()
    if (raw) {
      // CSS var ya viene con `oklch(...)` o equivalente. CSS la consume directo.
      out[lvl] = raw.startsWith("oklch") || raw.startsWith("#") ? raw : `var(${LEVEL_TOKEN_VAR[lvl]})`
    } else {
      out[lvl] = fallback[lvl]
    }
  })
  return out as Record<NLevel, string>
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${m}m ${rest.toFixed(0)}s`
}

function StackedBar({
  data,
  colors,
}: { data: NLevelDistribution; colors: Record<NLevel, string> }) {
  const total = Object.values(data.distribution_seconds).reduce((a, b) => a + b, 0)
  const levels: NLevel[] = ["N1", "N2", "N3", "N4", "meta"]

  if (total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
        Sin datos de duracion. El episodio aun no tiene eventos persistidos o el modo dev del
        analytics-service no tiene CTR configurado.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div
        className="flex h-12 w-full overflow-hidden rounded-lg border border-slate-200 shadow-sm"
        aria-label="Distribucion de tiempo por nivel N1-N4"
      >
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
                backgroundColor: colors[lvl],
              }}
              title={`${LEVEL_LABELS[lvl]} - ${formatSeconds(secs)} (${(ratio * 100).toFixed(1)}%)`}
            >
              {ratio > 0.08 ? `${(ratio * 100).toFixed(0)}%` : ""}
            </div>
          )
        })}
      </div>

      {/* Labels DEBAJO de la barra (mejora WCAG: el texto siempre es legible
          con suficiente contraste, el dot color carga la asociacion N4). */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {levels.map((lvl) => {
          const ratio = data.distribution_ratio[lvl] ?? 0
          if (ratio === 0) return null
          return (
            <span key={lvl} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: colors[lvl] }}
              />
              <span className="font-mono">{lvl}</span>
              <span>{(ratio * 100).toFixed(0)}%</span>
            </span>
          )
        })}
      </div>

      {/* Detalle por nivel: lista densa, un nivel por linea (no 5-card grid).
          Resuelve F5 del brief shape. */}
      <ul className="border-t border-slate-100 pt-3 space-y-2 text-sm">
        {levels.map((lvl) => {
          const secs = data.distribution_seconds[lvl] ?? 0
          const count = data.total_events_per_level[lvl] ?? 0
          const ratio = data.distribution_ratio[lvl] ?? 0
          return (
            <li key={lvl} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: colors[lvl] }}
              />
              <span className="font-medium text-slate-900 min-w-[200px]">
                {LEVEL_LABELS[lvl]}
              </span>
              <span className="text-slate-600 font-mono text-xs">
                {formatSeconds(secs)}
                <span className="text-slate-400 mx-1.5">·</span>
                {(ratio * 100).toFixed(1)}%
                <span className="text-slate-400 mx-1.5">·</span>
                {count} ev.
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function EpisodeNLevelView({ getToken, initialEpisodeId }: Props) {
  const [episodeIdInput, setEpisodeIdInput] = useState(initialEpisodeId ?? "")
  const [data, setData] = useState<NLevelDistribution | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const colors = useMemo(resolveLevelColors, [])

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
        {/* Estado vacio honesto cuando se llega sin episodeId. */}
        {!initialEpisodeId && !data && !loading && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600 space-y-2">
            <p className="font-medium text-slate-700">Llegaste aca sin episodio seleccionado.</p>
            <p>
              Volve a la lista del estudiante (
              <Link to="/student-longitudinal" className="text-[var(--color-accent-brand)] underline">
                evolucion del estudiante
              </Link>
              ) y eligi un episodio para ver su distribucion N1-N4.
            </p>
            <p className="text-xs text-slate-500 pt-2 border-t border-slate-100 mt-3">
              Tambien podes pegar un UUID a mano (auditoria) en el formulario de abajo.
            </p>
          </div>
        )}

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
            <StackedBar data={data} colors={colors} />
          </div>
        )}

        {/* Audit fallback: pegar UUID a mano. Colapsado si ya hay data, abierto
            si no llegamos por drill-down. */}
        <details className="rounded-lg border border-slate-200 bg-white" open={!initialEpisodeId && !data}>
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Buscar otro episodio por UUID
          </summary>
          <div className="px-4 pb-4">
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
              El UUID se obtiene desde la lista de episodios del estudiante o del CTR.
            </p>
          </div>
        </details>
      </div>
    </PageContainer>
  )
}
