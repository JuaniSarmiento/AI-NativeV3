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
import { useEffect, useState } from "react"
import {
  type CohortProgression,
  type StudentTrajectory,
  getCohortProgression,
} from "../lib/api"

const LABEL_COLORS: Record<string, string> = {
  delegacion_pasiva: "#dc2626", // red-600
  apropiacion_superficial: "#f59e0b", // amber-500
  apropiacion_reflexiva: "#16a34a", // green-600
}

const PROGRESSION_COLORS: Record<string, string> = {
  mejorando: "#16a34a",
  estable: "#64748b",
  empeorando: "#dc2626",
  insuficiente: "#94a3b8",
}

interface Props {
  comisionId: string
  getToken: () => Promise<string | null>
}

export function ProgressionView({ comisionId, getToken }: Props) {
  const [data, setData] = useState<CohortProgression | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getCohortProgression(getToken, comisionId)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [comisionId, getToken])

  if (loading) {
    return <div className="p-6 text-slate-500">Cargando progresión...</div>
  }
  if (error) {
    return <div className="p-6 text-red-600">Error: {error}</div>
  }
  if (!data) return null

  return (
    <div className="space-y-6 p-6">
      <Header data={data} />
      <SummaryCards data={data} />
      <NetProgressionBar ratio={data.net_progression_ratio} />
      <TrajectoriesSection trajectories={data.trajectories} />
    </div>
  )
}

function Header({ data }: { data: CohortProgression }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Progresión longitudinal</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
        Cohorte {data.comision_id.slice(0, 8)}...{" "}
        · {data.n_students} estudiantes · {data.n_students_with_enough_data}{" "}
        con datos suficientes (≥3 episodios)
      </p>
    </div>
  )
}

function SummaryCards({ data }: { data: CohortProgression }) {
  const items = [
    { label: "Mejorando", value: data.mejorando, color: "bg-green-100 text-green-900" },
    { label: "Estable", value: data.estable, color: "bg-slate-100 text-slate-900" },
    { label: "Empeorando", value: data.empeorando, color: "bg-red-100 text-red-900" },
    { label: "Datos insuficientes", value: data.insuficiente, color: "bg-slate-50 text-slate-600" },
  ]
  return (
    <div className="grid grid-cols-4 gap-4">
      {items.map((item) => (
        <div
          key={item.label}
          className={`rounded-lg p-4 ${item.color}`}
        >
          <div className="text-3xl font-semibold">{item.value}</div>
          <div className="text-sm mt-1">{item.label}</div>
        </div>
      ))}
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
}: {
  trajectories: StudentTrajectory[]
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
    (a, b) =>
      b.n_episodes - a.n_episodes ||
      (a.progression_label === "mejorando" ? -1 : 1),
  )

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium">Trayectorias individuales</h2>
      {sorted.map((t) => (
        <TrajectoryRow key={t.student_alias} trajectory={t} />
      ))}
    </div>
  )
}

function TrajectoryRow({ trajectory }: { trajectory: StudentTrajectory }) {
  const color = PROGRESSION_COLORS[trajectory.progression_label]
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-[180px]">
          <div className="font-mono text-sm font-medium">
            {trajectory.student_alias.slice(0, 12)}
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
    </div>
  )
}

function TrajectoryTimeline({ points }: { points: Array<{ appropriation: string; classified_at: string; episode_id: string }> }) {
  if (points.length === 0) {
    return <div className="text-xs text-slate-400">Sin clasificaciones</div>
  }

  return (
    <div className="flex items-center gap-1">
      {points.map((p, i) => (
        <div
          key={p.episode_id}
          className="flex-1 h-8 rounded transition-transform hover:scale-105 cursor-pointer"
          style={{ backgroundColor: LABEL_COLORS[p.appropriation] ?? "#94a3b8" }}
          title={`${new Date(p.classified_at).toLocaleDateString()} · ${p.appropriation}`}
        >
          <span className="sr-only">{p.appropriation}</span>
        </div>
      ))}
    </div>
  )
}
