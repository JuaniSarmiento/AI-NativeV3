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
import {
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
  draft: "bg-slate-200 text-slate-800",
  published: "bg-green-100 text-green-800",
  archived: "bg-amber-100 text-amber-800",
}

type EstadoFilter = "all" | TareaEstado

// Enum para máquina de estados de modales — reemplaza los 5 bools independientes.
type ModalState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; tarea: TareaPractica }
  | { kind: "view"; tarea: TareaPractica }
  | { kind: "versioning"; tarea: TareaPractica }
  | { kind: "versions-list"; tarea: TareaPractica }

// ADR-016 — badge "derivado de plantilla": muestra que la instancia fue
// creada por fan-out desde un `TareaPracticaTemplate`. Clickeable para
// mostrar el id del template (puente a la vista "Plantillas").
function TemplateBadge({ templateId }: { templateId: string }) {
  const title = `Derivado de plantilla de cátedra: ${templateId}`
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200"
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
      className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-800 border border-orange-200"
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
        {/* Filtros + acción principal */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-600 flex items-center gap-2">
              <span>Estado:</span>
              <select
                value={estadoFilter}
                onChange={(e) => setEstadoFilter(e.target.value as EstadoFilter)}
                className="px-2 py-1 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
              >
                <option value="all">Todos</option>
                <option value="draft">Borrador</option>
                <option value="published">Publicado</option>
                <option value="archived">Archivado</option>
              </select>
            </label>
            <button
              type="button"
              onClick={refreshList}
              disabled={loading}
              className="px-3 py-1 text-xs border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
            >
              {loading ? "Cargando..." : "Refrescar"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setModal({ kind: "create" })}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
          >
            + Nuevo TP
          </button>
        </div>

        {error && <div className="p-3 rounded bg-red-50 text-red-900 text-sm">{error}</div>}

        {/* Lista */}
        {loading && tareas.length === 0 ? (
          <div className="p-8 text-center text-slate-500">Cargando TPs...</div>
        ) : tareas.length === 0 ? (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-slate-500">
            No hay TPs para esta comisión todavía. Creá el primero con{" "}
            <span className="font-medium">+ Nuevo TP</span>.
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Código</th>
                  <th className="text-left px-4 py-2 font-medium">Título</th>
                  <th className="text-left px-4 py-2 font-medium">Estado</th>
                  <th className="text-right px-4 py-2 font-medium">Versión</th>
                  <th className="text-left px-4 py-2 font-medium">Inicio</th>
                  <th className="text-left px-4 py-2 font-medium">Fin</th>
                  <th className="text-right px-4 py-2 font-medium">Peso</th>
                  <th className="text-right px-4 py-2 font-medium">Acciones</th>
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

        {/* Modal: crear nuevo TP */}
        <TareaFormModal
          isOpen={modal.kind === "create"}
          title="Nuevo trabajo practico"
          initial={null}
          onClose={closeModal}
          onSubmit={async (values) => {
            await tareasPracticasApi.create({ ...values, comision_id: comisionId }, getToken)
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
    <tr className="border-b border-slate-100 dark:border-slate-800/50 last:border-0">
      <td className="px-4 py-2 font-mono text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span>{tarea.codigo}</span>
          {tarea.template_id && <TemplateBadge templateId={tarea.template_id} />}
          {tarea.has_drift && <DriftBadge />}
        </div>
      </td>
      <td className="px-4 py-2">
        <div className="font-medium truncate max-w-xs" title={tarea.titulo}>
          {tarea.titulo}
        </div>
        {tarea.parent_tarea_id && <div className="text-xs text-slate-500">(derivado)</div>}
      </td>
      <td className="px-4 py-2">
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ESTADO_COLOR[estado]}`}
        >
          {ESTADO_LABEL[estado]}
        </span>
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-slate-600">v{tarea.version}</td>
      <td className="px-4 py-2 text-xs text-slate-600">{formatShortDate(tarea.fecha_inicio)}</td>
      <td className="px-4 py-2 text-xs text-slate-600">{formatShortDate(tarea.fecha_fin)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-slate-600">{tarea.peso}</td>
      <td className="px-4 py-2 text-right">
        <div className="flex justify-end gap-1 flex-wrap">
          <button
            type="button"
            onClick={onShowVersions}
            className="px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 rounded"
            title="Ver historial de versiones"
          >
            Historial
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
                onClick={onView}
                className="px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 rounded"
              >
                Ver
              </button>
              <button
                type="button"
                onClick={onNewVersion}
                className="px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 rounded"
              >
                Nueva versión
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
            <>
              <button
                type="button"
                onClick={onView}
                className="px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 rounded"
              >
                Ver
              </button>
              <button
                type="button"
                onClick={onNewVersion}
                className="px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 rounded"
              >
                Nueva versión
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
}

function TareaFormModal({
  isOpen,
  title,
  initial,
  mode = "create",
  onClose,
  onSubmit,
}: {
  isOpen: boolean
  title: string
  initial: TareaPractica | null
  // `mode=edit` activa el banner de drift cuando el TP viene de un
  // template. En `create` y `version`, editar es el flujo esperado — no
  // tiene sentido advertir drift (create no tiene template todavia, y
  // new-version crea un TP nuevo derivado). Solo en `edit` el backend
  // mutaria `has_drift=true` sobre una instancia existente.
  mode?: "create" | "edit" | "version"
  onClose: () => void
  onSubmit: (values: FormValues) => Promise<void>
}) {
  const [codigo, setCodigo] = useState(initial?.codigo ?? "")
  const [titulo, setTitulo] = useState(initial?.titulo ?? "")
  const [enunciado, setEnunciado] = useState(initial?.enunciado ?? "")
  const [fechaInicio, setFechaInicio] = useState(isoToLocalInput(initial?.fecha_inicio ?? null))
  const [fechaFin, setFechaFin] = useState(isoToLocalInput(initial?.fecha_fin ?? null))
  const [peso, setPeso] = useState(initial?.peso ?? "1.0")
  const [rubricaRaw, setRubricaRaw] = useState(
    initial?.rubrica ? JSON.stringify(initial.rubrica, null, 2) : "",
  )
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // ADR-016 drift banner: editar una instancia derivada de template
  // desconecta la auto-sincronizacion. El docente tiene que reconocerlo
  // antes de que el submit se habilite. Si la instancia ya drifteo
  // (`has_drift=true`), el link ya se habia roto y no hay nada que
  // advertir — el banner solo aparece la primera vez.
  const showDriftBanner = Boolean(mode === "edit" && initial?.template_id && !initial.has_drift)
  const [driftAck, setDriftAck] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    // Validar coherencia de fechas antes de pegarle al backend (BUG-28).
    if (fechaInicio && fechaFin && fechaFin <= fechaInicio) {
      setFormError("La fecha de fin debe ser posterior a la fecha de inicio.")
      return
    }

    // Validar JSON de rubrica si hay contenido.
    let rubrica: Record<string, unknown> | null = null
    if (rubricaRaw.trim()) {
      try {
        const parsed = JSON.parse(rubricaRaw)
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("La rúbrica debe ser un objeto JSON (no array ni primitivo).")
        }
        rubrica = parsed as Record<string, unknown>
      } catch (err) {
        setFormError(`Rúbrica inválida: ${String(err)}`)
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
      })
    } catch (err) {
      setFormError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {showDriftBanner && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Este TP esta sincronizado con una plantilla de cátedra.</p>
            <p className="text-xs mt-1">
              Editar lo desconectara de la plantilla y lo marcara como drift. Ya no recibira nuevas
              versiones automáticas del template. El link al template se preserva para trazabilidad.
            </p>
            {!driftAck && (
              <button
                type="button"
                onClick={() => setDriftAck(true)}
                className="mt-2 px-3 py-1 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded font-medium"
              >
                Entiendo, continuar
              </button>
            )}
            {driftAck && (
              <p className="mt-2 text-xs italic text-amber-800">
                Reconocido, al guardar el TP quedara marcado como drift.
              </p>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 mb-2">
          <HelpButton
            size="sm"
            title="Formulario de Tarea Practica"
            content={
              <div className="space-y-3 text-zinc-300">
                <p>
                  <strong>Completa los siguientes campos</strong> para crear o editar el TP:
                </p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>
                    <strong>Codigo:</strong> Identificador corto del TP (ej. TP1, TP-RECURSION).
                    Obligatorio.
                  </li>
                  <li>
                    <strong>Peso:</strong> Ponderacion del TP en la evaluacion. Valor entre 0 y 1.
                    Ej: 0.25 para un 25%.
                  </li>
                  <li>
                    <strong>Titulo:</strong> Nombre descriptivo del trabajo practico. Obligatorio.
                  </li>
                  <li>
                    <strong>Enunciado (markdown):</strong> Descripcion completa del TP. Soporta
                    markdown con formato, listas, codigo. Obligatorio.
                  </li>
                  <li>
                    <strong>Fecha inicio / fin:</strong> Opcionales. Definen la ventana de tiempo en
                    que los estudiantes pueden abrir episodios.
                  </li>
                  <li>
                    <strong>Rubrica (JSON):</strong> Opcional. Criterios de evaluacion como objeto
                    JSON. Se valida antes de enviar.
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
            <span className="block text-xs font-medium text-slate-600 mb-1">Código</span>
            <input
              type="text"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              required
              placeholder="TP1"
              className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
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
          <span className="block text-xs font-medium text-slate-600 mb-1">Título</span>
          <input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            required
            placeholder="Ej: Recursión y divide & conquer"
            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            Enunciado (markdown)
          </span>
          {/* TODO: añadir markdown renderer para preview */}
          <textarea
            value={enunciado}
            onChange={(e) => setEnunciado(e.target.value)}
            required
            rows={15}
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
            Rúbrica (JSON, opcional)
          </span>
          <textarea
            value={rubricaRaw}
            onChange={(e) => setRubricaRaw(e.target.value)}
            rows={6}
            placeholder='{"criterios": [...]}'
            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 font-mono"
          />
          <p className="text-xs text-slate-500 mt-1">
            Se valida que sea JSON válido antes de enviar.
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
            disabled={submitting || (showDriftBanner && !driftAck)}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded font-medium"
          >
            {submitting ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </form>
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
              <div className="space-y-3 text-zinc-300">
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
          <span className="text-sm text-slate-500 dark:text-zinc-400">Ayuda sobre esta vista</span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ESTADO_COLOR[tarea.estado]}`}
          >
            {ESTADO_LABEL[tarea.estado]}
          </span>
          <span className="text-xs text-slate-500">
            v{tarea.version}
            {tarea.parent_tarea_id && " · derivado"}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-slate-500">Inicio</div>
            <div className="font-medium">
              {tarea.fecha_inicio ? formatDateTime(tarea.fecha_inicio) : "sin fecha"}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Fin</div>
            <div className="font-medium">
              {tarea.fecha_fin ? formatDateTime(tarea.fecha_fin) : "sin fecha"}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Peso</div>
            <div className="font-medium tabular-nums">{tarea.peso}</div>
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-600 mb-1">Enunciado</div>
          <div className="p-3 rounded bg-slate-50 dark:bg-slate-800 max-h-96 overflow-y-auto">
            <MarkdownRenderer content={tarea.enunciado} />
          </div>
        </div>

        {tarea.rubrica && (
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1">Rúbrica</div>
            {/* Rúbrica se muestra como JSON crudo a propósito — el shape no está
                versionado todavía, así que markdown sería engañoso. */}
            <pre className="p-3 rounded bg-slate-50 dark:bg-slate-800 text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
              {JSON.stringify(tarea.rubrica, null, 2)}
            </pre>
          </div>
        )}

        <div className="flex justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onShowVersions}
            className="px-4 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Ver historial de versiones
          </button>
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
              <div className="space-y-3 text-zinc-300">
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
          <span className="text-sm text-slate-500 dark:text-zinc-400">
            Ayuda sobre el historial
          </span>
        </div>

        {err && <div className="p-3 rounded bg-red-50 text-red-900 text-sm">{err}</div>}

        {!sorted ? (
          <div className="p-6 text-center text-slate-500 text-sm">Cargando versiones...</div>
        ) : sorted.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-sm">Sin versiones registradas.</div>
        ) : (
          <ol className="relative border-l border-slate-200 dark:border-slate-700 ml-3 space-y-4">
            {sorted.map((v) => (
              <li key={v.id} className="ml-4">
                <span
                  className={`absolute -left-[9px] w-4 h-4 rounded-full border-2 border-white dark:border-slate-900 ${
                    v.is_current ? "bg-blue-600" : "bg-slate-400"
                  }`}
                  aria-hidden="true"
                />
                <div
                  className={`rounded border p-3 ${
                    v.is_current
                      ? "border-blue-300 bg-blue-50 dark:bg-blue-950/30"
                      : "border-slate-200 dark:border-slate-800"
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
                      <span className="text-xs text-blue-700 font-medium">(actual)</span>
                    )}
                  </div>
                  <div className="text-sm mt-1">{v.titulo}</div>
                  <div className="text-xs text-slate-500 mt-1">{formatDateTime(v.created_at)}</div>
                </div>
              </li>
            ))}
          </ol>
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
