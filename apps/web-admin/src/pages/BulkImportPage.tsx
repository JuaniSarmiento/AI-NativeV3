import { PageContainer } from "@platform/ui"
import { type ReactNode, useState } from "react"
import { type BulkImportCommitResult, type BulkImportReport, HttpError, bulkApi } from "../lib/api"
import { helpContent } from "../utils/helpContent"

type Entity = "facultades" | "carreras" | "planes" | "materias" | "periodos" | "comisiones"

const ENTITY_OPTIONS: { value: Entity; label: string }[] = [
  { value: "facultades", label: "Facultades" },
  { value: "carreras", label: "Carreras" },
  { value: "planes", label: "Planes" },
  { value: "materias", label: "Materias" },
  { value: "periodos", label: "Periodos" },
  { value: "comisiones", label: "Comisiones" },
]

/**
 * Columnas esperadas por entidad (cotejadas contra Pydantic schemas en
 * `apps/academic-service/src/academic_service/schemas/*.py`).
 * Si el backend cambia los schemas, actualizar acá.
 */
const ENTITY_COLUMNS: Record<Entity, { required: string[]; optional: string[] }> = {
  facultades: {
    required: ["nombre", "codigo", "universidad_id"],
    optional: ["decano_user_id"],
  },
  carreras: {
    required: ["nombre", "codigo", "facultad_id"],
    optional: ["duracion_semestres", "modalidad", "director_user_id"],
  },
  planes: {
    required: ["carrera_id", "version", "año_inicio"],
    optional: ["ordenanza", "vigente"],
  },
  materias: {
    required: ["plan_id", "codigo", "nombre", "horas_totales", "cuatrimestre_sugerido"],
    optional: ["objetivos", "correlativas_cursar", "correlativas_rendir"],
  },
  periodos: {
    required: ["codigo", "nombre", "fecha_inicio", "fecha_fin"],
    optional: ["estado"],
  },
  comisiones: {
    required: ["materia_id", "periodo_id", "codigo"],
    optional: ["cupo_maximo", "horario", "ai_budget_monthly_usd"],
  },
}

type DryRunState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; report: BulkImportReport }
  | { status: "error"; message: string }

type CommitState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; result: BulkImportCommitResult }
  | { status: "error"; message: string; report?: BulkImportReport }

