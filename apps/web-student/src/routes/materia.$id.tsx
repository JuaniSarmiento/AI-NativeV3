/**
 * Página de la materia seleccionada (post-craft Fase 2): /materia/$id.
 *
 * Layout:
 *   - Header contextual: kicker mono `CODIGO_MATERIA · COMISION · PERIODO`.
 *   - <TareaSelector> con las 3 zonas (Continuar / Proximas / Vencidas)
 *     que ya existe — recibe `comisionId` derivado de la inscripcion.
 *
 * Single-flight per page: usamos useQuery con la misma key `mis-materias`
 * que la home. Si el alumno entra desde la home, el dato ya está en cache
 * y NO hay re-fetch (staleTime 5min). Acceso directo por URL → fetch
 * inicial (caso refresh / link compartido).
 *
 * Flujo multi-ejercicio (tp-entregas-correccion):
 *   click TP con ejercicios → mostrar ExerciseListView
 *   click ejercicio → POST /api/v1/episodes con ejercicio_orden → navegar
 *
 * Flujo monolitico (legacy):
 *   click TP → POST /api/v1/episodes (sin ejercicio_orden) → navegar
 */
import { useQuery } from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import { z } from "zod"
import { useEffect, useState } from "react"
import { ExerciseListView } from "../components/ExerciseListView"
import { GradeDetailView } from "../components/GradeDetailView"
import { OpeningStage } from "../components/OpeningStage"
import { TareaSelector } from "../components/TareaSelector"
import {
  type AvailableTarea,
  type Entrega,
  type MateriaInscripta,
  getTareaById,
  listMisMaterias,
  openEpisode,
} from "../lib/api"

/** Contexto que se persiste en sessionStorage cuando el alumno entra a un ejercicio. */
export const ACTIVE_EXERCISE_CONTEXT_KEY = "active-exercise-context"

export interface ActiveExerciseContext {
  materia_id: string
  tarea_id: string
  entrega_id: string
  ejercicio_orden: number
}

const searchSchema = z.object({
  returnToExercise: z.boolean().optional(),
})

export const Route = createFileRoute("/materia/$id")({
  component: MateriaPage,
  validateSearch: searchSchema,
})

/** Estado de la navegacion dentro de la pagina de materia. */
type MateriaPageView =
  | { kind: "selector" }
  | { kind: "exercise-list"; tarea: AvailableTarea }
  | { kind: "grade-detail"; tarea: AvailableTarea; entrega: Entrega }
  | { kind: "opening"; tarea: AvailableTarea; ejercicioOrden: number | null; error: string | null }

