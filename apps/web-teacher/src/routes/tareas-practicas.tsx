import { EmptyHero } from "@platform/ui"
import { createFileRoute } from "@tanstack/react-router"
import { BookOpen } from "lucide-react"
import { z } from "zod"
import { TareasPracticasView } from "../views/TareasPracticasView"

const searchSchema = z.object({
  comisionId: z.string().uuid().optional(),
})

export const Route = createFileRoute("/tareas-practicas")({
  validateSearch: searchSchema,
  component: function TareasPracticasRoute() {
    const { getToken } = Route.useRouteContext()
    const { comisionId } = Route.useSearch()
    if (!comisionId) {
      return (
        <div className="flex-1 flex items-center justify-center min-h-screen">
          <EmptyHero
            icon={<BookOpen className="h-12 w-12" />}
            title="Empezá eligiendo una comisión"
            description="Elegí la comisión con la que vas a trabajar para ver progresión, niveles y trabajos prácticos."
            hint="Después podés cambiarla desde el panel lateral."
          />
        </div>
      )
    }
    return <TareasPracticasView comisionId={comisionId} getToken={getToken} />
  },
})
