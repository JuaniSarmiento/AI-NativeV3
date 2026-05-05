/**
 * Vista de progresión longitudinal de una cohorte.
 *
 * Muestra:
 *  - Resumen agregado: mejorando / estable / empeorando / insuficiente
 *  - Net progression ratio (indicador global)
 *  - Chart con la trayectoria individual de cada estudiante
 *
 * El chart usa SVG nativo (no Recharts) para simplicidad y performance.
 * Si se necesita más interactividad (tooltips on hover, zoom), migrar
 * a Recharts en una iteración posterior.
 */
import { PageContainer, StateMessage } from "@platform/ui"
import { Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useComisionLabel } from "../components/ComisionSelector"
import { type CohortProgression, type StudentTrajectory, getCohortProgression } from "../lib/api"
import { helpContent } from "../utils/helpContent"

// Mapping de apropiacion -> CSS variable. Los SVG/style backgroundColor
// inline necesitan strings, asi que devolvemos `var(--token)` directo
// (browser lo resuelve, jsdom lo deja literal en computed style).
const LABEL_COLOR_VAR: Record<string, string> = {
  delegacion_pasiva: "var(--color-appropriation-delegacion)",
  apropiacion_superficial: "var(--color-appropriation-superficial)",
  apropiacion_reflexiva: "var(--color-appropriation-reflexiva)",
}

const PROGRESSION_COLOR_VAR: Record<string, string> = {
  mejorando: "var(--color-success)",
  estable: "var(--color-neutral)",
  empeorando: "var(--color-danger)",
  insuficiente: "var(--text-tertiary)",
}

interface Props {
  comisionId: string
  getToken: () => Promise<string | null>
}

export function ProgressionView({ comisionId, getToken }: Props) {
  const comisionLabelText = useComisionLabel(comisionId)
  const [data, setData] = useState<CohortProgression | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getCohortProgression(comisionId, getToken)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [comisionId, getToken])

  if (loading) {
    return (
      <div className="p-6">
        <StateMessage variant="loading" title="Cargando progresion..." />
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-6">
        <StateMessage variant="error" title="No se pudo cargar la progresion" description={error} />
      </div>
    )
  }
  if (!data) return null

  return (
    <PageContainer
      title="Progresion longitudinal"
      description={`Cohorte ${comisionLabelText} · ${data.n_students} estudiantes · ${data.n_students_with_enough_data} con datos suficientes (>=3 episodios)`}
      helpContent={helpContent.progression}
    >
      <div className="space-y-6">
        <SummaryStrip data={data} />
        <NetProgressionBar ratio={data.net_progression_ratio} />
        <TrajectoriesSection trajectories={data.trajectories} comisionId={comisionId} />
      </div>
    </PageContainer>
  )
}

