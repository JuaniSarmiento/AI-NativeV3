/**
 * Vista de evolucion longitudinal CII por estudiante (ADR-018, RN-130 + ADR-022).
 *
 * Cumple Seccion 15.4 de la tesis (CII como observacion longitudinal).
 * Muestra el slope ordinal (mejora/empeoramiento) del estudiante sobre
 * problemas analogos definidos por TareaPracticaTemplate.id (ADR-016).
 *
 * Drill-down navegacional (shape docente):
 *   cohorte (/progression) -> alumno (esta vista) -> episodio (/episode-n-level)
 * La lista "Episodios del estudiante" usa getStudentEpisodes y cada fila
 * navega a /episode-n-level?episodeId=X. Cierra fricción F7 del shape.
 *
 * Visualizacion: tabla por template + sparkline SVG inline + flecha
 * mejorando/estable/empeorando segun slope. Sin libs de chart.
 *
 * Tokens: SCORE_COLORS deriva de var(--color-appropriation-*) (sec 6 brief
 * shape). El SVG inline necesita strings concretos; los tomamos de
 * getComputedStyle al mount (caen a ASCII-safe defaults si no resuelve).
 */
import { Badge, PageContainer } from "@platform/ui"
import { Link } from "@tanstack/react-router"
import { TriangleAlert } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import {
  type CIIEvolutionLongitudinal,
  type CIIEvolutionTemplate,
  type CIIEvolutionUnidad,
  type StudentAlertsPayload,
  type StudentEpisode,
  type StudentEpisodesPayload,
  getStudentAlerts,
  getStudentCIIEvolution,
  getStudentEpisodes,
} from "../lib/api"
import { helpContent } from "../utils/helpContent"

interface Props {
  getToken: () => Promise<string | null>
  /** Si vienen, autocarga la vista al montar (drill-down desde Progresion). */
  initialComisionId?: string
  initialStudentId?: string
}

/**
 * Resuelve los 3 colores ordinales (delegacion=0, superficial=1, reflexiva=2)
 * desde los tokens compartidos. Sin estos tokens (SSR, jsdom sin theme), cae
 * a hex slate-500 — los tests siguen pasando porque no inspeccionan el SVG.
 */
function resolveScoreColors(): [string, string, string] {
  if (typeof window === "undefined") return ["#dc2626", "#f59e0b", "#16a34a"]
  const root = window.getComputedStyle(document.documentElement)
  const dele = root.getPropertyValue("--color-appropriation-delegacion").trim()
  const sup = root.getPropertyValue("--color-appropriation-superficial").trim()
  const ref = root.getPropertyValue("--color-appropriation-reflexiva").trim()
  return [
    dele ? `oklch(${dele.replace(/^oklch\(/, "").replace(/\)$/, "")})` : "#dc2626",
    sup ? `oklch(${sup.replace(/^oklch\(/, "").replace(/\)$/, "")})` : "#f59e0b",
    ref ? `oklch(${ref.replace(/^oklch\(/, "").replace(/\)$/, "")})` : "#16a34a",
  ]
}

function slopeLabel(slope: number | null): {
  label: string
  arrow: string
  color: string
} {
  if (slope === null) {
    return { label: "datos insuficientes", arrow: "?", color: "text-slate-400" }
  }
  if (slope > 0.1)
    return { label: "mejorando", arrow: "↑", color: "text-[var(--color-success)]" }
  if (slope < -0.1)
    return { label: "empeorando", arrow: "↓", color: "text-[var(--color-danger)]" }
  return { label: "estable", arrow: "→", color: "text-slate-600" }
}

