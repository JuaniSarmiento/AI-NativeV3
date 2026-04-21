import { type ReactNode, useEffect, useState } from "react"
import {
  type Carrera,
  type CarreraCreate,
  carrerasApi,
  universidadesApi,
  type Universidad,
  HttpError,
} from "../lib/api"

export function CarrerasPage(): ReactNode {
  const [items, setItems] = useState<Carrera[]>([])
  const [universidades, setUniversidades] = useState<Universidad[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [carrs, unis] = await Promise.all([
        carrerasApi.list(),
        universidadesApi.list(),
      ])
      setItems(carrs.data)
      setUniversidades(unis.data)
    } catch (e) {
      setError(
        e instanceof HttpError ? `${e.status}: ${e.detail || e.title}` : String(e),
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const uniMap = new Map(universidades.map((u) => [u.id, u]))

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Carreras</h2>
          <p className="text-slate-600 mt-1">
            Programas académicos del tenant actual.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          disabled={universidades.length === 0}
          className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {showForm ? "Cancelar" : "Nueva carrera"}
        </button>
      </header>

      {showForm && (
        <CarreraForm
          universidades={universidades}
          onCreated={async () => {
            setShowForm(false)
            await load()
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
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No hay carreras creadas.{" "}
            {universidades.length === 0 && "Primero creá una universidad."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Código</th>
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-4 py-2 font-medium">Universidad</th>
                <th className="px-4 py-2 font-medium">Duración</th>
                <th className="px-4 py-2 font-medium">Modalidad</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs">{c.codigo}</td>
                  <td className="px-4 py-2">{c.nombre}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">
                    {uniMap.get(c.universidad_id)?.nombre ?? c.universidad_id}
                  </td>
                  <td className="px-4 py-2">{c.duracion_semestres} sem.</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                      {c.modalidad}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function CarreraForm({
  universidades,
  onCreated,
}: {
  universidades: Universidad[]
  onCreated: () => void
}): ReactNode {
  const [form, setForm] = useState<CarreraCreate>({
    universidad_id: universidades[0]?.id ?? "",
    nombre: "",
    codigo: "",
    duracion_semestres: 8,
    modalidad: "presencial",
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await carrerasApi.create(form)
      onCreated()
    } catch (e) {
      setError(
        e instanceof HttpError ? `${e.status}: ${e.detail || e.title}` : String(e),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-slate-200 bg-white p-6 space-y-4"
    >
      <h3 className="font-medium">Nueva carrera</h3>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Universidad" required>
          <select
            value={form.universidad_id}
            onChange={(e) => setForm({ ...form, universidad_id: e.target.value })}
            required
            className={inputClass}
          >
            {universidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Código" required>
          <input
            type="text"
            value={form.codigo}
            onChange={(e) => setForm({ ...form, codigo: e.target.value })}
            required
            pattern="[A-Za-z0-9_-]+"
            className={inputClass}
            placeholder="LIS"
          />
        </Field>

        <Field label="Nombre" required>
          <input
            type="text"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            required
            minLength={2}
            className={inputClass}
            placeholder="Licenciatura en Sistemas"
          />
        </Field>

        <Field label="Duración (semestres)" required>
          <input
            type="number"
            value={form.duracion_semestres}
            onChange={(e) =>
              setForm({ ...form, duracion_semestres: Number(e.target.value) })
            }
            min={1}
            max={20}
            required
            className={inputClass}
          />
        </Field>

        <Field label="Modalidad" required>
          <select
            value={form.modalidad}
            onChange={(e) =>
              setForm({
                ...form,
                modalidad: e.target.value as CarreraCreate["modalidad"],
              })
            }
            required
            className={inputClass}
          >
            <option value="presencial">Presencial</option>
            <option value="virtual">Virtual</option>
            <option value="hibrida">Híbrida</option>
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
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}
