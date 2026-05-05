/**
 * Selector de Trabajo Practico para el estudiante (shape alumno, brief 3.3).
 *
 * Reorganiza el render en 3 zonas tipograficas (Continuar / Proximas /
 * Vencidas) en lugar del card grid uniforme original. Cumple el ban
 * "identical card grids" con densidad y forma diferentes:
 *   - "CONTINUAR": card prominente con border + padding generoso. TODO:
 *     conectar al endpoint de "episodios abiertos" cuando exista. Por
 *     ahora detecta TPs en las que el alumno tiene episodios cerrados
 *     recientes (mismo template_id o id) y muestra trayectoria N4.
 *   - "PROXIMAS": list items densos sin box, divider tipografico.
 *   - "VENCIDAS": items compactos, color muted, sin CTA.
 *
 * "Trayectoria N4 historica" en CONTINUAR: 3 dots ordinales con color de
 * apropiacion (reflexiva=verde, superficial=ambar, delegacion=rojo) sobre
 * los ultimos 3 cierres del alumno en TPs con el mismo `template_id`.
 * Si <3 episodios analogos: "Tu primera vez con esta TP" (muted).
 *
 * Privacy: la trayectoria es per-student (el endpoint
 * /api/v1/analytics/student/{id}/episodes filtra por student_pseudonym
 * desde headers — el backend NO expone otros estudiantes).
 */
import { StateMessage } from "@platform/ui"
import { useEffect, useMemo, useState } from "react"
import {
  type AvailableTarea,
  type StudentEpisode,
  listStudentEpisodes,
  tareasPracticasApi,
} from "../lib/api"

export interface TareaSelectorProps {
  comisionId: string
  onSelect: (tarea: AvailableTarea) => void
}

interface Zones {
  continuar: AvailableTarea[]
  proximas: AvailableTarea[]
  vencidas: AvailableTarea[]
}

function partitionTareas(tareas: AvailableTarea[], episodes: StudentEpisode[]): Zones {
  const now = Date.now()
  const continuarIds = new Set<string>()

  // CONTINUAR: TPs con al menos un cierre reciente del estudiante (apropiacion
  // != delegacion_pasiva). Heuristica simple para el piloto: cualquier
  // episodio cerrado de la propia TP califica como "ya empezaste" y deberias
  // poder volver. La idea de "episodio abierto preexistente" requeriria un
  // endpoint separado y queda como follow-up.
  for (const ep of episodes) {
    if (ep.appropriation && ep.problema_id) {
      continuarIds.add(ep.problema_id)
    }
  }

  const continuar: AvailableTarea[] = []
  const proximas: AvailableTarea[] = []
  const vencidas: AvailableTarea[] = []

  for (const t of tareas) {
    const fechaFin = t.fecha_fin ? new Date(t.fecha_fin).getTime() : null
    const isVencida = fechaFin !== null && fechaFin <= now
    if (isVencida) {
      vencidas.push(t)
      continue
    }
    if (continuarIds.has(t.id)) {
      continuar.push(t)
      continue
    }
    proximas.push(t)
  }

  // Ordenamiento: CONTINUAR por deadline asc; PROXIMAS asc; VENCIDAS desc.
  continuar.sort(byDeadlineAsc)
  proximas.sort(byDeadlineAsc)
  vencidas.sort(byDeadlineDesc)

  return { continuar, proximas, vencidas }
}

function byDeadlineAsc(a: AvailableTarea, b: AvailableTarea): number {
  const da = a.fecha_fin ? new Date(a.fecha_fin).getTime() : Number.POSITIVE_INFINITY
  const db = b.fecha_fin ? new Date(b.fecha_fin).getTime() : Number.POSITIVE_INFINITY
  return da - db
}

function byDeadlineDesc(a: AvailableTarea, b: AvailableTarea): number {
  return -byDeadlineAsc(a, b)
}

