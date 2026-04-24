/**
 * Selector de Trabajo Práctico para el estudiante.
 *
 * Flujo: al entrar, lista las TPs en estado=published de la comisión.
 * El estudiante elige una y dispara onSelect(tarea). A partir de ahí el
 * EpisodePage abre el episodio con ese problema_id real (ya no un UUID
 * hardcoded) y muestra el enunciado arriba del editor.
 */
import { useEffect, useState } from "react"
import { type AvailableTarea, tareasPracticasApi } from "../lib/api"

export interface TareaSelectorProps {
  comisionId: string
  onSelect: (tarea: AvailableTarea) => void
}

export function TareaSelector({ comisionId, onSelect }: TareaSelectorProps) {
  const [tareas, setTareas] = useState<AvailableTarea[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setLoadMoreError(null)
    setTareas([])
    setNextCursor(null)
    tareasPracticasApi
      .listAvailable(comisionId)
      .then((page) => {
        if (cancelled) return
        setTareas(page.data)
        setNextCursor(page.meta.cursor_next)
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
  }, [comisionId])

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      const page = await tareasPracticasApi.listAvailable(comisionId, nextCursor)
      setTareas((prev) => [...prev, ...page.data])
      setNextCursor(page.meta.cursor_next)
    } catch (e) {
      // Mantenemos la lista existente y mostramos el error inline.
      setLoadMoreError(String(e))
    } finally {
      setLoadingMore(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Cargando trabajos prácticos...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-md rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4 text-sm text-red-800 dark:text-red-200">
          <p className="font-medium mb-1">No pudimos cargar los trabajos prácticos.</p>
          <p className="font-mono text-xs">{error}</p>
        </div>
      </div>
    )
  }

  if (tareas.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-md text-center">
          <p className="text-lg font-medium text-slate-700 dark:text-slate-200 mb-2">
            No hay trabajos prácticos disponibles
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No hay trabajos prácticos disponibles para esta comisión todavía. Consultá con tu
            docente.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-lg font-semibold mb-1">Trabajos prácticos disponibles</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          Elegí un trabajo práctico para empezar a trabajar con el tutor.
        </p>

        <ul className="space-y-3">
          {tareas.map((t) => (
            <li key={t.id}>
              <TareaCard tarea={t} onSelect={() => onSelect(t)} />
            </li>
          ))}
        </ul>

        {nextCursor !== null && (
          <div className="mt-6 flex flex-col items-center gap-2">
            {loadMoreError && (
              <div
                role="alert"
                className="w-full max-w-md rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 p-3 text-xs text-red-800 dark:text-red-200"
              >
                <p className="font-medium mb-1">No pudimos cargar más trabajos prácticos.</p>
                <p className="font-mono">{loadMoreError}</p>
              </div>
            )}
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="px-4 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loadingMore ? "Cargando..." : "Cargar más"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function TareaCard({
  tarea,
  onSelect,
}: {
  tarea: AvailableTarea
  onSelect: () => void
}) {
  const deadline = formatDeadline(tarea.fecha_fin)
  const excerpt = buildExcerpt(tarea.enunciado)

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              {tarea.codigo}
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-200">
              v{tarea.version}
            </span>
          </div>
          <h3 className="font-medium text-base truncate">{tarea.titulo}</h3>
        </div>
        <button
          type="button"
          onClick={onSelect}
          className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium"
        >
          Empezar a trabajar
        </button>
      </div>

      {excerpt && (
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 whitespace-pre-wrap">
          {excerpt}
        </p>
      )}

      {deadline && <div className={`text-xs ${deadline.colorClass}`}>Cierra: {deadline.label}</div>}
    </div>
  )
}

/** Toma las primeras ~200 chars / 2 líneas útiles del enunciado. */
function buildExcerpt(enunciado: string): string {
  const trimmed = enunciado.trim()
  if (!trimmed) return ""
  const firstLines = trimmed.split("\n").slice(0, 2).join("\n")
  if (firstLines.length <= 200) return firstLines
  return `${firstLines.slice(0, 200).trimEnd()}...`
}

interface DeadlineInfo {
  label: string
  colorClass: string
}

/**
 * Formatea fecha_fin como string relativo y le asigna color según
 * urgencia: rojo <24h, ámbar <72h, gris resto.
 */
function formatDeadline(fechaFin: string | null): DeadlineInfo | null {
  if (!fechaFin) return null
  const end = new Date(fechaFin)
  if (Number.isNaN(end.getTime())) return null

  const now = Date.now()
  const diffMs = end.getTime() - now
  const absoluteLabel = end.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  if (diffMs <= 0) {
    return {
      label: `${absoluteLabel} (vencido)`,
      colorClass: "text-red-600 dark:text-red-400 font-medium",
    }
  }

  const diffHours = diffMs / (1000 * 60 * 60)
  let relative: string
  if (diffHours < 1) {
    relative = "en menos de 1 hora"
  } else if (diffHours < 24) {
    relative = `en ${Math.floor(diffHours)}h`
  } else {
    const days = Math.floor(diffHours / 24)
    relative = `en ${days}d`
  }

  let colorClass = "text-slate-500 dark:text-slate-400"
  if (diffHours < 24) {
    colorClass = "text-red-600 dark:text-red-400 font-medium"
  } else if (diffHours < 72) {
    colorClass = "text-amber-600 dark:text-amber-400"
  }

  return {
    label: `${absoluteLabel} (${relative})`,
    colorClass,
  }
}
