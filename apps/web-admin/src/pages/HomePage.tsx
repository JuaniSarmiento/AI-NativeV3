import type { ReactNode } from "react"
import { useEffect, useState } from "react"

export function HomePage(): ReactNode {
  const [apiStatus, setApiStatus] = useState<string>("verificando...")

  useEffect(() => {
    fetch("/api/")
      .then((r) => r.json())
      .then((d) => setApiStatus(d.status ?? "unknown"))
      .catch(() => setApiStatus("no responde"))
  }, [])

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Bienvenido</h2>
        <p className="text-slate-600 mt-1">
          Panel de administración institucional
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="font-medium mb-3">Estado de la plataforma</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-slate-500">API Gateway</dt>
          <dd className="font-mono">{apiStatus}</dd>
          <dt className="text-slate-500">Fase</dt>
          <dd className="font-mono">F1 — Dominio académico</dd>
        </dl>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="font-medium mb-3">Recursos disponibles</h3>
        <ul className="space-y-2 text-sm">
          <li>
            <strong>Universidades</strong> — gestión de tenants (solo superadmin
            puede crear).
          </li>
          <li>
            <strong>Carreras</strong> — programas académicos dentro de una
            universidad.
          </li>
          <li className="text-slate-500">
            Materias, Comisiones, Periodos, Inscripciones — próximas vistas
            (F1-W7).
          </li>
        </ul>
      </section>
    </div>
  )
}
