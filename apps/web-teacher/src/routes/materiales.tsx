import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { MaterialesView } from "../views/MaterialesView"

const searchSchema = z.object({
  comisionId: z.string().uuid().optional(),
})

export const Route = createFileRoute("/materiales")({
  validateSearch: searchSchema,
  component: function MaterialesRoute() {
    const { getToken } = Route.useRouteContext()
    const { comisionId } = Route.useSearch()
    if (!comisionId) {
      return (
        <div className="flex-1 flex items-center justify-center p-8 min-h-screen">
          <div className="max-w-md text-center">
            <p className="text-base text-slate-600 dark:text-slate-400">
              Seleccioná una comisión en el panel lateral para empezar.
            </p>
          </div>
        </div>
      )
    }
    return <MaterialesView comisionId={comisionId} getToken={getToken} />
  },
})
