/**
 * Vista docente/admin de clasificaciones N4 agregadas por comisión.
 *
 * Consume GET /api/v1/classifications/aggregated del classifier-service.
 * Muestra distribución, evolución temporal y promedios de las 3 coherencias.
 */
import { PageContainer } from "@platform/ui"
import { type ReactNode, useEffect, useState } from "react"
import { helpContent } from "../utils/helpContent"

type Appropriation = "delegacion_pasiva" | "apropiacion_superficial" | "apropiacion_reflexiva"

interface AggregatedStats {
  comision_id: string
  period_days: number
  total_episodes: number
  distribution: Record<Appropriation, number>
  avg_ct_summary: number | null
  avg_ccd_mean: number | null
  avg_ccd_orphan_ratio: number | null
  avg_cii_stability: number | null
  avg_cii_evolution: number | null
  timeseries: { date: string; counts: Record<Appropriation, number> }[]
}

// TODO(F9): reemplazar por un ComisionSelector real (como el que tiene web-teacher)
// cuando el JWT de Keycloak traiga `comisiones_activas` como claim. Hoy es dev-only
// y matchea el UUID de scripts/seed-demo-data.py (COMISION_ID).
const DEMO_COMISION_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

/** Headers dev con identidad mock. En F5 se reemplaza por JWT. */
function devHeaders(): Record<string, string> {
  return {
    "X-User-Id": "10000000-0000-0000-0000-000000000001",
    "X-Tenant-Id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "X-User-Email": "docente@uni-demo.edu",
    "X-User-Roles": "docente_admin",
  }
}

