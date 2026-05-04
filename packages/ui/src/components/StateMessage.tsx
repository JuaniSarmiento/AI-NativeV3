import type { ReactNode } from "react"
import { cn } from "../utils/cn"

type Variant = "loading" | "empty" | "error"

interface StateMessageProps {
  variant: Variant
  title?: string
  description?: string
  action?: ReactNode
  className?: string
}

/**
 * Primitiva visual unificada para estados loading / empty / error.
 * Pura presentacional, sin estado ni fetch. Usa los tokens semanticos
 * (--color-danger, etc.) declarados en cada apps/web-*\/src/index.css.
 */
export function StateMessage({
  variant,
  title,
  description,
  action,
  className,
}: StateMessageProps) {
  const defaults: Record<Variant, { title: string; description?: string }> = {
    loading: { title: title ?? "Cargando..." },
    empty: { title: title ?? "Sin datos", description },
    error: { title: title ?? "Error", description },
  }
  const resolved = defaults[variant]

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      data-variant={variant}
      aria-live={variant === "loading" ? "polite" : undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        variant === "empty" &&
          "rounded-md border border-dashed border-slate-200 bg-slate-50/40 dark:border-zinc-800 dark:bg-zinc-900/30",
        variant === "error" &&
          "rounded-md border border-[var(--color-danger)]/20 bg-[var(--color-danger-soft)]",
        className,
      )}
    >
      {variant === "loading" ? <Spinner /> : null}
      <div className="space-y-1">
        <p
          className={cn(
            "text-sm font-medium",
            variant === "error"
              ? "text-[var(--color-danger)]"
              : "text-slate-700 dark:text-zinc-200",
          )}
        >
          {resolved.title}
        </p>
        {resolved.description ? (
          <p
            className={cn(
              "text-xs",
              variant === "error"
                ? "text-[var(--color-danger)]/80"
                : "text-slate-500 dark:text-zinc-400",
            )}
          >
            {resolved.description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      data-testid="state-spinner"
      className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 dark:border-zinc-700 dark:border-t-zinc-200"
    />
  )
}
