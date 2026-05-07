import { HelpButton, PageContainer, ReadonlyField } from "@platform/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Fragment, type ReactNode, useState } from "react"
import { Breadcrumb, type BreadcrumbItem } from "../components/Breadcrumb"
import {
  type Carrera,
  type Comision,
  type ComisionCreate,
  type InscripcionCreate,
  type InscripcionOut,
  HttpError,
  type Materia,
  type Periodo,
  type Plan,
  type Universidad,
  type UsuarioComisionCreate,
  type UsuarioComisionOut,
  carrerasApi,
  comisionDocentesApi,
  comisionInscripcionesApi,
  comisionesApi,
  materiasApi,
  periodosApi,
  planesApi,
  universidadesApi,
} from "../lib/api"
import { helpContent } from "../utils/helpContent"

// Label expresivo del periodo: `${codigo} · ${nombre}`. Usamos ambos porque
// `codigo` (ej. "2026-S1") es conciso y `nombre` (ej. "Primer semestre 2026")
// da contexto humano. No hay endpoint GET /periodos/{id} — se resuelve desde
// la lista ya cacheada en `periodosQuery`.
function periodoLabel(p: Periodo): string {
  return `${p.codigo} · ${p.nombre}`
}

const PAGE_LIMIT = 50

interface MateriaContext {
  universidad: string
  carrera: string
  plan: string
  materia: string
  periodo: string
}

