/**
 * Vista de gestión de Trabajos Prácticos (TPs).
 *
 * Permite al docente:
 *  - Listar TPs de una comisión filtrados por estado
 *  - Crear TPs nuevos en estado `draft`
 *  - Editar TPs (sólo en `draft` — backend rechaza 409 en otros estados)
 *  - Publicar (draft → published) y archivar (published → archived)
 *  - Eliminar (soft delete)
 *  - Crear nueva versión (forkea el TP a un nuevo `draft` con parent_tarea_id)
 *  - Ver el historial de versiones
 *
 * Los estados son transiciones puntuales del docente — no hay pipeline async
 * como en Materiales, por lo que NO hay polling acá.
 *
 * Máquina de estados de modales: enum `ModalState` — mutex estricto.
 * Los 5 bools originales (showCreate, editing, viewing, versioningFrom, versionsOf)
 * fueron consolidados en un enum para evitar el race condition de "dos modales
 * abiertos al mismo tiempo" si un handler apagaba uno pero olvidaba el otro.
 */
import { HelpButton, MarkdownRenderer, Modal, PageContainer } from "@platform/ui"
import { useCallback, useEffect, useState } from "react"
import { useComisionLabel } from "../components/ComisionSelector"
import { GenerarConIAWizard } from "../components/GenerarConIAWizard"
import {
  type EjercicioGenerado,
  type EjercicioInput,
  type TareaEstado,
  type TareaPractica,
  type TareaPracticaUpdate,
  type TareaPracticaVersionRef,
  tareasPracticasApi,
} from "../lib/api"
import { helpContent } from "../utils/helpContent"

interface Props {
  comisionId: string
  getToken: () => Promise<string | null>
}

const ESTADO_LABEL: Record<TareaEstado, string> = {
  draft: "Borrador",
  published: "Publicado",
  archived: "Archivado",
}

const ESTADO_COLOR: Record<TareaEstado, string> = {
  draft: "text-muted",
  published: "text-success",
  archived: "text-warning/85",
}

type EstadoFilter = "all" | TareaEstado

// Enum para máquina de estados de modales — reemplaza los 5 bools independientes.
type ModalState =
  | { kind: "closed" }
  | { kind: "create"; prefill?: AIPrefill }
  | { kind: "edit"; tarea: TareaPractica }
  | { kind: "view"; tarea: TareaPractica }
  | { kind: "versioning"; tarea: TareaPractica }
  | { kind: "versions-list"; tarea: TareaPractica }
  | { kind: "generar-ia" }

interface AIPrefill {
  enunciado: string
  rubrica: Record<string, unknown> | null
}

// ADR-016 — badge "derivado de plantilla": muestra que la instancia fue
// creada por fan-out desde un `TareaPracticaTemplate`. Clickeable para
// mostrar el id del template (puente a la vista "Plantillas").
function TemplateBadge({ templateId }: { templateId: string }) {
  const title = `Derivado de plantilla de cátedra: ${templateId}`
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-surface-alt text-body border border-border-soft"
      title={title}
    >
      Plantilla
    </span>
  )
}

// ADR-016 — badge "drift": la instancia divergio de la plantilla de cátedra.
// Desde ese momento, nuevas versiones del template no se propagan
// automáticamente a esta fila (se preserva el link `template_id` pero
// la auto-sincronizacion queda deshabilitada).
function DriftBadge() {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-warning-soft text-warning border border-warning/30"
      title="Este TP divergio de la plantilla de cátedra. No recibira nuevas versiones automáticas del template."
    >
      Drift
    </span>
  )
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "sin fecha"
  const d = new Date(iso)
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  })
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

/** Convierte ISO 8601 → valor para `<input type="datetime-local">` (YYYY-MM-DDTHH:mm). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Convierte valor de `<input type="datetime-local">` → ISO 8601 (o null si vacío). */
function localInputToIso(local: string): string | null {
  if (!local) return null
  return new Date(local).toISOString()
}