function Sparkline({ scores, colors }: { scores: number[]; colors: [string, string, string] }) {
  if (scores.length === 0) {
    return <div className="text-xs text-slate-400">sin datos</div>
  }
  const W = 120
  const H = 36
  const PAD = 4
  const innerW = W - PAD * 2
  const innerH = H - PAD * 2

  const stepX = scores.length > 1 ? innerW / (scores.length - 1) : 0
  // scores son 0/1/2; el rango max es 2.
  const yFor = (s: number) => PAD + innerH - (s / 2) * innerH

  const points = scores.map((s, i) => `${PAD + i * stepX},${yFor(s)}`).join(" ")

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" role="img">
      <title>Sparkline ordinal de {scores.length} puntos</title>
      {[0, 1, 2].map((s) => (
        <line
          key={s}
          x1={PAD}
          y1={yFor(s)}
          x2={W - PAD}
          y2={yFor(s)}
          stroke="#e2e8f0"
          strokeWidth={0.5}
          strokeDasharray="2 2"
        />
      ))}
      {scores.length > 1 && (
        <polyline
          points={points}
          fill="none"
          stroke="#475569"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      )}
      {scores.map((s, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: posicion temporal estable
          key={i}
          cx={PAD + i * stepX}
          cy={yFor(s)}
          r={3}
          fill={colors[s] ?? "#64748b"}
          stroke="white"
          strokeWidth={1}
        />
      ))}
    </svg>
  )
}

function TemplateRow({
  entry,
  colors,
}: { entry: CIIEvolutionTemplate; colors: [string, string, string] }) {
  const { label, arrow, color } = slopeLabel(entry.slope)
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="py-3 pr-3 align-middle">
        <div className="font-mono text-xs text-slate-700 break-all">
          {entry.template_id.slice(0, 8)}...{entry.template_id.slice(-4)}
        </div>
      </td>
      <td className="py-3 pr-3 align-middle text-sm text-slate-700">{entry.n_episodes}</td>
      <td className="py-3 pr-3 align-middle">
        <Sparkline scores={entry.scores_ordinal} colors={colors} />
      </td>
      <td className="py-3 pr-3 align-middle">
        <div className={`flex items-center gap-2 text-sm ${color}`}>
          <span className="text-2xl leading-none">{arrow}</span>
          <span className="capitalize">{label}</span>
        </div>
      </td>
      <td className="py-3 align-middle text-right">
        {entry.slope === null ? (
          <span className="text-xs text-slate-400">sin slope</span>
        ) : (
          <span className="font-mono text-sm text-slate-700">
            {entry.slope > 0 ? "+" : ""}
            {entry.slope.toFixed(3)}
          </span>
        )}
      </td>
    </tr>
  )
}

const SEVERITY_BADGE_STYLES: Record<string, string> = {
  low: "bg-slate-200 text-slate-800",
  medium: "bg-amber-100 text-amber-900 border border-amber-300",
  high: "bg-red-100 text-red-900 border border-red-400",
}

const QUARTILE_LABELS: Record<string, string> = {
  Q1: "Q1 (peor 25%)",
  Q2: "Q2",
  Q3: "Q3",
  Q4: "Q4 (mejor 25%)",
}

const APPROPRIATION_LABEL: Record<string, string> = {
  apropiacion_reflexiva: "reflexiva",
  apropiacion_superficial: "superficial",
  delegacion_pasiva: "delegacion",
}

function appropriationDot(label: string | null): string {
  if (label === "apropiacion_reflexiva") return "var(--color-appropriation-reflexiva)"
  if (label === "apropiacion_superficial") return "var(--color-appropriation-superficial)"
  if (label === "delegacion_pasiva") return "var(--color-appropriation-delegacion)"
  return "var(--color-level-meta)"
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "sin fecha"
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  })
}

