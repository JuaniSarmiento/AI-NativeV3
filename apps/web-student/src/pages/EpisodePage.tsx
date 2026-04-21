import { useCallback, useRef, useState } from "react"
import {
  classifyEpisode,
  closeEpisode,
  openEpisode,
  sendMessage,
  type Classification,
} from "../lib/api"
import { CodeEditor } from "../components/CodeEditor"

interface Message {
  role: "user" | "tutor"
  content: string
  ts: number
}

/** Página principal del estudiante: editor + chat + panel N4 post-episodio. */
export default function EpisodePage() {
  const [episodeId, setEpisodeId] = useState<string | null>(null)
  const [code, setCode] = useState<string>(
    "# Escribí tu código Python acá\n\ndef factorial(n):\n    pass\n",
  )
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState<string>("")
  const [streaming, setStreaming] = useState(false)
  const [classification, setClassification] = useState<Classification | null>(null)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  async function handleOpenEpisode() {
    setError(null)
    setClassification(null)
    try {
      const res = await openEpisode({
        // UUIDs de prueba; en producción vienen del problema que la docente asignó
        comision_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        problema_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        curso_config_hash: "c".repeat(64),
        classifier_config_hash: "d".repeat(64),
      })
      setEpisodeId(res.episode_id)
      setMessages([])
    } catch (e) {
      setError(`Error abriendo episodio: ${e}`)
    }
  }

  async function handleSend() {
    if (!episodeId || !input.trim() || streaming) return
    const userMessage = input.trim()
    setInput("")
    setMessages((m) => [...m, { role: "user", content: userMessage, ts: Date.now() }])
    setStreaming(true)

    // Chunk buffer para ir renderizando
    const tutorMessage: Message = { role: "tutor", content: "", ts: Date.now() }
    setMessages((m) => [...m, tutorMessage])

    try {
      for await (const event of sendMessage(episodeId, userMessage)) {
        if (event.type === "chunk") {
          tutorMessage.content += event.content
          setMessages((m) => [...m.slice(0, -1), { ...tutorMessage }])
          scrollToBottom()
        } else if (event.type === "error") {
          setError(`Tutor error: ${event.message}`)
          break
        } else if (event.type === "done") {
          // opcional: mostrar chunks_used_hash en debug panel
          console.debug("chunks_used_hash:", event.chunks_used_hash)
        }
      }
    } catch (e) {
      setError(`Error en streaming: ${e}`)
    } finally {
      setStreaming(false)
    }
  }

  async function handleClose() {
    if (!episodeId) return
    setError(null)
    try {
      await closeEpisode(episodeId, "student_finished")
      // Disparar clasificación
      const c = await classifyEpisode(episodeId)
      setClassification(c)
    } catch (e) {
      setError(`Error cerrando: ${e}`)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 flex flex-col">
      <header className="border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <h1 className="text-xl font-semibold">Tutor — Programación 2</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {episodeId ? `Episodio ${episodeId.slice(0, 8)}...` : "Sin episodio abierto"}
        </p>
      </header>

      {error && (
        <div className="bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200 px-6 py-2 text-sm">
          {error}
        </div>
      )}

      {classification ? (
        <ClassificationPanel classification={classification} onReset={() => {
          setClassification(null)
          setEpisodeId(null)
        }} />
      ) : !episodeId ? (
        <div className="flex-1 flex items-center justify-center">
          <button
            type="button"
            onClick={handleOpenEpisode}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
          >
            Abrir episodio de trabajo
          </button>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 gap-4 p-4 min-h-0">
          {/* Editor de código con Monaco + Pyodide */}
          <section className="flex flex-col rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <CodeEditor
              initialCode={code}
              onCodeExecuted={(result) => {
                setCode(result.code)
                // TODO F6: emitir evento CTR codigo_ejecutado con result.output + result.error
                console.debug("code executed:", result)
              }}
            />
            <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 flex gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="ml-auto px-3 py-1 text-sm border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cerrar episodio
              </button>
            </div>
          </section>

          {/* Chat con el tutor */}
          <section className="flex flex-col rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-medium">Tutor socrático</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <p className="text-sm text-slate-500">
                  Escribí tu consulta o describí el problema en el que estás trabajando.
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] ${m.role === "user" ? "ml-auto" : ""}`}
                >
                  <div
                    className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 dark:bg-slate-800"
                    }`}
                  >
                    {m.content || (m.role === "tutor" && streaming ? "..." : "")}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800 p-3 flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="Escribí tu consulta (Enter para enviar)..."
                rows={2}
                disabled={streaming}
                className="flex-1 px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 resize-none focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={streaming || !input.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded text-sm font-medium"
              >
                {streaming ? "..." : "Enviar"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function ClassificationPanel({
  classification,
  onReset,
}: {
  classification: Classification
  onReset: () => void
}) {
  const labels: Record<Classification["appropriation"], { emoji: string; label: string; color: string }> = {
    apropiacion_reflexiva: {
      emoji: "🌟",
      label: "Apropiación reflexiva",
      color: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
    },
    apropiacion_superficial: {
      emoji: "🤔",
      label: "Apropiación superficial",
      color: "bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200",
    },
    delegacion_pasiva: {
      emoji: "⚠️",
      label: "Delegación pasiva",
      color: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
    },
  }
  const meta = labels[classification.appropriation]

  return (
    <div className="flex-1 p-6 overflow-y-auto max-w-4xl mx-auto w-full">
      <div className={`rounded-lg p-6 mb-6 ${meta.color}`}>
        <div className="text-4xl mb-2">{meta.emoji}</div>
        <h2 className="text-2xl font-semibold">{meta.label}</h2>
        <p className="mt-3 text-sm leading-relaxed">{classification.appropriation_reason}</p>
      </div>

      <section className="mb-6">
        <h3 className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400 mb-3">
          Las tres coherencias (N4)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CoherenceCard
            title="Temporal (CT)"
            description="Patrón de trabajo sostenido en el tiempo"
            value={classification.ct_summary}
          />
          <CoherenceCard
            title="Código ↔ Discurso (CCD)"
            description="Alineación entre acciones y verbalización"
            value={classification.ccd_mean}
            secondary={{
              label: "Acciones sin reflexión",
              value: classification.ccd_orphan_ratio,
              invertScale: true,
            }}
          />
          <CoherenceCard
            title="Inter-iteración (CII)"
            description="Estabilidad y evolución entre intentos"
            value={classification.cii_stability}
            secondary={{
              label: "Evolución",
              value: classification.cii_evolution,
            }}
          />
        </div>
      </section>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 mb-6 text-xs text-slate-500 font-mono">
        Hash de configuración del clasificador: {classification.classifier_config_hash.slice(0, 16)}...
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
        >
          Nuevo episodio
        </button>
      </div>
    </div>
  )
}

function CoherenceCard({
  title,
  description,
  value,
  secondary,
}: {
  title: string
  description: string
  value: number | null
  secondary?: { label: string; value: number | null; invertScale?: boolean }
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900">
      <h4 className="font-medium text-sm">{title}</h4>
      <p className="text-xs text-slate-500 mt-1 mb-3">{description}</p>
      <Meter value={value} />
      {secondary && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <p className="text-xs text-slate-500 mb-1">{secondary.label}</p>
          <Meter value={secondary.value} invertScale={secondary.invertScale} />
        </div>
      )}
    </div>
  )
}

function Meter({
  value,
  invertScale = false,
}: {
  value: number | null
  invertScale?: boolean
}) {
  if (value == null) {
    return <div className="text-xs text-slate-400">sin datos</div>
  }
  const pct = Math.round(value * 100)
  // color: alto=verde si no es escala invertida; si invertScale, alto=rojo
  const goodHigh = !invertScale
  const isGood = goodHigh ? pct > 60 : pct < 40
  const barColor = isGood
    ? "bg-green-500"
    : pct > 40 && pct < 70
      ? "bg-yellow-500"
      : "bg-red-500"
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-mono text-lg">{value.toFixed(2)}</span>
        <span className="text-xs text-slate-400">{pct}%</span>
      </div>
      <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
