import { PageContainer } from "@platform/ui"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { helpContent } from "../utils/helpContent"

/**
 * Estados que el endpoint /health del api-gateway puede devolver. Mapeamos a
 * etiquetas en español + un dot de color (semantic tokens) para que el home
 * deje de mostrar "unknown" (que era resultado de pegarle a /api/ con auth).
 */
const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  ready: { label: "Operativo", color: "var(--color-success)" },
  degraded: { label: "Degradado", color: "var(--color-warning)" },
  error: { label: "Caído", color: "var(--color-danger)" },
}

interface KpiState {
  value: number | null
  loading: boolean
  error: string | null
}

const initialKpi: KpiState = { value: null, loading: true, error: null }

interface KpiCardProps {
  label: string
  state: KpiState
  fallbackTooltip?: string
}

function KpiCard({ label, state, fallbackTooltip }: KpiCardProps): ReactNode {
  const display = state.loading
    ? "..."
    : state.error || state.value === null
      ? "—"
      : state.value.toLocaleString()
  const tooltip = state.error
    ? "Sin datos disponibles"
    : state.value === null && !state.loading
      ? fallbackTooltip
      : undefined
  const titleProp = tooltip ? { title: tooltip } : {}
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6" {...titleProp}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-3xl font-semibold mt-2 tabular-nums">{display}</div>
    </div>
  )
}

async function fetchCount(url: string): Promise<number> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const body = await r.json()
  if (Array.isArray(body)) return body.length
  if (body && typeof body === "object") {
    // La API académica devuelve `{data, meta}`. Algunos otros endpoints (bus
    // futuro o normalizados aguas arriba) podrían devolver `{items, ...}`.
    // Soportamos ambos shapes + array directo para que la card no caiga a `—`
    // por una diferencia menor de envelope.
    const asData = body as { data?: unknown; items?: unknown }
    if (Array.isArray(asData.data)) return asData.data.length
    if (Array.isArray(asData.items)) return asData.items.length
  }
  throw new Error("Unexpected response shape")
}

export function HomePage(): ReactNode {
  const [apiStatus, setApiStatus] = useState<string>("verificando...")
  const [universidades, setUniversidades] = useState<KpiState>(initialKpi)
  const [comisiones, setComisiones] = useState<KpiState>(initialKpi)
  // Episodios cerrados: requiere comisión específica (`/cohort/{id}/progression`).
  // En la HomePage no hay cohorte seleccionada — cae siempre a "—" con tooltip
  // explicativo. Aceptable porque la HomePage es vista global, no por-cohorte.
  const episodios: KpiState = { value: null, loading: false, error: null }

  useEffect(() => {
    fetch("/health")
      .then((r) => r.json())
      .then((d) => setApiStatus(d.status ?? "unknown"))
      .catch(() => setApiStatus("no responde"))
  }, [])

  useEffect(() => {
    fetchCount("/api/v1/universidades")
      .then((n) => setUniversidades({ value: n, loading: false, error: null }))
      .catch((e) => setUniversidades({ value: null, loading: false, error: String(e) }))
  }, [])

  useEffect(() => {
    fetchCount("/api/v1/comisiones?estado=activa")
      .then((n) => setComisiones({ value: n, loading: false, error: null }))
      .catch((e) => setComisiones({ value: null, loading: false, error: String(e) }))
  }, [])

  const known = STATUS_LABEL[apiStatus]

  return (
    <PageContainer
      title="Bienvenido"
      description="Panel de administración institucional"
      helpContent={helpContent.home}
    >
      <div className="space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h3 className="font-medium mb-3">Estado de la plataforma</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-slate-500">API Gateway</dt>
            <dd>
              {known ? (
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: known.color }}
                  />
                  {known.label}
                </span>
              ) : (
                <span className="font-mono">{apiStatus}</span>
              )}
            </dd>
            <dt className="text-slate-500">Fase</dt>
            <dd className="font-mono">F1 — Dominio académico</dd>
          </dl>
        </section>

        <section>
          <h3 className="font-medium mb-3">Plataforma en números</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiCard label="Universidades" state={universidades} />
            <KpiCard label="Comisiones activas" state={comisiones} />
            <KpiCard
              label="Episodios cerrados (últimos 7 días)"
              state={episodios}
              fallbackTooltip="Seleccioná una comisión para ver este KPI"
            />
          </div>
        </section>
      </div>
    </PageContainer>
  )
}