export function ComisionesPage(): ReactNode {
  // Cascading selectors: Universidad → Carrera → Plan → Materia.
  // Resetear descendientes en cada cambio para evitar combinaciones inválidas.
  const [universidadId, setUniversidadId] = useState<string>("")
  const [carreraId, setCarreraId] = useState<string>("")
  const [planId, setPlanId] = useState<string>("")
  const [materiaId, setMateriaId] = useState<string>("")
  const [periodoId, setPeriodoId] = useState<string>("")
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [showForm, setShowForm] = useState(false)
  const [expandedComisionId, setExpandedComisionId] = useState<string | null>(null)

  const queryClient = useQueryClient()

  const universidadesQuery = useQuery({
    queryKey: ["universidades", { limit: 200 }],
    queryFn: () => universidadesApi.list({ limit: 200 }),
  })

  // Server-side filter: carrerasApi.list soporta universidad_id.
  const carrerasQuery = useQuery({
    queryKey: ["carreras", { universidad_id: universidadId, limit: 200 }],
    queryFn: () => carrerasApi.list({ universidad_id: universidadId, limit: 200 }),
    enabled: !!universidadId,
  })

  // Server-side filter: planesApi.list soporta carrera_id.
  const planesQuery = useQuery({
    queryKey: ["planes", { carrera_id: carreraId, limit: 200 }],
    queryFn: () => planesApi.list({ carrera_id: carreraId, limit: 200 }),
    enabled: !!carreraId,
  })

  // Server-side filter: materiasApi.list soporta plan_id.
  const materiasQuery = useQuery({
    queryKey: ["materias", { plan_id: planId, limit: 200 }],
    queryFn: () => materiasApi.list({ plan_id: planId, limit: 200 }),
    enabled: !!planId,
  })

  const periodosQuery = useQuery({
    queryKey: ["periodos", { limit: 200 }],
    queryFn: () => periodosApi.list({ limit: 200 }),
  })

  const comisionesQuery = useQuery({
    queryKey: [
      "comisiones",
      { materia_id: materiaId, periodo_id: periodoId, cursor, limit: PAGE_LIMIT },
    ],
    queryFn: () =>
      comisionesApi.list({
        materia_id: materiaId,
        periodo_id: periodoId,
        ...(cursor ? { cursor } : {}),
        limit: PAGE_LIMIT,
      }),
    // Sólo cargamos comisiones cuando materia + periodo están ambos seteados.
    enabled: !!materiaId && !!periodoId,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => comisionesApi.delete(id),
    onMutate: async (id: string) => {
      const key = [
        "comisiones",
        { materia_id: materiaId, periodo_id: periodoId, cursor, limit: PAGE_LIMIT },
      ] as const
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<{
        data: Comision[]
        meta: { cursor_next: string | null; total: number | null }
      }>(key)
      if (previous) {
        queryClient.setQueryData(key, {
          ...previous,
          data: previous.data.filter((c) => c.id !== id),
        })
      }
      return { previous, key }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(ctx.key, ctx.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["comisiones"] })
    },
  })

  const universidades: Universidad[] = universidadesQuery.data?.data ?? []
  const carreras: Carrera[] = carrerasQuery.data?.data ?? []
  const planes: Plan[] = planesQuery.data?.data ?? []
  const materias: Materia[] = materiasQuery.data?.data ?? []
  const periodos: Periodo[] = periodosQuery.data?.data ?? []
  const items: Comision[] = comisionesQuery.data?.data ?? []
  const cursorNext = comisionesQuery.data?.meta.cursor_next ?? null

  const materiaMap = new Map(materias.map((m) => [m.id, m]))
  const periodoMap = new Map(periodos.map((p) => [p.id, p]))

  const selectedUniversidad = universidades.find((u) => u.id === universidadId)
  const selectedCarrera = carreras.find((c) => c.id === carreraId)
  const selectedPlan = planes.find((p) => p.id === planId)
  const selectedMateria = materiaMap.get(materiaId)
  const selectedPeriodo = periodoMap.get(periodoId)

  // Context del form: ya no hace falta chain fetch — los nombres los tenemos
  // en memoria de los 4 selectores cascadeados + el map de periodos.
  const formContext: MateriaContext | null =
    selectedUniversidad && selectedCarrera && selectedPlan && selectedMateria && selectedPeriodo
      ? {
          universidad: selectedUniversidad.nombre,
          carrera: selectedCarrera.nombre,
          plan: `${selectedPlan.version} (${selectedPlan.año_inicio})`,
          materia: `${selectedMateria.codigo} · ${selectedMateria.nombre}`,
          periodo: periodoLabel(selectedPeriodo),
        }
      : null

  const queryError =
    universidadesQuery.error ||
    carrerasQuery.error ||
    planesQuery.error ||
    materiasQuery.error ||
    periodosQuery.error ||
    comisionesQuery.error
  const errorMsg = queryError
    ? queryError instanceof HttpError
      ? `${queryError.status}: ${queryError.detail || queryError.title}`
      : String(queryError)
    : null

  const loading =
    universidadesQuery.isLoading ||
    periodosQuery.isLoading ||
    (carrerasQuery.isFetching && !!universidadId) ||
    (planesQuery.isFetching && !!carreraId) ||
    (materiasQuery.isFetching && !!planId) ||
    (comisionesQuery.isFetching && !!materiaId && !!periodoId)

  const breadcrumbItems: BreadcrumbItem[] = []
  if (selectedUniversidad) {
    breadcrumbItems.push({ context: "Universidad", label: selectedUniversidad.nombre })
  }
  if (selectedCarrera) {
    breadcrumbItems.push({ context: "Carrera", label: selectedCarrera.nombre })
  }
  if (selectedPlan) {
    breadcrumbItems.push({
      context: "Plan",
      label: `${selectedPlan.version} (${selectedPlan.año_inicio})`,
    })
  }
  if (selectedMateria) {
    breadcrumbItems.push({
      context: "Materia",
      label: `${selectedMateria.codigo} · ${selectedMateria.nombre}`,
    })
  }
  if (selectedPeriodo) {
    breadcrumbItems.push({ context: "Período", label: selectedPeriodo.codigo })
  }

  return (
    <PageContainer
      title="Comisiones"
      description="Comisiones de cursada por materia y periodo del tenant actual."
      helpContent={helpContent.comisiones}
    >
      <div className="space-y-6">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            disabled={!materiaId || !periodoId}
            className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {showForm ? "Cancelar" : "Nueva comisión"}
          </button>
        </div>

        {breadcrumbItems.length > 0 && <Breadcrumb items={breadcrumbItems} />}

        <div className="rounded-lg border border-slate-200 bg-white p-4 grid grid-cols-2 gap-4">
          <Field label="Universidad" required>
            <select
              value={universidadId}
              onChange={(e) => {
                setUniversidadId(e.target.value)
                setCarreraId("")
                setPlanId("")
                setMateriaId("")
                setCursor(undefined)
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
          </Field>
          <Field label="Carrera" required>
            <select
              value={carreraId}
              onChange={(e) => {
                setCarreraId(e.target.value)
                setPlanId("")
                setMateriaId("")
                setCursor(undefined)
              }}
              disabled={!universidadId}
              className={inputClass}
            >
              <option value="">
                {universidadId ? "— Seleccioná una carrera —" : "— Elegí universidad primero —"}
              </option>
              {carreras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} · {c.nombre}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Plan de estudio" required>
            <select
              value={planId}
              onChange={(e) => {
                setPlanId(e.target.value)
                setMateriaId("")
                setCursor(undefined)
              }}
              disabled={!carreraId}
              className={inputClass}
            >
              <option value="">
                {carreraId ? "— Seleccioná un plan —" : "— Elegí carrera primero —"}
              </option>
              {planes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.version} ({p.año_inicio})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Materia" required>
            <select
              value={materiaId}
              onChange={(e) => {
                setMateriaId(e.target.value)
                setCursor(undefined)
              }}
              disabled={!planId}
              className={inputClass}
            >
              <option value="">
                {planId ? "— Seleccioná una materia —" : "— Elegí plan primero —"}
              </option>
              {materias.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.codigo} · {m.nombre}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Periodo" required>
            <select
              value={periodoId}
              onChange={(e) => {
                setPeriodoId(e.target.value)
                setCursor(undefined)
              }}
              className={inputClass}
            >
              <option value="">
                {periodos.length === 0
                  ? "— No hay periodos creados —"
                  : "— Seleccioná un periodo —"}
              </option>
              {periodos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} · {p.nombre}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {periodos.length === 0 && !periodosQuery.isLoading && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            No hay periodos creados. Creá uno desde la página de Periodos para poder gestionar
            comisiones.
          </div>
        )}

        {showForm && materiaId && periodoId && formContext && (
          <ComisionForm
            materiaId={materiaId}
            periodoId={periodoId}
            context={formContext}
            onCreated={async () => {
              setShowForm(false)
              await queryClient.invalidateQueries({ queryKey: ["comisiones"] })
            }}
          />
        )}

        {errorMsg && (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            {errorMsg}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          {!materiaId || !periodoId ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              Seleccioná universidad, carrera, plan, materia y periodo para ver sus comisiones.
            </div>
          ) : loading ? (
            <div className="p-8 text-center text-slate-500 text-sm">Cargando…</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No hay comisiones para esta materia en el periodo seleccionado.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium w-6" />
                  <th className="px-4 py-2 font-medium">Código</th>
                  <th className="px-4 py-2 font-medium">Materia</th>
                  <th className="px-4 py-2 font-medium">Periodo</th>
                  <th className="px-4 py-2 font-medium">Cupo</th>
                  <th className="px-4 py-2 font-medium">Budget AI (USD/mes)</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <Fragment key={c.id}>
                    <tr
                      className="border-b border-slate-100 cursor-pointer hover:bg-slate-50"
                      onClick={() =>
                        setExpandedComisionId((prev) => (prev === c.id ? null : c.id))
                      }
                    >
                      <td className="px-2 py-2 text-slate-400">
                        {expandedComisionId === c.id ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{c.codigo}</td>
                      <td className="px-4 py-2 text-slate-600 text-xs">
                        {materiaMap.get(c.materia_id)?.nombre ?? c.materia_id}
                      </td>
                      <td className="px-4 py-2 text-slate-600 text-xs">
                        {periodoMap.get(c.periodo_id)?.codigo ?? c.periodo_id}
                      </td>
                      <td className="px-4 py-2">{c.cupo_maximo}</td>
                      <td className="px-4 py-2">{c.ai_budget_monthly_usd}</td>
                      <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              window.confirm(
                                `¿Eliminar la comisión ${c.codigo}? Esta acción es lógica (soft-delete).`,
                              )
                            ) {
                              deleteMutation.mutate(c.id)
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          className="text-xs text-red-700 hover:text-red-900 disabled:opacity-50"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                    {expandedComisionId === c.id && (
                      <tr>
                        <td colSpan={7} className="bg-slate-50 border-b border-slate-200 p-0">
                          <ComisionDetail comisionId={c.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}

          {materiaId && periodoId && (cursor || cursorNext) && (
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs">
              <button
                type="button"
                onClick={() => setCursor(undefined)}
                disabled={!cursor}
                className="rounded-md border border-slate-300 bg-white px-3 py-1 hover:bg-slate-100 disabled:opacity-50"
              >
                Inicio
              </button>
              <button
                type="button"
                onClick={() => {
                  if (cursorNext) setCursor(cursorNext)
                }}
                disabled={!cursorNext}
                className="rounded-md border border-slate-300 bg-white px-3 py-1 hover:bg-slate-100 disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  )
}

function ComisionForm({
  materiaId,
  periodoId,
  context,
  onCreated,
}: {
  materiaId: string
  periodoId: string
  context: MateriaContext
  onCreated: () => void
}): ReactNode {
  const [form, setForm] = useState<ComisionCreate>({
    materia_id: materiaId,
    periodo_id: periodoId,
    codigo: "",
    nombre: "",
    cupo_maximo: 50,
    horario: {},
    ai_budget_monthly_usd: "100.00",
  })
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: (data: ComisionCreate) => comisionesApi.create(data),
    onMutate: async (data) => {
      const optimistic: Comision = {
        id: `temp-${Date.now()}`,
        tenant_id: "",
        materia_id: data.materia_id,
        periodo_id: data.periodo_id,
        codigo: data.codigo,
        cupo_maximo: data.cupo_maximo ?? 50,
        horario: data.horario ?? {},
        ai_budget_monthly_usd: String(data.ai_budget_monthly_usd ?? "100.00"),
        curso_config_hash: null,
        created_at: new Date().toISOString(),
        deleted_at: null,
      }
      const queries = queryClient.getQueriesData<{
        data: Comision[]
        meta: { cursor_next: string | null; total: number | null }
      }>({ queryKey: ["comisiones"] })
      const snapshots = queries.map(([key, value]) => ({ key, value }))
      for (const { key, value } of snapshots) {
        if (value) {
          queryClient.setQueryData(key, {
            ...value,
            data: [optimistic, ...value.data],
          })
        }
      }
      return { snapshots }
    },
    onError: (err, _data, ctx) => {
      if (ctx?.snapshots) {
        for (const { key, value } of ctx.snapshots) {
          queryClient.setQueryData(key, value)
        }
      }
      setError(err instanceof HttpError ? `${err.status}: ${err.detail || err.title}` : String(err))
    },
    onSuccess: () => {
      onCreated()
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["comisiones"] })
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    createMutation.mutate(form)
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <HelpButton
          size="sm"
          title="Formulario de Comision"
          content={
            <div className="space-y-3 text-zinc-300">
              <p>
                <strong>Completa los siguientes campos</strong> para crear una nueva comision:
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong>Codigo:</strong> Identificador de la comision (ej. C1, ComA). Unico por
                  materia y periodo. Obligatorio.
                </li>
                <li>
                  <strong>Cupo maximo:</strong> Cantidad maxima de estudiantes inscriptos. Default
                  50.
                </li>
                <li>
                  <strong>Budget AI mensual (USD):</strong> Limite de gasto mensual en servicios AI
                  por comision. Default 100.00.
                </li>
              </ul>
            </div>
          }
        />
        <span className="text-sm text-slate-500">Nueva comision</span>
      </div>

      <div className="grid grid-cols-3 gap-4 rounded-md bg-slate-50 border border-slate-200 p-3">
        <ReadonlyField label="Universidad" value={context.universidad} />
        <ReadonlyField label="Carrera" value={context.carrera} />
        <ReadonlyField label="Plan" value={context.plan} />
        <ReadonlyField label="Materia" value={context.materia} />
        <ReadonlyField label="Periodo" value={context.periodo} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Código" required>
          <input
            type="text"
            value={form.codigo}
            onChange={(e) => setForm({ ...form, codigo: e.target.value })}
            required
            minLength={1}
            maxLength={50}
            className={inputClass}
            placeholder="C1"
          />
        </Field>

        <Field label="Nombre" required>
          <input
            type="text"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            required
            minLength={1}
            maxLength={100}
            className={inputClass}
            placeholder="Comision Manana"
          />
        </Field>

        <Field label="Cupo máximo" required>
          <input
            type="number"
            value={form.cupo_maximo}
            onChange={(e) => setForm({ ...form, cupo_maximo: Number(e.target.value) })}
            min={1}
            max={500}
            required
            className={inputClass}
          />
        </Field>

        <Field label="Budget AI mensual (USD)" required>
          <input
            type="number"
            step="0.01"
            value={form.ai_budget_monthly_usd as string | number}
            onChange={(e) => setForm({ ...form, ai_budget_monthly_usd: e.target.value })}
            min={0}
            max={10000}
            required
            className={inputClass}
          />
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
          disabled={createMutation.isPending}
          className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {createMutation.isPending ? "Creando..." : "Crear"}
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

// ── ComisionDetail: panel expandible con tabs Docentes / Alumnos ──────

type ComisionTab = "docentes" | "alumnos"

function ComisionDetail({ comisionId }: { comisionId: string }): ReactNode {
  const [tab, setTab] = useState<ComisionTab>("docentes")
  const queryClient = useQueryClient()

  const docentesQuery = useQuery({
    queryKey: ["comision-docentes", comisionId],
    queryFn: () => comisionDocentesApi.list(comisionId),
  })

  const inscripcionesQuery = useQuery({
    queryKey: ["comision-inscripciones", comisionId],
    queryFn: () => comisionInscripcionesApi.list(comisionId),
  })

  const removeDocenteMutation = useMutation({
    mutationFn: (ucId: string) => comisionDocentesApi.delete(comisionId, ucId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["comision-docentes", comisionId] }),
  })

  const removeInscripcionMutation = useMutation({
    mutationFn: (inscId: string) => comisionInscripcionesApi.delete(comisionId, inscId),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["comision-inscripciones", comisionId] }),
  })

  const docentes: UsuarioComisionOut[] = docentesQuery.data?.data ?? []
  const inscripciones: InscripcionOut[] = inscripcionesQuery.data?.data ?? []

  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        {(["docentes", "alumnos"] as ComisionTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors ${
              tab === t
                ? "border-blue-600 text-blue-700 bg-blue-50"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            {t === "docentes" ? "Docentes" : "Alumnos"}
          </button>
        ))}
      </div>

      {tab === "docentes" && (
        <DocentesTab
          comisionId={comisionId}
          docentes={docentes}
          isLoading={docentesQuery.isLoading}
          onRemove={(ucId) => removeDocenteMutation.mutate(ucId)}
          isRemoving={removeDocenteMutation.isPending}
          onAdded={() =>
            void queryClient.invalidateQueries({ queryKey: ["comision-docentes", comisionId] })
          }
        />
      )}

      {tab === "alumnos" && (
        <AlumnosTab
          comisionId={comisionId}
          inscripciones={inscripciones}
          isLoading={inscripcionesQuery.isLoading}
          onRemove={(inscId) => removeInscripcionMutation.mutate(inscId)}
          isRemoving={removeInscripcionMutation.isPending}
          onAdded={() =>
            void queryClient.invalidateQueries({
              queryKey: ["comision-inscripciones", comisionId],
            })
          }
        />
      )}
    </div>
  )
}

function DocentesTab({
  comisionId,
  docentes,
  isLoading,
  onRemove,
  isRemoving,
  onAdded,
}: {
  comisionId: string
  docentes: UsuarioComisionOut[]
  isLoading: boolean
  onRemove: (id: string) => void
  isRemoving: boolean
  onAdded: () => void
}): ReactNode {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    user_id: "",
    rol: "titular" as UsuarioComisionCreate["rol"],
    fecha_desde: new Date().toISOString().slice(0, 10),
  })
  const [formError, setFormError] = useState<string | null>(null)

  const addMutation = useMutation({
    mutationFn: (data: UsuarioComisionCreate) => comisionDocentesApi.create(comisionId, data),
    onSuccess: () => {
      setShowForm(false)
      setForm({ user_id: "", rol: "titular", fecha_desde: new Date().toISOString().slice(0, 10) })
      onAdded()
    },
    onError: (err) =>
      setFormError(
        err instanceof HttpError ? `${err.status}: ${err.detail || err.title}` : String(err),
      ),
  })

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="text-xs text-slate-500">Cargando...</p>
      ) : docentes.length === 0 ? (
        <p className="text-xs text-slate-500">No hay docentes asignados.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-3">User ID</th>
              <th className="py-1 pr-3">Rol</th>
              <th className="py-1 pr-3">Desde</th>
              <th className="py-1 pr-3">Hasta</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {docentes.map((d) => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="py-1 pr-3 font-mono">{d.user_id.slice(0, 8)}…</td>
                <td className="py-1 pr-3">{d.rol}</td>
                <td className="py-1 pr-3">{d.fecha_desde}</td>
                <td className="py-1 pr-3">{d.fecha_hasta ?? "—"}</td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`¿Quitar docente ${d.user_id.slice(0, 8)}…?`)) {
                        onRemove(d.id)
                      }
                    }}
                    disabled={isRemoving}
                    className="text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showForm ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setFormError(null)
            addMutation.mutate(form)
          }}
          className="grid grid-cols-4 gap-2 items-end"
        >
          <div className="col-span-2">
            <Field label="User ID (UUID)" required>
              <input
                type="text"
                value={form.user_id}
                onChange={(e) => setForm({ ...form, user_id: e.target.value })}
                required
                placeholder="UUID del docente"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Rol" required>
            <select
              value={form.rol}
              onChange={(e) => setForm({ ...form, rol: e.target.value as UsuarioComisionCreate["rol"] })}
              className={inputClass}
            >
              <option value="titular">Titular</option>
              <option value="adjunto">Adjunto</option>
              <option value="jtp">JTP</option>
              <option value="ayudante">Ayudante</option>
              <option value="corrector">Corrector</option>
            </select>
          </Field>
          <Field label="Desde" required>
            <input
              type="date"
              value={form.fecha_desde}
              onChange={(e) => setForm({ ...form, fecha_desde: e.target.value })}
              required
              className={inputClass}
            />
          </Field>
          {formError && (
            <div className="col-span-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {formError}
            </div>
          )}
          <div className="col-span-4 flex gap-2">
            <button
              type="submit"
              disabled={addMutation.isPending}
              className="rounded-md bg-blue-600 text-white px-3 py-1 text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {addMutation.isPending ? "Agregando..." : "Agregar"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="text-xs text-blue-700 hover:text-blue-900 font-medium"
        >
          + Agregar docente
        </button>
      )}
    </div>
  )
}