// Strip horizontal denso, NO 4-card grid (resuelve hero-metric ban). Los
// 4 estados van inline con dot coloreado + numero + label (Linear-grade
// densidad). Cumple DESIGN.md don't #3.
function SummaryStrip({ data }: { data: CohortProgression }) {
  const items: { label: string; value: number; dot: string }[] = [
    {
      label: "mejorando",
      value: data.mejorando,
      dot: "var(--color-success)",
    },
    {
      label: "estable",
      value: data.estable,
      dot: "var(--color-neutral)",
    },
    {
      label: "empeorando",
      value: data.empeorando,
      dot: "var(--color-danger)",
    },
    {
      label: "datos insuf.",
      value: data.insuficiente,
      dot: "var(--text-tertiary)",
    },
  ]
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-2">Resumen</p>
      <ul
        className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-slate-700"
        data-testid="progression-summary-strip"
      >
        {items.map((it) => (
          <li key={it.label} className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: it.dot }}
            />
            <strong className="font-semibold">{it.value}</strong>
            <span className="text-slate-600">{it.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function NetProgressionBar({ ratio }: { ratio: number }) {
  // Ratio entre -1 y 1. Positivo = cohorte mejorando.
  const pct = Math.abs(ratio) * 100
  const color = ratio > 0.1 ? "bg-green-500" : ratio < -0.1 ? "bg-red-500" : "bg-slate-400"

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-medium">Net progression ratio</h3>
        <span className="text-2xl font-semibold">
          {ratio > 0 ? "+" : ""}
          {ratio.toFixed(3)}
        </span>
      </div>
      <div className="relative h-3 bg-slate-100 dark:bg-slate-800 rounded mt-3 overflow-hidden">
        {/* Línea central (0) */}
        <div className="absolute left-1/2 top-0 h-full w-px bg-slate-400 dark:bg-slate-600" />
        {/* Barra */}
        <div
          className={`absolute top-0 h-full ${color}`}
          style={{
            left: ratio >= 0 ? "50%" : `${50 - pct / 2}%`,
            width: `${pct / 2}%`,
          }}
        />
      </div>
      <p className="text-xs text-slate-500 mt-2">
        (mejorando − empeorando) / estudiantes con datos. Rango [-1, +1].
      </p>
    </div>
  )
}

function TrajectoriesSection({
  trajectories,
  comisionId,
}: {
  trajectories: StudentTrajectory[]
  comisionId: string
}) {
  if (trajectories.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-slate-500">
        No hay trayectorias registradas en esta cohorte aún.
      </div>
    )
  }

  // Ordenar: primero los con más episodios, luego los mejorando
  const sorted = [...trajectories].sort(
    (a, b) => b.n_episodes - a.n_episodes || (a.progression_label === "mejorando" ? -1 : 1),
  )

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium">Trayectorias individuales</h2>
      {sorted.map((t) => (
        <TrajectoryRow key={t.student_pseudonym} trajectory={t} comisionId={comisionId} />
      ))}
    </div>
  )
}

function TrajectoryRow({
  trajectory,
  comisionId,
}: {
  trajectory: StudentTrajectory
  comisionId: string
}) {
  const color = PROGRESSION_COLOR_VAR[trajectory.progression_label] ?? "var(--color-neutral)"
  // ADR-022: drill-down navegacional. Click en la fila navega a la vista
  // longitudinal pre-poblada con student + comisión.
  return (
    <Link
      data-testid="student-row"
      to="/student-longitudinal"
      search={{ comisionId, studentId: trajectory.student_pseudonym }}
      className="block rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-blue-400 hover:shadow-sm transition"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-[180px]">
          <div className="font-mono text-sm font-medium">
            {trajectory.student_pseudonym.slice(0, 12)}
          </div>
          <div className="text-xs text-slate-500">
            {trajectory.n_episodes} episodio{trajectory.n_episodes !== 1 ? "s" : ""}
          </div>
        </div>
        <div className="flex-1">
          <TrajectoryTimeline points={trajectory.points} />
        </div>
        <div
          className="px-3 py-1 rounded text-xs font-medium text-white min-w-[100px] text-center"
          style={{ backgroundColor: color }}
        >
          {trajectory.progression_label}
        </div>
      </div>
    </Link>
  )
}

function TrajectoryTimeline({
  points,
}: { points: Array<{ appropriation: string; classified_at: string; episode_id: string }> }) {
  if (points.length === 0) {
    return <div className="text-xs text-slate-400">Sin clasificaciones</div>
  }

  return (
    <div className="flex items-center gap-1">
      {points.map((p) => (
        <div
          key={p.episode_id}
          className="flex-1 h-8 rounded transition-transform hover:scale-105 cursor-pointer"
          style={{ backgroundColor: LABEL_COLOR_VAR[p.appropriation] ?? "var(--color-level-meta)" }}
          title={`${new Date(p.classified_at).toLocaleDateString()} · ${p.appropriation}`}
        >
          <span className="sr-only">{p.appropriation}</span>
        </div>
      ))}
    </div>
  )
}
