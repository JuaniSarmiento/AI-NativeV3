import { useCallback, useState } from "react"
import { ExportView } from "./views/ExportView"
import { KappaRatingView } from "./views/KappaRatingView"
import { ProgressionView } from "./views/ProgressionView"

type View = "progression" | "kappa" | "export"

const DEMO_COMISION_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

// Episodios de demo para la vista Kappa. En prod, vienen de un endpoint
// GET /api/v1/analytics/cohort/{id}/episodes?needs_human_rating=true
const DEMO_EPISODES = [
  {
    episode_id: "ep_demo_1",
    classifier_label: "apropiacion_reflexiva" as const,
    summary:
      "Estudiante pregunta por qué su solución tiene complejidad O(n²) y propone alternativas con hash map antes de pedir código.",
  },
  {
    episode_id: "ep_demo_2",
    classifier_label: "delegacion_pasiva" as const,
    summary:
      '"Dame la solución del ejercicio 3 del TP" — tres prompts consecutivos pidiendo código directo, copia-pega sin preguntar.',
  },
  {
    episode_id: "ep_demo_3",
    classifier_label: "apropiacion_superficial" as const,
    summary:
      'Pregunta conceptos sueltos ("¿qué es recursión?"), recibe respuestas, ejecuta código sin probar alternativas ni validar edge cases.',
  },
]

export default function App() {
  const [view, setView] = useState<View>("progression")

  // Placeholder de auth — cuando integremos keycloak-js, acá usamos useAuth()
  const getToken = useCallback(async (): Promise<string | null> => {
    return "dev-token"
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50">
      <Header currentView={view} onViewChange={setView} />
      <main>
        {view === "progression" && (
          <ProgressionView comisionId={DEMO_COMISION_ID} getToken={getToken} />
        )}
        {view === "kappa" && (
          <KappaRatingView getToken={getToken} episodes={DEMO_EPISODES} />
        )}
        {view === "export" && (
          <ExportView getToken={getToken} comisionIdDefault={DEMO_COMISION_ID} />
        )}
      </main>
    </div>
  )
}

function Header({
  currentView,
  onViewChange,
}: {
  currentView: View
  onViewChange: (v: View) => void
}) {
  const tabs: Array<{ id: View; label: string; description: string }> = [
    { id: "progression", label: "Progresión", description: "Trayectorias N4" },
    { id: "kappa", label: "Inter-rater", description: "Validar clasificador (Kappa)" },
    { id: "export", label: "Exportar", description: "Dataset académico" },
  ]

  return (
    <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="px-6 py-4">
        <h1 className="text-xl font-semibold">Plataforma — Docente</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Análisis empírico · Kappa · Exportación de datasets
        </p>
      </div>
      <nav className="px-6 border-t border-slate-100 dark:border-slate-800 flex gap-1">
        {tabs.map((tab) => {
          const active = currentView === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onViewChange(tab.id)}
              className={`px-4 py-3 text-sm border-b-2 transition ${
                active
                  ? "border-blue-600 text-blue-600 font-medium"
                  : "border-transparent text-slate-600 hover:text-slate-900 dark:hover:text-slate-100"
              }`}
              title={tab.description}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>
    </header>
  )
}
