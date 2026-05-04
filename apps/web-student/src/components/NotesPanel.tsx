/**
 * Panel de notas del estudiante durante un episodio.
 *
 * Permite al alumno escribir anotaciones libres sobre su razonamiento,
 * dudas o decisiones. Cada nota guardada emite un evento CTR
 * `anotacion_creada` (el backend valida 1..5000 chars y responde 422 si
 * no se cumple).
 *
 * El panel mantiene una historia local read-only de las notas guardadas
 * en esta sesión — no las re-fetchea del backend; si el alumno refresca,
 * la recuperación de estado del episodio (G4) las trae desde CTR.
 */
import { useState } from "react"
import { emitAnotacionCreada } from "../lib/api"

interface SavedNote {
  contenido: string
  ts: number
}

const MAX_LEN = 5000

export interface NotesPanelProps {
  episodeId: string
  /** Notas iniciales (opcional) — vienen de la recuperación de estado. */
  initialNotes?: SavedNote[]
}

export function NotesPanel({ episodeId, initialNotes }: NotesPanelProps) {
  const [open, setOpen] = useState(true)
  const [draft, setDraft] = useState("")
  const [notes, setNotes] = useState<SavedNote[]>(initialNotes ?? [])
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const trimmed = draft.trim()
  const tooLong = trimmed.length > MAX_LEN
  const canSave = trimmed.length > 0 && !tooLong && !saving

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setValidationError(null)
    try {
      await emitAnotacionCreada(episodeId, { contenido: trimmed })
      setNotes((prev) => [...prev, { contenido: trimmed, ts: Date.now() }])
      setDraft("")
    } catch (e) {
      const status = (e as Error & { status?: number }).status
      if (status === 422) {
        setValidationError("La nota no es válida (vacía, sólo espacios o supera 5000 caracteres).")
      } else {
        setValidationError(`Error guardando la nota: ${String(e)}`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="flex flex-col rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2 flex items-center justify-between text-left border-b border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        <span className="text-sm font-medium">
          Mis notas{" "}
          {notes.length > 0 && (
            <span className="text-xs text-slate-500 ml-1">({notes.length})</span>
          )}
        </span>
        <span className="text-xs text-slate-500">{open ? "Ocultar" : "Mostrar"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 p-3">
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              if (validationError) setValidationError(null)
            }}
            placeholder="Anotá tu razonamiento, dudas, decisiones..."
            rows={4}
            disabled={saving}
            className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 resize-none focus:outline-none focus:border-blue-500"
          />
          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-xs ${tooLong ? "text-[var(--color-danger)]" : "text-slate-500"}`}
            >
              {trimmed.length}/{MAX_LEN}
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded font-medium"
            >
              {saving ? "Guardando..." : "Guardar nota"}
            </button>
          </div>
          {validationError && (
            <p className="text-xs text-[var(--color-danger)]">{validationError}</p>
          )}

          {notes.length > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800 max-h-48 overflow-y-auto space-y-2">
              {notes.map((n, i) => (
                <div
                  key={`${n.ts}-${i}`}
                  className="text-xs rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2"
                >
                  <div className="text-slate-400 mb-1">{new Date(n.ts).toLocaleTimeString()}</div>
                  <div className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                    {n.contenido}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
