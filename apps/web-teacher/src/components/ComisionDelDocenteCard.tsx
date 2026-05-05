/**
 * Card densa por comision del docente, usada en la home (HomeView).
 *
 * Patron equivalente al MateriaCard del web-student: una sola card
 * prominente con kicker mono + headline + 4 KPIs densos en strip
 * inline + CTA a la cohorte. NO 4-card grid uniforme (cumple
 * DESIGN.md don't #3 hero-metric ban).
 *
 * Honestidad tecnica: cuando el cohort tiene N=0 episodios o N<3
 * estudiantes con datos, los KPIs muestran "datos insuf." en color
 * muted en vez de un 0 ambiguo (PRODUCT.md auditabilidad).
 */
import { Link } from "@tanstack/react-router"
import type { Comision } from "../lib/api"

export interface ComisionKpis {
  /** Total de inscriptos en la comision (campo n_students del progression). */
  alumnos: number | null
  /** Episodios cerrados en los ultimos 7 dias. null = no hay datos. */
  episodiosSemana: number | null
  /** Alertas abiertas para la cohorte. null = endpoint no disponible. */
  alertas: number | null
  /** Eventos adversos en los ultimos 7 dias. */
  adversosSemana: number | null
}

export interface ComisionDelDocenteCardProps {
  comision: Comision
  /** Nombre legible (suele venir como `nombre` del seed). */
  displayName: string
  /** KPIs ya computados por el padre (la home hace los fetches en paralelo). */
  kpis: ComisionKpis
}

function kpiValueClass(v: number | null): string {
  return v === null ? "text-slate-400" : "text-slate-900 dark:text-slate-50"
}

function kpiValue(v: number | null): string {
  if (v === null) return "datos insuf."
  return String(v)
}

export function ComisionDelDocenteCard({
  comision,
  displayName,
  kpis,
}: ComisionDelDocenteCardProps) {
  const horarioStr = (() => {
    const horario = comision.horario as Record<string, unknown>
    if (typeof horario?.resumen === "string") return horario.resumen
    return null
  })()

  return (
    <article
      data-testid="comision-card"
      data-comision-id={comision.id}
      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-5"
    >
      <p
        className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2"
        data-testid="comision-card-kicker"
      >
        {comision.codigo}
        {horarioStr && (
          <>
            <span className="text-slate-400 mx-1.5">·</span>
            {horarioStr}
          </>
        )}
      </p>

      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-3">
        {displayName}
      </h3>

      {/* KPIs densos en strip inline (no 4-card grid). */}
      <dl
        className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm mb-4"
        data-testid="comision-card-kpis"
      >
        <div className="inline-flex items-baseline gap-1.5">
          <dt className="text-xs text-slate-500">alumnos</dt>
          <dd className={`font-semibold ${kpiValueClass(kpis.alumnos)}`}>
            {kpiValue(kpis.alumnos)}
          </dd>
        </div>
        <div className="inline-flex items-baseline gap-1.5">
          <dt className="text-xs text-slate-500">episodios sem.</dt>
          <dd className={`font-semibold ${kpiValueClass(kpis.episodiosSemana)}`}>
            {kpiValue(kpis.episodiosSemana)}
          </dd>
        </div>
        <div className="inline-flex items-baseline gap-1.5">
          <dt className="text-xs text-slate-500">alertas</dt>
          <dd className={`font-semibold ${kpiValueClass(kpis.alertas)}`}>
            {kpiValue(kpis.alertas)}
          </dd>
        </div>
        <div className="inline-flex items-baseline gap-1.5">
          <dt className="text-xs text-slate-500">adversos sem.</dt>
          <dd className={`font-semibold ${kpiValueClass(kpis.adversosSemana)}`}>
            {kpiValue(kpis.adversosSemana)}
          </dd>
        </div>
      </dl>

      <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            to="/progression"
            search={{ comisionId: comision.id }}
            data-testid="comision-card-cohort-link"
            className="inline-flex items-center px-4 py-2 rounded text-sm font-medium text-white"
            style={{ backgroundColor: "var(--color-accent-brand)" }}
          >
            Abrir cohorte
            <span aria-hidden="true" className="ml-1.5">
              →
            </span>
          </Link>
          <Link
            to="/cohort-adversarial"
            search={{ comisionId: comision.id }}
            className="text-xs text-slate-600 hover:text-slate-900"
          >
            Ver adversos
          </Link>
        </div>
      </div>
    </article>
  )
}
