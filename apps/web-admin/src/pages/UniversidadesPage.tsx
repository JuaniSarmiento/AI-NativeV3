import { HelpButton, PageContainer, StateMessage } from "@platform/ui"
import { type ReactNode, useEffect, useState } from "react"
import { HttpError, type Universidad, type UniversidadCreate, universidadesApi } from "../lib/api"
import { helpContent } from "../utils/helpContent"

export function UniversidadesPage(): ReactNode {
  const [items, setItems] = useState<Universidad[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: load — fetch mount-only; el handler usa setState con identidad estable.
  useEffect(() => {
    void load()
  }, [])

  const handleDelete = async (u: Universidad) => {
    if (!window.confirm(`¿Eliminar universidad ${u.nombre}?`)) return
    setDeletingId(u.id)
    setError(null)
    try {
      await universidadesApi.delete(u.id)
      await load()
    } catch (e) {
      const msg = e instanceof HttpError ? `${e.status}: ${e.detail || e.title}` : String(e)
      window.alert(`No se pudo eliminar: ${msg}`)
      setError(msg)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <PageContainer
      title="Universidades"
      description="Listado global. Crear requiere rol superadmin."
      helpContent={helpContent.universidades}
    >
      <div className="space-y-6">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700"
          >
            {showForm ? "Cancelar" : "Nueva universidad"}
          </button>
        </div>

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
            <StateMessage variant="loading" />
          ) : items.length === 0 ? (
            <StateMessage
              variant="empty"
              title="Sin universidades"
              description="No hay universidades registradas todavia."
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Código</th>
                  <th className="px-4 py-2 font-medium">Nombre</th>
                  <th className="px-4 py-2 font-medium">Realm Keycloak</th>
                  <th className="px-4 py-2 font-medium">Creada</th>
                  <th className="px-4 py-2 font-medium" />
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
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => void handleDelete(u)}
                        disabled={deletingId === u.id}
                        className="text-xs text-red-700 hover:text-red-900 disabled:opacity-50"
                      >
                        {deletingId === u.id ? "Eliminando…" : "Eliminar"}
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
    <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <HelpButton
          size="sm"
          title="Formulario de Universidad"
          content={
            <div className="space-y-3 text-zinc-300">
              <p>
                <strong>Completa los siguientes campos</strong> para crear una nueva universidad:
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong>Nombre:</strong> Nombre completo de la institucion (ej. Universidad
                  Nacional de San Luis).
                </li>
                <li>
                  <strong>Codigo:</strong> Identificador corto unico (ej. unsl). Solo letras,
                  numeros, guiones. Inmutable una vez creado.
                </li>
                <li>
                  <strong>Dominio email:</strong> Opcional. Dominio institucional (ej. unsl.edu.ar).
                </li>
                <li>
                  <strong>Keycloak realm:</strong> Nombre del realm en Keycloak. Debe existir o
                  crearse via onboarding. Inmutable una vez creado.
                </li>
              </ul>
            </div>
          }
        />
        <span className="text-sm text-slate-500">Nueva universidad</span>
      </div>

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
