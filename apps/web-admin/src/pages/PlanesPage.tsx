import { HelpButton, PageContainer, ReadonlyField } from "@platform/ui"
import { type ReactNode, useEffect, useRef, useState } from "react"
import {
  type Carrera,
  HttpError,
  type Plan,
  type PlanCreate,
  type Universidad,
  carrerasApi,
  facultadesApi,
  planesApi,
  universidadesApi,
} from "../lib/api"
import { helpContent } from "../utils/helpContent"

interface CarreraContext {
  universidad: string
  facultad: string
}

export function PlanesPage(): ReactNode {
  // Cascading selectors: Universidad → Carrera → lista de Planes.
  // Resetear descendientes en cada cambio para evitar combinaciones inválidas.
  const [universidades, setUniversidades] = useState<Universidad[]>([])
  const [universidadId, setUniversidadId] = useState<string>("")
  const [carreras, setCarreras] = useState<Carrera[]>([])
  const [carreraId, setCarreraId] = useState<string>("")
  const [items, setItems] = useState<Plan[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingUniversidades, setLoadingUniversidades] = useState(false)
  const [loadingCarreras, setLoadingCarreras] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [context, setContext] = useState<Partial<CarreraContext>>({})
  // Cache carrera_id → contexto resuelto. Persistido en ref para sobrevivir
  // re-renders sin disparar efectos.
  const contextCache = useRef<Map<string, CarreraContext>>(new Map())

  const loadUniversidades = async () => {
    setLoadingUniversidades(true)
    setError(null)
    try {
      const res = await universidadesApi.list({ limit: 200 })
      setUniversidades(res.data)
    } catch (e) {
      setError(e instanceof HttpError ? `${e.status}: ${e.detail || e.title}` : String(e))
    } finally {
      setLoadingUniversidades(false)
    }
  }

  const loadCarreras = async (uid: string) => {
    if (!uid) {
      setCarreras([])
      return
    }
    setLoadingCarreras(true)
    setError(null)
    try {
      const res = await carrerasApi.list({ universidad_id: uid, limit: 200 })
      setCarreras(res.data)
    } catch (e) {
      setError(e instanceof HttpError ? `${e.status}: ${e.detail || e.title}` : String(e))
    } finally {
      setLoadingCarreras(false)
    }
  }

  const loadPlanes = async (cid: string) => {
    if (!cid) {
      setItems([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await planesApi.list({ carrera_id: cid, limit: 200 })
      setItems(res.data)
    } catch (e) {
      setError(e instanceof HttpError ? `${e.status}: ${e.detail || e.title}` : String(e))
    } finally {
      setLoading(false)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadUniversidades — fetch mount-only; el handler usa setState con identidad estable.
  useEffect(() => {
    void loadUniversidades()
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadCarreras — depende solo de universidadId; el handler captura el arg en cada call.
  useEffect(() => {
    void loadCarreras(universidadId)
  }, [universidadId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadPlanes — depende solo de carreraId; el handler captura el arg en cada call.
  useEffect(() => {
    void loadPlanes(carreraId)
  }, [carreraId])

  // Chain fetch: carrera → facultad + universidad. No bloquea la lista de planes.
  // Cacheado por carrera_id en `contextCache` para evitar refetch al re-seleccionar.
  useEffect(() => {
    if (!carreraId) {
      setContext({})
      return
    }
    const cached = contextCache.current.get(carreraId)
    if (cached) {
      setContext(cached)
      return
    }
    let cancelled = false
    setContext({})
    ;(async () => {
      try {
        const carrera = await carrerasApi.get(carreraId)
        if (cancelled) return
        const facultad = await facultadesApi.get(carrera.facultad_id)
        if (cancelled) return
        const universidad = await universidadesApi.get(carrera.universidad_id)
        if (cancelled) return
        const resolved: CarreraContext = {
          universidad: universidad.nombre,
          facultad: facultad.nombre,
        }
        contextCache.current.set(carreraId, resolved)
        setContext(resolved)
      } catch {
        // Silencioso: no rompemos la página por un breadcrumb. Queda en "?".
        if (!cancelled) setContext({})
      }
    })()
    return () => {
      cancelled = true
    }
  }, [carreraId])

  const carreraMap = new Map(carreras.map((c) => [c.id, c]))

  const handleDelete = async (p: Plan) => {
    if (
      !window.confirm(
        `¿Eliminar el plan ${p.version} (${p.año_inicio})? Esta acción es lógica (soft-delete).`,
      )
    ) {
      return
    }
    setDeletingId(p.id)
    setError(null)
    try {
      await planesApi.delete(p.id)
      await loadPlanes(carreraId)
    } catch (e) {
      setError(e instanceof HttpError ? `${e.status}: ${e.detail || e.title}` : String(e))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <PageContainer
      title="Planes de estudio"
      description="Versiones de plan vigentes y derogadas por carrera."
      helpContent={helpContent.planes}
    >
      <div className="space-y-6">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            disabled={!universidadId || !carreraId}
            className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {showForm ? "Cancelar" : "Crear plan"}
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 grid grid-cols-2 gap-4">
          <Field label="Universidad" required>
            {loadingUniversidades ? (
              <span className="text-sm text-slate-500">Cargando universidades…</span>
            ) : universidades.length === 0 ? (
              <span className="text-sm text-slate-500">
                No hay universidades creadas. Primero creá una universidad.
              </span>
            ) : (
              <select
                value={universidadId}
                onChange={(e) => {
                  setUniversidadId(e.target.value)
                  setCarreraId("")
                }}
                className={inputClass}
              >
                <option value="">— Seleccioná una universidad —</option>
                {universidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.codigo} · {u.nombre}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Carrera" required>
            {loadingCarreras ? (
              <span className="text-sm text-slate-500">Cargando carreras…</span>
            ) : !universidadId ? (
              <select value="" disabled className={inputClass}>
                <option value="">— Primero seleccioná una universidad —</option>
              </select>
            ) : carreras.length === 0 ? (
              <span className="text-sm text-slate-500">No hay carreras en esta universidad.</span>
            ) : (
              <select
                value={carreraId}
                onChange={(e) => setCarreraId(e.target.value)}
                className={inputClass}
              >
                <option value="">— Seleccioná una carrera —</option>
                {carreras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} · {c.nombre}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        {showForm && carreraId && (
          <PlanForm
            carreraId={carreraId}
            context={context}
            onCreated={async () => {
              setShowForm(false)
              await loadPlanes(carreraId)
            }}
          />
        )}

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            {error}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-slate-500 text-sm">Cargando…</div>
          ) : !universidadId ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              Seleccioná una universidad y una carrera para ver sus planes.
            </div>
          ) : !carreraId ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              Seleccioná una carrera para ver sus planes.
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-slate-500 text-sm">No hay planes de estudio en esta carrera todavia.</p>
              {carreraId && (
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="rounded-md bg-blue-600 text-white px-4 py-1.5 text-sm hover:bg-blue-700"
                >
                  Crear primer plan
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Versión</th>
                  <th className="px-4 py-2 font-medium">Año inicio</th>
                  <th className="px-4 py-2 font-medium">Carrera</th>
                  <th className="px-4 py-2 font-medium">Ordenanza</th>
                  <th className="px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{p.version}</td>
                    <td className="px-4 py-2">{p.año_inicio}</td>
                    <td className="px-4 py-2 text-slate-600 text-xs">
                      {carreraMap.get(p.carrera_id)?.nombre ?? p.carrera_id}
                    </td>
                    <td className="px-4 py-2 text-slate-600 text-xs">{p.ordenanza ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          p.vigente
                            ? "inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-xs"
                            : "inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-xs"
                        }
                      >
                        {p.vigente ? "vigente" : "derogado"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        disabled={deletingId === p.id}
                        className="text-xs text-red-700 hover:text-red-900 disabled:opacity-50"
                      >
                        {deletingId === p.id ? "Eliminando…" : "Eliminar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </PageContainer>
  )
}

function PlanForm({
  carreraId,
  context,
  onCreated,
}: {
  carreraId: string
  context: Partial<CarreraContext>
  onCreated: () => void
}): ReactNode {
  const currentYear = new Date().getFullYear()
  const [form, setForm] = useState<PlanCreate>({
    carrera_id: carreraId,
    version: "",
    año_inicio: currentYear,
    ordenanza: "",
    vigente: true,
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const { ordenanza: _omit, ...rest } = form
      const trimmedOrdenanza = form.ordenanza?.trim()
      const payload: PlanCreate = {
        ...rest,
        carrera_id: carreraId,
        ...(trimmedOrdenanza ? { ordenanza: trimmedOrdenanza } : {}),
      }
      await planesApi.create(payload)
      onCreated()
    } catch (e) {
      setError(e instanceof HttpError ? `${e.status}: ${e.detail || e.title}` : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <HelpButton
          size="sm"
          title="Formulario de Plan de Estudio"
          content={
            <div className="space-y-3 text-zinc-300">
              <p>
                <strong>Completa los siguientes campos</strong> para crear un nuevo plan de estudio:
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong>Version:</strong> Identificador del plan (ej. 2024, Plan-2020). Libre pero
                  unico por carrera. Obligatorio.
                </li>
                <li>
                  <strong>Ano de inicio:</strong> Ano en que entra en vigencia el plan. Obligatorio.
                </li>
                <li>
                  <strong>Ordenanza:</strong> Opcional. Referencia a la resolucion del Consejo
                  Superior (ej. Res. CS No 12/24).
                </li>
                <li>
                  <strong>Vigencia:</strong> Indica si el plan esta activo para nuevas
                  inscripciones.
                </li>
              </ul>
            </div>
          }
        />
        <span className="text-sm text-slate-500">Nuevo plan de estudio</span>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-md bg-slate-50 border border-slate-200 p-3">
        <ReadonlyField label="Universidad" value={context.universidad ?? "—"} />
        <ReadonlyField label="Facultad" value={context.facultad ?? "—"} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Versión" required>
          <input
            type="text"
            value={form.version}
            onChange={(e) => setForm({ ...form, version: e.target.value })}
            required
            minLength={1}
            maxLength={50}
            className={inputClass}
            placeholder="2024"
          />
        </Field>

        <Field label="Año de inicio" required>
          <input
            type="number"
            value={form.año_inicio}
            onChange={(e) => setForm({ ...form, año_inicio: Number(e.target.value) })}
            min={1900}
            max={2100}
            required
            className={inputClass}
          />
        </Field>

        <Field label="Ordenanza">
          <input
            type="text"
            value={form.ordenanza ?? ""}
            onChange={(e) => setForm({ ...form, ordenanza: e.target.value })}
            maxLength={100}
            className={inputClass}
            placeholder="Opcional — Res. CS Nº 12/24"
          />
        </Field>

        <Field label="Vigencia" required>
          <select
            value={form.vigente ? "true" : "false"}
            onChange={(e) => setForm({ ...form, vigente: e.target.value === "true" })}
            required
            className={inputClass}
          >
            <option value="true">Vigente</option>
            <option value="false">Derogado</option>
          </select>
        </Field>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Creando..." : "Crear"}
        </button>
      </div>
    </form>
  )
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600"

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: ReactNode
}): ReactNode {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: children es el control (input/select/textarea) wrappeado por el padre — patrón de form helper.
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}
