/**
 * Router principal del web-admin.
 *
 * F1: rutas simples. En F2-F3 se reemplaza por TanStack Router con
 * type-safe routes y code splitting automático.
 */
import { type ReactNode, useState } from "react"
import { UniversidadesPage } from "../pages/UniversidadesPage"
import { CarrerasPage } from "../pages/CarrerasPage"
import { HomePage } from "../pages/HomePage"
import { ClasificacionesPage } from "../pages/ClasificacionesPage"

type Route = "home" | "universidades" | "carreras" | "clasificaciones"

export interface NavContext {
  current: Route
  navigate: (to: Route) => void
}

export function Router(): ReactNode {
  const [current, setCurrent] = useState<Route>("home")

  const navigate = (to: Route) => setCurrent(to)

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Nav current={current} navigate={navigate} />
      <main className="flex-1 container mx-auto p-6 max-w-6xl">
        {current === "home" && <HomePage />}
        {current === "universidades" && <UniversidadesPage />}
        {current === "carreras" && <CarrerasPage />}
        {current === "clasificaciones" && <ClasificacionesPage />}
      </main>
    </div>
  )
}

function Nav({ current, navigate }: NavContext): ReactNode {
  const items: { route: Route; label: string }[] = [
    { route: "home", label: "Inicio" },
    { route: "universidades", label: "Universidades" },
    { route: "carreras", label: "Carreras" },
    { route: "clasificaciones", label: "Clasificaciones N4" },
  ]

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="container mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Plataforma · Admin</h1>
        <nav className="flex gap-4">
          {items.map((item) => (
            <button
              type="button"
              key={item.route}
              onClick={() => navigate(item.route)}
              className={
                current === item.route
                  ? "text-blue-700 font-medium"
                  : "text-slate-600 hover:text-slate-900"
              }
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}
