/**
 * Vista del episodio activo (post-craft Fase 2).
 *
 * Este componente NO es ya la "page" raiz del web-student. Vive como vista
 * embebida dentro de la ruta `/episodio/$id` (TanStack Router file-based).
 * Recibe `episodeId` por prop (no por state) y un callback `onExit` que la
 * ruta usa para volver a "/" cuando el alumno cierra o sale.
 *
 * El selector de comisión / selector de TP YA NO viven acá — el flujo nuevo
 * es: home (/) -> /materia/:id (TareaSelector) -> /episodio/:id (esta vista).
 *
 * Hidratacion on-mount: pegamos a GET /api/v1/episodes/{id} para traer la TP,
 * mensajes y codigo. Si el episodio cerro / no existe / es cross-tenant,
 * limpiamos sessionStorage y llamamos onExit().
 */
import { HelpButton, MarkdownRenderer } from "@platform/ui"
import { useCallback, useEffect, useRef, useState } from "react"
import { CodeEditor } from "../components/CodeEditor"
import { ReflectionModal } from "../components/ReflectionModal"
import {
  type AvailableTarea,
  type Classification,
  EpisodeStateError,
  classifyEpisode,
  closeEpisode,
  emitEdicionCodigo,
  emitEpisodioAbandonado,
  emitLecturaEnunciado,
  getEpisodeState,
  getTareaById,
  markEjercicioCompleted,
  sendMessage,
} from "../lib/api"
import { helpContent } from "../utils/helpContent"

const ACTIVE_EPISODE_KEY = "active-episode-id"

interface Message {
  role: "user" | "tutor"
  content: string
  ts: number
}

/** Contexto de ejercicio activo para TPs multi-ejercicio. */
export interface EjercicioContext {
  entregaId: string
  ejercicioOrden: number
}

export interface EpisodeViewProps {
  episodeId: string
  /** Disparado cuando el alumno cierra el episodio o el recovery falla. */
  onExit: () => void
  /** Si viene de un ejercicio especifico, contiene entregaId y orden. */
  ejercicioContext?: EjercicioContext
}

/**
 * Resuelve el codigo_inicial para Monaco: ejercicio especifico (multi-ej)
 * o TP-level (monolitica). null = usar scaffold default del CodeEditor.
 */
function resolveCodigoInicial(tarea: AvailableTarea, ejercicioOrden: number | null): string | null {
  if (ejercicioOrden != null) {
    const ej = tarea.ejercicios.find((e) => e.orden === ejercicioOrden)
    if (ej?.inicial_codigo) return ej.inicial_codigo
  }
  return tarea.inicial_codigo ?? null
}

