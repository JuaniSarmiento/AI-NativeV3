/**
 * Vista de gestion de Unidades de Trazabilidad.
 *
 * Permite al docente:
 *  - Listar unidades de la comision ordenadas por `orden`
 *  - Crear una unidad nueva (nombre + descripcion)
 *  - Editar nombre/descripcion de una unidad existente
 *  - Eliminar unidad (soft delete)
 *  - Asignar/reasignar TPs a una unidad (dropdown)
 *  - Ver TPs por unidad en acordeon expandible
 *  - "Sin unidad" muestra las TPs huerfanas
 *
 * Convenciones:
 *  - useCallback para todas las fetchFns que van a deps de useEffect
 *  - Texto en espanol SIN tildes (encoding gotcha cp1252)
 *  - No usar @tailwindcss/typography
 */
import { Modal, PageContainer } from "@platform/ui"
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import {
  type TareaPractica,
  type Unidad,
  type UnidadCreate,
  assignTPToUnidad,
  createUnidad,
  deleteUnidad,
  listTareasPracticas,
  listUnidades,
  updateUnidad,
} from "../lib/api"
import { helpContent } from "../utils/helpContent"

interface Props {
  comisionId: string
  getToken: () => Promise<string | null>
}

type ModalState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; unidad: Unidad }
  | { kind: "confirm-delete"; unidad: Unidad }

