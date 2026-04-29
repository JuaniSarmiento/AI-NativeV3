import type { ReactNode } from "react"

export interface BreadcrumbItem {
  /** Etiqueta principal a mostrar (ej: "UNSL"). */
  label: string
  /** Texto pequeño descriptivo del nivel (ej: "Universidad"). */
  context?: string
}

interface BreadcrumbProps {
  items: BreadcrumbItem[]
}

/**
 * Migaja de navegación stateless que muestra el contexto académico actual.
 *
 * Ejemplo:
 *   Universidad: UNSL  /  Facultad: Cs. Físicas  /  Carrera: Lic. Sistemas
 *
 * El último item se renderiza en negrita; los anteriores son slate-600.
 */
export function Breadcrumb({ items }: BreadcrumbProps): ReactNode {
  if (items.length === 0) return null

  return (
    <nav
      aria-label="Contexto académico"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600"
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1
        return (
          <span
            key={`${item.context ?? ""}-${item.label}-${idx}`}
            className="flex items-center gap-2"
          >
            <span className={isLast ? "font-semibold text-slate-900" : ""}>
              {item.context && <span className="text-slate-500">{item.context}: </span>}
              {item.label}
            </span>
            {!isLast && <span className="text-slate-400">/</span>}
          </span>
        )
      })}
    </nav>
  )
}
