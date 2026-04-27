import { DEMO_COMISION_ID } from "@platform/contracts"
import { type NavGroup, Sidebar } from "@platform/ui"
import {
  BarChart3,
  ClipboardList,
  Download,
  FileBarChart,
  FileCode2,
  FolderOpen,
} from "lucide-react"
import { useCallback, useState } from "react"
import { ComisionSelector } from "./components/ComisionSelector"
import { ExportView } from "./views/ExportView"
import { KappaRatingView } from "./views/KappaRatingView"
import { MaterialesView } from "./views/MaterialesView"
import { ProgressionView } from "./views/ProgressionView"
import { TareasPracticasView } from "./views/TareasPracticasView"
import { TemplatesView } from "./views/TemplatesView"

/**
 * Identificadores de vista del web-teacher.
 *
 * El web-teacher hace state-based switching (no rutas reales con router) — este union
 * coincide 1:1 con los `id` de `NAV_GROUPS`. Si se agrega una vista nueva, actualizar
 * ambos lugares. Cuando se migre a TanStack Router type-safe (F2-F3), reemplazar por
 * los path types generados.
 */
export type View =
  | "progression"
  | "kappa"
  | "tareas-practicas"
  | "templates"
  | "materiales"
  | "export"

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Trabajo del docente",
    items: [
      { id: "templates", label: "Plantillas", icon: FileCode2 },
      { id: "tareas-practicas", label: "Trabajos Prácticos", icon: ClipboardList },
      { id: "materiales", label: "Materiales", icon: FolderOpen },
    ],
  },
  {
    label: "Análisis",
    items: [
      { id: "progression", label: "Progresión", icon: BarChart3 },
      { id: "kappa", label: "Inter-rater", icon: FileBarChart },
    ],
  },
  {
    label: "Operacional",
    items: [{ id: "export", label: "Exportar", icon: Download }],
  },
]

// Re-export del constante compartido para que callers que ya importaban
// desde "./App" sigan funcionando. La definición vive en
// `packages/contracts/src/demo/constants.ts` (F10).
export { DEMO_COMISION_ID }

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
  const [view, setView] = useState<View>("tareas-practicas")
  const [selectedComisionId, setSelectedComisionId] = useState<string | null>(null)

  // Placeholder de auth — cuando integremos keycloak-js, acá usamos useAuth()
  const getToken = useCallback(async (): Promise<string | null> => {
    return "dev-token"
  }, [])

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50">
      <Sidebar
        navGroups={NAV_GROUPS}
        headerLabel="Docente · N4"
        collapsedHeaderLabel="N4"
        storageKey="web-teacher-sidebar-collapsed"
        activeItemId={view}
        onNavigate={(id) => setView(id as View)}
        topSlot={<ComisionSelector value={selectedComisionId} onChange={setSelectedComisionId} />}
      />
      <main className="flex-1 overflow-x-hidden">
        {/* `templates` es vista a nivel catedra (materia + periodo) — usa su
            propio `AcademicContextSelector` interno y no depende de la comision
            seleccionada. Por eso se renderiza antes del gate de selectedComisionId. */}
        {view === "templates" ? (
          <TemplatesView getToken={getToken} />
        ) : selectedComisionId === null ? (
          <div className="flex-1 flex items-center justify-center p-8 min-h-screen">
            <div className="max-w-md text-center">
              <p className="text-base text-slate-600 dark:text-slate-400">
                Seleccioná una comisión en el panel lateral para empezar.
              </p>
            </div>
          </div>
        ) : (
          <>
            {view === "progression" && (
              <ProgressionView comisionId={selectedComisionId} getToken={getToken} />
            )}
            {view === "kappa" && <KappaRatingView getToken={getToken} episodes={DEMO_EPISODES} />}
            {view === "tareas-practicas" && (
              <TareasPracticasView comisionId={selectedComisionId} getToken={getToken} />
            )}
            {view === "materiales" && (
              <MaterialesView comisionId={selectedComisionId} getToken={getToken} />
            )}
            {view === "export" && (
              <ExportView getToken={getToken} comisionIdDefault={selectedComisionId} />
            )}
          </>
        )}
      </main>
    </div>
  )
}
