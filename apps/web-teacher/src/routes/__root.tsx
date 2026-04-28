/**
 * Root layout del web-teacher (ADR-022).
 *
 * - Sidebar con NAV_GROUPS (cada item es un <Link to=...>).
 * - <Outlet /> para renderizar la ruta hija.
 * - `selectedComisionId` vive en search params (?comisionId=X) para que sea
 *   shareable y persista en F5. ComisionSelector escribe en URL via setSearch.
 * - getToken centralizado: las rutas hijas lo reciben via context (no prop drilling).
 */
import { type NavGroup, Sidebar } from "@platform/ui"
import { Outlet, createRootRouteWithContext, useNavigate } from "@tanstack/react-router"
import {
  BarChart3,
  ClipboardList,
  Download,
  FileBarChart,
  FileCode2,
  FolderOpen,
  Layers,
  ShieldAlert,
  TrendingUp,
} from "lucide-react"
import { useCallback } from "react"
import { ComisionSelectorRouted } from "../components/ComisionSelectorRouted"

export interface RouterContext {
  /** Función de auth — placeholder hasta integración Keycloak (F8). */
  getToken: () => Promise<string | null>
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Trabajo del docente",
    items: [
      { id: "/templates", label: "Plantillas", icon: FileCode2 },
      { id: "/tareas-practicas", label: "Trabajos Prácticos", icon: ClipboardList },
      { id: "/materiales", label: "Materiales", icon: FolderOpen },
    ],
  },
  {
    label: "Análisis",
    items: [
      { id: "/progression", label: "Progresión", icon: BarChart3 },
      { id: "/student-longitudinal", label: "Evolución por estudiante", icon: TrendingUp },
      { id: "/episode-n-level", label: "Niveles N1-N4", icon: Layers },
      { id: "/cohort-adversarial", label: "Intentos adversos", icon: ShieldAlert },
      { id: "/kappa", label: "Inter-rater", icon: FileBarChart },
    ],
  },
  {
    label: "Operacional",
    items: [{ id: "/export", label: "Exportar", icon: Download }],
  },
]

function RootLayout() {
  const navigate = useNavigate()
  const handleNavigate = useCallback(
    (id: string) => {
      // `id` es un path (`/progression`, etc.). Navegamos preservando search params.
      navigate({ to: id as never })
    },
    [navigate],
  )

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50">
      <Sidebar
        navGroups={NAV_GROUPS}
        headerLabel="Docente · N4"
        collapsedHeaderLabel="N4"
        storageKey="web-teacher-sidebar-collapsed"
        activeItemId={window.location.pathname}
        onNavigate={handleNavigate}
        topSlot={<ComisionSelectorRouted />}
      />
      <main className="flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  )
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: () => (
    <div className="flex-1 flex items-center justify-center p-8 min-h-screen">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100">
          Vista no encontrada
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          La URL que intentaste abrir no corresponde a ninguna vista del web-teacher.
        </p>
      </div>
    </div>
  ),
})
