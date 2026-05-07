import { PageContainer, StateMessage } from "@platform/ui"
import { Link } from "@tanstack/react-router"
import { ChevronDown, ChevronRight } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useComisionLabel } from "../components/ComisionSelector"
import { useViewMode } from "../hooks/useViewMode"
import {
  type CIIEvolutionUnidad,
  type CohortProgression,
  type EntregaDocente,
  type StudentTrajectory,
  type Unidad,
  getCohortProgression,
  getStudentCIIEvolution,
  listEntregas,
  listUnidades,
} from "../lib/api"
import {
  APPROPRIATION_DOCENTE,
  PROGRESSION_DOCENTE,
  studentShortLabel,
} from "../utils/docenteLabels"
import { helpContent } from "../utils/helpContent"

const LABEL_COLOR_VAR: Record<string, string> = {
  delegacion_pasiva: "var(--color-appropriation-delegacion)",
  apropiacion_superficial: "var(--color-appropriation-superficial)",
  apropiacion_reflexiva: "var(--color-appropriation-reflexiva)",
}

interface Props {
  comisionId: string
  getToken: () => Promise<string | null>
}

/** Estadisticas de entregas por student_pseudonym. */
type EntregaStatsMap = Record<
  string,
  { pendientes: number; corregidas: number; nota_promedio: number | null }
>

export function ProgressionView({ comisionId, getToken }: Props) {
  const comisionLabelText = useComisionLabel(comisionId)
  const [data, setData] = useState<CohortProgression | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [entregaStats, setEntregaStats] = useState<EntregaStatsMap>({})
  const [unidades, setUnidades] = useState<Unidad[]>([])
  const [viewMode] = useViewMode()
  const isDocente = viewMode === "docente"

  useEffect(() => {
    setLoading(true)
    setError(null)
    getCohortProgression(comisionId, getToken)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [comisionId, getToken])

  // Fetch unidades best-effort para mostrar desglose por unidad
  useEffect(() => {
    if (!comisionId) return
    let cancelled = false
    listUnidades(comisionId, getToken)
      .then((u) => { if (!cancelled) setUnidades(u) })
      .catch(() => { /* best-effort */ })
    return () => { cancelled = true }
  }, [comisionId, getToken])

  // Fetch entrega stats best-effort para enriquecer la tabla
  useEffect(() => {
    if (!comisionId) return
    let cancelled = false
    listEntregas({ comision_id: comisionId, limit: 200 }, getToken)
      .then((resp) => {
        if (cancelled) return
        const map: EntregaStatsMap = {}
        const entregas: EntregaDocente[] = resp.data
        for (const e of entregas) {
          const s = map[e.student_pseudonym] ?? {
            pendientes: 0,
            corregidas: 0,
            nota_promedio: null,
          }
          if (e.estado === "submitted") s.pendientes++
          if (e.estado === "graded" || e.estado === "returned") s.corregidas++
          map[e.student_pseudonym] = s
        }
        setEntregaStats(map)
      })
      .catch(() => {
        // Best-effort — si falla, no mostramos stats de entregas
      })
    return () => {
      cancelled = true
    }
  }, [comisionId, getToken])

  if (loading) {
    return (
      <div className="p-8">
        <StateMessage variant="loading" title="Cargando progresion..." />
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-8">
        <StateMessage variant="error" title="No se pudo cargar la progresion" description={error} />
      </div>
    )
  }
  if (!data) return null

  return (
    <PageContainer
      title={isDocente ? "Como van mis alumnos" : "Progresion longitudinal"}
      description={
        isDocente
          ? `Comision ${comisionLabelText} · ${data.n_students} alumnos`
          : `Cohorte ${comisionLabelText} · ${data.n_students} estudiantes · ${data.n_students_with_enough_data} con datos suficientes (>=3 episodios)`
      }
      helpContent={helpContent.progression}
    >
      <div className="space-y-6">
        <SummaryStrip data={data} isDocente={isDocente} />
        <NetProgressionBar ratio={data.net_progression_ratio} isDocente={isDocente} />
        {isDocente && data.empeorando > 0 && (
          <ActionInsight count={data.empeorando} />
        )}
        <TrajectoriesSection
          trajectories={data.trajectories}
          comisionId={comisionId}
          isDocente={isDocente}
          entregaStats={entregaStats}
          unidades={unidades}
          getToken={getToken}
        />
      </div>
    </PageContainer>
  )
}

function ActionInsight({ count }: { count: number }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-900">
      <strong>{count} alumno{count !== 1 ? "s" : ""} en riesgo.</strong>{" "}
      Considerá revisar sus ultimos trabajos y acercarte a conversar con ellos.
    </div>
  )
}