export function EpisodeView({ episodeId, onExit, ejercicioContext }: EpisodeViewProps) {
  const [tarea, setTarea] = useState<AvailableTarea | null>(null)
  const [code, setCode] = useState<string>(
    "# Escribí tu código Python acá\n\ndef factorial(n):\n    pass\n",
  )
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState<string>("")
  const [streaming, setStreaming] = useState(false)
  const [classification, setClassification] = useState<Classification | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hydrating, setHydrating] = useState<boolean>(true)
  const [closed, setClosed] = useState<boolean>(false)
  const [reflectionTargetId, setReflectionTargetId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const ejercicioOrden = ejercicioContext?.ejercicioOrden ?? null

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  // Persistencia en sessionStorage del episodio activo (recovery via home).
  useEffect(() => {
    if (typeof window === "undefined") return
    if (closed) {
      window.sessionStorage.removeItem(ACTIVE_EPISODE_KEY)
    } else {
      window.sessionStorage.setItem(ACTIVE_EPISODE_KEY, episodeId)
    }
  }, [episodeId, closed])

  // ADR-025 G10-A: emitir EpisodioAbandonado en beforeunload.
  useEffect(() => {
    if (typeof window === "undefined") return
    if (closed) return
    const handler = () => {
      void emitEpisodioAbandonado(episodeId, {
        reason: "beforeunload",
        last_activity_seconds_ago: 0,
      })
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [episodeId, closed])

  // Hydration on-mount. El episodeId viene del path param, no del state.
  useEffect(() => {
    let cancelled = false
    setHydrating(true)
    setError(null)
    ;(async () => {
      try {
        const state = await getEpisodeState(episodeId)
        if (cancelled) return
        if (state.estado === "closed") {
          window.sessionStorage.removeItem(ACTIVE_EPISODE_KEY)
          onExit()
          return
        }
        const t = await getTareaById(state.tarea_practica_id)
        if (cancelled) return
        if (!t) {
          window.sessionStorage.removeItem(ACTIVE_EPISODE_KEY)
          setError("La TP del episodio anterior ya no esta disponible.")
          return
        }
        setTarea(t)
        if (state.last_code_snapshot) {
          setCode(state.last_code_snapshot)
        } else {
          const initialCode = resolveCodigoInicial(t, ejercicioOrden)
          if (initialCode) setCode(initialCode)
        }
        setMessages(
          state.messages.map((m) => ({
            role: m.role === "assistant" ? "tutor" : "user",
            content: m.content,
            ts: Date.parse(m.ts) || Date.now(),
          })),
        )
      } catch (e) {
        if (cancelled) return
        if (e instanceof EpisodeStateError && (e.status === 404 || e.status === 403)) {
          window.sessionStorage.removeItem(ACTIVE_EPISODE_KEY)
          onExit()
        } else {
          console.warn("Episode hydration failed:", e)
          setError("No se pudo cargar el episodio.")
        }
      } finally {
        if (!cancelled) setHydrating(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [episodeId, onExit, ejercicioOrden])

  async function handleSend() {
    if (!input.trim() || streaming) return
    const userMessage = input.trim()
    setInput("")
    setMessages((m) => [...m, { role: "user", content: userMessage, ts: Date.now() }])
    setStreaming(true)

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
    setError(null)
    try {
      await closeEpisode(episodeId, "student_finished")
    } catch (e) {
      const msg = String(e)
      if (msg.includes("404")) {
        window.sessionStorage.removeItem(ACTIVE_EPISODE_KEY)
        onExit()
        return
      }
      setError(`Error cerrando: ${e}`)
      return
    }
    setClosed(true)
    setReflectionTargetId(episodeId)
    try {
      const c = await classifyEpisode(episodeId)
      setClassification(c)
    } catch {
      // Best-effort.
    }
    window.sessionStorage.removeItem(ACTIVE_EPISODE_KEY)
  }

  const elapsedSeconds = useElapsedSeconds(closed ? null : episodeId)

  if (hydrating) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <div
            className="inline-block w-6 h-6 border-2 border-t-transparent rounded-full motion-safe:animate-spin mb-3"
            style={{ borderColor: "var(--color-accent-brand)", borderTopColor: "transparent" }}
          />
          <p className="text-sm text-slate-600 dark:text-slate-400">Cargando episodio...</p>
        </div>
      </div>
    )
  }

  if (classification) {
    return (
      <ClassificationPanel
        classification={classification}
        isMultiExercise={ejercicioContext != null}
        onReset={async () => {
          setClassification(null)
          if (ejercicioContext) {
            try {
              await markEjercicioCompleted(
                ejercicioContext.entregaId,
                ejercicioContext.ejercicioOrden,
                episodeId,
              )
            } catch {
              // Best-effort: no bloquear la navegacion si falla.
            }
          }
          onExit()
        }}
      />
    )
  }

  if (!tarea) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-2">
            {error ?? "No pudimos cargar el episodio."}
          </p>
          <button
            type="button"
            onClick={onExit}
            className="mt-4 px-4 py-2 rounded text-sm font-medium text-white"
            style={{ backgroundColor: "var(--color-accent-brand)" }}
          >
            Volver a mis materias
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        data-testid="episode-context-header"
        className="border-b border-slate-200 dark:border-slate-800 px-6 py-2 bg-white dark:bg-slate-900 flex items-center gap-4 text-xs"
      >
        <span className="font-mono text-slate-600 dark:text-slate-400">
          episodio {episodeId.slice(0, 6)}...{episodeId.slice(-4)}
        </span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-600 dark:text-slate-400">
          abierto hace {formatElapsed(elapsedSeconds)}
        </span>
        <span className="text-slate-400">·</span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: "var(--color-level-n1)" }}
          />
          <span className="text-slate-700 dark:text-slate-300">N1 lectura activa</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <HelpButton title="Tutor Socratico" content={helpContent.episode} />
          <button
            type="button"
            onClick={handleClose}
            data-testid="close-episode-button"
            className="px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Cerrar episodio
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200 px-6 py-2 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              window.sessionStorage.removeItem(ACTIVE_EPISODE_KEY)
              onExit()
            }}
            className="ml-4 px-3 py-1 text-xs font-medium bg-red-700 text-white rounded hover:bg-red-800"
          >
            Salir
          </button>
        </div>
      )}

      <div className="flex-1 grid grid-cols-2 gap-4 p-4 min-h-0">
        <section className="flex flex-col rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <SectionKicker level="N1" label="Enunciado" colorVar="var(--color-level-n1)" />
          <EnunciadoPanel tarea={tarea} episodeId={episodeId} ejercicioOrden={ejercicioContext?.ejercicioOrden ?? null} />
          <SectionKicker level="N3" label="Editor + tests" colorVar="var(--color-level-n3)" />
          <CodeEditor
            initialCode={code}
            onCodeExecuted={(result) => {
              setCode(result.code)
              console.debug("code executed:", result)
            }}
            onEditDebounced={(snapshot, diffChars, origin) => {
              void emitEdicionCodigo(episodeId, {
                snapshot,
                diff_chars: Math.abs(diffChars),
                language: "python",
                origin,
              }).catch((e) => {
                console.warn("emit edicion_codigo failed:", e)
              })
            }}
          />
        </section>

        <section className="flex flex-col rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <SectionKicker level="N4" label="Tutor socratico" colorVar="var(--color-level-n4)" />

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div
                data-testid="chat-pedagogical-contract"
                className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed max-w-prose"
              >
                <p className="font-medium mb-2">El tutor no te da la respuesta.</p>
                <p className="mb-3 text-slate-600 dark:text-slate-400">
                  Te hace preguntas para que llegues vos.
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-500 border-l border-slate-300 dark:border-slate-700 pl-3">
                  Empezas vos: contale en que estas pensando para resolver esta TP.
                </p>
              </div>
            )}
            {messages.map((m, i) => {
              const isLastTutor =
                m.role === "tutor" && messages.findLastIndex((mm) => mm.role === "tutor") === i
              return (
                <div
                  key={`${m.ts}-${i}`}
                  className={`max-w-[85%] ${m.role === "user" ? "ml-auto" : ""}`}
                >
                  <div
                    data-testid={isLastTutor ? "tutor-message-last" : undefined}
                    className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                      m.role === "user" ? "text-white" : "bg-slate-100 dark:bg-slate-800"
                    }`}
                    style={
                      m.role === "user"
                        ? { backgroundColor: "var(--color-accent-brand)" }
                        : undefined
                    }
                  >
                    {m.content || (m.role === "tutor" && streaming ? "..." : "")}
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 p-3 flex gap-2">
            <textarea
              data-testid="tutor-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Escribi tu mensaje (Enter para enviar)..."
              rows={2}
              disabled={streaming}
              className="flex-1 px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 resize-none focus:outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={streaming || !input.trim()}
              className="px-4 py-2 disabled:bg-slate-400 text-white rounded text-sm font-medium"
              style={{
                backgroundColor:
                  streaming || !input.trim() ? undefined : "var(--color-accent-brand)",
              }}
            >
              {streaming ? "..." : "Enviar"}
            </button>
          </div>
        </section>
      </div>

      <ReflectionModal
        isOpen={reflectionTargetId !== null}
        episodeId={reflectionTargetId}
        onClose={() => setReflectionTargetId(null)}
      />
    </>
  )
}

function SectionKicker({
  level,
  label,
  colorVar,
}: {
  level: "N1" | "N2" | "N3" | "N4"
  label: string
  colorVar: string
}) {
  return (
    <div
      data-testid={`section-kicker-${level.toLowerCase()}`}
      className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2"
    >
      <span
        aria-hidden="true"
        className="inline-block w-2 h-2 rounded-full"
        style={{ backgroundColor: colorVar }}
      />
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
        {level} {label}
      </h2>
    </div>
  )
}

function useElapsedSeconds(episodeId: string | null): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!episodeId) {
      setSeconds(0)
      return
    }
    setSeconds(0)
    const interval = window.setInterval(() => {
      setSeconds((s) => s + 1)
    }, 1000)
    return () => window.clearInterval(interval)
  }, [episodeId])
  return seconds
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

/** Hook que mide tiempo de visibilidad + tab focus y emite el delta al
 * backend cada `flushMs` o al unmount. Señal observable canónica de N1. */
function useReadingTimeReporter(episodeId: string | null, enabled: boolean, flushMs = 30_000) {
  const elementRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!enabled) return
    const target = elementRef.current
    if (!target) return

    let visibleInDom = false
    let tabVisible = typeof document !== "undefined" ? document.visibilityState === "visible" : true
    let accumMs = 0
    let lastTickAt: number | null = null

    function isCounting() {
      return visibleInDom && tabVisible
    }
    function tick() {
      if (lastTickAt != null) accumMs += Date.now() - lastTickAt
      lastTickAt = isCounting() ? Date.now() : null
    }

    async function flush() {
      tick()
      if (accumMs < 1000 || !episodeId) return
      const seconds = accumMs / 1000
      accumMs = 0
      try {
        await emitLecturaEnunciado(episodeId, { duration_seconds: seconds })
      } catch (e) {
        accumMs += seconds * 1000
        console.warn("emit lectura_enunciado failed:", e)
      }
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          tick()
          visibleInDom = entry.isIntersecting && entry.intersectionRatio >= 0.25
          if (isCounting() && lastTickAt == null) lastTickAt = Date.now()
        }
      },
      { threshold: [0, 0.25, 0.5, 1] },
    )
    io.observe(target)

    function onVisibility() {
      tick()
      tabVisible = document.visibilityState === "visible"
      if (isCounting() && lastTickAt == null) lastTickAt = Date.now()
    }
    document.addEventListener("visibilitychange", onVisibility)

    if (isCounting()) lastTickAt = Date.now()
    const flushTimer = window.setInterval(() => {
      void flush()
    }, flushMs)

    return () => {
      io.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      window.clearInterval(flushTimer)
      void flush()
    }
  }, [episodeId, enabled, flushMs])

  return elementRef
}

function EnunciadoPanel({
  tarea,
  episodeId,
  ejercicioOrden,
}: {
  tarea: AvailableTarea
  episodeId: string | null
  ejercicioOrden: number | null
}) {
  const [open, setOpen] = useState(true)
  const enunciadoRef = useReadingTimeReporter(episodeId, open && episodeId !== null)

  let displayContent = tarea.enunciado
  let headerLabel = `${tarea.codigo} (v${tarea.version})`

  if (ejercicioOrden != null && tarea.ejercicios.length > 0) {
    const ej = tarea.ejercicios.find((e) => e.orden === ejercicioOrden)
    if (ej) {
      displayContent = `## ${ej.titulo}\n\n${ej.enunciado_md}`
      headerLabel = `${tarea.codigo} — Ejercicio ${ejercicioOrden} de ${tarea.ejercicios.length}`
    }
  }

  return (
    <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-1.5 flex items-center justify-between text-left text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900"
      >
        <span>{headerLabel}</span>
        <span>{open ? "Ocultar" : "Mostrar"}</span>
      </button>
      {open && (
        <div
          ref={enunciadoRef}
          className="px-4 py-3 max-h-48 overflow-y-auto text-sm text-slate-700 dark:text-slate-300"
        >
          <MarkdownRenderer content={displayContent} />
        </div>
      )}
    </div>
  )
}

function ClassificationPanel({
  classification,
  isMultiExercise,
  onReset,
}: {
  classification: Classification
  isMultiExercise?: boolean
  onReset: () => void
}) {
  const labels: Record<
    Classification["appropriation"],
    { emoji: string; label: string; color: string }
  > = {
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
        Hash de configuración del clasificador: {classification.classifier_config_hash.slice(0, 16)}
        ...
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
        >
          {isMultiExercise ? "Siguiente ejercicio →" : "Volver a mis materias"}
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
          {secondary.invertScale !== undefined ? (
            <Meter value={secondary.value} invertScale={secondary.invertScale} />
          ) : (
            <Meter value={secondary.value} />
          )}
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
  const goodHigh = !invertScale
  const isGood = goodHigh ? pct > 60 : pct < 40
  const barColor = isGood ? "bg-green-500" : pct > 40 && pct < 70 ? "bg-yellow-500" : "bg-red-500"
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

// Default export para retro-compat con `App.tsx` viejo (queda como referencia
// no utilizada cuando main.tsx usa RouterProvider). NO romper si alguien
// importa `EpisodePage`.
export default EpisodeView
