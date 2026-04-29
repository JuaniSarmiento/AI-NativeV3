/**
 * Selector de comisión para el estudiante.
 *
 * Lista las comisiones donde el estudiante tiene asignación (vía
 * `usuarios_comision`) y persiste la elección en localStorage. La
 * primera vez en una sesión, si hay valor previo en localStorage lo
 * propagamos vía onChange para que el padre arranque con la última
 * elección.
 *
 * Nota F9: hoy el estudiante también pasa por `usuarios_comision` para
 * el demo del piloto. Cuando exista federación Keycloak con claim
 * `comisiones_activas` derivado de `Inscripcion`, este componente puede
 * leer ese claim sin pegarle al backend.
 */
import { useEffect, useState } from "react"
import { type Comision, comisionesApi } from "../lib/api"

const LS_KEY = "selected-comision-id"

interface Props {
  value: string | null
  onChange: (comisionId: string) => void
}

export function ComisionSelector({ value, onChange }: Props) {
  const [comisiones, setComisiones] = useState<Comision[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // mount-only fetch — value/onChange se leen una sola vez para sembrar la elección
  // recordada en localStorage; añadirlas refetcharía las comisiones cada vez que el
  // padre cambia el valor seleccionado.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value — ver comentario arriba.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onChange — ver comentario arriba.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    comisionesApi
      .listMine()
      .then((res) => {
        if (cancelled) return
        setComisiones(res.items)
        // Si el padre todavía no eligió y hay un valor recordado, lo
        // proponemos — siempre que esa comisión siga apareciendo en el
        // listado del backend (evita propagar IDs stale).
        if (!value) {
          const stored = localStorage.getItem(LS_KEY)
          if (stored && res.items.some((c) => c.id === stored)) {
            onChange(stored)
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    if (!id) return
    localStorage.setItem(LS_KEY, id)
    onChange(id)
  }

  if (loading) {
    return <div className="text-xs text-slate-500 px-3 py-2">Cargando comisiones...</div>
  }

  if (error) {
    return (
      <div className="text-xs text-red-700 dark:text-red-300 px-3 py-2">
        Error cargando comisiones: <span className="font-mono">{error}</span>
      </div>
    )
  }

  if (!comisiones || comisiones.length === 0) {
    return (
      <div className="text-xs text-slate-500 px-3 py-2">
        No estás inscripto en ninguna comisión. Hablá con tu docente.
      </div>
    )
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-600 dark:text-slate-400">Comisión:</span>
      <select
        value={value ?? ""}
        onChange={handleSelect}
        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
      >
        <option value="" disabled>
          Seleccioná una comisión
        </option>
        {comisiones.map((c) => (
          <option key={c.id} value={c.id}>
            {c.codigo} · {c.id.slice(0, 8)}
          </option>
        ))}
      </select>
    </label>
  )
}