function SummaryStrip({ data, isDocente }: { data: CohortProgression; isDocente: boolean }) {
  const items: { label: string; value: number; dot: string }[] = [
    {
      label: isDocente ? "Mejorando" : "Mejorando",
      value: data.mejorando,
      dot: "var(--color-success)",
    },
    {
      label: isDocente ? "Estable" : "Estable",
      value: data.estable,
      dot: "var(--color-neutral)",
    },
    {
      label: isDocente ? "En riesgo" : "En riesgo",
      value: data.empeorando,
      dot: "var(--color-danger)",
    },
    {
      label: isDocente ? "Sin datos" : "Sin datos",
      value: data.insuficiente,
      dot: "#EAEAEA",
    },
  ]
  const total = data.n_students || 1
  return (
    <div className="rounded-xl border border-[#EAEAEA] bg-white px-6 py-4">
      <ul
        className="flex flex-wrap divide-x divide-[#EAEAEA]"
        data-testid="progression-summary-strip"
      >
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-3 px-6 first:pl-0 last:pr-0 py-1">
            <span
              aria-hidden="true"
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: it.dot }}
            />
            <div>
              <div className="text-xl font-semibold text-[#111111]">{it.value}</div>
              <div className="text-xs text-[#787774]">
                {it.label}
                {total > 0 && (
                  <span className="ml-1">({((it.value / total) * 100).toFixed(0)}%)</span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function NetProgressionBar({ ratio, isDocente }: { ratio: number; isDocente: boolean }) {
  const pct = Math.abs(ratio) * 100
  const isPositive = ratio > 0.1
  const isNegative = ratio < -0.1
  const barColor = isPositive ? "#16a34a" : isNegative ? "#dc2626" : "#EAEAEA"

  const plainLabel = isPositive
    ? "La mayoria de los alumnos esta mejorando"
    : isNegative
      ? "La mayoria de los alumnos esta empeorando"
      : "La cohorte se mantiene estable"

  return (
    <div className="rounded-xl border border-[#EAEAEA] bg-white px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-[#111111]">
          {isDocente ? "Balance general" : "Net progression"}
        </span>
        {isDocente ? (
          <span
            className={`text-sm font-medium ${isPositive ? "text-green-600" : isNegative ? "text-red-600" : "text-[#787774]"}`}
          >
            {plainLabel}
          </span>
        ) : (
          <span
            className={`text-2xl font-semibold ${isPositive ? "text-green-600" : isNegative ? "text-red-600" : "text-[#787774]"}`}
          >
            {ratio > 0 ? "+" : ""}
            {ratio.toFixed(3)}
          </span>
        )}
      </div>
      <div className="relative h-1.5 bg-[#EAEAEA] rounded-full overflow-hidden">
        <div className="absolute left-1/2 top-0 h-full w-px bg-[#787774]" />
        <div
          className="absolute top-0 h-full rounded-full"
          style={{
            left: ratio >= 0 ? "50%" : `${50 - pct / 2}%`,
            width: `${pct / 2}%`,
            backgroundColor: barColor,
          }}
        />
      </div>
      {!isDocente && (
        <p className="text-xs text-[#787774] mt-2">
          (mejorando - empeorando) / estudiantes con datos. Rango [-1, +1].
        </p>
      )}
    </div>
  )
}

function TrajectoriesSection({
  trajectories,
  comisionId,
  isDocente,
  entregaStats,
  unidades,
  getToken,
}: {
  trajectories: StudentTrajectory[]
  comisionId: string
  isDocente: boolean
  entregaStats: EntregaStatsMap
  unidades: Unidad[]
  getToken: () => Promise<string | null>
}) {
  if (trajectories.length === 0) {
    return (
      <div className="rounded-xl border border-[#EAEAEA] bg-white p-8 text-center text-[#787774]">
        {isDocente
          ? "Todavia no hay datos de tus alumnos. Aparecerán cuando completen trabajos practicos."
          : "No hay trayectorias registradas en esta cohorte aun."}
      </div>
    )
  }

  const sorted = [...trajectories].sort((a, b) => {
    const riskOrder: Record<string, number> = {
      empeorando: 0,
      estable: 1,
      insuficiente: 2,
      mejorando: 3,
    }
    return (riskOrder[a.progression_label] ?? 2) - (riskOrder[b.progression_label] ?? 2)
  })

  return (
    <div className="rounded-xl border border-[#EAEAEA] bg-white overflow-hidden">
      <div className="border-b border-[#EAEAEA] px-6 py-3">
        <h2 className="text-sm font-semibold text-[#111111]">
          {isDocente ? "Detalle por alumno" : "Trayectorias individuales"}
        </h2>
        <p className="text-xs text-[#787774]">
          {isDocente
            ? "ordenados por quienes necesitan mas atencion primero"
            : "ordenadas por riesgo (en riesgo primero)"}
        </p>
      </div>
      {isDocente && (
        <div className="px-6 py-2 border-b border-[#EAEAEA] bg-[#FAFAFA] flex items-center gap-4 text-xs text-[#787774]">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: "var(--color-appropriation-reflexiva)" }}
            />
            Autonomo
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: "var(--color-appropriation-superficial)" }}
            />
            Superficial
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: "var(--color-appropriation-delegacion)" }}
            />
            Depende de la IA
          </span>
        </div>
      )}
      {isDocente && Object.keys(entregaStats).length > 0 && (
        <div className="px-6 py-2 border-b border-[#EAEAEA] bg-[#FAFAFA] text-xs text-[#787774] flex items-center gap-4">
          <span className="font-mono">Pendientes = entregas esperando correccion</span>
        </div>
      )}
      <ul className="divide-y divide-[#EAEAEA]">
        {sorted.map((t) => {
          const stat = entregaStats[t.student_pseudonym]
          return (
            <TrajectoryRow
              key={t.student_pseudonym}
              trajectory={t}
              comisionId={comisionId}
              isDocente={isDocente}
              unidades={unidades}
              getToken={getToken}
              {...(stat !== undefined ? { entregaStat: stat } : {})}
            />
          )
        })}
      </ul>
    </div>
  )
}