export function TareaSelector({ comisionId, onSelect }: TareaSelectorProps) {
  const [tareas, setTareas] = useState<AvailableTarea[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [episodes, setEpisodes] = useState<StudentEpisode[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setLoadMoreError(null)
    setTareas([])
    setNextCursor(null)
    setEpisodes([])
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

  // Trayectoria N4 historica: best-effort. Si el endpoint no esta disponible
  // (analytics down, dev mode sin classifier), seguimos sin la zona Continuar.
  useEffect(() => {
    let cancelled = false
    // Resolvemos student_pseudonym desde la cookie/proxy del dev mode.
    // En dev, el proxy de Vite inyecta `x-user-id`. No lo tenemos aca; el
    // backend ya lo lee de los headers y filtra por el. Pasamos un sentinel
    // que el endpoint NO va a usar (filtra por header X-User-Id).
    // TODO: cuando exista AuthContext con el sub claim, pasarlo explicito.
    // Por ahora pegamos al endpoint con el UUID hardcoded del seed para que
    // funcione en dev. En prod, el JWT trae el sub.
    const studentPseudonym = "b1b1b1b1-0001-0001-0001-000000000001"
    listStudentEpisodes(studentPseudonym, comisionId)
      .then((res) => {
        if (cancelled) return
        setEpisodes(res.episodes)
      })
      .catch(() => {
        // Best-effort: si analytics no responde, seguimos sin trayectoria.
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
      setLoadMoreError(String(e))
    } finally {
      setLoadingMore(false)
    }
  }

  const zones = useMemo(() => partitionTareas(tareas, episodes), [tareas, episodes])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <StateMessage variant="loading" title="Cargando trabajos practicos..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <StateMessage
          variant="error"
          title="No pudimos cargar los trabajos practicos."
          description={error}
          className="max-w-md"
        />
      </div>
    )
  }

  if (tareas.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-md text-center px-6">
          <p className="text-base font-medium text-slate-700 dark:text-slate-200 mb-2">
            Tu comision todavia no tiene TPs publicadas.
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Tu docente las publica desde el panel de gestion.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <p className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
          Trabajos practicos
        </p>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50 mb-8">
          Tu materia, esta semana.
        </h2>

        {zones.continuar.length > 0 && (
          <ZoneContinuar tareas={zones.continuar} episodes={episodes} onSelect={onSelect} />
        )}

        {zones.proximas.length > 0 && (
          <ZoneProximas tareas={zones.proximas} onSelect={onSelect} />
        )}

        {zones.vencidas.length > 0 && (
          <ZoneVencidas tareas={zones.vencidas} episodes={episodes} />
        )}

        {nextCursor !== null && (
          <div className="mt-8 flex flex-col items-center gap-2">
            {loadMoreError && (
              <div
                role="alert"
                className="w-full max-w-md rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 p-3 text-xs text-red-800 dark:text-red-200"
              >
                <p className="font-medium mb-1">No pudimos cargar mas trabajos practicos.</p>
                <p className="font-mono">{loadMoreError}</p>
              </div>
            )}
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="px-4 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
            >
              {loadingMore ? "Cargando..." : "Cargar mas"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Zona CONTINUAR: card prominente, trayectoria N4 historica ────────

function ZoneContinuar({
  tareas,
  episodes,
  onSelect,
}: {
  tareas: AvailableTarea[]
  episodes: StudentEpisode[]
  onSelect: (t: AvailableTarea) => void
}) {
  return (
    <section className="mb-10" data-testid="zone-continuar">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-mono uppercase tracking-wider text-slate-700 dark:text-slate-300">
          Continuar
        </p>
        <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
          {tareas.length} {tareas.length === 1 ? "TP en curso" : "TPs en curso"}
        </span>
      </div>
      <ul className="space-y-3">
        {tareas.map((t) => (
          <li key={t.id}>
            <ContinuarCard tarea={t} episodes={episodes} onSelect={() => onSelect(t)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ContinuarCard({
  tarea,
  episodes,
  onSelect,
}: {
  tarea: AvailableTarea
  episodes: StudentEpisode[]
  onSelect: () => void
}) {
  // Trayectoria: ultimos 3 cierres del alumno con el mismo problema_id.
  // (Si surge una TP con `template_id` reutilizado entre versiones, se
  // podria agrupar por template_id; por ahora basta con problema_id.)
  const trajectory = useMemo(() => {
    const matching = episodes
      .filter((ep) => ep.problema_id === tarea.id && ep.appropriation !== null)
      .sort((a, b) => {
        const da = a.classified_at ? new Date(a.classified_at).getTime() : 0
        const db = b.classified_at ? new Date(b.classified_at).getTime() : 0
        return db - da
      })
      .slice(0, 3)
      .reverse()
    return matching
  }, [episodes, tarea.id])

  const deadline = formatDeadline(tarea.fecha_fin)

  return (
    <article
      data-testid="tp-card"
      data-tp-codigo={tarea.codigo}
      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-5"
    >
      <header className="flex items-start gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mb-1">
            {tarea.codigo} (v{tarea.version})
          </p>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            {tarea.titulo}
          </h3>
        </div>
      </header>

      <div className="mb-4 text-xs text-slate-600 dark:text-slate-400">
        {trajectory.length === 0 ? (
          <p data-testid="trajectory-empty" className="italic">
            Tu primera vez con esta TP.
          </p>
        ) : (
          <div className="flex items-center gap-2 flex-wrap" data-testid="trajectory-dots">
            <span className="text-slate-500 dark:text-slate-400">
              Tu trayectoria en TPs analogas:
            </span>
            <span className="inline-flex items-center gap-1.5">
              {trajectory.map((ep, idx) => (
                <span
                  key={`${ep.episode_id}-${idx}`}
                  aria-label={appropriationAriaLabel(ep.appropriation)}
                  data-testid={`trajectory-dot-${ep.appropriation ?? "unknown"}`}
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: appropriationColor(ep.appropriation) }}
                />
              ))}
            </span>
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-3">
        {deadline && <p className={`text-xs ${deadline.colorClass}`}>{deadline.label}</p>}
        <button
          type="button"
          onClick={onSelect}
          className="ml-auto px-4 py-2 rounded text-sm font-medium text-white"
          style={{ backgroundColor: "var(--color-accent-brand)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-accent-brand-deep)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-accent-brand)"
          }}
        >
          Volver a la TP
        </button>
      </footer>
    </article>
  )
}

// ─── Zona PROXIMAS: list items densos, divider tipografico ────────────

function ZoneProximas({
  tareas,
  onSelect,
}: {
  tareas: AvailableTarea[]
  onSelect: (t: AvailableTarea) => void
}) {
  return (
    <section className="mb-10" data-testid="zone-proximas">
      <div className="flex items-baseline gap-3 mb-3 border-b border-slate-200 dark:border-slate-800 pb-1">
        <p className="text-xs font-mono uppercase tracking-wider text-slate-700 dark:text-slate-300">
          Proximas
        </p>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          ordenadas por deadline ascendente
        </span>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {tareas.map((t) => (
          <li key={t.id}>
            <ProximaItem tarea={t} onSelect={() => onSelect(t)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProximaItem({ tarea, onSelect }: { tarea: AvailableTarea; onSelect: () => void }) {
  const excerpt = buildExcerpt(tarea.enunciado)
  const deadline = formatDeadline(tarea.fecha_fin)
  return (
    <div
      data-testid="tp-card"
      data-tp-codigo={tarea.codigo}
      className="py-3 flex items-start gap-4"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
            {tarea.codigo}
          </span>
          <span className="text-xs font-mono text-slate-400">v{tarea.version}</span>
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
            {tarea.titulo}
          </span>
        </div>
        {excerpt && (
          <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-1">{excerpt}</p>
        )}
        {deadline && <p className={`text-xs mt-1 ${deadline.colorClass}`}>{deadline.label}</p>}
      </div>
      <button
        type="button"
        onClick={onSelect}
        className="shrink-0 px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        Empezar
      </button>
    </div>
  )
}

// ─── Zona VENCIDAS: items compactos, sin CTA, color muted ─────────────

function ZoneVencidas({
  tareas,
  episodes,
}: {
  tareas: AvailableTarea[]
  episodes: StudentEpisode[]
}) {
  return (
    <section className="mb-6" data-testid="zone-vencidas">
      <div className="flex items-baseline gap-3 mb-3 border-b border-slate-200 dark:border-slate-800 pb-1">
        <p className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-500">
          Vencidas
        </p>
        <span className="text-xs text-slate-400 dark:text-slate-500">acceso solo lectura</span>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {tareas.map((t) => {
          const lastResult = episodes
            .filter((ep) => ep.problema_id === t.id && ep.appropriation !== null)
            .sort((a, b) => {
              const da = a.classified_at ? new Date(a.classified_at).getTime() : 0
              const db = b.classified_at ? new Date(b.classified_at).getTime() : 0
              return db - da
            })[0]
          return (
            <li key={t.id} className="py-2.5 text-xs text-slate-500 dark:text-slate-500">
              <div className="flex items-center gap-2">
                <span className="font-mono">{t.codigo}</span>
                <span className="text-slate-400">v{t.version}</span>
                <span className="text-slate-700 dark:text-slate-300 truncate">{t.titulo}</span>
              </div>
              {lastResult && lastResult.appropriation && (
                <p className="mt-1 text-slate-500 flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: appropriationColor(lastResult.appropriation) }}
                  />
                  Tu episodio: {appropriationLabel(lastResult.appropriation)}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────

function appropriationColor(
  a: StudentEpisode["appropriation"] | null,
): string {
  switch (a) {
    case "apropiacion_reflexiva":
      return "var(--color-appropriation-reflexiva)"
    case "apropiacion_superficial":
      return "var(--color-appropriation-superficial)"
    case "delegacion_pasiva":
      return "var(--color-appropriation-delegacion)"
    default:
      return "var(--color-level-meta)"
  }
}

function appropriationLabel(a: NonNullable<StudentEpisode["appropriation"]>): string {
  switch (a) {
    case "apropiacion_reflexiva":
      return "apropiacion reflexiva"
    case "apropiacion_superficial":
      return "apropiacion superficial"
    case "delegacion_pasiva":
      return "delegacion pasiva"
  }
}

function appropriationAriaLabel(
  a: StudentEpisode["appropriation"] | null,
): string {
  if (!a) return "resultado pendiente"
  return appropriationLabel(a)
}

/** Toma las primeras ~150 chars / 1 linea util del enunciado. */
function buildExcerpt(enunciado: string): string {
  const trimmed = enunciado.trim()
  if (!trimmed) return ""
  const firstLine = trimmed.split("\n").find((l) => l.trim().length > 0) ?? ""
  if (firstLine.length <= 150) return firstLine
  return `${firstLine.slice(0, 150).trimEnd()}...`
}

interface DeadlineInfo {
  label: string
  colorClass: string
}

/**
 * Formatea fecha_fin como string relativo y le asigna color segun
 * urgencia: rojo <24h, ambar <72h, gris resto.
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
    label: `Cierra ${absoluteLabel} (${relative})`,
    colorClass,
  }
}