export function UnidadesView({ comisionId, getToken }: Props) {
  const [unidades, setUnidades] = useState<Unidad[]>([])
  const [tps, setTps] = useState<TareaPractica[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ kind: "closed" })
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [savingTpId, setSavingTpId] = useState<string | null>(null)

  const fetchAll = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      listUnidades(comisionId, getToken),
      listTareasPracticas({ comision_id: comisionId, limit: 200 }, getToken).then((r) => r.data),
    ])
      .then(([u, t]) => {
        setUnidades(u)
        setTps(t)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [comisionId, getToken])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleCreate(nombre: string, descripcion: string) {
    setSaving(true)
    const nextOrden = unidades.length > 0 ? Math.max(...unidades.map((u) => u.orden)) + 1 : 1
    const body: UnidadCreate = {
      comision_id: comisionId,
      nombre,
      orden: nextOrden,
      descripcion: descripcion || null,
    }
    try {
      await createUnidad(body, getToken)
      setModal({ kind: "closed" })
      fetchAll()
    } catch (e) {
      alert(`Error al crear unidad: ${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(unidad: Unidad, nombre: string, descripcion: string) {
    setSaving(true)
    try {
      await updateUnidad(unidad.id, { nombre, descripcion: descripcion || null }, getToken)
      setModal({ kind: "closed" })
      fetchAll()
    } catch (e) {
      alert(`Error al editar unidad: ${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(unidad: Unidad) {
    setSaving(true)
    try {
      await deleteUnidad(unidad.id, getToken)
      setModal({ kind: "closed" })
      fetchAll()
    } catch (e) {
      alert(`Error al eliminar unidad: ${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleAssignTP(tpId: string, unidadId: string | null) {
    setSavingTpId(tpId)
    try {
      await assignTPToUnidad(tpId, unidadId, getToken)
      // Optimistic local update
      setTps((prev) =>
        prev.map((t) => (t.id === tpId ? { ...t, unidad_id: unidadId } : t)),
      )
    } catch (e) {
      alert(`Error al asignar TP: ${String(e)}`)
    } finally {
      setSavingTpId(null)
    }
  }

  // Group TPs by unidad_id (null → "sin_unidad")
  const tpsByUnidad: Record<string, TareaPractica[]> = { sin_unidad: [] }
  for (const u of unidades) tpsByUnidad[u.id] = []
  for (const tp of tps) {
    const key = tp.unidad_id ?? "sin_unidad"
    if (!tpsByUnidad[key]) tpsByUnidad[key] = []
    tpsByUnidad[key]?.push(tp)
  }

  return (
    <PageContainer
      title="Unidades de trazabilidad"
      description={`Organiza los TPs de la comision en unidades tematicas para mejorar el analisis longitudinal.`}
      helpContent={helpContent.unidades}
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="font-semibold">Error al cargar datos</div>
            <div className="mt-1 font-mono text-xs">{error}</div>
          </div>
        )}

        {loading && (
          <div className="rounded-xl border border-[#EAEAEA] bg-white p-6 text-sm text-[#787774]">
            Cargando unidades...
          </div>
        )}

        {!loading && (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm text-[#787774]">
                {unidades.length === 0
                  ? "Sin unidades creadas todavia."
                  : `${unidades.length} unidad${unidades.length !== 1 ? "es" : ""} · ${tps.length} TP${tps.length !== 1 ? "s" : ""}`}
              </div>
              <button
                type="button"
                onClick={() => setModal({ kind: "create" })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#333333] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Nueva unidad
              </button>
            </div>

            <div className="space-y-2">
              {unidades.map((unidad) => (
                <UnidadCard
                  key={unidad.id}
                  unidad={unidad}
                  tps={tpsByUnidad[unidad.id] ?? []}
                  allUnidades={unidades}
                  expanded={expandedIds.has(unidad.id)}
                  onToggle={() => toggleExpand(unidad.id)}
                  onEdit={() => setModal({ kind: "edit", unidad })}
                  onDelete={() => setModal({ kind: "confirm-delete", unidad })}
                  onAssignTP={handleAssignTP}
                  savingTpId={savingTpId}
                />
              ))}

              {/* Sin unidad — siempre visible */}
              <SinUnidadCard
                tps={tpsByUnidad["sin_unidad"] ?? []}
                allUnidades={unidades}
                expanded={expandedIds.has("sin_unidad")}
                onToggle={() => toggleExpand("sin_unidad")}
                onAssignTP={handleAssignTP}
                savingTpId={savingTpId}
              />
            </div>
          </>
        )}
      </div>

      {/* Modal crear */}
      {modal.kind === "create" && (
        <UnidadFormModal
          title="Nueva unidad"
          onClose={() => setModal({ kind: "closed" })}
          onSubmit={handleCreate}
          saving={saving}
        />
      )}

      {/* Modal editar */}
      {modal.kind === "edit" && (
        <UnidadFormModal
          title="Editar unidad"
          initial={modal.unidad}
          onClose={() => setModal({ kind: "closed" })}
          onSubmit={(nombre, descripcion) => handleEdit(modal.unidad, nombre, descripcion)}
          saving={saving}
        />
      )}

      {/* Modal confirmar borrado */}
      {modal.kind === "confirm-delete" && (
        <Modal
          isOpen
          onClose={() => setModal({ kind: "closed" })}
          title="Eliminar unidad"
          size="sm"
          variant="light"
        >
          <div className="space-y-4">
            <p className="text-sm text-[#111111]">
              ¿Eliminar la unidad{" "}
              <strong>&quot;{modal.unidad.nombre}&quot;</strong>?
              Los TPs asignados quedan sin unidad (no se borran).
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModal({ kind: "closed" })}
                className="rounded-lg border border-[#EAEAEA] px-4 py-1.5 text-sm text-[#787774] hover:text-[#111111] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleDelete(modal.unidad)}
                className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60 transition-colors"
              >
                {saving ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </PageContainer>
  )
}

// ── UnidadCard ────────────────────────────────────────────────────────

function UnidadCard({
  unidad,
  tps,
  allUnidades,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onAssignTP,
  savingTpId,
}: {
  unidad: Unidad
  tps: TareaPractica[]
  allUnidades: Unidad[]
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onAssignTP: (tpId: string, unidadId: string | null) => void
  savingTpId: string | null
}) {
  return (
    <div className="rounded-xl border border-[#EAEAEA] bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-[#787774] shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[#787774] shrink-0" aria-hidden="true" />
          )}
          <span className="text-sm font-semibold text-[#111111] truncate">{unidad.nombre}</span>
          <span className="text-xs text-[#787774] shrink-0">
            {tps.length} TP{tps.length !== 1 ? "s" : ""}
          </span>
          {unidad.descripcion && (
            <span className="text-xs text-[#787774] truncate hidden sm:inline">
              · {unidad.descripcion}
            </span>
          )}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 rounded-lg text-[#787774] hover:text-[#111111] hover:bg-[#FAFAFA] transition-colors"
            title="Editar unidad"
            aria-label={`Editar unidad ${unidad.nombre}`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 rounded-lg text-[#787774] hover:text-red-600 hover:bg-red-50 transition-colors"
            title="Eliminar unidad"
            aria-label={`Eliminar unidad ${unidad.nombre}`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#EAEAEA] divide-y divide-[#EAEAEA]">
          {tps.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[#787774] italic">
              Sin TPs asignados a esta unidad.
            </div>
          ) : (
            tps.map((tp) => (
              <TPRow
                key={tp.id}
                tp={tp}
                allUnidades={allUnidades}
                onAssign={onAssignTP}
                saving={savingTpId === tp.id}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── SinUnidadCard ─────────────────────────────────────────────────────

function SinUnidadCard({
  tps,
  allUnidades,
  expanded,
  onToggle,
  onAssignTP,
  savingTpId,
}: {
  tps: TareaPractica[]
  allUnidades: Unidad[]
  expanded: boolean
  onToggle: () => void
  onAssignTP: (tpId: string, unidadId: string | null) => void
  savingTpId: string | null
}) {
  return (
    <div className="rounded-xl border border-dashed border-[#EAEAEA] bg-[#FAFAFA] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-[#787774] shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[#787774] shrink-0" aria-hidden="true" />
        )}
        <span className="text-sm font-medium text-[#787774]">Sin unidad</span>
        <span className="text-xs text-[#787774] shrink-0">
          {tps.length} TP{tps.length !== 1 ? "s" : ""}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[#EAEAEA] divide-y divide-[#EAEAEA]">
          {tps.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[#787774] italic">
              Todos los TPs tienen unidad asignada.
            </div>
          ) : (
            tps.map((tp) => (
              <TPRow
                key={tp.id}
                tp={tp}
                allUnidades={allUnidades}
                onAssign={onAssignTP}
                saving={savingTpId === tp.id}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── TPRow ─────────────────────────────────────────────────────────────

function TPRow({
  tp,
  allUnidades,
  onAssign,
  saving,
}: {
  tp: TareaPractica
  allUnidades: Unidad[]
  onAssign: (tpId: string, unidadId: string | null) => void
  saving: boolean
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="flex-1 min-w-0">
        <span className="text-xs font-mono text-[#787774] mr-2">{tp.codigo}</span>
        <span className="text-sm text-[#111111] truncate">{tp.titulo}</span>
      </div>
      <div className="shrink-0">
        <select
          value={tp.unidad_id ?? ""}
          disabled={saving}
          onChange={(e) => onAssign(tp.id, e.target.value || null)}
          className="text-xs rounded-lg border border-[#EAEAEA] bg-white px-2 py-1 text-[#111111] disabled:opacity-60 hover:border-[#111111] transition-colors"
          aria-label={`Asignar unidad a ${tp.codigo}`}
        >
          <option value="">Sin unidad</option>
          {allUnidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ── UnidadFormModal ───────────────────────────────────────────────────

function UnidadFormModal({
  title,
  initial,
  onClose,
  onSubmit,
  saving,
}: {
  title: string
  initial?: Unidad
  onClose: () => void
  onSubmit: (nombre: string, descripcion: string) => void
  saving: boolean
}) {
  const [nombre, setNombre] = useState(initial?.nombre ?? "")
  const [descripcion, setDescripcion] = useState(initial?.descripcion ?? "")
  const isValid = nombre.trim().length > 0

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid) return
    onSubmit(nombre.trim(), descripcion.trim())
  }

  return (
    <Modal isOpen onClose={onClose} title={title} size="sm" variant="light">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-[#111111] mb-1" htmlFor="unidad-nombre">
            Nombre *
          </label>
          <input
            id="unidad-nombre"
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Condicionales"
            maxLength={120}
            required
            className="w-full rounded-lg border border-[#EAEAEA] bg-white px-3 py-2 text-sm text-[#111111] placeholder-[#787774] focus:border-[#111111] focus:outline-none transition-colors"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#111111] mb-1" htmlFor="unidad-desc">
            Descripcion (opcional)
          </label>
          <textarea
            id="unidad-desc"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Breve descripcion del tema de la unidad"
            rows={2}
            maxLength={500}
            className="w-full rounded-lg border border-[#EAEAEA] bg-white px-3 py-2 text-sm text-[#111111] placeholder-[#787774] focus:border-[#111111] focus:outline-none transition-colors resize-none"
          />
        </div>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#EAEAEA] px-4 py-1.5 text-sm text-[#787774] hover:text-[#111111] transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!isValid || saving}
            className="rounded-lg bg-[#111111] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#333333] disabled:opacity-60 transition-colors"
          >
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
