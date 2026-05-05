/**
 * Home del web-student (post-craft Fase 2): "Mis materias".
 *
 * El alumno ve UNA card por inscripción activa. Diseño deliberado:
 *   - N=0: empty state honesto (mensaje literal del gap B.2 + strip N1-N4
 *     del WelcomeStage para que el comité vea el modelo desde el primer pixel).
 *   - N=1: la card prominente (caso piloto típico).
 *   - N=2..5: lista de cards con el mismo formato que N=1.
 *   - N>5: list items densos sin box (regla "no card grids uniformes").
 *
 * TanStack Query con `staleTime` de 5min para el single-flight per page.
 * Sin re-fetch en cada render. Cuando el alumno vuelve desde /materia/:id
 * la cache evita el spinner.
 *
 * Bootstrap recovery: si hay `active-episode-id` en sessionStorage,
 * redirigimos a /episodio/:id antes de pintar la home — preserva la UX
 * de "recuperar sesion" del flujo viejo.
 */
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { MateriaCard } from "../components/MateriaCard"
import { type MateriaInscripta, listMisMaterias } from "../lib/api"

const ACTIVE_EPISODE_KEY = "active-episode-id"

export const Route = createFileRoute("/")({
  component: HomePage,
})

function HomePage() {
  const navigate = useNavigate()

  // Recovery: si hay un episode_id en sessionStorage saltamos a esa ruta
  // ANTES de pintar la home. La ruta /episodio/:id se encarga de hidratar
  // el estado real (o limpiar el sessionStorage si el episodio ya cerró).
  useEffect(() => {
    if (typeof window === "undefined") return
    const storedId = window.sessionStorage.getItem(ACTIVE_EPISODE_KEY)
    if (storedId) {
      navigate({ to: "/episodio/$id", params: { id: storedId } })
    }
  }, [navigate])

  const { data, isLoading, error } = useQuery({
    queryKey: ["mis-materias"],
    queryFn: () => listMisMaterias(),
    staleTime: 5 * 60 * 1000,
  })

  return (
    <HomeContent
      isLoading={isLoading}
      error={error ? String(error) : null}
      materias={data ?? []}
      onEnter={(materia) =>
        navigate({ to: "/materia/$id", params: { id: materia.materia_id } })
      }
    />
  )
}

/**
 * Vista presentacional pura de la home — sin TanStack Query / Router.
 * Permite testear los 3 estados (loading, error, lista) sin envolver en
 * un RouterProvider de testbed.
 */
export interface HomeContentProps {
  isLoading: boolean
  error: string | null
  materias: MateriaInscripta[]
  onEnter: (m: MateriaInscripta) => void
}

export function HomeContent({ isLoading, error, materias, onEnter }: HomeContentProps) {
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8" data-testid="home-loading">
        <div
          className="inline-block w-6 h-6 border-2 border-t-transparent rounded-full motion-safe:animate-spin"
          style={{ borderColor: "var(--color-accent-brand)", borderTopColor: "transparent" }}
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-2">
            No pudimos cargar tus materias.
          </p>
          <p className="text-xs font-mono text-slate-500">{error}</p>
        </div>
      </div>
    )
  }

  if (materias.length === 0) {
    return <EmptyState />
  }

  // N>5 → lista densa; N≤5 → cards. Decisión bicapa:
  //   cards cumplen "una pieza desigual" cuando N≤5;
  //   list items densos cumplen "no card grid uniforme" cuando N>5.
  const usaListaDensa = materias.length > 5

  return (
    <div className="flex-1 overflow-y-auto px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <p
          className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3"
          data-testid="home-kicker-periodo"
        >
          {firstPeriodoCodigo(materias) ?? "Cuatrimestre actual"}
        </p>

        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50 mb-8">
          Mis materias
        </h2>

        {usaListaDensa ? (
          <DensaList materias={materias} onEnter={onEnter} />
        ) : (
          <ul className="space-y-4">
            {materias.map((m) => (
              <li key={m.inscripcion_id}>
                <MateriaCard materia={m} onEnter={onEnter} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function firstPeriodoCodigo(materias: MateriaInscripta[]): string | null {
  if (materias.length === 0) return null
  const m = materias[0]
  if (!m) return null
  return m.periodo_codigo
}

// ─── Empty state honesto (gap B.2) + strip N1-N4 ────────────────────────

interface LevelBlurb {
  level: "N1" | "N2" | "N3" | "N4"
  label: string
  description: string
  colorVar: string
}

const LEVELS: LevelBlurb[] = [
  {
    level: "N1",
    label: "Lectura",
    description: "Lees el enunciado y planeas tu abordaje.",
    colorVar: "var(--color-level-n1)",
  },
  {
    level: "N2",
    label: "Anotacion",
    description: "Anotas tu plan, dudas, ideas.",
    colorVar: "var(--color-level-n2)",
  },
  {
    level: "N3",
    label: "Validacion",
    description: "Corres tests y debugeas.",
    colorVar: "var(--color-level-n3)",
  },
  {
    level: "N4",
    label: "Tutor",
    description: "Preguntas cuando te trabas.",
    colorVar: "var(--color-level-n4)",
  },
]

function EmptyState() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <p className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4">
          UNSL · Plataforma del piloto
        </p>

        <h1 className="text-2xl font-semibold leading-tight text-slate-900 dark:text-slate-50 mb-4">
          Tutor socratico con trazabilidad cognitiva.
        </h1>

        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed mb-10 max-w-2xl">
          No te da la respuesta. Te acompana a construirla. Cada interaccion queda registrada en
          una cadena verificable.
        </p>

        <section
          aria-label="Como trabajas con el tutor"
          className="border-t border-slate-200 dark:border-slate-800 pt-6 mb-10"
        >
          <p className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-5">
            Como trabajas
          </p>
          <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-6">
            {LEVELS.map((lvl) => (
              <li key={lvl.level} className="flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    aria-hidden="true"
                    data-testid={`level-dot-${lvl.level.toLowerCase()}`}
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: lvl.colorVar }}
                  />
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {lvl.level} {lvl.label}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {lvl.description}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <div
          role="status"
          data-testid="home-empty-gap-b2"
          className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl border-l border-slate-300 dark:border-slate-700 pl-3"
        >
          <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">
            No estas viendo tus materias?
          </p>
          <p>
            Tu Direccion de Informatica todavia no activo tu inscripcion. Ver gap-B.2 / ADR-029
            para el detalle.
          </p>
        </div>
      </div>
    </div>
  )
}

function DensaList({
  materias,
  onEnter,
}: {
  materias: MateriaInscripta[]
  onEnter: (m: MateriaInscripta) => void
}) {
  return (
    <ul
      className="divide-y divide-slate-100 dark:divide-slate-800"
      data-testid="home-densa-list"
    >
      {materias.map((m) => {
        const comisionLabel = m.comision_nombre ?? `Comision ${m.comision_codigo}`
        return (
          <li
            key={m.inscripcion_id}
            data-testid="materia-list-item"
            data-materia-codigo={m.codigo}
            className="py-4 flex items-start gap-4"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {m.codigo}
                </span>
                <span className="text-slate-400">·</span>
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {comisionLabel}
                </span>
              </div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {m.nombre}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {m.periodo_codigo}
                {m.horario_resumen && (
                  <>
                    <span className="text-slate-400 mx-1.5">·</span>
                    {m.horario_resumen}
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onEnter(m)}
              className="shrink-0 px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Entrar
            </button>
          </li>
        )
      })}
    </ul>
  )
}
