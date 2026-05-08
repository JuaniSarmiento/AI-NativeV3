import { Modal } from "@platform/ui"
import { useEffect, useRef, useState } from "react"
import { submitReflection } from "../lib/api"

/**
 * Modal de reflexion metacognitiva post-cierre del episodio (ADR-035).
 *
 * NO bloqueante: el cierre del episodio ya emitio `EpisodioCerrado` al CTR
 * antes de que este modal se muestre. El alumno puede saltarlo (boton
 * "Saltar") sin emitir `reflexion_completada`. La cadena criptografica
 * sigue intacta.
 *
 * Privacy: el contenido textual viaja al backend como string libre. El
 * export academico redacta los 3 campos por default (`include_reflections`
 * = false). Investigador con consentimiento usa el flag explicito.
 *
 * Reproducibilidad: el classifier IGNORA `reflexion_completada` (filtrado
 * en `pipeline.py::_EXCLUDED_FROM_FEATURES`) — la presencia o ausencia de
 * reflexion NO afecta el resultado de la clasificacion N4 ni el
 * `classifier_config_hash`.
 */

const PROMPT_VERSION = "reflection/v1.0.0"
const MAX_CHARS = 500

interface ReflectionModalProps {
  isOpen: boolean
  episodeId: string | null
  onClose: () => void
}

export function ReflectionModal({ isOpen, episodeId, onClose }: ReflectionModalProps) {
  const [queAprendiste, setQueAprendiste] = useState("")
  const [dificultad, setDificultad] = useState("")
  const [queDistinto, setQueDistinto] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Marca temporal de apertura para calcular `tiempo_completado_ms`. Se
  // resetea cada vez que el modal se abre — usamos useRef para que el reset
  // ocurra dentro del effect, no en cada render.
  const openedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (isOpen) {
      openedAtRef.current = Date.now()
      setQueAprendiste("")
      setDificultad("")
      setQueDistinto("")
      setError(null)
      setSubmitting(false)
    } else {
      openedAtRef.current = null
    }
  }, [isOpen])

  async function handleSubmit() {
    if (!episodeId || submitting) return
    if (openedAtRef.current === null) {
      // Defensa: si el ref no se hidrato, no enviamos un valor invalido.
      return
    }
    setSubmitting(true)
    setError(null)
    const tiempoMs = Date.now() - openedAtRef.current
    try {
      await submitReflection(episodeId, {
        que_aprendiste: queAprendiste,
        dificultad_encontrada: dificultad,
        que_haria_distinto: queDistinto,
        prompt_version: PROMPT_VERSION,
        tiempo_completado_ms: Math.max(0, tiempoMs),
      })
      onClose()
    } catch (e) {
      setError(`Error enviando reflexion: ${e}`)
      setSubmitting(false)
    }
  }

  function handleSkip() {
    if (submitting) return
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleSkip}
      title="Antes de cerrar — una reflexion rapida"
      size="lg"
    >
      <div className="space-y-4 text-sm text-body">
        <p className="text-muted">
          El episodio ya quedo cerrado. Tu respuesta es{" "}
          <span className="font-semibold">opcional</span> y nos ayuda a entender como pensaste el
          ejercicio. Podes saltearla sin problema.
        </p>

        <ReflectionTextarea
          id="que-aprendiste"
          label="Que aprendiste?"
          hint="En una o dos lineas, que cosa nueva entendiste o reforzaste."
          value={queAprendiste}
          onChange={setQueAprendiste}
        />

        <ReflectionTextarea
          id="dificultad-encontrada"
          label="Que dificultad encontraste?"
          hint="Donde te quedaste trabado, que parte costo mas."
          value={dificultad}
          onChange={setDificultad}
        />

        <ReflectionTextarea
          id="que-haria-distinto"
          label="Que harias distinto la proxima?"
          hint="Si volvieras a empezar este ejercicio, que cambiarias en tu forma de encararlo."
          value={queDistinto}
          onChange={setQueDistinto}
        />

        {error && (
          <div className="bg-danger-soft text-danger px-3 py-2 text-sm rounded">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleSkip}
            disabled={submitting}
            className="px-4 py-2 text-sm border border-border rounded hover:bg-surface-alt disabled:opacity-50"
          >
            Saltar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-sm bg-accent-brand hover:bg-accent-brand-deep text-white rounded disabled:opacity-50"
          >
            {submitting ? "Enviando..." : "Enviar"}
          </button>
        </div>
      </div>
    </Modal>
  )
}

interface ReflectionTextareaProps {
  id: string
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
}

function ReflectionTextarea({ id, label, hint, value, onChange }: ReflectionTextareaProps) {
  const remaining = MAX_CHARS - value.length
  const overLimit = remaining < 0

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1">
        {label}
      </label>
      <p className="text-xs text-muted mb-2">{hint}</p>
      <textarea
        id={id}
        value={value}
        onChange={(e) => {
          // Cap en el cliente para evitar que el backend rechace con 422.
          // El backend igual valida defensivamente.
          if (e.target.value.length <= MAX_CHARS) onChange(e.target.value)
        }}
        rows={3}
        className="w-full px-3 py-2 text-sm border border-border bg-white rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <p
        className={`text-xs mt-1 text-right ${
          overLimit ? "text-danger" : "text-muted"
        }`}
      >
        {remaining} chars restantes
      </p>
    </div>
  )
}