export function BulkImportPage(): ReactNode {
  const [entity, setEntity] = useState<Entity>("facultades")
  const [file, setFile] = useState<File | null>(null)
  const [dryRun, setDryRun] = useState<DryRunState>({ status: "idle" })
  const [commit, setCommit] = useState<CommitState>({ status: "idle" })

  const reset = () => {
    setEntity("facultades")
    setFile(null)
    setDryRun({ status: "idle" })
    setCommit({ status: "idle" })
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    // Si cambia el archivo, invalidar dry-run y commit anteriores.
    setDryRun({ status: "idle" })
    setCommit({ status: "idle" })
  }

  const onEntityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setEntity(e.target.value as Entity)
    setDryRun({ status: "idle" })
    setCommit({ status: "idle" })
  }

  const handleDryRun = async () => {
    if (!file) return
    setDryRun({ status: "loading" })
    setCommit({ status: "idle" })
    try {
      const report = await bulkApi.dryRun(entity, file)
      setDryRun({ status: "ok", report })
    } catch (e) {
      setDryRun({
        status: "error",
        message: e instanceof HttpError ? `${e.status}: ${e.detail || e.title}` : String(e),
      })
    }
  }

  const handleCommit = async () => {
    if (!file) return
    setCommit({ status: "loading" })
    try {
      const result = await bulkApi.commit(entity, file)
      setCommit({ status: "ok", result })
    } catch (e) {
      // Si vino un 422 con report estructurado, intentar parsear.
      let parsedReport: BulkImportReport | undefined
      const message = e instanceof HttpError ? `${e.status}: ${e.detail || e.title}` : String(e)
      if (e instanceof HttpError && e.detail) {
        try {
          const parsed = JSON.parse(e.detail)
          if (parsed && typeof parsed === "object" && "errors" in parsed) {
            parsedReport = parsed as BulkImportReport
          }
        } catch {
          /* detail no era JSON */
        }
      }
      setCommit({
        status: "error",
        message,
        ...(parsedReport ? { report: parsedReport } : {}),
      })
    }
  }

  const cols = ENTITY_COLUMNS[entity]
  const canValidate = file !== null && dryRun.status !== "loading"
  const canCommit =
    dryRun.status === "ok" &&
    dryRun.report.invalid_rows === 0 &&
    dryRun.report.total_rows > 0 &&
    commit.status !== "loading" &&
    commit.status !== "ok"

  return (
    <PageContainer
      title="Importacion masiva"
      description="Carga un CSV, valida con dry-run y luego confirma la importacion."
      helpContent={helpContent.bulkImport}
    >
      <div className="space-y-6">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Reiniciar
          </button>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
          <h3 className="font-medium">1. Entidad</h3>
          <label className="flex flex-col gap-1 max-w-md">
            <span className="text-xs font-medium text-slate-700">Tipo de entidad a importar</span>
            <select
              value={entity}
              onChange={onEntityChange}
              className={inputClass}
              disabled={commit.status === "ok"}
            >
              {ENTITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="font-medium text-slate-700 mb-2">Formato esperado</p>
            <p className="text-xs text-slate-600 mb-2">
              Columnas para <span className="font-mono">{entity}</span>:
            </p>
            <ul className="text-xs space-y-1">
              {cols.required.map((c) => (
                <li key={c} className="font-mono">
                  <span className="text-slate-900">{c}</span>{" "}
                  <span className="text-red-600">(requerida)</span>
                </li>
              ))}
              {cols.optional.map((c) => (
                <li key={c} className="font-mono">
                  <span className="text-slate-700">{c}</span>{" "}
                  <span className="text-slate-500">(opcional)</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
          <h3 className="font-medium">2. Archivo CSV</h3>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFileChange}
            disabled={commit.status === "ok"}
            className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
          />
          {file && (
            <p className="text-xs text-slate-600">
              Seleccionado: <span className="font-mono text-slate-900">{file.name}</span>{" "}
              <span className="text-slate-500">({(file.size / 1024).toFixed(1)} KB)</span>
            </p>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
          <h3 className="font-medium">3. Validar (dry-run)</h3>
          <p className="text-sm text-slate-600">
            Sube el archivo y muestra errores sin escribir nada en la base.
          </p>
          <button
            type="button"
            onClick={handleDryRun}
            disabled={!canValidate}
            className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {dryRun.status === "loading" ? "Validando…" : "Validar"}
          </button>

          {dryRun.status === "error" && (
            <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
              {dryRun.message}
            </div>
          )}

          {dryRun.status === "ok" && <ReportView report={dryRun.report} />}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
          <h3 className="font-medium">4. Confirmar importación</h3>
          <p className="text-sm text-slate-600">Sólo habilitado si el dry-run no mostró errores.</p>
          <button
            type="button"
            onClick={handleCommit}
            disabled={!canCommit}
            className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {commit.status === "loading" ? "Importando…" : "Confirmar"}
          </button>

          {commit.status === "error" && (
            <div className="space-y-2">
              <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
                {commit.message}
              </div>
              {commit.report && <ReportView report={commit.report} />}
            </div>
          )}

          {commit.status === "ok" && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 space-y-2">
              <p className="font-medium">Importadas {commit.result.created_count} filas</p>
              {commit.result.created_ids.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-emerald-800 hover:text-emerald-900">
                    Ver IDs creados
                    {commit.result.created_ids.length > 10
                      ? ` (mostrando primeros 10 de ${commit.result.created_ids.length})`
                      : ""}
                  </summary>
                  <ul className="mt-2 font-mono space-y-0.5">
                    {commit.result.created_ids.slice(0, 10).map((id) => (
                      <li key={id}>{id}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </section>
      </div>
    </PageContainer>
  )
}

function ReportView({ report }: { report: BulkImportReport }): ReactNode {
  const allValid = report.invalid_rows === 0 && report.total_rows > 0

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Totales" value={report.total_rows} tone="slate" />
        <Stat label="Válidas" value={report.valid_rows} tone="emerald" />
        <Stat label="Inválidas" value={report.invalid_rows} tone="red" />
      </div>

      {allValid && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          Todas las filas son válidas — listas para importar.
        </div>
      )}

      {report.total_rows === 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          El archivo no contiene filas.
        </div>
      )}

      {report.invalid_rows > 0 && (
        <div className="rounded-md border border-red-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-red-50 border-b border-red-200 text-left">
              <tr>
                <th className="px-4 py-2 font-medium text-red-900">Fila</th>
                <th className="px-4 py-2 font-medium text-red-900">Columna</th>
                <th className="px-4 py-2 font-medium text-red-900">Mensaje</th>
              </tr>
            </thead>
            <tbody>
              {report.errors.map((err, i) => (
                <tr
                  key={`${err.row_number}-${err.column ?? "_"}-${i}`}
                  className="border-b border-red-100 last:border-b-0"
                >
                  <td className="px-4 py-2 font-mono text-xs">{err.row_number}</td>
                  <td className="px-4 py-2 font-mono text-xs">{err.column ?? "—"}</td>
                  <td className="px-4 py-2 text-red-900">{err.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "slate" | "emerald" | "red"
}): ReactNode {
  const toneClasses = {
    slate: "border-slate-200 bg-slate-50 text-slate-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    red: "border-red-200 bg-red-50 text-red-900",
  }[tone]
  return (
    <div className={`rounded-md border p-4 ${toneClasses}`}>
      <div className="text-xs uppercase tracking-wide opacity-75">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  )
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
