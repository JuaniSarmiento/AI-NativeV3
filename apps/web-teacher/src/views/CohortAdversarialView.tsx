/**
 * Vista de eventos adversos por cohorte (ADR-019, RN-129).
 *
 * Cumple Sección 8.5 + 17.8 de la tesis: visibilidad pedagógica para el
 * docente sobre intentos de jailbreak / persuasión / prompt injection
 * detectados en los prompts de los estudiantes de su comisión.
 *
 * Visualización: cards de totales + barras de categorías + barras de severidad
 * + ranking de estudiantes + lista de eventos recientes con matched_text.
 */
import { Badge, PageContainer } from "@platform/ui"
import { useEffect, useState } from "react"
import { ComisionSelector } from "../components/ComisionSelector"
import {
  type AdversarialRecentEvent,
  type CohortAdversarialEvents,
  getCohortAdversarialEvents,
} from "../lib/api"
import { helpContent } from "../utils/helpContent"

interface Props {
  getToken: () => Promise<string | null>
  /** Si viene, se selecciona automáticamente al montar (drill-down). */
  initialComisionId?: string
}

const CATEGORY_LABELS: Record<string, string> = {
  jailbreak_indirect: "Jailbreak indirecto",
  jailbreak_substitution: "Jailbreak (sustitución)",
  jailbreak_fiction: "Jailbreak (ficción)",
  persuasion_urgency: "Persuasión por urgencia",
  prompt_injection: "Prompt injection",
}

const CATEGORY_COLORS: Record<string, string> = {
  jailbreak_indirect: "#a855f7", // purple-500
  jailbreak_substitution: "#dc2626", // red-600
  jailbreak_fiction: "#06b6d4", // cyan-500
  persuasion_urgency: "#f59e0b", // amber-500
  prompt_injection: "#7f1d1d", // red-900 (más severo)
}

const SEVERITY_COLORS: Record<string, string> = {
  "1": "#94a3b8", // slate-400
  "2": "#fbbf24", // amber-400
  "3": "#fb923c", // orange-400
  "4": "#ef4444", // red-500
  "5": "#7f1d1d", // red-900
}