function AlumnosTab({
  comisionId,
  inscripciones,
  isLoading,
  onRemove,
  isRemoving,
  onAdded,
}: {
  comisionId: string
  inscripciones: InscripcionOut[]
  isLoading: boolean
  onRemove: (id: string) => void
  isRemoving: boolean
  onAdded: () => void
}): ReactNode {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<InscripcionCreate>({
    student_pseudonym: "",
    fecha_inscripcion: new Date().toISOString().slice(0, 10),
  })
  const [formError, setFormError] = useState<string | null>(null)

  const addMutation = useMutation({
    mutationFn: (data: InscripcionCreate) => comisionInscripcionesApi.create(comisionId, data),
    onSuccess: () => {
      setShowForm(false)
      setForm({ student_pseudonym: "", fecha_inscripcion: new Date().toISOString().slice(0, 10) })
      onAdded()
    },
    onError: (err) =>
      setFormError(
        err instanceof HttpError ? `${err.status}: ${err.detail || err.title}` : String(err),
      ),
  })

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="text-xs text-slate-500">Cargando...</p>
      ) : inscripciones.length === 0 ? (
        <p className="text-xs text-slate-500">No hay alumnos inscriptos.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-3">Student pseudonym</th>
              <th className="py-1 pr-3">Rol</th>
              <th className="py-1 pr-3">Estado</th>
              <th className="py-1 pr-3">Fecha inscripción</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {inscripciones.map((i) => (
              <tr key={i.id} className="border-t border-slate-100">
                <td className="py-1 pr-3 font-mono">{i.student_pseudonym.slice(0, 8)}…</td>
                <td className="py-1 pr-3">{i.rol}</td>
                <td className="py-1 pr-3">{i.estado}</td>
                <td className="py-1 pr-3">{i.fecha_inscripcion}</td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`¿Quitar alumno ${i.student_pseudonym.slice(0, 8)}…?`)) {
                        onRemove(i.id)
                      }
                    }}
                    disabled={isRemoving}
                    className="text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showForm ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setFormError(null)
            addMutation.mutate(form)
          }}
          className="grid grid-cols-3 gap-2 items-end"
        >
          <div className="col-span-2">
            <Field label="Student pseudonym (UUID)" required>
              <input
                type="text"
                value={form.student_pseudonym}
                onChange={(e) => setForm({ ...form, student_pseudonym: e.target.value })}
                required
                placeholder="UUID del estudiante"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Fecha inscripción" required>
            <input
              type="date"
              value={form.fecha_inscripcion}
              onChange={(e) => setForm({ ...form, fecha_inscripcion: e.target.value })}
              required
              className={inputClass}
            />
          </Field>
          {formError && (
            <div className="col-span-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {formError}
            </div>
          )}
          <div className="col-span-3 flex gap-2">
            <button
              type="submit"
              disabled={addMutation.isPending}
              className="rounded-md bg-blue-600 text-white px-3 py-1 text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {addMutation.isPending ? "Inscribiendo..." : "Inscribir"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="text-xs text-blue-700 hover:text-blue-900 font-medium"
        >
          + Inscribir alumno
        </button>
      )}
    </div>
  )
}
