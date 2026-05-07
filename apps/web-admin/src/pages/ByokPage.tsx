import { HelpButton, Modal, PageContainer } from "@platform/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Key } from "lucide-react"
import { type ReactNode, useState } from "react"
import {
  type ByokKey,
  type ByokKeyCreate,
  type ByokKeyUsage,
  HttpError,
  byokApi,
  facultadesApi,
  materiasApi,
} from "../lib/api"
import { helpContent } from "../utils/helpContent"

type ModalState =
  | { type: "none" }
  | { type: "create" }
  | { type: "rotate"; key: ByokKey }
  | { type: "revoke"; key: ByokKey }
  | { type: "usage"; key: ByokKey }

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
    // biome-ignore lint/a11y/noLabelWithoutControl: children es el control wrappeado por el padre
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}

export function ByokPage(): ReactNode {
  const [scopeTypeFilter, setScopeTypeFilter] = useState<string>("")
  const [modal, setModal] = useState<ModalState>({ type: "none" })
  const queryClient = useQueryClient()

  const keysQuery = useQuery({
    queryKey: ["byok-keys", { scope_type: scopeTypeFilter }],
    queryFn: () => byokApi.list(scopeTypeFilter ? { scope_type: scopeTypeFilter } : undefined),
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => byokApi.revoke(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["byok-keys"] })
      setModal({ type: "none" })
    },
  })

  const keys: ByokKey[] = keysQuery.data ?? []

  const errorMsg = keysQuery.error
    ? keysQuery.error instanceof HttpError
      ? `${keysQuery.error.status}: ${keysQuery.error.detail || keysQuery.error.title}`
      : String(keysQuery.error)
    : null

  return (
    <PageContainer
      title="BYOK Keys"
      description="Gestion de claves de proveedor LLM por tenant o materia (Bring Your Own Key)."
      helpContent={helpContent.byok}
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="scope-filter" className="text-sm font-medium text-slate-700">
              Filtrar por scope:
            </label>
            <select
              id="scope-filter"
              value={scopeTypeFilter}
              onChange={(e) => setScopeTypeFilter(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="">Todos</option>
              <option value="tenant">Tenant</option>
              <option value="materia">Materia</option>
              <option value="facultad">Facultad</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => setModal({ type: "create" })}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700"
          >
            <Key size={14} />
            Nueva key
          </button>
        </div>

        {errorMsg && (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            {errorMsg}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          {keysQuery.isLoading ? (
            <div className="p-8 text-center text-slate-500 text-sm">Cargando...</div>
          ) : keys.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              <div className="flex flex-col items-center gap-3">
                <Key size={32} className="text-slate-300" />
                <p className="font-medium">No hay BYOK keys configuradas</p>
                <p className="text-xs text-slate-400">
                  Crea una key para que el ai-gateway use tu propia clave de proveedor LLM.
                </p>
                <button
                  type="button"
                  onClick={() => setModal({ type: "create" })}
                  className="mt-1 rounded-md bg-blue-600 text-white px-4 py-1.5 text-sm hover:bg-blue-700"
                >
                  Crear primera key
                </button>
              </div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Scope</th>
                  <th className="px-4 py-2 font-medium">Scope ID</th>
                  <th className="px-4 py-2 font-medium">Provider</th>
                  <th className="px-4 py-2 font-medium">Fingerprint</th>
                  <th className="px-4 py-2 font-medium">Budget (USD/mes)</th>
                  <th className="px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2 font-medium">Creada</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs">{k.scope_type}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">
                      {k.scope_id ? `${k.scope_id.slice(0, 8)}…` : "—"}
                    </td>
                    <td className="px-4 py-2 font-medium">{k.provider}</td>
                    <td className="px-4 py-2 font-mono text-xs">…{k.fingerprint_last4}</td>
                    <td className="px-4 py-2 text-xs">
                      {k.monthly_budget_usd !== null ? `$${k.monthly_budget_usd}` : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {k.revoked_at ? (
                        <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs">
                          Revocada
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs">
                          Activa
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {new Date(k.created_at).toLocaleDateString("es-AR")}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setModal({ type: "usage", key: k })}
                          className="text-xs text-blue-700 hover:text-blue-900"
                        >
                          Uso
                        </button>
                        {!k.revoked_at && (
                          <>
                            <button
                              type="button"
                              onClick={() => setModal({ type: "rotate", key: k })}
                              className="text-xs text-amber-700 hover:text-amber-900"
                            >
                              Rotar
                            </button>
                            <button
                              type="button"
                              onClick={() => setModal({ type: "revoke", key: k })}
                              className="text-xs text-red-700 hover:text-red-900"
                            >
                              Revocar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modal.type === "create" && (
        <CreateKeyModal
          onClose={() => setModal({ type: "none" })}
          onCreated={() => {
            void queryClient.invalidateQueries({ queryKey: ["byok-keys"] })
            setModal({ type: "none" })
          }}
        />
      )}

      {modal.type === "rotate" && (
        <RotateKeyModal
          byokKey={modal.key}
          onClose={() => setModal({ type: "none" })}
          onRotated={() => {
            void queryClient.invalidateQueries({ queryKey: ["byok-keys"] })
            setModal({ type: "none" })
          }}
        />
      )}

      {modal.type === "revoke" && (
        <Modal
          isOpen
          onClose={() => setModal({ type: "none" })}
          title="Revocar BYOK key"
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Esta accion es <strong>irreversible</strong>. La key con fingerprint{" "}
              <code className="font-mono bg-slate-100 px-1 rounded">
                …{modal.key.fingerprint_last4}
              </code>{" "}
              ({modal.key.provider} / {modal.key.scope_type}) quedara revocada y el ai-gateway no
              podra usarla.
            </p>
            {revokeMutation.error && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
                {revokeMutation.error instanceof HttpError
                  ? revokeMutation.error.detail || revokeMutation.error.title
                  : String(revokeMutation.error)}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModal({ type: "none" })}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => revokeMutation.mutate(modal.key.id)}
                disabled={revokeMutation.isPending}
                className="rounded-md bg-red-600 text-white px-4 py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {revokeMutation.isPending ? "Revocando..." : "Revocar key"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal.type === "usage" && (
        <UsagePanel
          byokKey={modal.key}
          onClose={() => setModal({ type: "none" })}
        />
      )}
    </PageContainer>
  )
}

function CreateKeyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}): ReactNode {
  const [form, setForm] = useState<ByokKeyCreate>({
    scope_type: "tenant",
    provider: "anthropic",
    plaintext_value: "",
  })
  const [error, setError] = useState<string | null>(null)

  const facultadesQuery = useQuery({
    queryKey: ["facultades"],
    queryFn: () => facultadesApi.list(),
    enabled: form.scope_type === "facultad",
  })
  const materiasQuery = useQuery({
    queryKey: ["materias"],
    queryFn: () => materiasApi.list(),
    enabled: form.scope_type === "materia",
  })

  const createMutation = useMutation({
    mutationFn: (data: ByokKeyCreate) => byokApi.create(data),
    onSuccess: onCreated,
    onError: (err) => {
      setError(
        err instanceof HttpError ? `${err.status}: ${err.detail || err.title}` : String(err),
      )
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    createMutation.mutate(form)
  }

  return (
    <Modal isOpen onClose={onClose} title="Nueva BYOK key" size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <HelpButton
            size="sm"
            title="Crear BYOK key"
            content={
              <div className="space-y-2 text-zinc-300 text-sm">
                <p>
                  <strong>Scope type:</strong> tenant aplica a toda la universidad; materia solo a
                  esa materia (resolver usa materia primero).
                </p>
                <p>
                  <strong>Scope ID:</strong> UUID de la materia o facultad. Dejar vacio para scope
                  tenant.
                </p>
                <p>
                  <strong>Plaintext value:</strong> La API key del proveedor. Se encripta con
                  AES-256-GCM y nunca se devuelve en claro.
                </p>
              </div>
            }
          />
          <span className="text-sm text-slate-500">Completa los campos de la nueva key</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Scope type" required>
            <select
              value={form.scope_type}
              onChange={(e) =>
                setForm({
                  ...form,
                  scope_type: e.target.value as ByokKeyCreate["scope_type"],
                  scope_id: undefined,
                })
              }
              className={inputClass}
            >
              <option value="tenant">Tenant</option>
              <option value="materia">Materia</option>
              <option value="facultad">Facultad</option>
            </select>
          </Field>

          <Field label={form.scope_type === "facultad" ? "Facultad" : form.scope_type === "materia" ? "Materia" : "Scope"}>
            {form.scope_type === "tenant" ? (
              <select disabled className={inputClass}>
                <option>— Aplica a todo el tenant —</option>
              </select>
            ) : (
              <select
                value={form.scope_id ?? ""}
                onChange={(e) => setForm({ ...form, scope_id: e.target.value || undefined })}
                className={inputClass}
              >
                <option value="">Seleccionar...</option>
                {form.scope_type === "facultad" &&
                  (facultadesQuery.data?.data ?? []).map((f) => (
                    <option key={f.id} value={f.id}>{f.nombre} ({f.codigo})</option>
                  ))}
                {form.scope_type === "materia" &&
                  (materiasQuery.data?.data ?? []).map((m) => (
                    <option key={m.id} value={m.id}>{m.nombre} ({m.codigo})</option>
                  ))}
              </select>
            )}
          </Field>

          <Field label="Provider" required>
            <select
              value={form.provider}
              onChange={(e) =>
                setForm({ ...form, provider: e.target.value as ByokKeyCreate["provider"] })
              }
              className={inputClass}
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="mistral">Mistral</option>
            </select>
          </Field>

          <Field label="Budget mensual (USD)">
            <input
              type="number"
              step="0.01"
              min={0}
              value={form.monthly_budget_usd ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  monthly_budget_usd: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              placeholder="Sin limite"
              className={inputClass}
            />
          </Field>

          <div className="col-span-2">
            <Field label="API Key (plaintext)" required>
              <input
                type="password"
                value={form.plaintext_value}
                onChange={(e) => setForm({ ...form, plaintext_value: e.target.value })}
                required
                minLength={8}
                placeholder="sk-ant-..."
                className={inputClass}
              />
            </Field>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {createMutation.isPending ? "Creando..." : "Crear key"}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function RotateKeyModal({
  byokKey,
  onClose,
  onRotated,
}: {
  byokKey: ByokKey
  onClose: () => void
  onRotated: () => void
}): ReactNode {
  const [plaintext, setPlaintext] = useState("")
  const [error, setError] = useState<string | null>(null)

  const rotateMutation = useMutation({
    mutationFn: () => byokApi.rotate(byokKey.id, plaintext),
    onSuccess: onRotated,
    onError: (err) => {
      setError(
        err instanceof HttpError ? `${err.status}: ${err.detail || err.title}` : String(err),
      )
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    rotateMutation.mutate()
  }

  return (
    <Modal isOpen onClose={onClose} title="Rotar BYOK key" size="md">
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-sm">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <span className="text-slate-500">Provider:</span>
            <span className="font-medium">{byokKey.provider}</span>
            <span className="text-slate-500">Fingerprint actual:</span>
            <code className="font-mono">…{byokKey.fingerprint_last4}</code>
            <span className="text-slate-500">Scope:</span>
            <span>{byokKey.scope_type}</span>
          </div>
        </div>

        <Field label="Nueva API Key (plaintext)" required>
          <input
            type="password"
            value={plaintext}
            onChange={(e) => setPlaintext(e.target.value)}
            required
            minLength={8}
            placeholder="sk-ant-..."
            className={inputClass}
          />
        </Field>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={rotateMutation.isPending || !plaintext}
            className="rounded-md bg-amber-600 text-white px-4 py-2 text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
          >
            {rotateMutation.isPending ? "Rotando..." : "Rotar key"}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function UsagePanel({
  byokKey,
  onClose,
}: {
  byokKey: ByokKey
  onClose: () => void
}): ReactNode {
  const usageQuery = useQuery({
    queryKey: ["byok-usage", byokKey.id],
    queryFn: () => byokApi.usage(byokKey.id),
  })

  const usage: ByokKeyUsage[] = usageQuery.data ?? []

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Uso de key …${byokKey.fingerprint_last4} (${byokKey.provider})`}
      size="lg"
    >
      <div className="space-y-4">
        {usageQuery.isLoading ? (
          <div className="text-center text-slate-500 text-sm py-4">Cargando...</div>
        ) : usage.length === 0 ? (
          <div className="text-center text-slate-500 text-sm py-4">
            No hay registros de uso para esta key.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Periodo</th>
                <th className="px-3 py-2 font-medium text-right">Tokens entrada</th>
                <th className="px-3 py-2 font-medium text-right">Tokens salida</th>
                <th className="px-3 py-2 font-medium text-right">Requests</th>
                <th className="px-3 py-2 font-medium text-right">Costo (USD)</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.yyyymm} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{u.yyyymm}</td>
                  <td className="px-3 py-2 text-right text-xs">{u.tokens_input_total.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-xs">{u.tokens_output_total.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-xs">{u.request_count}</td>
                  <td className="px-3 py-2 text-right text-xs font-medium">${u.cost_usd_total.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  )
}
