/**
 * Root layout del web-student (post-craft Fase 2).
 *
 * Pattern espejo del web-teacher:
 *   - createRootRouteWithContext para que las rutas hijas reciban `getToken`
 *     sin prop drilling.
 *   - Header global SIN selector de comisión: el alumno YA NO elige comisión.
 *     La comisión es metadata de la materia (visible en /materia/:id).
 *   - <Outlet /> renderiza la ruta hija.
 *   - <AuditFooter /> al pie en TODAS las rutas (Design Principle 2 del PRODUCT.md:
 *     "auditabilidad visible, no oculta"). El footer hoy se monta SIN episodeId
 *     porque ese estado vive ahora dentro de /episodio/$id; cuando esa ruta
 *     este activa, va a inyectar el id via search/path param y el footer va a
 *     pollear el verify (mejora pendiente; el render con null sigue siendo válido).
 */
import { AuditFooter, HelpButton } from "@platform/ui"
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router"
import { helpContent } from "../utils/helpContent"

export interface RouterContext {
  /** Función de auth — placeholder hasta integración Keycloak (F8). */
  getToken: () => Promise<string | null>
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 flex flex-col">
      <header className="border-b border-slate-200 dark:border-slate-800 px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span
            aria-hidden="true"
            className="inline-block w-1.5 h-4 rounded-sm"
            style={{ backgroundColor: "var(--color-accent-brand)" }}
          />
          <h1 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Plataforma N4 <span className="text-slate-400 mx-1">·</span> UNSL
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <HelpButton title="Tutor Socratico" content={helpContent.episode} />
        </div>
      </header>

      <Outlet />

      <AuditFooter episodeId={null} classifierHash={null} />
    </div>
  )
}
