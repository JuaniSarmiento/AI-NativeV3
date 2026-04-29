import { createFileRoute, redirect } from "@tanstack/react-router"

// Default redirect: / → /tareas-practicas (primera vista del NAV_GROUPS)
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/tareas-practicas" })
  },
})
