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
import { Badge, HelpButton, MarkdownRenderer, Modal, PageContainer } from "@platform/ui"
import { Archive, Eye, FileText, GitBranch, History, Pencil, Plus, Send, Sparkles, Trash2 } from "lucide-react"
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

const ESTADO_VARIANT: Record<TareaEstado, "default" | "success" | "warning"> = {
  draft: "default",
  published: "success",
  archived: "warning",
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

  const totalDraft = tareas.filter((t) => t.estado === "draft").length
  const totalPublished = tareas.filter((t) => t.estado === "published").length

  return (
    <PageContainer
      title="Trabajos prácticos"
      description={`Diseña los TPs de la comisión. Solo los TPs publicados aceptan episodios. Comisión: ${comisionLabelText}`}
      eyebrow={`Inicio · Tareas prácticas · ${comisionLabelText}`}
      helpContent={helpContent.tareasPracticas}
    >
      <div className="space-y-6">
        {/* ═══ Toolbar: filtros + acciones ════════════════════════════════ */}
        <div className="flex items-center justify-between gap-4 flex-wrap animate-fade-in-up">
          <div
            role="tablist"
            aria-label="Filtro por estado"
            className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1 shadow-[0_1px_2px_0_rgba(0,0,0,0.04)]"
          >
            {(["all", "draft", "published", "archived"] as const).map((f) => {
              const labels: Record<typeof f, string> = {
                all: "Todos",
                draft: "Borrador",
                published: "Publicado",
                archived: "Archivado",
              }
              const counts: Record<typeof f, number | null> = {
                all: tareas.length,
                draft: totalDraft,
                published: totalPublished,
                archived: tareas.filter((t) => t.estado === "archived").length,
              }
              const active = estadoFilter === f
              return (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setEstadoFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors press-shrink ${
                    active
                      ? "bg-ink text-white"
                      : "text-muted hover:text-ink hover:bg-surface-alt"
                  }`}
                >
                  {labels[f]}
                  <span
                    className={`ml-1.5 font-mono tabular-nums text-[10px] ${active ? "text-white/70" : "text-muted-soft"}`}
                  >
                    {counts[f]}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshList}
              disabled={loading}
              className="press-shrink px-3 py-1.5 text-xs border border-border bg-surface rounded-md hover:bg-surface-alt transition-colors disabled:opacity-40 text-muted"
            >
              {loading ? "Cargando..." : "Refrescar"}
            </button>
            <button
              type="button"
              onClick={() => setModal({ kind: "generar-ia" })}
              className="press-shrink inline-flex items-center gap-1.5 px-4 py-1.5 text-sm border border-border bg-surface hover:bg-surface-alt text-ink rounded-md font-medium transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent-brand-deep" />
              Generar con IA
            </button>
            <button
              type="button"
              onClick={() => setModal({ kind: "create" })}
              className="press-shrink inline-flex items-center gap-1.5 px-4 py-1.5 text-sm bg-accent-brand hover:bg-accent-brand-deep text-white rounded-md font-medium transition-colors shadow-[0_1px_2px_0_rgba(24,95,165,0.25)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Nuevo TP
            </button>
          </div>
        </div>

        {/* ═══ Error ══════════════════════════════════════════════════════ */}
        {error && (
          <div className="animate-fade-in-up rounded-xl border border-danger/30 bg-danger-soft p-4">
            <div className="text-sm font-semibold text-danger">No pudimos completar la operación</div>
            <div className="mt-1.5 font-mono text-xs text-danger/85 break-all">{error}</div>
          </div>
        )}

        {/* ═══ Loading skeleton ═══════════════════════════════════════════ */}
        {loading && tareas.length === 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-fade-in">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-44 rounded-xl" />
            ))}
          </div>
        )}

        {/* ═══ Empty state ════════════════════════════════════════════════ */}
        {!loading && tareas.length === 0 && (
          <div className="animate-fade-in-up rounded-2xl border border-dashed border-border bg-surface p-10 max-w-2xl mx-auto text-center">
            <div className="inline-flex items-center justify-center rounded-full bg-surface-alt p-4 mb-4">
              <FileText className="h-7 w-7 text-muted" />
            </div>
            <h2 className="text-lg font-semibold text-ink mb-2">
              Todavía no hay TPs en esta comisión
            </h2>
            <p className="text-sm text-muted leading-relaxed max-w-sm mx-auto mb-5">
              Empezá creando un TP a mano o pedile a la IA un punto de partida que después podés
              editar a fondo.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setModal({ kind: "generar-ia" })}
                className="press-shrink inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs border border-border bg-surface hover:bg-surface-alt text-ink rounded-md font-medium transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5 text-accent-brand-deep" />
                Generar con IA
              </button>
              <button
                type="button"
                onClick={() => setModal({ kind: "create" })}
                className="press-shrink inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-accent-brand hover:bg-accent-brand-deep text-white rounded-md font-medium transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Nuevo TP
              </button>
            </div>
          </div>
        )}

        {/* ═══ Grid de TPs ════════════════════════════════════════════════ */}
        {tareas.length > 0 && (
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {tareas.map((t, idx) => (
              <li
                key={t.id}
                className="animate-fade-in-up"
                style={{ animationDelay: `${Math.min(idx, 6) * 50}ms` }}
              >
                <TareaCard
                  tarea={t}
                  onView={() => setModal({ kind: "view", tarea: t })}
                  onEdit={() => setModal({ kind: "edit", tarea: t })}
                  onPublish={() => handlePublish(t)}
                  onArchive={() => handleArchive(t)}
                  onNewVersion={() => setModal({ kind: "versioning", tarea: t })}
                  onDelete={() => handleDelete(t)}
                  onShowVersions={() => setModal({ kind: "versions-list", tarea: t })}
                />
              </li>
            ))}
          </ul>
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

// ── Card ──────────────────────────────────────────────────────────────

function TareaCard({
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
  const accentByEstado: Record<TareaEstado, string> = {
    draft: "bg-muted-soft",
    published: "bg-success",
    archived: "bg-warning",
  }

  return (
    <article className="hover-lift group relative overflow-hidden rounded-xl border border-border bg-surface flex flex-col h-full shadow-[0_1px_2px_0_rgba(0,0,0,0.04)]">
      {/* Banda izquierda según estado */}
      <div
        aria-hidden="true"
        className={`absolute left-0 top-0 bottom-0 w-1 ${accentByEstado[estado]} opacity-60 group-hover:opacity-100 transition-opacity`}
      />

      <div className="p-4 flex-1 flex flex-col gap-3">
        {/* Kicker: código + badges */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted px-2 py-0.5 rounded bg-surface-alt border border-border-soft">
              {tarea.codigo}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-soft">
              v{tarea.version}
            </span>
            {tarea.template_id && <TemplateBadge templateId={tarea.template_id} />}
            {tarea.has_drift && <DriftBadge />}
          </div>
          <Badge variant={ESTADO_VARIANT[estado]}>{ESTADO_LABEL[estado]}</Badge>
        </div>

        {/* Headline */}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink leading-tight tracking-tight line-clamp-2" title={tarea.titulo}>
            {tarea.titulo}
          </h3>
          {tarea.parent_tarea_id && (
            <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted">
              <GitBranch className="h-3 w-3" />
              Versión derivada
            </div>
          )}
        </div>

        {/* Mini-grid de metadatos */}
        <dl className="grid grid-cols-3 gap-2 mt-auto">
          <MetaCell label="Inicio" value={formatShortDate(tarea.fecha_inicio)} />
          <MetaCell label="Fin" value={formatShortDate(tarea.fecha_fin)} />
          <MetaCell label="Peso" value={tarea.peso} mono />
        </dl>
      </div>

      {/* Footer con acciones */}
      <footer className="flex items-stretch border-t border-border-soft">
        <button
          type="button"
          onClick={onShowVersions}
          className="press-shrink flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium text-muted hover:bg-surface-alt hover:text-ink transition-colors"
          title="Ver historial de versiones"
        >
          <History className="h-3.5 w-3.5" />
          Historial
        </button>
        {estado === "draft" && (
          <>
            <ActionButton onClick={onEdit} icon={<Pencil className="h-3.5 w-3.5" />} label="Editar" tone="brand" />
            <ActionButton onClick={onPublish} icon={<Send className="h-3.5 w-3.5" />} label="Publicar" tone="success" />
            <ActionButton onClick={onDelete} icon={<Trash2 className="h-3.5 w-3.5" />} label="" tone="danger" title="Eliminar" />
          </>
        )}
        {estado === "published" && (
          <>
            <ActionButton onClick={onView} icon={<Eye className="h-3.5 w-3.5" />} label="Ver" tone="muted" />
            <ActionButton onClick={onNewVersion} icon={<GitBranch className="h-3.5 w-3.5" />} label="Versión" tone="brand" title="Crear nueva versión" />
            <ActionButton onClick={onArchive} icon={<Archive className="h-3.5 w-3.5" />} label="" tone="warning" title="Archivar" />
          </>
        )}
        {estado === "archived" && (
          <>
            <ActionButton onClick={onView} icon={<Eye className="h-3.5 w-3.5" />} label="Ver" tone="muted" />
            <ActionButton onClick={onNewVersion} icon={<GitBranch className="h-3.5 w-3.5" />} label="Versión" tone="brand" title="Crear nueva versión" />
          </>
        )}
      </footer>
    </article>
  )
}

function MetaCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-soft">{label}</span>
      <span
        className={`text-xs text-body truncate ${mono ? "font-mono tabular-nums" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

function ActionButton({
  onClick,
  icon,
  label,
  tone,
  title,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  tone: "brand" | "success" | "warning" | "danger" | "muted"
  title?: string
}) {
  const toneCls: Record<typeof tone, string> = {
    brand: "text-accent-brand-deep hover:bg-accent-brand-soft",
    success: "text-success hover:bg-success-soft",
    warning: "text-warning hover:bg-warning-soft",
    danger: "text-danger hover:bg-danger-soft",
    muted: "text-muted hover:bg-surface-alt hover:text-ink",
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`press-shrink inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium border-l border-border-soft transition-colors ${toneCls[tone]}`}
    >
      {icon}
      {label}
    </button>
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
                          className="w-full px-2 py-1.5 text-sm font-mono border border-border rounded bg-surface-alt text-ink resize-y focus:outline-none focus:border-ink"
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
              <div className="space-y-3 text-body">
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
          <span className="text-sm text-muted">Ayuda sobre esta vista</span>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={ESTADO_VARIANT[tarea.estado]}>{ESTADO_LABEL[tarea.estado]}</Badge>
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
          <div className="p-3 rounded bg-surface-alt max-h-96 overflow-y-auto">
            <MarkdownRenderer content={tarea.enunciado} />
          </div>
        </div>

        {tarea.rubrica && (
          <div>
            <div className="text-xs font-medium text-muted mb-1">Rúbrica</div>
            {/* Rúbrica se muestra como JSON crudo a propósito — el shape no está
                versionado todavía, así que markdown sería engañoso. */}
            <pre className="p-3 rounded bg-surface-alt text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
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
              <div className="space-y-3 text-body">
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
          <span className="text-sm text-muted">
            Ayuda sobre el historial
          </span>
        </div>

        {err && <div className="p-3 rounded bg-danger-soft text-danger text-sm">{err}</div>}

        {!sorted ? (
          <div className="p-6 text-center text-muted text-sm">Cargando versiones...</div>
        ) : sorted.length === 0 ? (
          <div className="p-6 text-center text-muted text-sm">Sin versiones registradas.</div>
        ) : (
          <ol className="relative border-l border-border-soft ml-3 space-y-4">
            {sorted.map((v) => (
              <li key={v.id} className="ml-4">
                <span
                  className={`absolute -left-[9px] w-4 h-4 rounded-full border-2 border-surface ${
                    v.is_current ? "bg-accent-brand" : "bg-border-strong"
                  }`}
                  aria-hidden="true"
                />
                <div
                  className={`rounded border p-3 ${
                    v.is_current
                      ? "border-accent-brand/40 bg-accent-brand-soft"
                      : "border-border-soft bg-surface"
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">v{v.version}</span>
                    <Badge variant={ESTADO_VARIANT[v.estado]}>{ESTADO_LABEL[v.estado]}</Badge>
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
