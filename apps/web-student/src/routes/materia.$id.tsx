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
 * El click en una TP del selector navega a /episodio/:id. Hoy el flujo es:
 *   click TP → POST /api/v1/episodes (open) → setEpisodeId → render activo
 * Para preservar la UX en una transicion mínima, mantenemos el `openEpisode`
 * inline acá y pasamos el id resultante a navigate({to: "/episodio/$id"}).
 */
import { useQuery } from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import { useState } from "react"
import { OpeningStage } from "../components/OpeningStage"
import { TareaSelector } from "../components/TareaSelector"
import {
  type AvailableTarea,
  type MateriaInscripta,
  listMisMaterias,
  openEpisode,
} from "../lib/api"

export const Route = createFileRoute("/materia/$id")({
  component: MateriaPage,
})

function MateriaPage() {
  const { id } = useParams({ from: "/materia/$id" })
  const navigate = useNavigate()
  const [openingTarea, setOpeningTarea] = useState<AvailableTarea | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  const { data: materias, isLoading, error } = useQuery({
    queryKey: ["mis-materias"],
    queryFn: () => listMisMaterias(),
    staleTime: 5 * 60 * 1000,
  })

  const materia = (materias ?? []).find((m) => m.materia_id === id)

  if (isLoading) {
    return <PageLoading />
  }

  if (error) {
    return <PageError detail={String(error)} />
  }

  if (!materia) {
    return <MateriaNotFound id={id} />
  }

  async function handleSelectTarea(tarea: AvailableTarea) {
    if (!materia) return
    setOpeningTarea(tarea)
    setOpenError(null)
    try {
      const res = await openEpisode({
        comision_id: materia.comision_id,
        problema_id: tarea.id,
        // Hashes hardcoded del piloto. F9 real los provee el bootstrap.
        curso_config_hash: "c".repeat(64),
        classifier_config_hash: "d".repeat(64),
      })
      navigate({ to: "/episodio/$id", params: { id: res.episode_id } })
    } catch (e) {
      setOpenError(`Error abriendo episodio: ${e}`)
      setOpeningTarea(null)
    }
  }

  return (
    <>
      <ContextualHeader materia={materia} />
      {openError && (
        <div className="bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200 px-6 py-2 text-sm">
          {openError}
        </div>
      )}
      {openingTarea ? (
        <OpeningStage
          tareaCodigo={openingTarea.codigo}
          tareaTitulo={openingTarea.titulo}
          episodeReady={false}
          {...(openError ? { errorMessage: openError } : {})}
          onShowError={() => {
            // El error ya esta visible en el banner rojo de arriba.
          }}
        />
      ) : (
        <TareaSelector
          comisionId={materia.comision_id}
          onSelect={(tarea) => {
            void handleSelectTarea(tarea)
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
