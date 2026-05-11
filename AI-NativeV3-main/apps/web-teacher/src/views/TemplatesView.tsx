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
import { Badge, HelpButton, MarkdownRenderer, Modal, PageContainer } from "@platform/ui"
import {
  Archive,
  Eye,
  FileStack,
  GitBranch,
  Layers,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react"
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

const ESTADO_VARIANT: Record<TareaEstado, "default" | "success" | "warning"> = {
  draft: "default",
  published: "success",
  archived: "warning",
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
      eyebrow="Inicio · Plantillas (cátedra)"
      helpContent={helpContent.templates}
    >
      <div className="space-y-6">
        <AcademicContextSelector value={ctx} onChange={setCtx} getToken={getToken} />

        {!ctx ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center animate-fade-in-up">
            <div className="inline-flex items-center justify-center rounded-full bg-surface-alt p-4 mb-4">
              <Layers className="h-7 w-7 text-muted" />
            </div>
            <p className="text-sm text-muted leading-relaxed max-w-md mx-auto">
              Seleccioná universidad, facultad, carrera, plan, materia y período para ver o crear
              plantillas.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap animate-fade-in-up">
              <p className="text-xs text-muted leading-relaxed max-w-2xl">
                Templates canónicos para esta materia y período. Crear uno auto-instancia un TP en
                cada comisión existente. Las nuevas versiones se propagan a las instancias sin
                drift.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={refreshList}
                  disabled={loading}
                  className="press-shrink px-3 py-1.5 text-xs border border-border bg-surface rounded-md hover:bg-surface-alt disabled:opacity-40 text-muted transition-colors"
                >
                  {loading ? "Cargando..." : "Refrescar"}
                </button>
                <button
                  type="button"
                  onClick={() => setModal({ kind: "create" })}
                  className="press-shrink inline-flex items-center gap-1.5 px-4 py-1.5 text-sm bg-accent-brand hover:bg-accent-brand-deep text-white rounded-md font-medium transition-colors shadow-[0_1px_2px_0_rgba(24,95,165,0.25)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Nueva plantilla
                </button>
              </div>
            </div>

            {error && (
              <div className="animate-fade-in-up rounded-xl border border-danger/30 bg-danger-soft p-4">
                <div className="text-sm font-semibold text-danger">
                  No pudimos cargar las plantillas
                </div>
                <div className="mt-1.5 font-mono text-xs text-danger/85 break-all">{error}</div>
              </div>
            )}

            {loading && templates.length === 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-fade-in">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-40 rounded-xl" />
                ))}
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center animate-fade-in-up">
                <div className="inline-flex items-center justify-center rounded-full bg-surface-alt p-4 mb-4">
                  <FileStack className="h-7 w-7 text-muted" />
                </div>
                <p className="text-sm text-muted leading-relaxed max-w-md mx-auto">
                  No hay plantillas para esta materia y período. Creá la primera con el botón "Nueva
                  plantilla".
                </p>
              </div>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {templates.map((t, idx) => (
                  <li
                    key={t.id}
                    className="animate-fade-in-up"
                    style={{ animationDelay: `${Math.min(idx, 6) * 50}ms` }}
                  >
                    <TemplateCard
                      template={t}
                      onView={() => setModal({ kind: "view", template: t })}
                      onEdit={() => setModal({ kind: "edit", template: t })}
                      onPublish={() => handlePublish(t)}
                      onArchive={() => handleArchive(t)}
                      onDelete={() => handleDelete(t)}
                      onShowInstances={() => setModal({ kind: "instances", template: t })}
                      onNewVersion={() => setModal({ kind: "new-version", template: t })}
                    />
                  </li>
                ))}
              </ul>
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

// ── Card ──────────────────────────────────────────────────────────────

function TemplateCard({
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
  const accentByEstado: Record<TareaEstado, string> = {
    draft: "bg-muted-soft",
    published: "bg-success",
    archived: "bg-warning",
  }
  return (
    <article className="hover-lift group relative overflow-hidden rounded-xl border border-border bg-surface flex flex-col h-full shadow-[0_1px_2px_0_rgba(0,0,0,0.04)]">
      <div
        aria-hidden="true"
        className={`absolute left-0 top-0 bottom-0 w-1 ${accentByEstado[estado]} opacity-60 group-hover:opacity-100 transition-opacity`}
      />

      <div className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted px-2 py-0.5 rounded bg-surface-alt border border-border-soft">
              {template.codigo}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-soft">
              v{template.version}
            </span>
          </div>
          <Badge variant={ESTADO_VARIANT[estado]}>{ESTADO_LABEL[estado]}</Badge>
        </div>

        <div className="min-w-0">
          <h3
            className="text-[15px] font-semibold text-ink leading-tight tracking-tight line-clamp-2"
            title={template.titulo}
          >
            {template.titulo}
          </h3>
          {template.parent_template_id && (
            <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted">
              <GitBranch className="h-3 w-3" />
              Versión derivada
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-muted mt-auto pt-2 border-t border-border-soft">
          <span className="text-[10px] uppercase tracking-wider text-muted-soft">Peso</span>
          <span className="font-mono tabular-nums text-body">{template.peso}</span>
        </div>
      </div>

      <footer className="flex items-stretch border-t border-border-soft text-[11px] font-medium">
        <button
          type="button"
          onClick={onShowInstances}
          className="press-shrink flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-2.5 text-muted hover:bg-surface-alt hover:text-ink transition-colors"
          title="Ver instancias en comisiones"
        >
          <Layers className="h-3.5 w-3.5" />
          Instancias
        </button>
        <button
          type="button"
          onClick={onView}
          className="press-shrink inline-flex items-center justify-center gap-1.5 px-2 py-2.5 border-l border-border-soft text-muted hover:bg-surface-alt hover:text-ink transition-colors"
          title="Ver detalle"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
        {estado === "draft" && (
          <>
            <button
              type="button"
              onClick={onEdit}
              className="press-shrink inline-flex items-center justify-center gap-1.5 px-2 py-2.5 border-l border-border-soft text-accent-brand-deep hover:bg-accent-brand-soft transition-colors"
              title="Editar"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onPublish}
              className="press-shrink inline-flex items-center justify-center gap-1.5 px-2 py-2.5 border-l border-border-soft text-success hover:bg-success-soft transition-colors"
              title="Publicar"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="press-shrink inline-flex items-center justify-center gap-1.5 px-2 py-2.5 border-l border-border-soft text-danger hover:bg-danger-soft transition-colors"
              title="Eliminar"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {estado === "published" && (
          <>
            <button
              type="button"
              onClick={onNewVersion}
              className="press-shrink inline-flex items-center justify-center gap-1.5 px-2 py-2.5 border-l border-border-soft text-accent-brand-deep hover:bg-accent-brand-soft transition-colors"
              title="Nueva versión"
            >
              <GitBranch className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onArchive}
              className="press-shrink inline-flex items-center justify-center gap-1.5 px-2 py-2.5 border-l border-border-soft text-warning hover:bg-warning-soft transition-colors"
              title="Archivar"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {estado === "archived" && (
          <button
            type="button"
            onClick={onNewVersion}
            className="press-shrink inline-flex items-center justify-center gap-1.5 px-2 py-2.5 border-l border-border-soft text-accent-brand-deep hover:bg-accent-brand-soft transition-colors"
            title="Nueva versión"
          >
            <GitBranch className="h-3.5 w-3.5" />
          </button>
        )}
      </footer>
    </article>
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
              <div className="space-y-3 text-sidebar-text-muted">
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
          <span className="text-sm text-muted">Ayuda sobre el formulario</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-muted mb-1">Codigo</span>
            <input
              type="text"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              required
              disabled={lockCodigo}
              placeholder="TP1"
              className="w-full px-2 py-1.5 text-sm border border-border rounded bg-surface disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-muted mb-1">Peso (0 – 1)</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={peso}
              onChange={(e) => setPeso(e.target.value)}
              required
              className="w-full px-2 py-1.5 text-sm border border-border rounded bg-surface tabular-nums"
            />
          </label>
        </div>

        <label className="block">
          <span className="block text-xs font-medium text-muted mb-1">Titulo</span>
          <input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            required
            placeholder="Ej: Recursion y divide & conquer"
            className="w-full px-2 py-1.5 text-sm border border-border rounded bg-surface"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-muted mb-1">Enunciado (markdown)</span>
          <textarea
            value={enunciado}
            onChange={(e) => setEnunciado(e.target.value)}
            required
            rows={12}
            placeholder="Escribir en markdown..."
            className="w-full px-2 py-1.5 text-sm border border-border rounded bg-surface font-mono"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-muted mb-1">
              Fecha de inicio (opcional)
            </span>
            <input
              type="datetime-local"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-border rounded bg-surface"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-muted mb-1">
              Fecha de fin (opcional)
            </span>
            <input
              type="datetime-local"
              value={fechaFin}
              onChange={(e) => setFechaFin(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-border rounded bg-surface"
            />
          </label>
        </div>

        <label className="block">
          <span className="block text-xs font-medium text-muted mb-1">
            Codigo inicial (opcional)
          </span>
          <textarea
            value={inicialCodigo}
            onChange={(e) => setInicialCodigo(e.target.value)}
            rows={4}
            placeholder="Codigo base que ve el estudiante al abrir el TP"
            className="w-full px-2 py-1.5 text-sm border border-border rounded bg-surface font-mono"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-muted mb-1">
            Rubrica (JSON, opcional)
          </span>
          <textarea
            value={rubricaRaw}
            onChange={(e) => setRubricaRaw(e.target.value)}
            rows={5}
            placeholder='{"criterios": [...]}'
            className="w-full px-2 py-1.5 text-sm border border-border rounded bg-surface font-mono"
          />
          <p className="text-xs text-muted mt-1">Se valida que sea JSON valido antes de enviar.</p>
        </label>

        {formError && (
          <div className="p-2 rounded bg-danger-soft text-danger text-xs">{formError}</div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border-soft">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-1.5 text-sm border border-border rounded hover:bg-surface-alt disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-1.5 text-sm bg-accent-brand hover:bg-accent-brand-deep disabled:bg-border-strong text-white rounded font-medium"
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
              <div className="space-y-3 text-sidebar-text-muted">
                <p>
                  Crea una nueva version del template (v+1) en estado borrador. Si marcas
                  "Re-instanciar en comisiones sin drift", cada instancia que siga al template
                  actual recibe tambien una nueva version. Las instancias con drift quedan apuntando
                  al template viejo.
                </p>
              </div>
            }
          />
          <span className="text-sm text-muted">Ayuda sobre nueva version</span>
        </div>

        <label className="block">
          <span className="block text-xs font-medium text-muted mb-1">Titulo</span>
          <input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            required
            className="w-full px-2 py-1.5 text-sm border border-border rounded bg-surface"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-muted mb-1">Enunciado (markdown)</span>
          <textarea
            value={enunciado}
            onChange={(e) => setEnunciado(e.target.value)}
            required
            rows={10}
            className="w-full px-2 py-1.5 text-sm border border-border rounded bg-surface font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-muted mb-1">Peso</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={peso}
            onChange={(e) => setPeso(e.target.value)}
            required
            className="w-full px-2 py-1.5 text-sm border border-border rounded bg-surface tabular-nums"
          />
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={reinstance}
            onChange={(e) => setReinstance(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-body">
            Re-instanciar en comisiones sin drift.{" "}
            <span className="text-muted text-xs">
              Las comisiones con `has_drift=true` no se tocan.
            </span>
          </span>
        </label>

        {err && <div className="p-2 rounded bg-danger-soft text-danger text-xs">{err}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-border-soft">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-1.5 text-sm border border-border rounded hover:bg-surface-alt disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-1.5 text-sm bg-accent-brand hover:bg-accent-brand-deep disabled:bg-border-strong text-white rounded font-medium"
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
          <Badge variant={ESTADO_VARIANT[template.estado]}>{ESTADO_LABEL[template.estado]}</Badge>
          <span className="text-xs text-muted">
            v{template.version}
            {template.parent_template_id && " · derivada"}
          </span>
        </div>

        <div>
          <div className="text-xs font-medium text-muted mb-1">Enunciado</div>
          <div className="p-3 rounded bg-surface-alt max-h-96 overflow-y-auto">
            <MarkdownRenderer content={template.enunciado} />
          </div>
        </div>

        {template.inicial_codigo && (
          <div>
            <div className="text-xs font-medium text-muted mb-1">Codigo inicial</div>
            <pre className="p-3 rounded bg-surface-alt text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
              {template.inicial_codigo}
            </pre>
          </div>
        )}

        {template.rubrica && (
          <div>
            <div className="text-xs font-medium text-muted mb-1">Rubrica</div>
            <pre className="p-3 rounded bg-surface-alt text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
              {JSON.stringify(template.rubrica, null, 2)}
            </pre>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-border-soft">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-ink hover:bg-accent-brand-deep text-white rounded"
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
              <div className="space-y-3 text-sidebar-text-muted">
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
          <span className="text-sm text-muted">Ayuda sobre las instancias</span>
        </div>

        {err && <div className="p-3 rounded bg-danger-soft text-danger text-sm">{err}</div>}
        {!instances ? (
          <div className="p-6 text-center text-muted text-sm">Cargando instancias...</div>
        ) : instances.length === 0 ? (
          <div className="p-6 text-center text-muted text-sm">
            Sin instancias registradas. Puede pasar si no hay comisiones creadas en esta materia y
            periodo todavia, o si el template fallo al fan-out-ear.
          </div>
        ) : (
          <div className="rounded border border-border-soft overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-alt border-b border-border-soft">
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
                  <tr key={i.id} className="border-b border-border-soft last:border-0">
                    <td className="px-3 py-2 font-mono text-xs" title={i.comision_id}>
                      {i.comision_id.slice(0, 8)}...
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={ESTADO_VARIANT[i.estado]}>{ESTADO_LABEL[i.estado]}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">v{i.version}</td>
                    <td className="px-3 py-2">
                      {i.has_drift ? (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-warning-soft text-warning">
                          Drift
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-success-soft text-success">
                          Sincronizada
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{formatDateTime(i.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-border-soft">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-ink hover:bg-accent-brand-deep text-white rounded"
          >
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  )
}
