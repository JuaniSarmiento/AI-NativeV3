/**
 * Vista de Plantillas de TP (ADR-016).
 *
 * Permite a la cátedra (docente) gestionar TP-templates canónicos por
 * (materia, periodo). Al crear un template, el backend fan-out-ea
 * instancias en TODAS las comisiones de esa materia+periodo (auto-seed).
 * Editar una instancia en su comision dispara `has_drift=true`; crear
 * una nueva version del template con `reinstance_non_drifted=true`
 * propaga el cambio a las comisiones sin drift.
 *
 * Workflow operativo:
 *  1. Seleccionar contexto academico (Univ -> ... -> Materia + Periodo)
 *  2. Lista de templates existentes; crear uno nuevo
 *  3. Publicar / archivar / nueva version
 *  4. Ver instancias (cuales estan drifted, cuales siguen al template)
 *
 * Patron de estados de modal: `ModalState` discriminated union — mutex
 * estricto para evitar doble modal. Mismo patron que `TareasPracticasView`.
 */
import { HelpButton, MarkdownRenderer, Modal, PageContainer } from "@platform/ui"
import { useCallback, useEffect, useState } from "react"
import {
  type AcademicContext,
  AcademicContextSelector,
} from "../components/AcademicContextSelector"
import {
  type TareaEstado,
  type TareaPractica,
  type TareaPracticaTemplate,
  type TareaPracticaTemplateCreate,
  type TareaPracticaTemplateUpdate,
  tareasPracticasTemplatesApi,
} from "../lib/api"
import { helpContent } from "../utils/helpContent"

interface Props {
  getToken: () => Promise<string | null>
}

const ESTADO_LABEL: Record<TareaEstado, string> = {
  draft: "Borrador",
  published: "Publicado",
  archived: "Archivado",
}

const ESTADO_COLOR: Record<TareaEstado, string> = {
  draft: "bg-slate-200 text-slate-800",
  published: "bg-green-100 text-green-800",
  archived: "bg-amber-100 text-amber-800",
}

type ModalState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; template: TareaPracticaTemplate }
  | { kind: "view"; template: TareaPracticaTemplate }
  | { kind: "instances"; template: TareaPracticaTemplate }
  | { kind: "new-version"; template: TareaPracticaTemplate }

function isoToLocalInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToIso(local: string): string | null {
  if (!local) return null
  return new Date(local).toISOString()
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function TemplatesView({ getToken }: Props) {
  const [ctx, setCtx] = useState<AcademicContext | null>(null)
  const [templates, setTemplates] = useState<TareaPracticaTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ kind: "closed" })

  const closeModal = () => setModal({ kind: "closed" })

  const refreshList = useCallback(async () => {
    if (!ctx) {
      setTemplates([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await tareasPracticasTemplatesApi.list(
        { materia_id: ctx.materiaId, periodo_id: ctx.periodoId },
        getToken,
      )
      setTemplates(list)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [ctx, getToken])

  useEffect(() => {
    refreshList()
  }, [refreshList])

  const handlePublish = async (t: TareaPracticaTemplate) => {
    try {
      await tareasPracticasTemplatesApi.publish(t.id, getToken)
      await refreshList()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleArchive = async (t: TareaPracticaTemplate) => {
    const ok = window.confirm(
      `Archivar la plantilla "${t.codigo}: ${t.titulo}"? Las instancias en comisiones no se archivan automáticamente.`,
    )
    if (!ok) return
    try {
      await tareasPracticasTemplatesApi.archive(t.id, getToken)
      await refreshList()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleDelete = async (t: TareaPracticaTemplate) => {
    const ok = window.confirm(
      `Eliminar la plantilla "${t.codigo}: ${t.titulo}"? Soft delete. Las instancias existentes quedan con link muerto al template.`,
    )
    if (!ok) return
    try {
      await tareasPracticasTemplatesApi.delete(t.id, getToken)
      await refreshList()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <PageContainer
      title="Plantillas de Trabajos Prácticos"
      description="Gestión de templates canónicos a nivel cátedra (materia + periodo). Las plantillas se instancian automáticamente en todas las comisiones de la misma materia y periodo."
      helpContent={helpContent.templates}
    >
      <div className="space-y-6 max-w-6xl">
        <AcademicContextSelector value={ctx} onChange={setCtx} getToken={getToken} />

        {!ctx ? (
          <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500">
            Selecciona universidad, facultad, carrera, plan, materia y periodo para ver o crear
            plantillas.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <button
                type="button"
                onClick={refreshList}
                disabled={loading}
                className="px-3 py-1 text-xs border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
              >
                {loading ? "Cargando..." : "Refrescar"}
              </button>
              <button
                type="button"
                onClick={() => setModal({ kind: "create" })}
                className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
              >
                + Nueva plantilla
              </button>
            </div>

            {error && <div className="p-3 rounded bg-red-50 text-red-900 text-sm">{error}</div>}

            {loading && templates.length === 0 ? (
              <div className="p-8 text-center text-slate-500">Cargando plantillas...</div>
            ) : templates.length === 0 ? (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-slate-500">
                No hay plantillas para esta materia y periodo. Crea la primera con{" "}
                <span className="font-medium">+ Nueva plantilla</span>.
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Codigo</th>
                      <th className="text-left px-4 py-2 font-medium">Titulo</th>
                      <th className="text-left px-4 py-2 font-medium">Estado</th>
                      <th className="text-right px-4 py-2 font-medium">Version</th>
                      <th className="text-right px-4 py-2 font-medium">Peso</th>
                      <th className="text-right px-4 py-2 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((t) => (
                      <TemplateRow
                        key={t.id}
                        template={t}
                        onView={() => setModal({ kind: "view", template: t })}
                        onEdit={() => setModal({ kind: "edit", template: t })}
                        onPublish={() => handlePublish(t)}
                        onArchive={() => handleArchive(t)}
                        onDelete={() => handleDelete(t)}
                        onShowInstances={() => setModal({ kind: "instances", template: t })}
                        onNewVersion={() => setModal({ kind: "new-version", template: t })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Modal: crear plantilla */}
        {modal.kind === "create" && ctx && (
          <TemplateFormModal
            title="Nueva plantilla de TP"
            initial={null}
            submitLabel="Crear plantilla"
            onClose={closeModal}
            onSubmit={async (values) => {
              const body: TareaPracticaTemplateCreate = {
                materia_id: ctx.materiaId,
                periodo_id: ctx.periodoId,
                codigo: values.codigo,
                titulo: values.titulo,
                enunciado: values.enunciado,
                peso: values.peso,
                fecha_inicio: values.fecha_inicio,
                fecha_fin: values.fecha_fin,
                rubrica: values.rubrica,
                inicial_codigo: values.inicial_codigo,
              }
              await tareasPracticasTemplatesApi.create(body, getToken)
              closeModal()
              await refreshList()
            }}
          />
        )}

        {/* Modal: editar plantilla (draft solamente) */}
        {modal.kind === "edit" && (
          <TemplateFormModal
            title={`Editar plantilla: ${modal.template.codigo}`}
            initial={modal.template}
            submitLabel="Guardar cambios"
            onClose={closeModal}
            lockCodigo
            onSubmit={async (values) => {
              const patch: TareaPracticaTemplateUpdate = {
                titulo: values.titulo,
                enunciado: values.enunciado,
                peso: values.peso,
                fecha_inicio: values.fecha_inicio,
                fecha_fin: values.fecha_fin,
                rubrica: values.rubrica,
                inicial_codigo: values.inicial_codigo,
              }
              await tareasPracticasTemplatesApi.update(modal.template.id, patch, getToken)
              closeModal()
              await refreshList()
            }}
          />
        )}

        {/* Modal: nueva version */}
        {modal.kind === "new-version" && (
          <NewVersionModal
            template={modal.template}
            getToken={getToken}
            onClose={closeModal}
            onDone={async () => {
              closeModal()
              await refreshList()
            }}
          />
        )}

        {/* Modal: ver detalle plantilla */}
        {modal.kind === "view" && (
          <TemplateViewModal template={modal.template} onClose={closeModal} />
        )}

        {/* Modal: ver instancias */}
        {modal.kind === "instances" && (
          <InstancesModal template={modal.template} getToken={getToken} onClose={closeModal} />
        )}
      </div>
    </PageContainer>
  )
}

// ── Row ───────────────────────────────────────────────────────────────

function TemplateRow({
  template,
  onView,
  onEdit,
  onPublish,
  onArchive,
  onDelete,
  onShowInstances,
  onNewVersion,
}: {
  template: TareaPracticaTemplate
  onView: () => void
  onEdit: () => void
  onPublish: () => void
  onArchive: () => void
  onDelete: () => void
  onShowInstances: () => void
  onNewVersion: () => void
}) {
  const estado = template.estado
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800/50 last:border-0">
      <td className="px-4 py-2 font-mono text-xs">{template.codigo}</td>
      <td className="px-4 py-2">
        <div className="font-medium truncate max-w-xs" title={template.titulo}>
          {template.titulo}
        </div>
        {template.parent_template_id && <div className="text-xs text-slate-500">(derivada)</div>}
      </td>
      <td className="px-4 py-2">
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ESTADO_COLOR[estado]}`}
        >
          {ESTADO_LABEL[estado]}
        </span>
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-slate-600">v{template.version}</td>
      <td className="px-4 py-2 text-right tabular-nums text-slate-600">{template.peso}</td>
      <td className="px-4 py-2 text-right">
        <div className="flex justify-end gap-1 flex-wrap">
          <button
            type="button"
            onClick={onShowInstances}
            className="px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 rounded"
            title="Ver instancias en comisiones"
          >
            Instancias
          </button>
          <button
            type="button"
            onClick={onView}
            className="px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 rounded"
          >
            Ver
          </button>
          {estado === "draft" && (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 rounded"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={onPublish}
                className="px-2 py-1 text-xs text-green-700 hover:bg-green-50 rounded font-medium"
              >
                Publicar
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="px-2 py-1 text-xs text-red-700 hover:bg-red-50 rounded"
              >
                Eliminar
              </button>
            </>
          )}
          {estado === "published" && (
            <>
              <button
                type="button"
                onClick={onNewVersion}
                className="px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 rounded"
              >
                Nueva version
              </button>
              <button
                type="button"
                onClick={onArchive}
                className="px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 rounded"
              >
                Archivar
              </button>
            </>
          )}
          {estado === "archived" && (
            <button
              type="button"
              onClick={onNewVersion}
              className="px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 rounded"
            >
              Nueva version
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Form modal (create / edit) ────────────────────────────────────────

interface FormValues {
  codigo: string
  titulo: string
  enunciado: string
  fecha_inicio: string | null
  fecha_fin: string | null
  peso: string
  rubrica: Record<string, unknown> | null
  inicial_codigo: string | null
}

function TemplateFormModal({
  title,
  initial,
  submitLabel,
  onClose,
  onSubmit,
  lockCodigo = false,
}: {
  title: string
  initial: TareaPracticaTemplate | null
  submitLabel: string
  onClose: () => void
  onSubmit: (values: FormValues) => Promise<void>
  lockCodigo?: boolean
}) {
  const [codigo, setCodigo] = useState(initial?.codigo ?? "")
  const [titulo, setTitulo] = useState(initial?.titulo ?? "")
  const [enunciado, setEnunciado] = useState(initial?.enunciado ?? "")
  const [fechaInicio, setFechaInicio] = useState(isoToLocalInput(initial?.fecha_inicio ?? null))
  const [fechaFin, setFechaFin] = useState(isoToLocalInput(initial?.fecha_fin ?? null))
  const [peso, setPeso] = useState(initial?.peso ?? "1.0")
  const [inicialCodigo, setInicialCodigo] = useState(initial?.inicial_codigo ?? "")
  const [rubricaRaw, setRubricaRaw] = useState(
    initial?.rubrica ? JSON.stringify(initial.rubrica, null, 2) : "",
  )
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (fechaInicio && fechaFin && fechaFin <= fechaInicio) {
      setFormError("La fecha de fin debe ser posterior a la fecha de inicio.")
      return
    }

    let rubrica: Record<string, unknown> | null = null
    if (rubricaRaw.trim()) {
      try {
        const parsed = JSON.parse(rubricaRaw)
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("La rubrica debe ser un objeto JSON (no array ni primitivo).")
        }
        rubrica = parsed as Record<string, unknown>
      } catch (err) {
        setFormError(`Rubrica invalida: ${String(err)}`)
        return
      }
    }

    setSubmitting(true)
    try {
      await onSubmit({
        codigo: codigo.trim(),
        titulo: titulo.trim(),
        enunciado,
        fecha_inicio: localInputToIso(fechaInicio),
        fecha_fin: localInputToIso(fechaFin),
        peso: peso.trim(),
        rubrica,
        inicial_codigo: inicialCodigo.trim() || null,
      })
    } catch (err) {
      setFormError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <HelpButton
            size="sm"
            title="Formulario de plantilla de TP"
            content={
              <div className="space-y-3 text-zinc-300">
                <p>
                  <strong>Completa los campos</strong> para crear o editar la plantilla. Las
                  plantillas son fuente canónica a nivel cátedra: al guardarlas, el sistema crea
                  automáticamente una instancia en cada comision de la materia y periodo elegidos.
                </p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>
                    <strong>Codigo:</strong> Identificador corto (ej. TP1, TP-RECURSION).
                    Obligatorio. Inmutable una vez creada la plantilla.
                  </li>
                  <li>
                    <strong>Titulo:</strong> Nombre descriptivo del TP. Obligatorio.
                  </li>
                  <li>
                    <strong>Enunciado (markdown):</strong> Descripcion completa. Soporta markdown,
                    listas, codigo. Obligatorio.
                  </li>
                  <li>
                    <strong>Peso:</strong> Ponderacion entre 0 y 1.
                  </li>
                  <li>
                    <strong>Fechas:</strong> Opcionales. Definen la ventana en que los estudiantes
                    abren episodios. Se heredan a cada instancia.
                  </li>
                  <li>
                    <strong>Codigo inicial:</strong> Codigo base que aparece en el editor del
                    estudiante al abrir el TP. Opcional.
                  </li>
                  <li>
                    <strong>Rubrica (JSON):</strong> Criterios de evaluacion como objeto JSON.
                    Opcional.
                  </li>
                </ul>
              </div>
            }
          />
          <span className="text-sm text-slate-500 dark:text-zinc-400">
            Ayuda sobre el formulario
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">Codigo</span>
            <input
              type="text"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              required
              disabled={lockCodigo}
              placeholder="TP1"
              className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">Peso (0 – 1)</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={peso}
              onChange={(e) => setPeso(e.target.value)}
              required
              className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 tabular-nums"
            />
          </label>
        </div>

        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">Titulo</span>
          <input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            required
            placeholder="Ej: Recursion y divide & conquer"
            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            Enunciado (markdown)
          </span>
          <textarea
            value={enunciado}
            onChange={(e) => setEnunciado(e.target.value)}
            required
            rows={12}
            placeholder="Escribir en markdown..."
            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 font-mono"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">
              Fecha de inicio (opcional)
            </span>
            <input
              type="datetime-local"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">
              Fecha de fin (opcional)
            </span>
            <input
              type="datetime-local"
              value={fechaFin}
              onChange={(e) => setFechaFin(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
            />
          </label>
        </div>

        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            Codigo inicial (opcional)
          </span>
          <textarea
            value={inicialCodigo}
            onChange={(e) => setInicialCodigo(e.target.value)}
            rows={4}
            placeholder="Codigo base que ve el estudiante al abrir el TP"
            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 font-mono"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            Rubrica (JSON, opcional)
          </span>
          <textarea
            value={rubricaRaw}
            onChange={(e) => setRubricaRaw(e.target.value)}
            rows={5}
            placeholder='{"criterios": [...]}'
            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 font-mono"
          />
          <p className="text-xs text-slate-500 mt-1">
            Se valida que sea JSON valido antes de enviar.
          </p>
        </label>

        {formError && <div className="p-2 rounded bg-red-50 text-red-900 text-xs">{formError}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded font-medium"
          >
            {submitting ? "Guardando..." : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── New-version modal ─────────────────────────────────────────────────

function NewVersionModal({
  template,
  getToken,
  onClose,
  onDone,
}: {
  template: TareaPracticaTemplate
  getToken: () => Promise<string | null>
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [reinstance, setReinstance] = useState(true)
  const [titulo, setTitulo] = useState(template.titulo)
  const [enunciado, setEnunciado] = useState(template.enunciado)
  const [peso, setPeso] = useState(template.peso)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setSubmitting(true)
    try {
      await tareasPracticasTemplatesApi.newVersion(
        template.id,
        {
          patch: {
            titulo,
            enunciado,
            peso,
          },
          reinstance_non_drifted: reinstance,
        },
        getToken,
      )
      await onDone()
    } catch (e2) {
      setErr(String(e2))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Nueva version desde ${template.codigo} v${template.version}`}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <HelpButton
            size="sm"
            title="Crear nueva version de plantilla"
            content={
              <div className="space-y-3 text-zinc-300">
                <p>
                  Crea una nueva version del template (v+1) en estado borrador. Si marcas
                  "Re-instanciar en comisiones sin drift", cada instancia que siga al template
                  actual recibe tambien una nueva version. Las instancias con drift quedan apuntando
                  al template viejo.
                </p>
              </div>
            }
          />
          <span className="text-sm text-slate-500 dark:text-zinc-400">
            Ayuda sobre nueva version
          </span>
        </div>

        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">Titulo</span>
          <input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            required
            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            Enunciado (markdown)
          </span>
          <textarea
            value={enunciado}
            onChange={(e) => setEnunciado(e.target.value)}
            required
            rows={10}
            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">Peso</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={peso}
            onChange={(e) => setPeso(e.target.value)}
            required
            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 tabular-nums"
          />
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={reinstance}
            onChange={(e) => setReinstance(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-slate-700 dark:text-slate-300">
            Re-instanciar en comisiones sin drift.{" "}
            <span className="text-slate-500 text-xs">
              Las comisiones con `has_drift=true` no se tocan.
            </span>
          </span>
        </label>

        {err && <div className="p-2 rounded bg-red-50 text-red-900 text-xs">{err}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded font-medium"
          >
            {submitting ? "Creando..." : "Crear nueva version"}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── View modal ────────────────────────────────────────────────────────

function TemplateViewModal({
  template,
  onClose,
}: {
  template: TareaPracticaTemplate
  onClose: () => void
}) {
  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`${template.codigo}: ${template.titulo}`}
      size="lg"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ESTADO_COLOR[template.estado]}`}
          >
            {ESTADO_LABEL[template.estado]}
          </span>
          <span className="text-xs text-slate-500">
            v{template.version}
            {template.parent_template_id && " · derivada"}
          </span>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-600 mb-1">Enunciado</div>
          <div className="p-3 rounded bg-slate-50 dark:bg-slate-800 max-h-96 overflow-y-auto">
            <MarkdownRenderer content={template.enunciado} />
          </div>
        </div>

        {template.inicial_codigo && (
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1">Codigo inicial</div>
            <pre className="p-3 rounded bg-slate-50 dark:bg-slate-800 text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
              {template.inicial_codigo}
            </pre>
          </div>
        )}

        {template.rubrica && (
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1">Rubrica</div>
            <pre className="p-3 rounded bg-slate-50 dark:bg-slate-800 text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
              {JSON.stringify(template.rubrica, null, 2)}
            </pre>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-slate-700 hover:bg-slate-800 text-white rounded"
          >
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Instances modal ───────────────────────────────────────────────────

function InstancesModal({
  template,
  getToken,
  onClose,
}: {
  template: TareaPracticaTemplate
  getToken: () => Promise<string | null>
  onClose: () => void
}) {
  const [instances, setInstances] = useState<TareaPractica[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    tareasPracticasTemplatesApi
      .instances(template.id, getToken)
      .then((r) => {
        if (!cancelled) setInstances(r.instances)
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [template.id, getToken])

  return (
    <Modal isOpen={true} onClose={onClose} title={`Instancias de ${template.codigo}`} size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <HelpButton
            size="sm"
            title="Instancias del template en comisiones"
            content={
              <div className="space-y-3 text-zinc-300">
                <p>
                  Lista las `TareaPractica` que este template creo en cada comision de la materia y
                  periodo. Cada instancia mantiene su `problema_id` estable para el CTR.
                </p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>
                    <strong>Sin drift:</strong> La instancia sigue al template. Si se crea una nueva
                    version con `reinstance_non_drifted=true`, la instancia recibe la nueva version
                    automáticamente.
                  </li>
                  <li>
                    <strong>Drift:</strong> El docente de la comision edito la instancia. El link al
                    template se preserva pero la auto-actualizacion se desactiva.
                  </li>
                </ul>
              </div>
            }
          />
          <span className="text-sm text-slate-500 dark:text-zinc-400">
            Ayuda sobre las instancias
          </span>
        </div>

        {err && <div className="p-3 rounded bg-red-50 text-red-900 text-sm">{err}</div>}
        {!instances ? (
          <div className="p-6 text-center text-slate-500 text-sm">Cargando instancias...</div>
        ) : instances.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-sm">
            Sin instancias registradas. Puede pasar si no hay comisiones creadas en esta materia y
            periodo todavia, o si el template fallo al fan-out-ear.
          </div>
        ) : (
          <div className="rounded border border-slate-200 dark:border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Comision</th>
                  <th className="text-left px-3 py-2 font-medium">Estado</th>
                  <th className="text-right px-3 py-2 font-medium">Version</th>
                  <th className="text-left px-3 py-2 font-medium">Sincronizacion</th>
                  <th className="text-left px-3 py-2 font-medium">Actualizada</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((i) => (
                  <tr
                    key={i.id}
                    className="border-b border-slate-100 dark:border-slate-800/50 last:border-0"
                  >
                    <td className="px-3 py-2 font-mono text-xs" title={i.comision_id}>
                      {i.comision_id.slice(0, 8)}...
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ESTADO_COLOR[i.estado]}`}
                      >
                        {ESTADO_LABEL[i.estado]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      v{i.version}
                    </td>
                    <td className="px-3 py-2">
                      {i.has_drift ? (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                          Drift
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
                          Sincronizada
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {formatDateTime(i.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-slate-700 hover:bg-slate-800 text-white rounded"
          >
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  )
}