export function TareasPracticasView({ comisionId, getToken }: Props) {
  const comisionLabelText = useComisionLabel(comisionId)
  const [tareas, setTareas] = useState<TareaPractica[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>("all")

  // Máquina de estados — un único estado activo a la vez (mutex).
  const [modal, setModal] = useState<ModalState>({ kind: "closed" })

  const closeModal = () => setModal({ kind: "closed" })

  const refreshList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await tareasPracticasApi.list(
        {
          comision_id: comisionId,
          ...(estadoFilter === "all" ? {} : { estado: estadoFilter }),
        },
        getToken,
      )
      setTareas(r.data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [comisionId, estadoFilter, getToken])

  useEffect(() => {
    refreshList()
  }, [refreshList])

  const handlePublish = async (t: TareaPractica) => {
    try {
      await tareasPracticasApi.publish(t.id, getToken)
      await refreshList()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleArchive = async (t: TareaPractica) => {
    const ok = window.confirm(
      `¿Archivar el TP "${t.codigo}: ${t.titulo}"? Los estudiantes no podrán seguir enviando episodios.`,
    )
    if (!ok) return
    try {
      await tareasPracticasApi.archive(t.id, getToken)
      await refreshList()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleDelete = async (t: TareaPractica) => {
    const ok = window.confirm(
      `¿Eliminar el TP "${t.codigo}: ${t.titulo}"? Esta acción es un soft delete.`,
    )
    if (!ok) return
    try {
      await tareasPracticasApi.delete(t.id, getToken)
      await refreshList()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <PageContainer
      title="Trabajos prácticos"
      description={`Diseña los TPs de la comisión. Solo los TPs publicados aceptan episodios. Comisión: ${comisionLabelText}`}
      helpContent={helpContent.tareasPracticas}
    >
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1 bg-canvas border border-border rounded-lg p-1">
            {(["all", "draft", "published", "archived"] as const).map((f) => {
              const labels: Record<typeof f, string> = {
                all: "Todos",
                draft: "Borrador",
                published: "Publicado",
                archived: "Archivado",
              }
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setEstadoFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    estadoFilter === f
                      ? "bg-ink text-white"
                      : "text-muted hover:text-ink bg-transparent"
                  }`}
                >
                  {labels[f]}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshList}
              disabled={loading}
              className="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-canvas transition-colors disabled:opacity-40 text-muted"
            >
              {loading ? "Cargando..." : "Refrescar"}
            </button>
            <button
              type="button"
              onClick={() => setModal({ kind: "generar-ia" })}
              className="px-4 py-1.5 text-sm border border-border hover:bg-canvas text-ink rounded-md font-medium transition-colors"
            >
              Generar con IA
            </button>
            <button
              type="button"
              onClick={() => setModal({ kind: "create" })}
              className="px-4 py-1.5 text-sm bg-accent-brand hover:bg-accent-brand-deep text-white rounded-md font-medium transition-colors"
            >
              + Nuevo TP
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-danger text-sm">
            {error}
          </div>
        )}

        {loading && tareas.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">Cargando TPs...</div>
        ) : tareas.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-white p-8 text-center text-muted text-sm">
            No hay TPs para esta comision todavia. Crea el primero con{" "}
            <span className="font-semibold text-ink">+ Nuevo TP</span>.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-canvas border-b border-border text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Codigo</th>
                  <th className="text-left px-4 py-2.5 font-medium">Titulo</th>
                  <th className="text-left px-4 py-2.5 font-medium">Estado</th>
                  <th className="text-right px-4 py-2.5 font-medium">Version</th>
                  <th className="text-left px-4 py-2.5 font-medium">Inicio</th>
                  <th className="text-left px-4 py-2.5 font-medium">Fin</th>
                  <th className="text-right px-4 py-2.5 font-medium">Peso</th>
                  <th className="text-right px-4 py-2.5 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {tareas.map((t) => (
                  <TareaRow
                    key={t.id}
                    tarea={t}
                    onView={() => setModal({ kind: "view", tarea: t })}
                    onEdit={() => setModal({ kind: "edit", tarea: t })}
                    onPublish={() => handlePublish(t)}
                    onArchive={() => handleArchive(t)}
                    onNewVersion={() => setModal({ kind: "versioning", tarea: t })}
                    onDelete={() => handleDelete(t)}
                    onShowVersions={() => setModal({ kind: "versions-list", tarea: t })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Wizard: generar TP con IA */}
        <GenerarConIAWizard
          isOpen={modal.kind === "generar-ia"}
          comisionId={comisionId}
          getToken={getToken}
          onClose={closeModal}
          onUseResult={async (ejerciciosIA: EjercicioGenerado[]) => {
            const enunciado = ejerciciosIA
              .map((ej, i) => `## Ejercicio ${i + 1}: ${ej.titulo}\n\n${ej.enunciado}`)
              .join("\n\n---\n\n")
            const titulo = ejerciciosIA.length === 1
              ? ejerciciosIA[0]!.titulo
              : `TP: ${ejerciciosIA[0]!.titulo} (+${ejerciciosIA.length - 1} mas)`
            const codigo = `IA-${Date.now().toString(36).slice(-4).toUpperCase()}`
            const apiEjercicios: EjercicioInput[] = ejerciciosIA.map((ej, i) => {
              const n = ejerciciosIA.length
              const basePeso = Math.floor((1.0 / n) * 1000) / 1000
              const isLast = i === n - 1
              const ejPeso = isLast ? (1.0 - basePeso * (n - 1)).toFixed(3) : basePeso.toFixed(3)
              return {
                orden: i + 1,
                titulo: ej.titulo,
                enunciado_md: ej.enunciado,
                inicial_codigo: ej.inicial_codigo || null,
                peso: ejPeso,
              }
            })
            await tareasPracticasApi.create(
              {
                comision_id: comisionId,
                codigo,
                titulo,
                enunciado,
                rubrica: { ejercicios: ejerciciosIA },
                ejercicios: apiEjercicios,
                created_via_ai: true,
              },
              getToken,
            )
            closeModal()
            await refreshList()
          }}
        />

        {/* Modal: crear nuevo TP */}
        <TareaFormModal
          isOpen={modal.kind === "create"}
          title="Nuevo trabajo practico"
          initial={null}
          {...(modal.kind === "create" && modal.prefill ? { prefill: modal.prefill } : {})}
          onClose={closeModal}
          onSubmit={async (values) => {
            await tareasPracticasApi.create({
              ...values,
              comision_id: comisionId,
              ejercicios: values.ejercicios,
            }, getToken)
            closeModal()
            await refreshList()
          }}
        />

        {/* Modal: editar TP (draft solamente) */}
        {modal.kind === "edit" && (
          <TareaFormModal
            isOpen={true}
            title={`Editar TP: ${modal.tarea.codigo}`}
            initial={modal.tarea}
            mode="edit"
            onClose={closeModal}
            onSubmit={async (values) => {
              const patch: TareaPracticaUpdate = {
                codigo: values.codigo,
                titulo: values.titulo,
                enunciado: values.enunciado,
                fecha_inicio: values.fecha_inicio,
                fecha_fin: values.fecha_fin,
                peso: values.peso,
                rubrica: values.rubrica,
                ejercicios: values.ejercicios,
              }
              await tareasPracticasApi.update(modal.tarea.id, patch, getToken)
              closeModal()
              await refreshList()
            }}
          />
        )}

        {/* Modal: nueva versión desde TP existente */}
        {modal.kind === "versioning" && (
          <TareaFormModal
            isOpen={true}
            title={`Nueva version desde ${modal.tarea.codigo} v${modal.tarea.version}`}
            initial={modal.tarea}
            mode="version"
            onClose={closeModal}
            onSubmit={async (values) => {
              const patch: TareaPracticaUpdate = {
                codigo: values.codigo,
                titulo: values.titulo,
                enunciado: values.enunciado,
                fecha_inicio: values.fecha_inicio,
                fecha_fin: values.fecha_fin,
                peso: values.peso,
                rubrica: values.rubrica,
                ejercicios: values.ejercicios,
              }
              await tareasPracticasApi.newVersion(modal.tarea.id, patch, getToken)
              closeModal()
              await refreshList()
            }}
          />
        )}

        {/* Modal: ver detalle TP (solo lectura) */}
        {modal.kind === "view" && (
          <TareaViewModal
            tarea={modal.tarea}
            onClose={closeModal}
            onShowVersions={() => {
              setModal({ kind: "versions-list", tarea: modal.tarea })
            }}
          />
        )}

        {/* Modal: historial de versiones */}
        {modal.kind === "versions-list" && (
          <VersionsModal tarea={modal.tarea} getToken={getToken} onClose={closeModal} />
        )}
      </div>
    </PageContainer>
  )
}

// ── Row ───────────────────────────────────────────────────────────────

function TareaRow({
  tarea,
  onView,
  onEdit,
  onPublish,
  onArchive,
  onNewVersion,
  onDelete,
  onShowVersions,
}: {
  tarea: TareaPractica
  onView: () => void
  onEdit: () => void
  onPublish: () => void
  onArchive: () => void
  onNewVersion: () => void
  onDelete: () => void
  onShowVersions: () => void
}) {
  const estado = tarea.estado

  return (
    <tr className="border-b border-border last:border-0 hover:bg-canvas transition-colors">
      <td className="px-4 py-3 font-mono text-xs text-ink">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span>{tarea.codigo}</span>
          {tarea.template_id && <TemplateBadge templateId={tarea.template_id} />}
          {tarea.has_drift && <DriftBadge />}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium truncate max-w-xs text-ink" title={tarea.titulo}>
          {tarea.titulo}
        </div>
        {tarea.parent_tarea_id && <div className="text-xs text-muted">(derivado)</div>}
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-medium ${ESTADO_COLOR[estado]}`}>
          {ESTADO_LABEL[estado]}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted text-xs">v{tarea.version}</td>
      <td className="px-4 py-3 text-xs text-muted">{formatShortDate(tarea.fecha_inicio)}</td>
      <td className="px-4 py-3 text-xs text-muted">{formatShortDate(tarea.fecha_fin)}</td>
      <td className="px-4 py-3 text-right tabular-nums text-muted text-xs">{tarea.peso}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-1 flex-wrap">
          <button
            type="button"
            onClick={onShowVersions}
            className="px-2 py-1 text-xs text-muted hover:text-ink hover:bg-border rounded transition-colors"
            title="Ver historial de versiones"
          >
            Historial
          </button>
          {estado === "draft" && (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="px-2 py-1 text-xs text-[var(--color-accent-brand)] hover:bg-canvas rounded transition-colors"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={onPublish}
                className="px-2 py-1 text-xs text-success hover:bg-success-soft rounded font-medium transition-colors"
              >
                Publicar
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="px-2 py-1 text-xs text-danger hover:bg-danger-soft rounded transition-colors"
              >
                Eliminar
              </button>
            </>
          )}
          {estado === "published" && (
            <>
              <button
                type="button"
                onClick={onView}
                className="px-2 py-1 text-xs text-muted hover:text-ink hover:bg-border rounded transition-colors"
              >
                Ver
              </button>
              <button
                type="button"
                onClick={onNewVersion}
                className="px-2 py-1 text-xs text-[var(--color-accent-brand)] hover:bg-canvas rounded transition-colors"
              >
                Nueva version
              </button>
              <button
                type="button"
                onClick={onArchive}
                className="px-2 py-1 text-xs text-warning/85 hover:bg-warning-soft rounded transition-colors"
              >
                Archivar
              </button>
            </>
          )}
          {estado === "archived" && (
            <>
              <button
                type="button"
                onClick={onView}
                className="px-2 py-1 text-xs text-muted hover:text-ink hover:bg-border rounded transition-colors"
              >
                Ver
              </button>
              <button
                type="button"
                onClick={onNewVersion}
                className="px-2 py-1 text-xs text-[var(--color-accent-brand)] hover:bg-canvas rounded transition-colors"
              >
                Nueva version
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Form modal (create / edit / new-version) ──────────────────────────

interface FormValues {
  codigo: string
  titulo: string
  enunciado: string
  fecha_inicio: string | null
  fecha_fin: string | null
  peso: string
  rubrica: Record<string, unknown> | null
  ejercicios: EjercicioInput[]
}

interface EjercicioEdit {
  titulo: string
  enunciado: string
  inicial_codigo: string
  rubrica: Record<string, unknown>
  rubricaRaw: string
}

function parseEjercicios(
  tpEjercicios: TareaPractica["ejercicios"] | undefined,
  rubrica: Record<string, unknown> | null,
): EjercicioEdit[] | null {
  if (tpEjercicios && tpEjercicios.length > 0) {
    return tpEjercicios.map((ej) => ({
      titulo: ej.titulo ?? "",
      enunciado: ej.enunciado_md ?? "",
      inicial_codigo: ej.inicial_codigo ?? "",
      rubrica: {},
      rubricaRaw: "{}",
    }))
  }
  if (!rubrica) return null
  const arr = rubrica.ejercicios
  if (!Array.isArray(arr) || arr.length === 0) return null
  return (arr as Array<Record<string, string>>).map((ej) => ({
    titulo: ej.titulo ?? "",
    enunciado: ej.enunciado_md ?? ej.enunciado ?? "",
    inicial_codigo: ej.inicial_codigo ?? "",
    rubrica: {},
    rubricaRaw: "{}",
  }))
}

function ejerciciosToEnunciado(ejercicios: EjercicioEdit[]): string {
  return ejercicios
    .map((ej, i) => `## Ejercicio ${i + 1}: ${ej.titulo}\n\n${ej.enunciado}`)
    .join("\n\n---\n\n")
}

function TareaFormModal({
  isOpen,
  title,
  initial,
  prefill,
  mode = "create",
  onClose,
  onSubmit,
}: {
  isOpen: boolean
  title: string
  initial: TareaPractica | null
  prefill?: AIPrefill
  mode?: "create" | "edit" | "version"
  onClose: () => void
  onSubmit: (values: FormValues) => Promise<void>
}) {
  const initRubrica = prefill?.rubrica ?? initial?.rubrica ?? null
  const initEjercicios = parseEjercicios(initial?.ejercicios, initRubrica as Record<string, unknown> | null)
  const isEditing = mode === "edit" || mode === "version"

  const [step, setStep] = useState<"basics" | "ejercicios">(isEditing ? "ejercicios" : "basics")

  const [codigo, setCodigo] = useState(initial?.codigo ?? "")
  const [titulo, setTitulo] = useState(initial?.titulo ?? "")
  const [fechaInicio, setFechaInicio] = useState(isoToLocalInput(initial?.fecha_inicio ?? null))
  const [fechaFin, setFechaFin] = useState(isoToLocalInput(initial?.fecha_fin ?? null))
  const [peso, setPeso] = useState(initial?.peso ?? "1.0")
  const [ejercicios, setEjercicios] = useState<EjercicioEdit[]>(
    initEjercicios ?? [{ titulo: "Ejercicio 1", enunciado: "", inicial_codigo: "", rubrica: {}, rubricaRaw: "{}" }],
  )
  const [expandedEj, setExpandedEj] = useState<number | null>(0)

  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const showDriftBanner = Boolean(mode === "edit" && initial?.template_id && !initial.has_drift)
  const [driftAck, setDriftAck] = useState(false)

  const updateEjercicio = (index: number, updates: Partial<EjercicioEdit>) => {
    setEjercicios((prev) => prev.map((ej, i) => (i === index ? { ...ej, ...updates } : ej)))
  }

  const removeEjercicio = (index: number) => {
    setEjercicios((prev) => prev.filter((_, i) => i !== index))
    setExpandedEj(null)
  }

  const addEjercicio = () => {
    setEjercicios((prev) => [
      ...prev,
      { titulo: `Ejercicio ${prev.length + 1}`, enunciado: "", inicial_codigo: "", rubrica: {}, rubricaRaw: "{}" },
    ])
    setExpandedEj(ejercicios.length)
  }

  const handleNextStep = () => {
    setFormError(null)
    if (!codigo.trim()) { setFormError("El codigo es obligatorio."); return }
    if (!titulo.trim()) { setFormError("El titulo es obligatorio."); return }
    if (fechaInicio && fechaFin && fechaFin <= fechaInicio) {
      setFormError("La fecha de fin debe ser posterior a la fecha de inicio.")
      return
    }
    setStep("ejercicios")
  }

  const handleSubmit = async () => {
    setFormError(null)

    if (ejercicios.length === 0) {
      setFormError("Agrega al menos un ejercicio.")
      return
    }

    const apiEjercicios: EjercicioInput[] = ejercicios.map((ej, i) => {
      const n = ejercicios.length
      const basePeso = Math.floor((1.0 / n) * 1000) / 1000
      const isLast = i === n - 1
      const ejPeso = isLast ? (1.0 - basePeso * (n - 1)).toFixed(3) : basePeso.toFixed(3)
      return {
        orden: i + 1,
        titulo: ej.titulo,
        enunciado_md: ej.enunciado,
        inicial_codigo: ej.inicial_codigo || null,
        peso: ejPeso,
      }
    })

    const cleanEjercicios = ejercicios.map((ej) => {
      let parsedRubrica = ej.rubrica
      if (ej.rubricaRaw.trim()) {
        try {
          parsedRubrica = JSON.parse(ej.rubricaRaw)
        } catch {
          setFormError(`Rubrica invalida en ejercicio "${ej.titulo}".`)
          return null
        }
      }
      return { titulo: ej.titulo, enunciado: ej.enunciado, inicial_codigo: ej.inicial_codigo, rubrica: parsedRubrica }
    })
    if (cleanEjercicios.some((e) => e === null)) return

    const rubrica = { ejercicios: cleanEjercicios }
    const finalEnunciado = ejerciciosToEnunciado(ejercicios)

    setSubmitting(true)
    try {
      await onSubmit({
        codigo: codigo.trim(),
        titulo: titulo.trim(),
        enunciado: finalEnunciado,
        fecha_inicio: localInputToIso(fechaInicio),
        fecha_fin: localInputToIso(fechaFin),
        peso: peso.trim(),
        rubrica,
        ejercicios: apiEjercicios,
      })
    } catch (err) {
      setFormError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = "w-full px-2 py-1.5 text-sm border border-border rounded bg-white focus:outline-none focus:border-ink"

  const stepTitle = step === "basics"
    ? title
    : `${titulo || title} — Ejercicios (${ejercicios.length})`

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={stepTitle} size="lg">
      {showDriftBanner && (
        <div className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning mb-4">
          <p className="font-medium">Este TP esta sincronizado con una plantilla de catedra.</p>
          <p className="text-xs mt-1">
            Editar lo desconectara de la plantilla y lo marcara como drift.
          </p>
          {!driftAck && (
            <button
              type="button"
              onClick={() => setDriftAck(true)}
              className="mt-2 px-3 py-1 text-xs bg-warning hover:bg-warning text-white rounded font-medium"
            >
              Entiendo, continuar
            </button>
          )}
        </div>
      )}

      {/* Step indicator */}
      {!isEditing && (
        <div className="flex items-center gap-2 mb-4 text-xs">
          <span className={`px-2 py-0.5 rounded-full font-medium ${step === "basics" ? "bg-ink text-white" : "bg-border text-muted"}`}>
            1. Datos del TP
          </span>
          <span className="text-border">→</span>
          <span className={`px-2 py-0.5 rounded-full font-medium ${step === "ejercicios" ? "bg-ink text-white" : "bg-border text-muted"}`}>
            2. Ejercicios
          </span>
        </div>
      )}

      {/* Step 1: Basics */}
      {step === "basics" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-ink mb-1">Codigo</span>
              <input type="text" value={codigo} onChange={(e) => setCodigo(e.target.value)} required placeholder="TP1" className={inputClass} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-ink mb-1">Peso (0 - 1)</span>
              <input type="number" min={0} max={1} step={0.05} value={peso} onChange={(e) => setPeso(e.target.value)} required className={`${inputClass} tabular-nums`} />
            </label>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-ink mb-1">Titulo del TP</span>
            <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} required placeholder="Ej: Listas y funciones en Python" className={inputClass} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-ink mb-1">Fecha de inicio (opcional)</span>
              <input type="datetime-local" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} className={inputClass} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-ink mb-1">Fecha de fin (opcional)</span>
              <input type="datetime-local" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} className={inputClass} />
            </label>
          </div>

          {formError && <div className="p-2 rounded bg-danger-soft text-danger text-xs">{formError}</div>}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-1.5 text-sm border border-border rounded-md hover:bg-canvas transition-colors text-muted">
              Cancelar
            </button>
            <button type="button" onClick={handleNextStep} className="px-4 py-1.5 text-sm bg-accent-brand hover:bg-accent-brand-deep text-white rounded-md font-medium transition-colors">
              Siguiente: Ejercicios →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Ejercicios */}
      {step === "ejercicios" && (
        <div className="space-y-4">
          {/* Summary strip of TP basics */}
          {!isEditing && (
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-canvas border border-border text-xs text-muted">
              <span className="font-mono font-medium text-ink">{codigo}</span>
              <span className="text-border">·</span>
              <span>{titulo}</span>
              <span className="text-border">·</span>
              <span>peso {peso}</span>
              {fechaInicio && (
                <>
                  <span className="text-border">·</span>
                  <span>{formatShortDate(localInputToIso(fechaInicio))}</span>
                </>
              )}
              <button type="button" onClick={() => setStep("basics")} className="ml-auto text-[var(--color-accent-brand)] hover:underline">
                Editar
              </button>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink uppercase tracking-wider">
                Ejercicios ({ejercicios.length})
              </span>
              <button type="button" onClick={addEjercicio} className="text-xs text-muted hover:text-ink transition-colors">
                + Agregar ejercicio
              </button>
            </div>
            <div className="max-h-[45vh] overflow-y-auto space-y-2 pr-1">
              {ejercicios.map((ej, i) => (
                <div key={i} className="border border-border rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedEj(expandedEj === i ? null : i)}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-canvas hover:bg-surface-alt transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted bg-white border border-border rounded px-1.5 py-0.5">
                        {i + 1}
                      </span>
                      <span className="text-sm font-medium text-ink truncate max-w-xs">
                        {ej.titulo || `Ejercicio ${i + 1}`}
                      </span>
                      {ej.enunciado && (
                        <span className="text-[10px] text-success bg-success-soft border border-green-200 rounded px-1.5 py-0.5">
                          con contenido
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {ejercicios.length > 1 && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(ev) => { ev.stopPropagation(); removeEjercicio(i) }}
                          onKeyDown={(ev) => { if (ev.key === "Enter") { ev.stopPropagation(); removeEjercicio(i) } }}
                          className="text-xs text-danger hover:text-danger px-1"
                        >
                          Quitar
                        </span>
                      )}
                      <span className="text-muted text-xs">{expandedEj === i ? "▲" : "▼"}</span>
                    </div>
                  </button>
                  {expandedEj === i && (
                    <div className="p-4 space-y-3">
                      <label className="block">
                        <span className="block text-xs font-medium text-ink mb-1">Titulo</span>
                        <input type="text" value={ej.titulo} onChange={(e) => updateEjercicio(i, { titulo: e.target.value })} className={inputClass} />
                      </label>
                      <label className="block">
                        <span className="block text-xs font-medium text-ink mb-1">Enunciado (markdown)</span>
                        <textarea
                          value={ej.enunciado}
                          onChange={(e) => updateEjercicio(i, { enunciado: e.target.value })}
                          rows={8}
                          placeholder="Describir el ejercicio en markdown..."
                          className={`${inputClass} font-mono resize-y`}
                        />
                      </label>
                      <label className="block">
                        <span className="block text-xs font-medium text-ink mb-1">Codigo inicial (opcional)</span>
                        <textarea
                          value={ej.inicial_codigo}
                          onChange={(e) => updateEjercicio(i, { inicial_codigo: e.target.value })}
                          rows={5}
                          placeholder="# Codigo que el alumno ve al empezar..."
                          className="w-full px-2 py-1.5 text-sm font-mono border border-border rounded bg-sidebar-bg text-sidebar-text resize-y focus:outline-none focus:border-ink"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-xs font-medium text-ink mb-1">Rubrica (JSON, opcional)</span>
                        <textarea
                          value={ej.rubricaRaw}
                          onChange={(e) => updateEjercicio(i, { rubricaRaw: e.target.value })}
                          onBlur={(e) => {
                            try {
                              const parsed = JSON.parse(e.target.value)
                              updateEjercicio(i, { rubrica: parsed })
                            } catch { /* se parsea al guardar */ }
                          }}
                          rows={4}
                          placeholder='{"criterios": [...]}'
                          className={`${inputClass} text-xs font-mono resize-y`}
                        />
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {formError && <div className="p-2 rounded bg-danger-soft text-danger text-xs">{formError}</div>}

          <div className="flex justify-between gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => isEditing ? onClose() : setStep("basics")}
              disabled={submitting}
              className="px-4 py-1.5 text-sm border border-border rounded-md hover:bg-canvas transition-colors disabled:opacity-40 text-muted"
            >
              {isEditing ? "Cancelar" : "← Volver"}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || (showDriftBanner && !driftAck)}
              className="px-4 py-1.5 text-sm bg-accent-brand hover:bg-accent-brand-deep disabled:bg-border text-white rounded-md font-medium transition-colors"
            >
              {submitting ? "Guardando..." : "Guardar TP"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── View modal ────────────────────────────────────────────────────────

function TareaViewModal({
  tarea,
  onClose,
  onShowVersions,
}: {
  tarea: TareaPractica
  onClose: () => void
  onShowVersions: () => void
}) {
  return (
    <Modal isOpen={true} onClose={onClose} title={`${tarea.codigo}: ${tarea.titulo}`} size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <HelpButton
            size="sm"
            title="Detalle del TP"
            content={
              <div className="space-y-3 text-sidebar-text-muted">
                <p>Esta vista muestra el detalle completo del TP en modo solo lectura:</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>
                    <strong>Estado:</strong> Indica si el TP esta publicado o archivado.
                  </li>
                  <li>
                    <strong>Version:</strong> Numero de version. TPs derivados muestran "derivado".
                  </li>
                  <li>
                    <strong>Enunciado:</strong> Texto completo renderizado en markdown.
                  </li>
                  <li>
                    <strong>Rubrica:</strong> Criterios de evaluacion en JSON (si fueron cargados).
                  </li>
                  <li>
                    <strong>Ver historial:</strong> Navega a la lista de versiones del TP.
                  </li>
                </ul>
              </div>
            }
          />
          <span className="text-sm text-muted dark:text-sidebar-text-muted">Ayuda sobre esta vista</span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ESTADO_COLOR[tarea.estado]}`}
          >
            {ESTADO_LABEL[tarea.estado]}
          </span>
          <span className="text-xs text-muted">
            v{tarea.version}
            {tarea.parent_tarea_id && " · derivado"}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-muted">Inicio</div>
            <div className="font-medium">
              {tarea.fecha_inicio ? formatDateTime(tarea.fecha_inicio) : "sin fecha"}
            </div>
          </div>
          <div>
            <div className="text-muted">Fin</div>
            <div className="font-medium">
              {tarea.fecha_fin ? formatDateTime(tarea.fecha_fin) : "sin fecha"}
            </div>
          </div>
          <div>
            <div className="text-muted">Peso</div>
            <div className="font-medium tabular-nums">{tarea.peso}</div>
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-muted mb-1">Enunciado</div>
          <div className="p-3 rounded bg-surface-alt dark:bg-sidebar-bg-edge max-h-96 overflow-y-auto">
            <MarkdownRenderer content={tarea.enunciado} />
          </div>
        </div>

        {tarea.rubrica && (
          <div>
            <div className="text-xs font-medium text-muted mb-1">Rúbrica</div>
            {/* Rúbrica se muestra como JSON crudo a propósito — el shape no está
                versionado todavía, así que markdown sería engañoso. */}
            <pre className="p-3 rounded bg-surface-alt dark:bg-sidebar-bg-edge text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
              {JSON.stringify(tarea.rubrica, null, 2)}
            </pre>
          </div>
        )}

        <div className="flex justify-between pt-2 border-t border-border">
          <button
            type="button"
            onClick={onShowVersions}
            className="px-4 py-1.5 text-sm border border-border rounded-md hover:bg-canvas transition-colors text-muted"
          >
            Ver historial de versiones
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-accent-brand hover:bg-accent-brand-deep text-white rounded-md transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Versions modal (timeline) ─────────────────────────────────────────

function VersionsModal({
  tarea,
  getToken,
  onClose,
}: {
  tarea: TareaPractica
  getToken: () => Promise<string | null>
  onClose: () => void
}) {
  const [versions, setVersions] = useState<TareaPracticaVersionRef[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    tareasPracticasApi
      .versions(tarea.id, getToken)
      .then((v) => {
        if (!cancelled) setVersions(v)
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [tarea.id, getToken])

  // Timeline vertical: ordena por version ascendente para lectura natural.
  const sorted = versions ? [...versions].sort((a, b) => a.version - b.version) : null

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Historial de versiones (${tarea.codigo})`}
      size="md"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <HelpButton
            size="sm"
            title="Historial de versiones"
            content={
              <div className="space-y-3 text-sidebar-text-muted">
                <p>Muestra la linea de tiempo de todas las versiones del TP:</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>
                    <strong>Version actual:</strong> Marcada en azul, es la version activa del TP.
                  </li>
                  <li>
                    <strong>Versiones anteriores:</strong> Marcadas en gris, son inmutables y solo
                    de referencia.
                  </li>
                  <li>
                    <strong>Estado:</strong> Cada version muestra su estado al momento de la
                    creacion.
                  </li>
                  <li>
                    <strong>Nueva version:</strong> Para modificar el contenido de un TP publicado,
                    usa el boton "Nueva version" en la lista de TPs: esto crea un nuevo borrador
                    linkeado por parent_tarea_id.
                  </li>
                </ul>
              </div>
            }
          />
          <span className="text-sm text-muted dark:text-sidebar-text-muted">
            Ayuda sobre el historial
          </span>
        </div>

        {err && <div className="p-3 rounded bg-danger-soft text-danger text-sm">{err}</div>}

        {!sorted ? (
          <div className="p-6 text-center text-muted text-sm">Cargando versiones...</div>
        ) : sorted.length === 0 ? (
          <div className="p-6 text-center text-muted text-sm">Sin versiones registradas.</div>
        ) : (
          <ol className="relative border-l border-border-soft dark:border-sidebar-bg-edge ml-3 space-y-4">
            {sorted.map((v) => (
              <li key={v.id} className="ml-4">
                <span
                  className={`absolute -left-[9px] w-4 h-4 rounded-full border-2 border-white dark:border-sidebar-bg ${
                    v.is_current ? "bg-accent-brand" : "bg-border-strong"
                  }`}
                  aria-hidden="true"
                />
                <div
                  className={`rounded border p-3 ${
                    v.is_current
                      ? "border-accent-brand/40 bg-accent-brand-soft dark:bg-accent-brand-deep/30"
                      : "border-border-soft dark:border-sidebar-bg-edge"
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">v{v.version}</span>
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ESTADO_COLOR[v.estado]}`}
                    >
                      {ESTADO_LABEL[v.estado]}
                    </span>
                    {v.is_current && (
                      <span className="text-xs text-accent-brand-deep font-medium">(actual)</span>
                    )}
                  </div>
                  <div className="text-sm mt-1">{v.titulo}</div>
                  <div className="text-xs text-muted mt-1">{formatDateTime(v.created_at)}</div>
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className="flex justify-end pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-accent-brand hover:bg-accent-brand-deep text-white rounded-md transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  )
}