export function StudentLongitudinalView({ getToken, initialComisionId, initialStudentId }: Props) {
  const studentId = initialStudentId ?? null
  const comisionId = initialComisionId ?? null
  const [data, setData] = useState<CIIEvolutionLongitudinal | null>(null)
  const [alertsData, setAlertsData] = useState<StudentAlertsPayload | null>(null)
  const [episodesData, setEpisodesData] = useState<StudentEpisodesPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scoreColors = useMemo(resolveScoreColors, [])

  // Drill-down: si la URL trae studentId+comisionId, autocargar al montar.
  useEffect(() => {
    if (!studentId || !comisionId) return
    setLoading(true)
    setError(null)
    setData(null)
    setAlertsData(null)
    setEpisodesData(null)
    Promise.all([
      getStudentCIIEvolution(studentId, comisionId, getToken),
      getStudentAlerts(studentId, comisionId, getToken),
      getStudentEpisodes(studentId, comisionId, getToken),
    ])
      .then(([evo, alerts, episodes]) => {
        setData(evo)
        setAlertsData(alerts)
        setEpisodesData(episodes)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [studentId, comisionId, getToken])

  const meanLabel = data ? slopeLabel(data.mean_slope) : null

  return (
    <PageContainer
      title="Evolucion longitudinal del estudiante"
      description="Slope ordinal de apropiacion a traves de problemas analogos (Seccion 15.4, ADR-018, RN-130). N>=3 episodios por template para slope valido."
      helpContent={helpContent.studentLongitudinal}
    >
      <div className="space-y-6">
        {/* Breadcrumb + back-link cuando se llego por drill-down */}
        {comisionId && (
          <div className="flex items-center gap-2 text-xs">
            <Link
              to="/progression"
              search={{ comisionId }}
              className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              ← Volver a la cohorte
            </Link>
            {studentId && (
              <>
                <span className="text-slate-400">·</span>
                <span className="font-mono text-slate-500">
                  estudiante {studentId.slice(0, 8)}...{studentId.slice(-4)}
                </span>
              </>
            )}
          </div>
        )}

        {/* Estado vacio honesto: el flujo correcto es entrar por drill-down. */}
        {(!studentId || !comisionId) && !loading && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600 space-y-2">
            <p className="font-medium text-slate-700">
              Llegaste aca sin estudiante seleccionado.
            </p>
            <p>
              Volve a <Link to="/" className="text-[var(--color-accent-brand)] underline">tus
              comisiones</Link>, abri una cohorte y eligi un estudiante para ver su evolucion
              longitudinal.
            </p>
          </div>
        )}

        {loading && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Cargando evolucion del estudiante...
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="font-medium">Error consultando al estudiante</div>
            <div className="mt-1 font-mono text-xs">{error}</div>
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Resumen denso (no 4-card grid). Resuelve F5. */}
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
              <p className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-1">
                Resumen
              </p>
              <p>
                <strong>{data.n_episodes_total}</strong> episodios totales
                <span className="text-slate-400 mx-2">·</span>
                <strong>{data.n_groups_evaluated}</strong> templates evaluados
                {data.n_groups_insufficient > 0 && (
                  <>
                    {" "}
                    <span className="text-slate-400">
                      (+{data.n_groups_insufficient} con N&lt;3)
                    </span>
                  </>
                )}
              </p>
              <p className="mt-1">
                Slope promedio:
                <span className="font-mono mx-1">
                  {data.mean_slope === null
                    ? "sin slope"
                    : `${data.mean_slope > 0 ? "+" : ""}${data.mean_slope.toFixed(3)}`}
                </span>
                {meanLabel && (
                  <span className={meanLabel.color}>
                    {" "}
                    {meanLabel.arrow} {meanLabel.label}
                  </span>
                )}
                <span className="text-slate-400 mx-2">·</span>
                <span className="text-xs font-mono">labeler v{data.labeler_version}</span>
              </p>
            </div>

            {/* Alertas: panel border completo (sin side-stripe baneado).
                Resuelve F2: era border-l-4 border-amber-400, ahora border completo
                + icono TriangleAlert que carga la severidad. */}
            {alertsData && alertsData.alerts.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                    <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {alertsData.n_alerts} alerta{alertsData.n_alerts !== 1 ? "s" : ""} para este
                    estudiante
                  </div>
                  {alertsData.quartile && (
                    <span className="text-xs text-amber-800">
                      Posicion en cohorte: <strong>{QUARTILE_LABELS[alertsData.quartile]}</strong>
                    </span>
                  )}
                </div>
                <ul className="space-y-1">
                  {alertsData.alerts.map((a) => (
                    <li key={a.code} className="flex items-start gap-2 text-xs text-slate-800">
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-[10px] uppercase font-semibold ${SEVERITY_BADGE_STYLES[a.severity] ?? ""}`}
                      >
                        {a.severity}
                      </span>
                      <span>
                        <strong>{a.title}</strong>
                        {": "}
                        {a.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {alertsData &&
              alertsData.alerts.length === 0 &&
              alertsData.cohort_stats &&
              !alertsData.cohort_stats.insufficient_data && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  <strong>Sin alertas</strong>: el estudiante esta dentro del rango esperado de la
                  cohorte
                  {alertsData.quartile && ` (${QUARTILE_LABELS[alertsData.quartile]})`}.
                </div>
              )}

            {/* Agrupacion por Unidad — PRIMARY cuando evolution_per_unidad tiene datos */}
            {(data.evolution_per_unidad ?? []).length > 0 ? (
              <>
                {(data.evolution_per_unidad ?? []).every((e) => e.insufficient_data) ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500 space-y-1">
                    <div className="font-medium text-slate-700">
                      Datos insuficientes en todas las unidades.
                    </div>
                    <div>
                      Cada unidad necesita al menos 3 episodios cerrados para calcular el slope
                      ordinal. Asigna TPs a unidades y/o espera que el estudiante complete mas
                      trabajos.
                    </div>
                  </div>
                ) : (
                  <UnidadTable entries={data.evolution_per_unidad} colors={scoreColors} />
                )}

                {/* Template view como seccion secundaria colapsable */}
                {data.evolution_per_template.length > 0 && (
                  <TemplateSecondarySection
                    entries={data.evolution_per_template}
                    colors={scoreColors}
                    labelerVersion={data.labeler_version}
                  />
                )}
              </>
            ) : data.evolution_per_template.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                <div className="font-medium text-slate-700">Sin clasificaciones disponibles.</div>
                <div className="mt-1">
                  El estudiante no tiene episodios cerrados. Asigna TPs a Unidades para habilitar
                  el analisis por tema.
                </div>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">Template</th>
                      <th className="px-3 py-2 font-medium">N episodios</th>
                      <th className="px-3 py-2 font-medium">Trayectoria ordinal</th>
                      <th className="px-3 py-2 font-medium">Tendencia</th>
                      <th className="px-3 py-2 font-medium text-right">Slope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.evolution_per_template.map((entry) => (
                      <TemplateRow
                        key={entry.template_id}
                        entry={entry}
                        colors={scoreColors}
                      />
                    ))}
                  </tbody>
                </table>
                <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Trayectoria, cada punto es la apropiacion de un episodio (
                  <Badge className="bg-red-500 text-white">delegacion=0</Badge>{" "}
                  <Badge className="bg-amber-500 text-white">superficial=1</Badge>{" "}
                  <Badge className="bg-emerald-500 text-white">reflexiva=2</Badge>) ordenada por
                  classified_at.
                </div>
              </div>
            )}

            {/* Episodios del estudiante: drill-down a /episode-n-level.
                Cierra F7 del shape. */}
            {episodesData && Array.isArray(episodesData.episodes) && (
              <EpisodesList episodes={episodesData.episodes} />
            )}
          </div>
        )}
      </div>
    </PageContainer>
  )
}

// ── Unidad table — PRIMARY grouping (ADR-022 unidades-trazabilidad) ──────

function UnidadTable({
  entries,
  colors,
}: {
  entries: CIIEvolutionUnidad[]
  colors: [string, string, string]
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-mono uppercase tracking-wider text-slate-600">
        Evolucion por unidad (primario)
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-600">
          <tr>
            <th className="px-3 py-2 font-medium">Unidad</th>
            <th className="px-3 py-2 font-medium">N episodios</th>
            <th className="px-3 py-2 font-medium">Trayectoria ordinal</th>
            <th className="px-3 py-2 font-medium">Tendencia</th>
            <th className="px-3 py-2 font-medium text-right">Slope</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const { label, arrow, color } = slopeLabel(
              entry.insufficient_data ? null : entry.slope,
            )
            const isSinUnidad = entry.unidad_id === "sin_unidad"
            return (
              <tr
                key={entry.unidad_id}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
              >
                <td className="px-3 py-3 align-middle">
                  {isSinUnidad ? (
                    <span className="text-xs text-slate-400 italic">{entry.unidad_nombre}</span>
                  ) : (
                    <span className="text-sm font-medium text-slate-800">{entry.unidad_nombre}</span>
                  )}
                </td>
                <td className="px-3 py-3 align-middle text-sm text-slate-700">{entry.n_episodes}</td>
                <td className="px-3 py-3 align-middle">
                  {entry.insufficient_data ? (
                    <span className="text-xs text-slate-400">insuficiente (min. 3)</span>
                  ) : (
                    <Sparkline scores={entry.scores_ordinal} colors={colors} />
                  )}
                </td>
                <td className="px-3 py-3 align-middle">
                  <div className={`flex items-center gap-2 text-sm ${color}`}>
                    <span className="text-2xl leading-none">{arrow}</span>
                    <span className="capitalize">{label}</span>
                  </div>
                </td>
                <td className="px-3 py-3 align-middle text-right">
                  {entry.insufficient_data || entry.slope === null ? (
                    <span className="text-xs text-slate-400">sin slope</span>
                  ) : (
                    <span className="font-mono text-sm text-slate-700">
                      {entry.slope > 0 ? "+" : ""}
                      {entry.slope.toFixed(3)}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Trayectoria por unidad tematica: cada punto es un episodio (
        <Badge className="bg-red-500 text-white">delegacion=0</Badge>{" "}
        <Badge className="bg-amber-500 text-white">superficial=1</Badge>{" "}
        <Badge className="bg-emerald-500 text-white">reflexiva=2</Badge>) ordenada por classified_at.
        Agrupacion primaria ADR-022.
      </div>
    </div>
  )
}

function TemplateSecondarySection({
  entries,
  colors,
  labelerVersion,
}: {
  entries: CIIEvolutionTemplate[]
  colors: [string, string, string]
  labelerVersion: string
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="text-xs font-mono uppercase tracking-wider text-slate-500">
          Agrupacion por template (secundario)
        </span>
        <span className="text-xs text-slate-400">{expanded ? "Ocultar" : "Mostrar"}</span>
      </button>
      {expanded && (
        <div className="border-t border-slate-100">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Template</th>
                <th className="px-3 py-2 font-medium">N episodios</th>
                <th className="px-3 py-2 font-medium">Trayectoria ordinal</th>
                <th className="px-3 py-2 font-medium">Tendencia</th>
                <th className="px-3 py-2 font-medium text-right">Slope</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <TemplateRow key={entry.template_id} entry={entry} colors={colors} />
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Labeler v{labelerVersion}. Agrupacion por TareaPracticaTemplate.id (ADR-018).
          </div>
        </div>
      )}
    </div>
  )
}

function EpisodesList({ episodes }: { episodes: StudentEpisode[] }) {
  if (episodes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        El estudiante no tiene episodios registrados en esta comision todavia.
      </div>
    )
  }
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-mono uppercase tracking-wider text-slate-600">
        Episodios del estudiante
        <span className="text-slate-400 mx-2">·</span>
        <span className="text-[11px] normal-case font-sans">
          click para ver distribucion N1-N4
        </span>
      </header>
      <ul className="divide-y divide-slate-100" data-testid="student-episodes-list">
        {episodes.map((ep) => {
          const apr = ep.appropriation ? APPROPRIATION_LABEL[ep.appropriation] : null
          return (
            <li key={ep.episode_id}>
              <Link
                to="/episode-n-level"
                search={{ episodeId: ep.episode_id }}
                data-testid="student-episode-row"
                className="block px-4 py-3 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: appropriationDot(ep.appropriation) }}
                  />
                  <span className="font-mono text-xs text-slate-700 shrink-0">
                    {ep.episode_id.slice(0, 8)}...{ep.episode_id.slice(-4)}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-sm text-slate-800">
                    {ep.tarea_codigo ? (
                      <>
                        <span className="font-medium">{ep.tarea_codigo}</span>
                        {ep.tarea_titulo && (
                          <span className="text-slate-500">
                            {" "}
                            {ep.tarea_titulo}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-400 italic">TP huerfana</span>
                    )}
                  </span>
                  <span className="text-xs text-slate-500 shrink-0 hidden sm:inline">
                    {formatShortDate(ep.opened_at)}
                  </span>
                  <span className="text-xs font-mono text-slate-600 shrink-0 w-24 text-right">
                    {apr ?? "sin clasif."}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 shrink-0">
                    ›
                  </span>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
