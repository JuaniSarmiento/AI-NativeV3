/**
 * Vista de evolución longitudinal CII por estudiante (ADR-018, RN-130).
 *
 * Cumple Sección 15.4 de la tesis (CII como observación longitudinal).
 * Muestra el slope ordinal (mejora/empeoramiento) del estudiante sobre
 * problemas análogos definidos por TareaPracticaTemplate.id (ADR-016).
 *
 * Visualización: tabla por template + sparkline SVG inline + flecha
 * mejorando/estable/empeorando según slope. Sin libs de chart.
 */
import { Badge, Button, Input, Label, PageContainer } from "@platform/ui"
import { useEffect, useState } from "react"
import { ComisionSelector } from "../components/ComisionSelector"
import {
  type CIIEvolutionLongitudinal,
  type CIIEvolutionTemplate,
  type StudentAlertsPayload,
  getStudentAlerts,
  getStudentCIIEvolution,
} from "../lib/api"
import { helpContent } from "../utils/helpContent"

interface Props {
  getToken: () => Promise<string | null>
  /** Si vienen, autocarga la vista al montar (drill-down desde Progresión). */
  initialComisionId?: string
  initialStudentId?: string
}

const SCORE_COLORS = ["#ef4444", "#f59e0b", "#22c55e"] // red (delegacion), amber (superficial), green (reflexiva)

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

function Sparkline({ scores }: { scores: number[] }) {
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
      {/* Background grid lines */}
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
      {/* Línea conectando puntos */}
      {scores.length > 1 && (
        <polyline
          points={points}
          fill="none"
          stroke="#475569"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      )}
      {/* Puntos — el index ES la key correcta porque cada punto representa una posicion
          temporal estable en la trayectoria del estudiante; reordenar la lista cambia
          el significado de cada punto. */}
      {scores.map((s, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: posicion temporal estable
          key={i}
          cx={PAD + i * stepX}
          cy={yFor(s)}
          r={3}
          fill={SCORE_COLORS[s] ?? "#64748b"}
          stroke="white"
          strokeWidth={1}
        />
      ))}
    </svg>
  )
}

