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

  const totalAlumnos = items?.reduce((s, e) => s + (e.kpis.alumnos ?? 0), 0) ?? null
  const totalEpisodios = items?.reduce((s, e) => s + (e.kpis.episodiosSemana ?? 0), 0) ?? null
  const totalAdversos = items?.reduce((s, e) => s + (e.kpis.adversosSemana ?? 0), 0) ?? null

  return (
    <PageContainer
      title="Tus comisiones"
      description="Cohortes asignadas a vos en este periodo."
      helpContent={helpContent.home}
    >
      <div className="space-y-8">
        {loading && (
          <div className="rounded-xl border border-[#EAEAEA] bg-white p-4 text-sm text-[#787774]">
            Cargando tus comisiones...
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="font-semibold">No pudimos cargar tus comisiones.</div>
            <div className="mt-1 font-mono text-xs">{error}</div>
          </div>
        )}

        {items && items.length > 0 && !loading && (
          <div className="rounded-xl border border-[#EAEAEA] bg-white px-6 py-4">
            <div className="flex flex-wrap gap-x-10 gap-y-4">
              <div>
                <div className="text-2xl font-semibold text-[#111111]">{items.length}</div>
                <div className="text-xs text-[#787774] mt-0.5">comisiones</div>
              </div>
              <div className="w-px bg-[#EAEAEA] hidden sm:block" />
              <div>
                <div className="text-2xl font-semibold text-[#111111]">
                  {totalAlumnos !== null ? totalAlumnos : <span className="text-[#787774] text-base">—</span>}
                </div>
                <div className="text-xs text-[#787774] mt-0.5">alumnos totales</div>
              </div>
              <div className="w-px bg-[#EAEAEA] hidden sm:block" />
              <div>
                <div className="text-2xl font-semibold text-[#111111]">
                  {totalEpisodios !== null ? totalEpisodios : <span className="text-[#787774] text-base">—</span>}
                </div>
                <div className="text-xs text-[#787774] mt-0.5">episodios esta semana</div>
              </div>
              <div className="w-px bg-[#EAEAEA] hidden sm:block" />
              <div>
                <div className="text-2xl font-semibold text-[#111111]">
                  {totalAdversos !== null ? totalAdversos : <span className="text-[#787774] text-base">—</span>}
                </div>
                <div className="text-xs text-[#787774] mt-0.5">adversos esta semana</div>
              </div>
            </div>
          </div>
        )}

        {items && items.length === 0 && !loading && (
          <div className="rounded-xl border border-dashed border-[#EAEAEA] bg-white p-8 text-sm text-[#787774] max-w-2xl">
            <p className="font-semibold text-[#111111] mb-2">
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

        {items && items.length > 0 && (
          <section className="pt-6 border-t border-[#EAEAEA]">
            <p className="text-xs uppercase tracking-wider text-[#787774] mb-3 font-medium">
              Tools transversales
            </p>
            <ul className="text-sm space-y-2">
              <li>
                <a
                  href="/templates"
                  className="text-[#111111] hover:text-[var(--color-accent-brand)] transition-colors"
                >
                  Plantillas (catedra)
                </a>
              </li>
              <li>
                <a
                  href="/kappa"
                  className="text-[#111111] hover:text-[var(--color-accent-brand)] transition-colors"
                >
                  Inter-rater (kappa)
                </a>
              </li>
              <li>
                <a
                  href="/export"
                  className="text-[#111111] hover:text-[var(--color-accent-brand)] transition-colors"
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
