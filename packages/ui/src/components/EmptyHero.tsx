import type { ReactNode } from "react"

interface EmptyHeroProps {
  /** Icono lucide ya configurado por el caller (ej. <BookOpen className="h-12 w-12" />). */
  icon: ReactNode
  /** Heading principal. */
  title: string
  /** Texto secundario, 1-2 oraciones. */
  description: string
  /** CTA opcional. */
  primaryAction?: {
    label: string
    onClick: () => void
  }
  /** Línea pequeña al pie (gris). */
  hint?: string
}

/**
 * Empty state hero para pantallas que arrancan sin selección (ej. comisión).
 * Centrado vertical + horizontal, sin borde ni sombra. Usa los tokens del
 * design system (slate + dark variant).
 */
export function EmptyHero({ icon, title, description, primaryAction, hint }: EmptyHeroProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 mx-auto max-w-md">
      <div className="rounded-full bg-slate-100 dark:bg-slate-800 p-4 flex items-center justify-center text-slate-500 dark:text-slate-300">
        {icon}
      </div>
      <h2 className="mt-6 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        {title}
      </h2>
      <p className="text-slate-500 dark:text-slate-400 text-base leading-relaxed mt-2">
        {description}
      </p>
      {primaryAction ? (
        <button
          type="button"
          onClick={primaryAction.onClick}
          className="inline-flex items-center gap-2 mt-6 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-5 py-2.5 text-sm font-medium hover:bg-slate-800 dark:hover:bg-white transition"
        >
          {primaryAction.label}
        </button>
      ) : null}
      {hint ? <p className="text-xs text-slate-400 mt-4">{hint}</p> : null}
    </div>
  )
}
