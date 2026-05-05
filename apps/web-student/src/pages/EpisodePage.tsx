import { DEMO_COMISION_ID } from "@platform/contracts"
import { EmptyHero, HelpButton, MarkdownRenderer } from "@platform/ui"
import { BookOpen } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { CodeEditor } from "../components/CodeEditor"
import { ComisionSelector } from "../components/ComisionSelector"
import { ReflectionModal } from "../components/ReflectionModal"
import { TareaSelector } from "../components/TareaSelector"
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
  openEpisode,
  sendMessage,
} from "../lib/api"
import { helpContent } from "../utils/helpContent"

/**
 * sessionStorage key for episode recovery (G4). Per-tab scoped, clears on
 * tab close. NO usar localStorage: queremos que cerrar la pestaña descarte
 * la sesión, pero refrescar (F5) la recupere.
 */
const ACTIVE_EPISODE_KEY = "active-episode-id"

interface Message {
  role: "user" | "tutor"
  content: string
  ts: number
}

/**
 * Re-export del constante compartido (F10). La definición canónica vive
 * en `packages/contracts/src/demo/constants.ts`. En F9 real, el listado
 * del selector se filtra por el claim `comisiones_activas` del JWT.
 */
export { DEMO_COMISION_ID }

/** Página principal del estudiante: selector TP → editor + chat → panel N4. */
export default function EpisodePage() {
  const [selectedComisionId, setSelectedComisionId] = useState<string | null>(null)
  const [selectedTarea, setSelectedTarea] = useState<AvailableTarea | null>(null)
  const [episodeId, setEpisodeId] = useState<string | null>(null)
  const [code, setCode] = useState<string>(
    "# Escribí tu código Python acá\n\ndef factorial(n):\n    pass\n",
  )
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState<string>("")
  const [streaming, setStreaming] = useState(false)
  const [classification, setClassification] = useState<Classification | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [recovering, setRecovering] = useState<boolean>(() => {
    // Si hay un episodio en sessionStorage, arrancamos en modo "recovering"
    // para que no flashee el TareaSelector antes de hidratar.
    if (typeof window === "undefined") return false
    return Boolean(window.sessionStorage.getItem(ACTIVE_EPISODE_KEY))
  })
  // ADR-035: estado del modal de reflexion post-cierre. Se abre tras el
  // closeEpisode exitoso y guardamos el episodeId que acabamos de cerrar
  // para que la reflexion apunte al CTR correcto (el setEpisodeId(null)
  // de handleClose limpia el state principal).
  const [reflectionTargetId, setReflectionTargetId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  // ── G4: persistencia + recuperación del episodio activo ──────────────
  // Mantenemos sessionStorage sincronizado con el episodio actual para
  // sobrevivir a refresh (F5). Sólo persiste mientras la pestaña vive.
  useEffect(() => {
    if (typeof window === "undefined") return
    if (episodeId) {
      window.sessionStorage.setItem(ACTIVE_EPISODE_KEY, episodeId)
    } else {
      window.sessionStorage.removeItem(ACTIVE_EPISODE_KEY)
    }
  }, [episodeId])

  // ── G10-A (ADR-025): emitir EpisodioAbandonado en beforeunload ───────
  // Si el estudiante cierra la pestaña o navega afuera con un episodio
  // abierto, emitimos al CTR para distinguir cierre intencional de cierre
  // por inactividad. Idempotente con el worker server-side de timeout —
  // el backend ignora la segunda emision si ya hubo una. Usa sendBeacon
  // por dentro porque fetch puede ser cancelado mid-flight en unload.
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!episodeId) return
    const handler = () => {
      void emitEpisodioAbandonado(episodeId, {
        reason: "beforeunload",
        // Sin baseline confiable de "ultima actividad" en el cliente —
        // el backend acepta 0 y queda como signal honesta.
        last_activity_seconds_ago: 0,
      })
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [episodeId])

  // Recuperación on-mount. Corre UNA vez antes del flujo normal para
  // evitar parpadeo del TareaSelector. Si la TP fue despublicada o el
  // episodio ya está cerrado, limpiamos sessionStorage y arrancamos
  // fresco (closed = workflow completo, no tiene sentido restaurar).
  useEffect(() => {
    if (typeof window === "undefined") return
    const storedId = window.sessionStorage.getItem(ACTIVE_EPISODE_KEY)
    if (!storedId) {
      setRecovering(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const state = await getEpisodeState(storedId)
        if (cancelled) return
        if (state.estado === "closed") {
          window.sessionStorage.removeItem(ACTIVE_EPISODE_KEY)
          return
        }
        const tarea = await getTareaById(state.tarea_practica_id)
        if (cancelled) return
        if (!tarea) {
          window.sessionStorage.removeItem(ACTIVE_EPISODE_KEY)
          setError("La TP del episodio anterior ya no está disponible.")
          return
        }
        // Hidratar estado. Sólo restauramos mensajes completos — un chunk
        // streamado a medio camino se pierde (acceptable trade-off).
        setSelectedComisionId(state.comision_id)
        setSelectedTarea(tarea)
        setEpisodeId(state.episode_id)
        if (state.last_code_snapshot) setCode(state.last_code_snapshot)
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
        } else {
          console.warn("Episode recovery failed:", e)
          window.sessionStorage.removeItem(ACTIVE_EPISODE_KEY)
          setError("No se pudo recuperar la sesión anterior.")
        }
      } finally {
        if (!cancelled) setRecovering(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleOpenEpisode(tarea: AvailableTarea) {
    setError(null)
    setClassification(null)
    setOpening(true)
    try {
      const res = await openEpisode({
        comision_id: selectedComisionId ?? DEMO_COMISION_ID,
        problema_id: tarea.id,
        // Hashes de configuración del piloto. En F9 real vienen del backend
        // como parte del bootstrap de la comisión.
        curso_config_hash: "c".repeat(64),
        classifier_config_hash: "d".repeat(64),
      })
      setEpisodeId(res.episode_id)
      setMessages([])
    } catch (e) {
      setError(`Error abriendo episodio: ${e}`)
      // Si falla el open (TP vencida, no autorizada, etc.), volvemos al
      // selector para que el estudiante pueda elegir otra.
      setSelectedTarea(null)
    } finally {
      setOpening(false)
    }
  }

  function handleSelectTarea(tarea: AvailableTarea) {
    setSelectedTarea(tarea)
    void handleOpenEpisode(tarea)
  }

  /**
   * Vuelve al selector de TP. Si hay un episodio en curso lo cerramos
   * con motivo `student_switched_tarea` para no dejar episodios abiertos
   * colgando — el invariante CTR append-only se preserva: cerrar es un
   * INSERT, no un DELETE.
   */
  async function handleChangeTarea() {
    if (episodeId) {
      try {
        await closeEpisode(episodeId, "student_switched_tarea")
      } catch (e) {
        // No bloqueamos el cambio de TP por un error de cierre — el
        // estudiante priorizó cambiar de problema.
        console.warn("Error cerrando episodio al cambiar de TP:", e)
      }
    }
    setEpisodeId(null)
    setMessages([])
    setClassification(null)
    setSelectedTarea(null)
    setError(null)
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
    } catch (e) {
      setError(`Error cerrando: ${e}`)
      return
    }
    // ADR-035: el cierre ya fue appendeado al CTR — disparamos el modal de
    // reflexion DESPUES, asincrono y opcional. La clasificacion sigue su
    // camino en paralelo (best-effort).
    const closedEpisodeId = episodeId
    setReflectionTargetId(closedEpisodeId)
    try {
      const c = await classifyEpisode(closedEpisodeId)
      setClassification(c)
    } catch {
      // Clasificación es best-effort — en dev el pipeline puede no estar
      // disponible. El episodio ya se cerró correctamente.
    }
    setEpisodeId(null)
    setSelectedTarea(null)
    window.sessionStorage.removeItem(ACTIVE_EPISODE_KEY)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 flex flex-col">
      <header className="border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Tutor — Programación 2</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 truncate">
            {selectedTarea
              ? `${selectedTarea.codigo} · ${selectedTarea.titulo}`
              : "Elegí un trabajo práctico para empezar"}
            {episodeId ? ` · Episodio ${episodeId.slice(0, 8)}...` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ComisionSelector value={selectedComisionId} onChange={setSelectedComisionId} />
          {selectedTarea && (
            <button
              type="button"
              onClick={handleChangeTarea}
              className="shrink-0 px-3 py-1 text-sm border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cambiar TP
            </button>
          )}
          <HelpButton title="Tutor Socratico" content={helpContent.episode} />
        </div>
      </header>

      {error && (
        <div className="bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200 px-6 py-2 text-sm">
          {error}
        </div>
      )}

      {recovering ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Recuperando sesión anterior...
            </p>
          </div>
        </div>
      ) : selectedComisionId === null ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyHero
            icon={<BookOpen className="h-12 w-12" />}
            title="Bienvenido al tutor"
            description="Elegí tu comisión para ver los trabajos prácticos disponibles."
            hint="Vas a poder cambiarla desde el menú de arriba."
          />
        </div>
      ) : classification ? (
        <ClassificationPanel
          classification={classification}
          onReset={() => {
            setClassification(null)
            setEpisodeId(null)
            setSelectedTarea(null)
          }}
        />
      ) : !selectedTarea ? (
        <TareaSelector comisionId={selectedComisionId} onSelect={handleSelectTarea} />
      ) : !episodeId ? (
        <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
          {opening ? "Abriendo episodio..." : "Preparando episodio..."}
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 gap-4 p-4 min-h-0">
          {/* Editor de código con Monaco + Pyodide */}
          {/* Deferred: ADR-026 / post-defensa — botón "Insertar código del tutor"
              desde el chat al editor cambiaría la condición experimental del
              piloto (introduciría copy-paste asistido). Mantener manual hasta
              piloto-2. */}
          <section className="flex flex-col rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <EnunciadoPanel tarea={selectedTarea} episodeId={episodeId} />
            <CodeEditor
              initialCode={code}
              onCodeExecuted={(result) => {
                setCode(result.code)
                // TODO F6: emitir evento CTR codigo_ejecutado con result.output + result.error
                console.debug("code executed:", result)
              }}
              onEditDebounced={(snapshot, diffChars, origin) => {
                if (!episodeId) return
                // F6: emitimos edicion_codigo con `origin` para que el
                // clasificador distinga tipeo vs paste sin depender solo de
                // inferencia temporal. Best-effort — un error no bloquea la
                // UI ni invalida la sesión.
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
                        m.role === "user"
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 dark:bg-slate-800"
                      }`}
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
      <ReflectionModal
        isOpen={reflectionTargetId !== null}
        episodeId={reflectionTargetId}
        onClose={() => setReflectionTargetId(null)}
      />
    </div>
  )
}

/**
 * Hook que mide tiempo de visibilidad de un elemento + tab focus, y
 * emite el delta acumulado al backend cada `flushMs` o al unmount.
 *
 * Es la señal observable canónica de N1 (Comprensión) — sin esto el
 * clasificador queda casi sin evidencia para esa coherencia.
 *
 * Reglas:
 *  - Sólo cuenta tiempo cuando el elemento está visible (IntersectionObserver
 *    >= 25% threshold) Y la pestaña está visible (document.visibilityState).
 *  - Flushea cada flushMs si hay >= 1s acumulado.
 *  - On unmount, flushea el remanente.
 *  - Si el episodio aún no abrió (episodeId == null), acumula igual y se
 *    flushea en el siguiente flush con episode válido (mejor evidencia
 *    cuando la TP demoró en abrir).
 */
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
        // Re-acumulamos para no perder señal — el siguiente flush lo
        // reintenta. No bloquea la UI.
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

/**
 * Panel del enunciado de la TP, colapsable. Renderiza markdown con
 * `react-markdown` + `remark-gfm` para que listas, headings, código inline
 * y tablas se vean bien.
 *
 * F5: emite eventos `lectura_enunciado` al CTR mientras el panel está
 * visible (cada 30s acumulados o al cerrar el episodio/unmount).
 */
function EnunciadoPanel({
  tarea,
  episodeId,
}: {
  tarea: AvailableTarea
  episodeId: string | null
}) {
  const [open, setOpen] = useState(true)
  // Sólo cuenta tiempo cuando el panel está expandido y hay episodio activo.
  const enunciadoRef = useReadingTimeReporter(episodeId, open && episodeId !== null)

  return (
    <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2 flex items-center justify-between text-left hover:bg-slate-100 dark:hover:bg-slate-900"
      >
        <span className="text-sm font-medium">
          Enunciado · {tarea.codigo} (v{tarea.version})
        </span>
        <span className="text-xs text-slate-500">{open ? "Ocultar" : "Mostrar"}</span>
      </button>
      {open && (
        <div
          ref={enunciadoRef}
          className="px-4 py-3 max-h-48 overflow-y-auto text-slate-700 dark:text-slate-300"
        >
          <MarkdownRenderer content={tarea.enunciado} />
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
          {/* exactOptionalPropertyTypes: no pasamos la prop si el caller no la fijó,
              para que tome el default de Meter (false) sin propagar `undefined`. */}
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
  // color: alto=verde si no es escala invertida; si invertScale, alto=rojo
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
