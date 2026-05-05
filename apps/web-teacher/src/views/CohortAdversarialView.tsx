/**
 * Vista de eventos adversos por cohorte (ADR-019, RN-129).
 *
 * Cumple Seccion 8.5 + 17.8 de la tesis: visibilidad pedagogica para el
 * docente sobre intentos de jailbreak / persuasion / prompt injection
 * detectados en los prompts de los estudiantes de su comision.
 *
 * Drill-down (D7 brief): top estudiantes -> /student-longitudinal,
 * eventos recientes -> /episode-n-level. Conecta intento adverso con
 * perfil cognitivo + episodio especifico sin endpoint nuevo.
 *
 * Tokens: CATEGORY_COLORS y SEVERITY_COLORS migrados a tokens compartidos
 * (var(--color-adversarial-*) y var(--color-severity-*)). Resuelve F4.
 */
import { Badge, PageContainer, StateMessage } from "@platform/ui"
import { Link } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import {
  type AdversarialRecentEvent,
  type CohortAdversarialEvents,
  getCohortAdversarialEvents,
} from "../lib/api"
import { helpContent } from "../utils/helpContent"

interface Props {
  getToken: () => Promise<string | null>
  /** Si viene, se selecciona automaticamente al montar (drill-down). */
  initialComisionId?: string
}

const CATEGORY_LABELS: Record<string, string> = {
  jailbreak_indirect: "Jailbreak indirecto",
  jailbreak_substitution: "Jailbreak (sustitución)",
  jailbreak_fiction: "Jailbreak (ficción)",
  persuasion_urgency: "Persuasión por urgencia",
  prompt_injection: "Prompt injection",
}

const CATEGORY_TOKEN_VAR: Record<string, string> = {
  jailbreak_indirect: "--color-adversarial-jailbreak-indirect",
  jailbreak_substitution: "--color-adversarial-jailbreak-substitution",
  jailbreak_fiction: "--color-adversarial-jailbreak-fiction",
  persuasion_urgency: "--color-adversarial-persuasion-urgency",
  prompt_injection: "--color-adversarial-prompt-injection",
}

const SEVERITY_TOKEN_VAR: Record<string, string> = {
  "1": "--color-severity-1",
  "2": "--color-severity-2",
  "3": "--color-severity-3",
  "4": "--color-severity-4",
  "5": "--color-severity-5",
}

const CATEGORY_FALLBACK: Record<string, string> = {
  jailbreak_indirect: "#a855f7",
  jailbreak_substitution: "#dc2626",
  jailbreak_fiction: "#06b6d4",
  persuasion_urgency: "#f59e0b",
  prompt_injection: "#7f1d1d",
}

const SEVERITY_FALLBACK: Record<string, string> = {
  "1": "#94a3b8",
  "2": "#fbbf24",
  "3": "#fb923c",
  "4": "#ef4444",
  "5": "#7f1d1d",
}

function resolveCssVar(varName: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  const v = window.getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return v || fallback
}