function TrajectoryRow({
  trajectory,
  comisionId,
  isDocente,
  entregaStat,
  unidades,
  getToken,
}: {
  trajectory: StudentTrajectory
  comisionId: string
  isDocente: boolean
  entregaStat?: { pendientes: number; corregidas: number; nota_promedio: number | null }
  unidades: Unidad[]
  getToken: () => Promise<string | null>
}) {
  const [unidadExpanded, setUnidadExpanded] = useState(false)
  const [unidadData, setUnidadData] = useState<CIIEvolutionUnidad[] | null>(null)
  const [unidadLoading, setUnidadLoading] = useState(false)

  const fetchUnidadEvolucion = useCallback(() => {
    if (unidadData !== null || unidadLoading) return
    setUnidadLoading(true)
    getStudentCIIEvolution(trajectory.student_pseudonym, comisionId, getToken)
      .then((evo) => {
        setUnidadData(evo.evolution_per_unidad)
      })
      .catch(() => setUnidadData([]))
      .finally(() => setUnidadLoading(false))
  }, [trajectory.student_pseudonym, comisionId, getToken, unidadData, unidadLoading])

  function handleToggleUnidad(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!unidadExpanded) fetchUnidadEvolucion()
    setUnidadExpanded((v) => !v)
  }

  const progressionBg: Record<string, string> = {
    mejorando: "bg-green-50 text-green-800",
    estable: "bg-[#FAFAFA] text-[#787774]",
    empeorando: "bg-red-50 text-red-800",
    insuficiente: "bg-[#FAFAFA] text-[#787774]",
  }
  const badgeClass = progressionBg[trajectory.progression_label] ?? "bg-[#FAFAFA] text-[#787774]"
  const label = isDocente
    ? (PROGRESSION_DOCENTE[trajectory.progression_label] ?? trajectory.progression_label)
    : trajectory.progression_label

  // Solo mostrar el expand de unidades si hay unidades en esta comision
  const hasUnidades = unidades.length > 0

  return (
    <li>
      <Link
        data-testid="student-row"
        to="/student-longitudinal"
        search={{ comisionId, studentId: trajectory.student_pseudonym }}
        className="flex items-center gap-4 px-6 py-3 hover:bg-[#FAFAFA] transition-colors"
      >
        <div className="w-40 shrink-0">
          <div className="font-mono text-xs font-medium text-[#111111]">
            {isDocente
              ? studentShortLabel(trajectory.student_pseudonym)
              : trajectory.student_pseudonym.slice(0, 12)}
          </div>
          {!isDocente && (
            <div className="text-xs text-[#787774]">{trajectory.n_episodes} ep.</div>
          )}
          {isDocente && (
            <div className="text-xs text-[#787774]">
              {trajectory.n_episodes} trabajo{trajectory.n_episodes !== 1 ? "s" : ""}
            </div>
          )}
        </div>
        <div className="flex-1 flex items-center gap-1">
          <TrajectoryDots points={trajectory.points} isDocente={isDocente} />
        </div>
        {/* Entrega stats — solo si hay datos y el usuario es docente */}
        {isDocente && entregaStat && (
          <div className="shrink-0 flex items-center gap-2 text-xs font-mono">
            {entregaStat.pendientes > 0 && (
              <span
                data-testid="entrega-pendiente-badge"
                className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700"
                title="Entregas pendientes de correccion"
              >
                {entregaStat.pendientes}p
              </span>
            )}
            {entregaStat.corregidas > 0 && (
              <span
                data-testid="entrega-corregida-badge"
                className="px-1.5 py-0.5 rounded bg-green-50 text-green-700"
                title="Entregas corregidas"
              >
                {entregaStat.corregidas}c
              </span>
            )}
          </div>
        )}
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${badgeClass}`}>
          {label}
        </span>
        {hasUnidades && (
          <button
            type="button"
            onClick={handleToggleUnidad}
            className="shrink-0 p-1 rounded text-[#787774] hover:text-[#111111] hover:bg-[#EAEAEA] transition-colors"
            title={unidadExpanded ? "Ocultar desglose por unidad" : "Ver desglose por unidad"}
            aria-label={unidadExpanded ? "Ocultar desglose por unidad" : "Ver desglose por unidad"}
          >
            {unidadExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        )}
        {!hasUnidades && (
          <span aria-hidden="true" className="text-[#EAEAEA] shrink-0">
            ›
          </span>
        )}
      </Link>

      {/* Desglose por unidad — expandible */}
      {hasUnidades && unidadExpanded && (
        <div className="border-t border-[#EAEAEA] px-6 py-3 bg-[#FAFAFA]">
          {unidadLoading && (
            <span className="text-xs text-[#787774]">Cargando evolucion por unidad...</span>
          )}
          {!unidadLoading && unidadData !== null && unidadData.length === 0 && (
            <span className="text-xs text-[#787774]">
              {isDocente
                ? "El alumno no tiene episodios en unidades todavia."
                : "Sin episodios clasificados en unidades para este estudiante."}
            </span>
          )}
          {!unidadLoading && unidadData !== null && unidadData.length > 0 && (
            <UnidadBreakdown entries={unidadData} isDocente={isDocente} />
          )}
        </div>
      )}
    </li>
  )
}

// ── UnidadBreakdown ────────────────────────────────────────────────────
// Desglose por unidad expandido en el row de un estudiante.

const SLOPE_ARROW: Record<string, string> = {
  mejorando: "↑",
  estable: "→",
  empeorando: "↓",
  insuficiente: "?",
}
const SLOPE_COLOR: Record<string, string> = {
  mejorando: "text-[var(--color-success)]",
  estable: "text-[#787774]",
  empeorando: "text-[var(--color-danger)]",
  insuficiente: "text-[#EAEAEA]",
}

function slopeToTrend(slope: number | null): "mejorando" | "estable" | "empeorando" | "insuficiente" {
  if (slope === null) return "insuficiente"
  if (slope > 0.1) return "mejorando"
  if (slope < -0.1) return "empeorando"
  return "estable"
}

function UnidadBreakdown({
  entries,
  isDocente,
}: {
  entries: CIIEvolutionUnidad[]
  isDocente: boolean
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-[#787774] uppercase tracking-wide mb-2">
        {isDocente ? "Por tema" : "Evolucion por unidad"}
      </div>
      <div className="flex flex-wrap gap-2">
        {entries.map((entry) => {
          const trend = slopeToTrend(entry.insufficient_data ? null : entry.slope)
          const arrow = SLOPE_ARROW[trend] ?? "?"
          const color = SLOPE_COLOR[trend] ?? "text-[#787774]"
          const isSinUnidad = entry.unidad_id === "sin_unidad"
          return (
            <div
              key={entry.unidad_id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#EAEAEA] bg-white px-2.5 py-1.5 text-xs"
              title={entry.insufficient_data ? "Datos insuficientes (min. 3 episodios)" : undefined}
            >
              <span className={`font-semibold shrink-0 ${color}`}>{arrow}</span>
              <span className={isSinUnidad ? "text-[#787774] italic" : "text-[#111111]"}>
                {entry.unidad_nombre}
              </span>
              <span className="text-[#787774]">
                {entry.n_episodes}ep
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TrajectoryDots({
  points,
  isDocente,
}: {
  points: Array<{ appropriation: string; classified_at: string; episode_id: string }>
  isDocente: boolean
}) {
  if (points.length === 0) {
    return <span className="text-xs text-[#787774]">Sin clasificaciones</span>
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {points.map((p) => (
        <span
          key={p.episode_id}
          className="inline-block w-3 h-3 rounded-full shrink-0"
          style={{
            backgroundColor: LABEL_COLOR_VAR[p.appropriation] ?? "var(--color-level-meta)",
          }}
          title={
            isDocente
              ? `${new Date(p.classified_at).toLocaleDateString("es-AR")} · ${APPROPRIATION_DOCENTE[p.appropriation] ?? p.appropriation}`
              : `${new Date(p.classified_at).toLocaleDateString()} · ${p.appropriation}`
          }
          aria-label={
            isDocente
              ? (APPROPRIATION_DOCENTE[p.appropriation] ?? p.appropriation)
              : p.appropriation
          }
        />
      ))}
    </div>
  )
}
