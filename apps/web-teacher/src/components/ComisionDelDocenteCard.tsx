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

function kpiValue(v: number | null): string {
  if (v === null) return "—"
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
      className="rounded-xl border border-[#EAEAEA] bg-white p-6 transition-shadow duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
    >
      <p
        className="text-xs uppercase tracking-wider text-[#787774] mb-1"
        data-testid="comision-card-kicker"
      >
        {comision.codigo}
        {horarioStr && (
          <>
            <span className="text-[#EAEAEA] mx-1.5">·</span>
            {horarioStr}
          </>
        )}
      </p>

      <h3 className="text-lg font-semibold text-[#111111] mb-4">
        {displayName}
      </h3>

      <dl
        className="flex flex-wrap items-start gap-x-8 gap-y-3 mb-5"
        data-testid="comision-card-kpis"
      >
        <div>
          <dd className={`text-xl font-semibold ${kpis.alumnos === null ? "text-[#787774]" : "text-[#111111]"}`}>
            {kpiValue(kpis.alumnos)}
          </dd>
          <dt className="text-xs text-[#787774] mt-0.5">alumnos</dt>
        </div>
        <div>
          <dd className={`text-xl font-semibold ${kpis.episodiosSemana === null ? "text-[#787774]" : "text-[#111111]"}`}>
            {kpiValue(kpis.episodiosSemana)}
          </dd>
          <dt className="text-xs text-[#787774] mt-0.5">episodios sem.</dt>
        </div>
        <div>
          <dd className={`text-xl font-semibold ${kpis.alertas === null ? "text-[#787774]" : "text-[#111111]"}`}>
            {kpiValue(kpis.alertas)}
          </dd>
          <dt className="text-xs text-[#787774] mt-0.5">alertas</dt>
        </div>
        <div>
          <dd className={`text-xl font-semibold ${kpis.adversosSemana === null ? "text-[#787774]" : "text-[#111111]"}`}>
            {kpiValue(kpis.adversosSemana)}
          </dd>
          <dt className="text-xs text-[#787774] mt-0.5">adversos sem.</dt>
        </div>
      </dl>

      <div className="h-1 rounded-full mb-4 overflow-hidden bg-[#EAEAEA]">
        <div
          className="h-full rounded-full"
          style={{
            width: kpis.alumnos && kpis.alumnos > 0 ? "100%" : "0%",
            backgroundColor: "var(--color-appropriation-reflexiva)",
          }}
        />
      </div>

      <div className="flex items-center gap-4">
        <Link
          to="/progression"
          search={{ comisionId: comision.id }}
          data-testid="comision-card-cohort-link"
          className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-[#111111] text-white hover:bg-[#333333] transition-colors"
        >
          Ver cohorte
        </Link>
        <Link
          to="/cohort-adversarial"
          search={{ comisionId: comision.id }}
          className="text-sm text-[#787774] hover:text-[#111111] transition-colors"
        >
          Adversarial
        </Link>
      </div>
    </article>
  )
}
