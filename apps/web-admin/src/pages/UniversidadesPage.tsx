import {
  type ReactNode,
  useEffect,
  useState,
} from "react"
import {
  type Universidad,
  type UniversidadCreate,
  universidadesApi,
  HttpError,
} from "../lib/api"

export function UniversidadesPage(): ReactNode {
  const [items, setItems] = useState<Universidad[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await universidadesApi.list()
      setItems(resp.data)
    } catch (e) {
      setError(e instanceof HttpError ? `${e.status}: ${e.detail || e.title}` : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Universidades</h2>
          <p className="text-slate-600 mt-1">
            Listado global. Crear requiere rol superadmin.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700"
        >
          {showForm ? "Cancelar" : "Nueva universidad"}
        </button>
      </header>

      {showForm && (
        <UniversidadForm
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
            No hay universidades registradas.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Código</th>
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-4 py-2 font-medium">Realm Keycloak</th>
                <th className="px-4 py-2 font-medium">Creada</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs">{u.codigo}</td>
                  <td className="px-4 py-2">{u.nombre}</td>
                  <td className="px-4 py-2 font-mono text-xs">{u.keycloak_realm}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">
                    {new Date(u.created_at).toLocaleDateString()}
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

function UniversidadForm({
  onCreated,
}: {
  onCreated: () => void
}): ReactNode {
  const [form, setForm] = useState<UniversidadCreate>({
    nombre: "",
    codigo: "",
    keycloak_realm: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await universidadesApi.create(form)
      onCreated()
    } catch (e) {
      setError(e instanceof HttpError ? `${e.status}: ${e.detail || e.title}` : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-slate-200 bg-white p-6 space-y-4"
    >
      <h3 className="font-medium">Nueva universidad</h3>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Nombre" required>
          <input
            type="text"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            required
            minLength={2}
            className={inputClass}
            placeholder="Universidad Nacional de San Luis"
          />
        </Field>

        <Field label="Código" required>
          <input
            type="text"
            value={form.codigo}
            onChange={(e) => setForm({ ...form, codigo: e.target.value })}
            required
            pattern="[A-Za-z0-9_-]+"
            className={inputClass}
            placeholder="unsl"
          />
        </Field>

        <Field label="Dominio email">
          <input
            type="text"
            value={form.dominio_email ?? ""}
            onChange={(e) => setForm({ ...form, dominio_email: e.target.value })}
            className={inputClass}
            placeholder="unsl.edu.ar"
          />
        </Field>

        <Field label="Keycloak realm" required>
          <input
            type="text"
            value={form.keycloak_realm}
            onChange={(e) => setForm({ ...form, keycloak_realm: e.target.value })}
            required
            className={inputClass}
            placeholder="unsl"
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