export function ClasificacionesPage(): ReactNode {
  const [stats, setStats] = useState<AggregatedStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [periodDays, setPeriodDays] = useState(30)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(
      `/api/v1/classifications/aggregated?comision_id=${DEMO_COMISION_ID}&period_days=${periodDays}`,
      { headers: devHeaders() },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: AggregatedStats) => {
        if (!cancelled) {
          setStats(data)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(`Error cargando: ${e.message}`)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [periodDays])

  if (loading) {
    return <p className="text-sm text-slate-500">Cargando clasificaciones...</p>
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 text-red-900 p-4">
        <p className="font-medium">No se pudo cargar</p>
        <p className="text-sm mt-1">{error}</p>
        <p className="text-xs mt-2 text-red-700">
          Asegurate de que classifier-service esté corriendo en el puerto 8008 y que haya
          clasificaciones persistidas para la comisión demo.
        </p>
      </div>
    )
  }

  if (!stats) return null

  return (
    <PageContainer
      title="Clasificaciones N4"
      description={`Ultimos ${stats.period_days} dias · ${stats.total_episodes} episodios cerrados`}
      helpContent={helpContent.clasificaciones}
    >
      <div className="space-y-6">
        <div className="flex justify-end">
          <select
            value={periodDays}
            onChange={(e) => setPeriodDays(Number(e.target.value))}
            className="rounded border border-slate-300 px-3 py-1 text-sm"
          >
            <option value={7}>últimos 7 días</option>
            <option value={30}>últimos 30 días</option>
            <option value={90}>últimos 90 días</option>
          </select>
        </div>

        {stats.total_episodes === 0 ? (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-8 text-center">
            <p className="text-slate-500">Aún no hay clasificaciones en el período seleccionado.</p>
          </div>
        ) : (
          <>
            {/* Distribución por tipo */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <DistributionCard
                label="Delegación pasiva"
                count={stats.distribution.delegacion_pasiva}
                total={stats.total_episodes}
                color="red"
                emoji="⚠️"
              />
              <DistributionCard
                label="Apropiación superficial"
                count={stats.distribution.apropiacion_superficial}
                total={stats.total_episodes}
                color="yellow"
                emoji="🤔"
              />
              <DistributionCard
                label="Apropiación reflexiva"
                count={stats.distribution.apropiacion_reflexiva}
                total={stats.total_episodes}
                color="green"
                emoji="🌟"
              />
            </section>

            {/* Promedios de las 3 coherencias */}
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold uppercase text-slate-500 mb-3">
                Promedios de las tres coherencias
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <AverageMetric title="Coherencia Temporal" value={stats.avg_ct_summary} />
                <AverageMetric title="Código ↔ Discurso" value={stats.avg_ccd_mean} />
                <AverageMetric title="Inter-Iteración (estab.)" value={stats.avg_cii_stability} />
              </div>
            </section>

            {/* Timeseries */}
            {stats.timeseries.length > 0 && (
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-semibold uppercase text-slate-500 mb-4">
                  Evolución temporal
                </h2>
                <Timeseries data={stats.timeseries} />
              </section>
            )}
          </>
        )}
      </div>
    </PageContainer>
  )
}

function DistributionCard({
  label,
  count,
  total,
  color,
  emoji,
}: {
  label: string
  count: number
  total: number
  color: "red" | "yellow" | "green"
  emoji: string
}): ReactNode {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  const bg = {
    red: "bg-red-50 border-red-200",
    yellow: "bg-yellow-50 border-yellow-200",
    green: "bg-green-50 border-green-200",
  }[color]
  const textColor = {
    red: "text-red-900",
    yellow: "text-yellow-900",
    green: "text-green-900",
  }[color]

  return (
    <div className={`rounded-lg border p-4 ${bg} ${textColor}`}>
      <div className="text-2xl mb-1">{emoji}</div>
      <div className="font-medium text-sm">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold">{count}</span>
        <span className="text-sm opacity-70">
          de {total} ({pct}%)
        </span>
      </div>
    </div>
  )
}

function AverageMetric({ title, value }: { title: string; value: number | null }): ReactNode {
  if (value == null) {
    return (
      <div>
        <p className="text-xs text-slate-500">{title}</p>
        <p className="text-sm text-slate-400 mt-1">sin datos</p>
      </div>
    )
  }
  const pct = Math.round(value * 100)
  const color = pct > 60 ? "bg-green-500" : pct > 40 ? "bg-yellow-500" : "bg-red-500"
  return (
    <div>
      <p className="text-xs text-slate-500">{title}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="font-mono text-xl">{value.toFixed(2)}</span>
        <span className="text-xs text-slate-400">{pct}%</span>
      </div>
      <div className="mt-2 h-2 bg-slate-200 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Timeseries({
  data,
}: {
  data: { date: string; counts: Record<Appropriation, number> }[]
}): ReactNode {
  const max = Math.max(
    ...data.map(
      (d) =>
        d.counts.delegacion_pasiva +
        d.counts.apropiacion_superficial +
        d.counts.apropiacion_reflexiva,
    ),
    1,
  )

  return (
    <div>
      <div className="flex items-end gap-1 h-48">
        {data.map((d) => {
          const total =
            d.counts.delegacion_pasiva +
            d.counts.apropiacion_superficial +
            d.counts.apropiacion_reflexiva
          const totalPct = (total / max) * 100
          const rPct = total > 0 ? (d.counts.delegacion_pasiva / total) * 100 : 0
          const yPct = total > 0 ? (d.counts.apropiacion_superficial / total) * 100 : 0
          const gPct = total > 0 ? (d.counts.apropiacion_reflexiva / total) * 100 : 0

          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full flex flex-col-reverse rounded overflow-hidden"
                style={{ height: `${totalPct}%`, minHeight: "4px" }}
                title={`${d.date}: ${total} episodios`}
              >
                <div className="bg-red-400" style={{ height: `${rPct}%` }} />
                <div className="bg-yellow-400" style={{ height: `${yPct}%` }} />
                <div className="bg-green-500" style={{ height: `${gPct}%` }} />
              </div>
              <span className="text-xs text-slate-400 rotate-45 origin-top-left whitespace-nowrap mt-2">
                {d.date.slice(5)}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex gap-4 mt-6 text-xs text-slate-600">
        <LegendDot color="bg-green-500" label="Reflexiva" />
        <LegendDot color="bg-yellow-400" label="Superficial" />
        <LegendDot color="bg-red-400" label="Delegación" />
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }): ReactNode {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-3 h-3 rounded ${color}`} />
      <span>{label}</span>
    </div>
  )
}
