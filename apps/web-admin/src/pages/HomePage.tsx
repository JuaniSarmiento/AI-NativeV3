import { PageContainer } from "@platform/ui"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { helpContent } from "../utils/helpContent"

export function HomePage(): ReactNode {
  const [apiStatus, setApiStatus] = useState<string>("verificando...")

  useEffect(() => {
    fetch("/api/")
      .then((r) => r.json())
      .then((d) => setApiStatus(d.status ?? "unknown"))
      .catch(() => setApiStatus("no responde"))
  }, [])

  return (
    <PageContainer
      title="Bienvenido"
      description="Panel de administracion institucional"
      helpContent={helpContent.home}
    >
      <div className="space-y-6">
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
              <strong>Universidades</strong> — gestión de tenants (solo superadmin puede crear).
            </li>
            <li>
              <strong>Carreras</strong> — programas académicos dentro de una universidad.
            </li>
            <li>
              <strong>Materias</strong> — listado por plan de estudio con CRUD completo.
            </li>
            <li>
              <strong>Comisiones</strong> — secciones de cursado por materia y período, con altas y
              bajas.
            </li>
            <li>
              <strong>Facultades</strong> — divisiones académicas dentro de una universidad.
            </li>
            <li>
              <strong>Planes de estudio</strong> — planes vigentes por carrera.
            </li>
            <li>
              <strong>Importación masiva</strong> — carga de
              Facultades/Carreras/Planes/Materias/Periodos/Comisiones desde CSV con dry-run preview.
            </li>
            <li className="text-slate-500">Inscripciones — próxima iteración.</li>
          </ul>
        </section>
      </div>
    </PageContainer>
  )
}