function CategoryBars({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
        Sin eventos adversos detectados en la cohorte.
      </div>
    )
  }
  const max = Math.max(...entries.map(([, v]) => v))
  return (
    <div className="space-y-2">
      {entries.map(([cat, count]) => {
        const ratio = max > 0 ? count / max : 0
        return (
          <div key={cat} className="flex items-center gap-3">
            <div className="w-48 shrink-0 text-sm text-slate-700 truncate">
              {CATEGORY_LABELS[cat] ?? cat}
            </div>
            <div className="flex-1 h-6 rounded-md bg-slate-100 overflow-hidden">
              <div
                className="h-full flex items-center justify-end px-2 text-xs font-medium text-white"
                style={{
                  width: `${ratio * 100}%`,
                  backgroundColor: CATEGORY_COLORS[cat] ?? "#64748b",
                }}
              >
                {ratio > 0.15 ? count : ""}
              </div>
            </div>
            <div className="w-12 shrink-0 text-right text-sm font-medium text-slate-900">
              {count}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SeverityBars({ counts }: { counts: Record<string, number> }) {
  const max = Math.max(...Object.values(counts), 1)
  return (
    <div className="grid grid-cols-5 gap-2">
      {(["1", "2", "3", "4", "5"] as const).map((sev) => {
        const count = counts[sev] ?? 0
        const ratio = count / max
        return (
          <div key={sev} className="flex flex-col items-center gap-1">
            <div className="text-xs font-medium text-slate-500">Sev. {sev}</div>
            <div className="h-24 w-full flex items-end rounded-md bg-slate-100 overflow-hidden">
              <div
                className="w-full transition-all"
                style={{
                  height: `${ratio * 100}%`,
                  backgroundColor: SEVERITY_COLORS[sev],
                }}
              />
            </div>
            <div className="text-sm font-semibold text-slate-900">{count}</div>
          </div>
        )
      })}
    </div>
  )
}

function RecentEventRow({ event }: { event: AdversarialRecentEvent }) {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="py-2 pr-3 align-top text-xs text-slate-500 whitespace-nowrap">
        {event.ts.slice(0, 19).replace("T", " ")}
      </td>
      <td className="py-2 pr-3 align-top">
        <span
          className="inline-block rounded px-2 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: CATEGORY_COLORS[event.category] ?? "#64748b" }}
        >
          {CATEGORY_LABELS[event.category] ?? event.category}
        </span>
      </td>
      <td className="py-2 pr-3 align-top">
        <span
          className="inline-block rounded px-2 py-0.5 text-xs font-bold text-white"
          style={{ backgroundColor: SEVERITY_COLORS[String(event.severity)] }}
        >
          {event.severity}
        </span>
      </td>
      <td className="py-2 pr-3 align-top font-mono text-xs text-slate-700">
        {event.student_pseudonym.slice(0, 8)}...
      </td>
      <td className="py-2 align-top">
        <code className="block text-xs text-slate-700 bg-slate-50 rounded px-2 py-1 break-all">
          {event.matched_text}
        </code>
      </td>
    </tr>
  )
}

export function CohortAdversarialView({ getToken, initialComisionId }: Props) {
  const [comisionId, setComisionId] = useState<string | null>(initialComisionId ?? null)
  const [data, setData] = useState<CohortAdversarialEvents | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!comisionId) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    let cancelled = false
    getCohortAdversarialEvents(comisionId, getToken)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [comisionId, getToken])

  return (
    <PageContainer
      title="Intentos adversos detectados"
      description="Visibilidad pedagógica de los matches del corpus de guardrails (ADR-019, Sección 8.5 de la tesis). Detección preprocesamiento del prompt — el flujo NO se bloquea."
      helpContent={helpContent.cohortAdversarial}
    >
      <div className="space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm font-medium text-slate-700 mb-2">Comisión a inspeccionar</div>
          <ComisionSelector value={comisionId} onChange={setComisionId} />
        </div>

        {loading && (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Cargando eventos adversos...
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="font-medium">Error consultando la cohorte</div>
            <div className="mt-1 font-mono text-xs">{error}</div>
          </div>
        )}

        {data && !loading && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  Eventos totales
                </div>
                <div className="mt-1 text-3xl font-semibold text-slate-900">
                  {data.n_events_total}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  Categorías observadas
                </div>
                <div className="mt-1 text-3xl font-semibold text-slate-900">
                  {Object.keys(data.counts_by_category).length}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  Estudiantes con matches
                </div>
                <div className="mt-1 text-3xl font-semibold text-slate-900">
                  {Object.keys(data.counts_by_student).length}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-sm font-medium text-slate-700 mb-3">Por categoría</div>
                <CategoryBars counts={data.counts_by_category} />
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-sm font-medium text-slate-700 mb-3">
                  Por severidad (1-5, ordinal)
                </div>
                <SeverityBars counts={data.counts_by_severity} />
              </div>
            </div>

            {data.top_students_by_n_events.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-sm font-medium text-slate-700 mb-3">
                  Top estudiantes (más eventos)
                </div>
                <div className="space-y-2">
                  {data.top_students_by_n_events.map((s) => (
                    <div
                      key={s.student_pseudonym}
                      className="flex items-center justify-between rounded border border-slate-100 px-3 py-2"
                    >
                      <span className="font-mono text-xs text-slate-700">
                        {s.student_pseudonym.slice(0, 8)}...{s.student_pseudonym.slice(-4)}
                      </span>
                      <Badge className="bg-slate-700 text-white">{s.n_events} ev.</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.recent_events.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                  Eventos recientes ({data.recent_events.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-medium">Timestamp</th>
                        <th className="px-3 py-2 font-medium">Categoría</th>
                        <th className="px-3 py-2 font-medium">Sev.</th>
                        <th className="px-3 py-2 font-medium">Estudiante</th>
                        <th className="px-3 py-2 font-medium">Texto matcheado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_events.map((ev, idx) => (
                        <RecentEventRow key={`${ev.episode_id}-${idx}`} event={ev} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {data.n_events_total === 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center">
                <div className="text-emerald-800 font-medium">
                  Sin eventos adversos en esta cohorte.
                </div>
                <div className="mt-2 text-sm text-emerald-700">
                  Puede significar (a) los estudiantes no intentaron jailbreak, (b) los regex del
                  corpus v1.1.0 no detectan los intentos reales, o (c) el modo dev no tiene CTR
                  conectado. Ver <code className="font-mono">RN-129</code> para limitaciones
                  declaradas.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PageContainer>
  )
}
