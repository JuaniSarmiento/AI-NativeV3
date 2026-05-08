/**
 * Card de una materia inscripta (shape alumno, post-craft Fase 2).
 *
 * Una sola card prominente cuando el alumno tiene N=1 (caso piloto típico).
 * Cuando tiene N>5, la HomePage cambia el render a list items densos y
 * NO usa este componente — evitamos el "identical card grid" baneado.
 *
 * Layout editorial:
 *   - Kicker mono (CODIGO_MATERIA · COMISION) — auditable hex rule
 *   - Headline 18px (nombre de la materia)
 *   - Meta línea (periodo + horario opcional)
 *   - CTA "Entrar →" con var(--color-accent-brand)
 *
 * Cero side-stripe coloreado, cero icono decorativo. El color vive en el
 * acento del CTA, NO en el border de la card. Borde slate neutro.
 */
import type { MateriaInscripta } from "../lib/api"

export interface MateriaCardProps {
  materia: MateriaInscripta
  /** Disparado por el CTA (click o Enter). El parent navega a /materia/:id. */
  onEnter: (materia: MateriaInscripta) => void
}

export function MateriaCard({ materia, onEnter }: MateriaCardProps) {
  const horario = materia.horario_resumen
  const comisionLabel = materia.comision_nombre ?? `Comision ${materia.comision_codigo}`

  return (
    <article
      data-testid="materia-card"
      data-materia-codigo={materia.codigo}
      className="rounded-lg border border-border bg-white p-6"
    >
      <p
        className="text-xs font-mono uppercase tracking-wider text-muted mb-2"
        data-testid="materia-card-kicker"
      >
        {materia.codigo} <span className="text-muted-soft">·</span> {comisionLabel}
      </p>

      <h3 className="text-lg font-semibold text-ink mb-3">
        {materia.nombre}
      </h3>

      <p className="text-xs text-muted mb-5">
        <span data-testid="materia-card-periodo">{materia.periodo_codigo}</span>
        {horario && (
          <>
            <span className="text-muted-soft mx-1.5">·</span>
            <span data-testid="materia-card-horario">{horario}</span>
          </>
        )}
      </p>

      <div className="flex justify-end">
        <button
          type="button"
          data-testid="materia-card-enter"
          onClick={() => onEnter(materia)}
          className="px-4 py-2 rounded text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2"
          style={{ backgroundColor: "var(--color-accent-brand)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-accent-brand-deep)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-accent-brand)"
          }}
        >
          Entrar
          <span aria-hidden="true" className="ml-1.5">
            →
          </span>
        </button>
      </div>
    </article>
  )
}