function TemplateRow({ entry }: { entry: CIIEvolutionTemplate }) {
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
        <Sparkline scores={entry.scores_ordinal} />
      </td>
      <td className="py-3 pr-3 align-middle">
        <div className={`flex items-center gap-2 text-sm ${color}`}>
          <span className="text-2xl leading-none">{arrow}</span>
          <span className="capitalize">{label}</span>
        </div>
      </td>
      <td className="py-3 align-middle text-right">
        {entry.slope === null ? (
          <span className="text-xs text-slate-400">—</span>
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
  Q1: "Q1 — peor 25%",
  Q2: "Q2",
  Q3: "Q3",
  Q4: "Q4 — mejor 25%",
}

export function StudentLongitudinalView({ getToken, initialComisionId, initialStudentId }: Props) {
  const [studentId, setStudentId] = useState(initialStudentId ?? "")
  const [comisionId, setComisionId] = useState<string | null>(initialComisionId ?? null)
  const [data, setData] = useState<CIIEvolutionLongitudinal | null>(null)
  const [alertsData, setAlertsData] = useState<StudentAlertsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSearch = () => {
    if (!studentId.trim() || !comisionId) return
    setLoading(true)
    setError(null)
    setData(null)
    setAlertsData(null)

    // Cargamos en paralelo: evolution longitudinal + alertas (ADR-022)
    Promise.all([
      getStudentCIIEvolution(studentId.trim(), comisionId, getToken),
      getStudentAlerts(studentId.trim(), comisionId, getToken),
    ])
      .then(([evo, alerts]) => {
        setData(evo)
        setAlertsData(alerts)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }

  // Drill-down: si la URL trae ?studentId+comisionId, autocargar al montar.
  useEffect(() => {
    if (!initialStudentId || !initialComisionId) return
    setLoading(true)
    setError(null)
    setData(null)
    setAlertsData(null)
    Promise.all([
      getStudentCIIEvolution(initialStudentId, initialComisionId, getToken),
      getStudentAlerts(initialStudentId, initialComisionId, getToken),
    ])
      .then(([evo, alerts]) => {
        setData(evo)
        setAlertsData(alerts)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [initialStudentId, initialComisionId, getToken])

  const meanLabel = data ? slopeLabel(data.mean_slope) : null

  return (
    <PageContainer
      title="Evolución longitudinal del estudiante"
      description="Slope ordinal de apropiación a través de problemas análogos (Sección 15.4 — ADR-018, RN-130). N>=3 episodios por template para slope válido."
      helpContent={helpContent.studentLongitudinal}
    >
      <div className="space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div>
            <Label>Comisión</Label>
            <div className="mt-1">
              <ComisionSelector value={comisionId} onChange={setComisionId} />
            </div>
          </div>
          <div>
            <Label htmlFor="student-id-input">UUID del estudiante (student_pseudonym)</Label>
            <div className="mt-1 flex gap-2">
              <Input
                id="student-id-input"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch()
                }}
                placeholder="ej. b1b1b1b1-0001-0001-0001-000000000001"
                className="flex-1 font-mono text-sm"
              />
              <Button onClick={handleSearch} disabled={loading || !studentId.trim() || !comisionId}>
                {loading ? "Cargando..." : "Analizar"}
              </Button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Obtené el UUID desde Progresión (cada estudiante listado tiene su pseudónimo).
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="font-medium">Error consultando al estudiante</div>
            <div className="mt-1 font-mono text-xs">{error}</div>
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* ADR-022: alertas + cuartil de cohorte */}
            {alertsData && alertsData.alerts.length > 0 && (
              <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 p-4 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm font-medium text-amber-900">
                    {alertsData.n_alerts} alerta{alertsData.n_alerts !== 1 ? "s" : ""} para este
                    estudiante
                  </div>
                  {alertsData.quartile && (
                    <span className="text-xs text-amber-800">
                      Posición en cohorte: <strong>{QUARTILE_LABELS[alertsData.quartile]}</strong>
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
                        {" — "}
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
                  <strong>Sin alertas</strong> — el estudiante está dentro del rango esperado de la
                  cohorte
                  {alertsData.quartile && ` (${QUARTILE_LABELS[alertsData.quartile]})`}.
                </div>
              )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  Episodios totales
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {data.n_episodes_total}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  Templates evaluados (N≥3)
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {data.n_groups_evaluated}
                </div>
                {data.n_groups_insufficient > 0 && (
                  <div className="mt-1 text-xs text-slate-500">
                    +{data.n_groups_insufficient} con N&lt;3
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  Slope promedio
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {data.mean_slope === null ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <>
                      {data.mean_slope > 0 ? "+" : ""}
                      {data.mean_slope.toFixed(3)}
                    </>
                  )}
                </div>
                {meanLabel && (
                  <div className={`mt-1 text-sm ${meanLabel.color}`}>
                    {meanLabel.arrow} {meanLabel.label}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  Datos suficientes
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {data.sufficient_data ? "Sí" : "No"}
                </div>
                <div className="mt-1 text-xs text-slate-500">labeler v{data.labeler_version}</div>
              </div>
            </div>

            {data.evolution_per_template.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                <div className="font-medium text-slate-700">Sin templates con clasificaciones.</div>
                <div className="mt-1">
                  El estudiante no tiene episodios cerrados sobre TPs con{" "}
                  <code className="font-mono">template_id</code>. TPs huérfanas (sin template) no
                  entran al cálculo (limitación declarada en ADR-018).
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
                      <TemplateRow key={entry.template_id} entry={entry} />
                    ))}
                  </tbody>
                </table>
                <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Trayectoria: cada punto es la apropiación de un episodio (
                  <Badge className="bg-red-500 text-white">delegación=0</Badge>{" "}
                  <Badge className="bg-amber-500 text-white">superficial=1</Badge>{" "}
                  <Badge className="bg-emerald-500 text-white">reflexiva=2</Badge>) ordenada por
                  classified_at.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PageContainer>
  )
}