function CategoryBars({
  counts,
  colors,
}: { counts: Record<string, number>; colors: Record<string, string> }) {
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
                  backgroundColor: colors[cat] ?? "#64748b",
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

function SeverityBars({
  counts,
  colors,
}: { counts: Record<string, number>; colors: Record<string, string> }) {
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
                  backgroundColor: colors[sev],
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

function RecentEventRow({
  event,
  catColors,
  sevColors,
}: {
  event: AdversarialRecentEvent
  catColors: Record<string, string>
  sevColors: Record<string, string>
}) {
  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <td className="py-2 pr-3 align-top text-xs text-slate-500 whitespace-nowrap">
        {event.ts.slice(0, 19).replace("T", " ")}
      </td>
      <td className="py-2 pr-3 align-top">
        <span
          className="inline-block rounded px-2 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: catColors[event.category] ?? "#64748b" }}
        >
          {CATEGORY_LABELS[event.category] ?? event.category}
        </span>
      </td>
      <td className="py-2 pr-3 align-top">
        <span
          className="inline-block rounded px-2 py-0.5 text-xs font-bold text-white"
          style={{ backgroundColor: sevColors[String(event.severity)] }}
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
      <td className="py-2 pl-3 align-top text-right whitespace-nowrap">
        <Link
          to="/episode-n-level"
          search={{ episodeId: event.episode_id }}
          className="text-xs text-[var(--color-accent-brand)] hover:underline"
        >
          ver episodio →
        </Link>
      </td>
    </tr>
  )
}

export function CohortAdversarialView({ getToken, initialComisionId }: Props) {
  const comisionId = initialComisionId ?? null
  const [data, setData] = useState<CohortAdversarialEvents | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resolvemos los colores via tokens compartidos. CSS vars se aplicarian
  // automaticamente con var(...) inline, pero los SVG/style backgroundColor
  // necesitan strings concretos -> caemos a hex fallback en jsdom.
  const catColors = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(CATEGORY_TOKEN_VAR).map(([k, v]) => [
          k,
          resolveCssVar(v, CATEGORY_FALLBACK[k] ?? "#64748b"),
        ]),
      ),
    [],
  )
  const sevColors = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(SEVERITY_TOKEN_VAR).map(([k, v]) => [
          k,
          resolveCssVar(v, SEVERITY_FALLBACK[k] ?? "#64748b"),
        ]),
      ),
    [],
  )

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
      description="Visibilidad pedagógica de los matches del corpus de guardrails (ADR-019, Sección 8.5 de la tesis). Detección preprocesamiento del prompt, el flujo NO se bloquea."
      helpContent={helpContent.cohortAdversarial}
    >
      <div className="space-y-6">
        {comisionId && (
          <div className="text-xs">
            <Link
              to="/progression"
              search={{ comisionId }}
              className="text-slate-500 hover:text-slate-700"
            >
              ← Volver a la cohorte
            </Link>
          </div>
        )}

        {!comisionId && !loading && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
            Eligi una comisión desde la barra lateral para ver los intentos adversos detectados.
          </div>
        )}

        {loading && <StateMessage variant="loading" title="Cargando eventos adversos..." />}

        {error && (
          <StateMessage
            variant="error"
            title="Error consultando la cohorte"
            description={error}
          />
        )}

        {data && !loading && (
          <>
            {/* Resumen denso (no 3 KPI cards). Resuelve F5. */}
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
              <p className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-1">
                Resumen
              </p>
              <p>
                <strong>{data.n_events_total}</strong> eventos totales
                <span className="text-slate-400 mx-2">·</span>
                <strong>{Object.keys(data.counts_by_category).length}</strong> categorias
                observadas
                <span className="text-slate-400 mx-2">·</span>
                <strong>{Object.keys(data.counts_by_student).length}</strong> estudiantes con
                matches
              </p>
            </div>

            {/* Categorias + severidades unificados (1 card en vez de 2). Resuelve F5. */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-5">
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-3">
                  Por categoria
                </div>
                <CategoryBars counts={data.counts_by_category} colors={catColors} />
              </div>
              <div className="border-t border-slate-100 pt-4">
                <div className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-3">
                  Por severidad (1-5, ordinal)
                </div>
                <SeverityBars counts={data.counts_by_severity} colors={sevColors} />
              </div>
            </div>

            {data.top_students_by_n_events.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-3">
                  Top estudiantes por número de eventos
                </div>
                <ul className="divide-y divide-slate-100">
                  {data.top_students_by_n_events.map((s) => (
                    <li key={s.student_pseudonym}>
                      {comisionId ? (
                        <Link
                          to="/student-longitudinal"
                          search={{ comisionId, studentId: s.student_pseudonym }}
                          className="flex items-center justify-between px-2 py-2 hover:bg-slate-50"
                          data-testid="adversarial-top-student-link"
                        >
                          <span className="font-mono text-xs text-slate-700">
                            {s.student_pseudonym.slice(0, 8)}...
                            {s.student_pseudonym.slice(-4)}
                          </span>
                          <span className="flex items-center gap-2">
                            <Badge className="bg-slate-700 text-white">{s.n_events} ev.</Badge>
                            <span aria-hidden="true" className="text-slate-300">
                              ›
                            </span>
                          </span>
                        </Link>
                      ) : (
                        <div className="flex items-center justify-between px-2 py-2">
                          <span className="font-mono text-xs text-slate-700">
                            {s.student_pseudonym.slice(0, 8)}...
                            {s.student_pseudonym.slice(-4)}
                          </span>
                          <Badge className="bg-slate-700 text-white">{s.n_events} ev.</Badge>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
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
                        <th className="px-3 py-2 font-medium text-right">Drill-down</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_events.map((ev, idx) => (
                        <RecentEventRow
                          key={`${ev.episode_id}-${idx}`}
                          event={ev}
                          catColors={catColors}
                          sevColors={sevColors}
                        />
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