function MateriaPage() {
  const { id } = useParams({ from: "/materia/$id" })
  const { returnToExercise } = Route.useSearch()
  const navigate = useNavigate()
  const [view, setView] = useState<MateriaPageView>({ kind: "selector" })

  const { data: materias, isLoading, error } = useQuery({
    queryKey: ["mis-materias"],
    queryFn: () => listMisMaterias(),
    staleTime: 5 * 60 * 1000,
  })

  const materia = (materias ?? []).find((m) => m.materia_id === id)

  // Si el alumno volvio de un ejercicio, recuperar el contexto y re-abrir el ExerciseListView.
  useEffect(() => {
    if (!returnToExercise) return
    if (!materia) return
    const raw = window.sessionStorage.getItem(ACTIVE_EXERCISE_CONTEXT_KEY)
    if (!raw) return
    let ctx: ActiveExerciseContext
    try {
      ctx = JSON.parse(raw) as ActiveExerciseContext
    } catch {
      window.sessionStorage.removeItem(ACTIVE_EXERCISE_CONTEXT_KEY)
      return
    }
    if (ctx.materia_id !== id) {
      window.sessionStorage.removeItem(ACTIVE_EXERCISE_CONTEXT_KEY)
      return
    }
    // Limpiar el contexto ya consumido
    window.sessionStorage.removeItem(ACTIVE_EXERCISE_CONTEXT_KEY)
    // Quitar el query param de la URL sin reemplazar la entrada de historial
    void navigate({ to: "/materia/$id", params: { id }, replace: true })
    // Fetch de la tarea y abrir el ExerciseListView
    getTareaById(ctx.tarea_id).then((tarea) => {
      if (tarea) setView({ kind: "exercise-list", tarea })
    }).catch(() => { /* best-effort */ })
  }, [returnToExercise, materia, id, navigate])

  if (isLoading) {
    return <PageLoading />
  }

  if (error) {
    return <PageError detail={String(error)} />
  }

  if (!materia) {
    return <MateriaNotFound id={id} />
  }

  /**
   * Abre un episodio para la TP (monolitica o ejercicio especifico).
   * Navega a /episodio/:id al completar.
   *
   * Para ejercicios de TPs multi-ejercicio, persiste el contexto en
   * sessionStorage para que EpisodePage sepa donde volver al cerrar.
   * El entregaId se resuelve aqui porque ExerciseListView ya creo/recupero
   * la entrega en su propio mount — lo recibimos via callback.
   */
  async function openEpisodeAndNavigate(
    tarea: AvailableTarea,
    ejercicioOrden: number | null,
    entregaId?: string,
  ) {
    setView({ kind: "opening", tarea, ejercicioOrden, error: null })
    try {
      const res = await openEpisode({
        comision_id: materia!.comision_id,
        problema_id: tarea.id,
        // Hashes hardcoded del piloto. F9 real los provee el bootstrap.
        curso_config_hash: "c".repeat(64),
        classifier_config_hash: "d".repeat(64),
        ...(ejercicioOrden != null ? { ejercicio_orden: ejercicioOrden } : {}),
      })
      // Persistir contexto si es un ejercicio de TP multi-ejercicio
      if (ejercicioOrden != null && entregaId) {
        const ctx: ActiveExerciseContext = {
          materia_id: id,
          tarea_id: tarea.id,
          entrega_id: entregaId,
          ejercicio_orden: ejercicioOrden,
        }
        window.sessionStorage.setItem(ACTIVE_EXERCISE_CONTEXT_KEY, JSON.stringify(ctx))
      }
      navigate({ to: "/episodio/$id", params: { id: res.episode_id } })
    } catch (e) {
      setView({
        kind: "opening",
        tarea,
        ejercicioOrden,
        error: `Error abriendo episodio: ${e}`,
      })
    }
  }

  /**
   * Callback del TareaSelector.
   * - TP monolitica (sin ejercicios): abre episodio directamente.
   * - TP multi-ejercicio: muestra ExerciseListView.
   */
  function handleSelectTarea(tarea: AvailableTarea) {
    const esMultiEjercicio = (tarea.ejercicios ?? []).length > 0
    if (esMultiEjercicio) {
      setView({ kind: "exercise-list", tarea })
    } else {
      void openEpisodeAndNavigate(tarea, null)
    }
  }

  const currentView = view

  return (
    <>
      <ContextualHeader materia={materia} />

      {currentView.kind === "opening" && currentView.error && (
        <div className="bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200 px-6 py-2 text-sm">
          {currentView.error}
        </div>
      )}

      {currentView.kind === "selector" && (
        <TareaSelector
          comisionId={materia.comision_id}
          onSelect={handleSelectTarea}
        />
      )}

      {currentView.kind === "exercise-list" && (
        <ExerciseListView
          tarea={currentView.tarea}
          comisionId={materia.comision_id}
          onSelectEjercicio={(tarea, ejercicioOrden, entregaId) => {
            void openEpisodeAndNavigate(tarea, ejercicioOrden, entregaId)
          }}
          onViewGrade={(entrega) =>
            setView({ kind: "grade-detail", tarea: currentView.tarea, entrega })
          }
          onBack={() => setView({ kind: "selector" })}
        />
      )}

      {currentView.kind === "grade-detail" && (
        <GradeDetailView
          entrega={currentView.entrega}
          onBack={() => setView({ kind: "exercise-list", tarea: currentView.tarea })}
        />
      )}

      {currentView.kind === "opening" && (
        <OpeningStage
          tareaCodigo={currentView.tarea.codigo}
          tareaTitulo={currentView.tarea.titulo}
          episodeReady={false}
          {...(currentView.error ? { errorMessage: currentView.error } : {})}
          onShowError={() => {
            // El error ya esta visible en el banner rojo de arriba.
          }}
        />
      )}
    </>
  )
}

function ContextualHeader({ materia }: { materia: MateriaInscripta }) {
  return (
    <div
      data-testid="materia-context-header"
      className="border-b border-slate-200 dark:border-slate-800 px-6 py-3 bg-white dark:bg-slate-900 flex items-center gap-3 flex-wrap"
    >
      <Link
        to="/"
        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        data-testid="materia-back-link"
      >
        ← Mis materias
      </Link>
      <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
        |
      </span>
      <MateriaContextLine materia={materia} />
      <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate ml-auto">
        {materia.nombre}
      </span>
    </div>
  )
}

/**
 * Linea pura del header contextual — kicker mono con codigo + comision + periodo.
 * Extraida del header para que pueda testearse sin RouterProvider.
 */
export function MateriaContextLine({ materia }: { materia: MateriaInscripta }) {
  const comisionLabel = materia.comision_nombre ?? `Comision ${materia.comision_codigo}`
  return (
    <p
      data-testid="materia-context-line"
      className="text-xs font-mono uppercase tracking-wider text-slate-700 dark:text-slate-300"
    >
      <span data-testid="materia-header-codigo">{materia.codigo}</span>
      <span className="text-slate-400 mx-1.5">·</span>
      <span data-testid="materia-header-comision">{comisionLabel}</span>
      <span className="text-slate-400 mx-1.5">·</span>
      <span data-testid="materia-header-periodo">{materia.periodo_codigo}</span>
    </p>
  )
}

function PageLoading() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div
        className="inline-block w-6 h-6 border-2 border-t-transparent rounded-full motion-safe:animate-spin"
        style={{ borderColor: "var(--color-accent-brand)", borderTopColor: "transparent" }}
      />
    </div>
  )
}

function PageError({ detail }: { detail: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-2">
          No pudimos cargar la materia.
        </p>
        <p className="text-xs font-mono text-slate-500">{detail}</p>
      </div>
    </div>
  )
}

function MateriaNotFound({ id }: { id: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          Esta materia no esta entre tus inscripciones activas.
        </p>
        <p className="text-xs font-mono text-slate-500 mb-4">id: {id}</p>
        <Link
          to="/"
          className="text-sm underline text-slate-700 dark:text-slate-300"
          data-testid="materia-not-found-back"
        >
          Volver a mis materias
        </Link>
      </div>
    </div>
  )
}
