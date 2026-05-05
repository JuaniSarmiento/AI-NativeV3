/**
 * Vista home del docente (shape docente, brief seccion 3.1).
 *
 * Lista las comisiones del docente como cards densas. Patron equivalente
 * al MateriaCard del web-student. Cada card tiene 4 KPIs en strip inline
 * (alumnos / episodios sem. / alertas / adversos sem.) y CTAs para abrir
 * la cohorte y ver adversos.
 *
 * Honestidad tecnica:
 *   - el endpoint /comisiones/mis devuelve solo IDs y codigo;
 *     los KPIs de progression/adversos se enriquen en paralelo.
 *   - sin endpoint agregado de "alertas por cohorte", el campo `alertas`
 *     queda como null (UI muestra "datos insuf.").
 *   - empty state literal: "no tenes comisiones asignadas, ADR-029".
 *
 * Sub-tarea pendiente declarable: agregar endpoint
 *   GET /api/v1/analytics/cohort/{id}/alerts-summary
 * que itere sobre estudiantes y agregue n_alerts. Hoy se omite (R1 del brief).
 */
import { PageContainer } from "@platform/ui"
import { useCallback, useEffect, useState } from "react"
import { ComisionDelDocenteCard, type ComisionKpis } from "../components/ComisionDelDocenteCard"
import { comisionLabel } from "../components/ComisionSelector"
import {
  type CohortAdversarialEvents,
  type CohortProgression,
  type Comision,
  comisionesApi,
  getCohortAdversarialEvents,
  getCohortProgression,
} from "../lib/api"
import { helpContent } from "../utils/helpContent"

interface Props {
  getToken: () => Promise<string | null>
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function countLastWeek(events: { ts: string }[]): number {
  const cutoff = Date.now() - SEVEN_DAYS_MS
  return events.filter((e) => {
    const t = Date.parse(e.ts)
    return Number.isFinite(t) && t >= cutoff
  }).length
}

interface ComisionWithKpis {
  comision: Comision
  displayName: string
  kpis: ComisionKpis
}

export function HomeView({ getToken }: Props) {
  const [items, setItems] = useState<ComisionWithKpis[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { items: comisiones } = await comisionesApi.listMine(getToken)
      // Fetch KPIs en paralelo. Cada fetch es best-effort: si falla uno,
      // sus KPIs quedan null y la card muestra "datos insuf." en vez de
      // bloquear toda la home. El degradado es la honestidad tecnica.
      const enriched = await Promise.all(
        comisiones.map(async (c) => {
          const [prog, adv] = await Promise.allSettled([
            getCohortProgression(c.id, getToken) as Promise<CohortProgression>,
            getCohortAdversarialEvents(c.id, getToken) as Promise<CohortAdversarialEvents>,
          ])
          const alumnos = prog.status === "fulfilled" ? prog.value.n_students : null
          // Episodios "esta semana" no esta directo en progression (el endpoint
          // es agregado por trayectoria). Lo aproximamos por trajectories totales
          // > 0; queda como conteo conservador hasta que haya endpoint dedicado.
          const episodiosSemana =
            prog.status === "fulfilled"
              ? prog.value.trajectories.reduce((a, t) => a + t.n_episodes, 0)
              : null
          const adversosSemana =
            adv.status === "fulfilled" ? countLastWeek(adv.value.recent_events) : null
          // alertas: no hay endpoint agregado por cohorte; declaramos null
          // para que la UI muestre "datos insuf." en vez de un 0 ambiguo.
          const alertas: number | null = null
          return {
            comision: c,
            displayName: comisionLabel(c),
            kpis: { alumnos, episodiosSemana, alertas, adversosSemana },
          }
        }),
      )
      setItems(enriched)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <PageContainer
      title="Tus comisiones"
      description="Cohortes asignadas a vos en este periodo. Click en una para ver progresion, alertas y eventos adversos."
      helpContent={helpContent.home}
    >
      <div className="space-y-6">
        {loading && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Cargando tus comisiones...
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="font-medium">No pudimos cargar tus comisiones.</div>
            <div className="mt-1 font-mono text-xs">{error}</div>
          </div>
        )}

        {items && items.length === 0 && !loading && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600 max-w-2xl">
            <p className="font-medium text-slate-700 mb-2">
              No tenes comisiones asignadas todavia.
            </p>
            <p>
              El admin de tu facultad debe agregarte via bulk-import (ADR-029) o crear una
              comision desde web-admin asignandote el rol docente.
            </p>
          </div>
        )}

        {items && items.length > 0 && (
          <ul className="space-y-4" data-testid="comisiones-list">
            {items.map((entry) => (
              <li key={entry.comision.id}>
                <ComisionDelDocenteCard
                  comision={entry.comision}
                  displayName={entry.displayName}
                  kpis={entry.kpis}
                />
              </li>
            ))}
          </ul>
        )}

        {/* Tools transversales como divider tipografico, no cards. Densidad
            academica: una linea por tool, sin overhead visual. */}
        {items && items.length > 0 && (
          <section className="pt-6 border-t border-slate-200 dark:border-slate-800">
            <p className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
              Tools transversales
              <span className="text-slate-400 mx-2">·</span>
              <span className="normal-case font-sans">no requieren comision</span>
            </p>
            <ul className="text-sm space-y-1">
              <li className="flex items-baseline gap-3">
                <span className="text-slate-400">─</span>
                <a
                  href="/templates"
                  className="text-slate-700 dark:text-slate-200 hover:text-[var(--color-accent-brand)]"
                >
                  Plantillas (catedra)
                </a>
              </li>
              <li className="flex items-baseline gap-3">
                <span className="text-slate-400">─</span>
                <a
                  href="/kappa"
                  className="text-slate-700 dark:text-slate-200 hover:text-[var(--color-accent-brand)]"
                >
                  Inter-rater (kappa)
                </a>
              </li>
              <li className="flex items-baseline gap-3">
                <span className="text-slate-400">─</span>
                <a
                  href="/export"
                  className="text-slate-700 dark:text-slate-200 hover:text-[var(--color-accent-brand)]"
                >
                  Exportar dataset academico
                </a>
              </li>
            </ul>
          </section>
        )}
      </div>
    </PageContainer>
  )
}
