import type { ReactNode } from "react"

/**
 * Par label/value read-only para páginas de contexto (breadcrumb-style en forms).
 *
 * Extraído de las páginas de Materias/Planes/Comisiones del web-admin donde estaba
 * duplicado inline. El `title` attr muestra el valor completo en hover cuando está
 * truncado.
 */
export function ReadonlyField({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
      <span className="text-sm text-slate-900 font-medium truncate" title={value}>
        {value}
      </span>
    </div>
  )
}
