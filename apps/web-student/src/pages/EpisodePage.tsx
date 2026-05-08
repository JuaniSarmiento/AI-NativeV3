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
import { Bot, BookOpen, Code2, LogOut, MessageSquare, Send, Sparkles, User } from "lucide-react"
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
      <div className="page-enter flex-1 p-6">
        <div className="max-w-7xl mx-auto space-y-4">
          {/* Header skeleton */}
          <div className="skeleton h-10 rounded-lg" />
          {/* 3-panel grid skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-200px)]">
            <div className="skeleton rounded-xl" />
            <div className="skeleton rounded-xl" />
            <div className="skeleton rounded-xl" />
          </div>
          <p className="text-center text-sm text-muted animate-pulse-soft">
            Hidratando tu episodio...
          </p>
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
          <p className="text-sm font-medium text-danger mb-2">
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
      {/* ═══ HEADER CONTEXT — chip de episodio + tiempo + nivel + acciones ═══ */}
      <div
        data-testid="episode-context-header"
        className="animate-fade-in-down border-b border-border-soft px-6 py-2.5 bg-surface flex items-center gap-3 text-xs"
      >
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-alt border border-border-soft font-mono text-muted">
          <span
            aria-hidden="true"
            className="inline-block w-1.5 h-1.5 rounded-full bg-success animate-pulse-soft"
          />
          {episodeId.slice(0, 6)}…{episodeId.slice(-4)}
        </span>
        <span className="text-muted-soft">·</span>
        <span className="text-muted font-mono tabular-nums">
          {formatElapsed(elapsedSeconds)}
        </span>
        <span className="text-muted-soft">·</span>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-level-n1/10 border border-level-n1/30 text-level-n1 font-medium">
          <span
            aria-hidden="true"
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: "var(--color-level-n1)" }}
          />
          N1 lectura activa
        </span>
        <div className="ml-auto flex items-center gap-1">
          <HelpButton title="Tutor Socratico" content={helpContent.episode} />
          <button
            type="button"
            onClick={handleClose}
            data-testid="close-episode-button"
            className="press-shrink inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-md text-body hover:bg-danger-soft hover:border-danger/30 hover:text-danger transition-colors"
          >
            <LogOut className="h-3 w-3" />
            Cerrar episodio
          </button>
        </div>
      </div>

      {error && (
        <div className="animate-fade-in-down bg-danger-soft border-b border-danger/30 text-danger px-6 py-2 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              window.sessionStorage.removeItem(ACTIVE_EPISODE_KEY)
              onExit()
            }}
            className="press-shrink ml-4 px-3 py-1 text-xs font-medium bg-danger text-white rounded hover:bg-danger/90"
          >
            Salir
          </button>
        </div>
      )}

      {/* ═══ 3 PANELES: Consigna · Editor · Tutor ═══════════════════════ */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 min-h-0">
        {/* Panel 1 — Consigna (N1) */}
        <section
          className="animate-fade-in-up animate-delay-50 flex flex-col rounded-xl border border-border bg-surface overflow-hidden shadow-[0_1px_3px_-1px_rgba(0,0,0,0.04)]"
          aria-label="Consigna del problema"
        >
          <PanelHeader
            level="N1"
            label="Consigna"
            icon={<BookOpen className="h-3.5 w-3.5" />}
            colorVar="var(--color-level-n1)"
          />
          <EnunciadoPanel
            tarea={tarea}
            episodeId={episodeId}
            ejercicioOrden={ejercicioContext?.ejercicioOrden ?? null}
          />
        </section>

        {/* Panel 2 — Editor (N3) */}
        <section
          className="animate-fade-in-up animate-delay-100 flex flex-col rounded-xl border border-border bg-surface overflow-hidden shadow-[0_1px_3px_-1px_rgba(0,0,0,0.04)]"
          aria-label="Editor de código"
        >
          <PanelHeader
            level="N3"
            label="Editor de código"
            icon={<Code2 className="h-3.5 w-3.5" />}
            colorVar="var(--color-level-n3)"
            badge="Python"
          />
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

        {/* Panel 3 — Tutor (N4) */}
        <section
          className="animate-fade-in-up animate-delay-150 flex flex-col rounded-xl border border-border bg-surface overflow-hidden shadow-[0_1px_3px_-1px_rgba(0,0,0,0.04)]"
          aria-label="Tutor socrático"
        >
          <PanelHeader
            level="N4"
            label="Tutor socrático"
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            colorVar="var(--color-level-n4)"
            badge={streaming ? "escribiendo…" : "Mistral"}
            badgePulse={streaming}
          />

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 && (
              <div
                data-testid="chat-pedagogical-contract"
                className="animate-fade-in mx-auto max-w-prose"
              >
                <div className="rounded-xl border border-level-n4/20 bg-level-n4/5 p-5 relative overflow-hidden">
                  <div
                    aria-hidden="true"
                    className="absolute left-0 top-0 bottom-0 w-1"
                    style={{ background: "var(--color-level-n4)" }}
                  />
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles
                      className="h-4 w-4"
                      style={{ color: "var(--color-level-n4)" }}
                    />
                    <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted">
                      Contrato pedagógico
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-ink mb-1.5 leading-snug">
                    El tutor no te da la respuesta.
                  </p>
                  <p className="text-sm text-body leading-relaxed mb-3">
                    Te hace preguntas para que llegues vos.
                  </p>
                  <p className="text-xs text-muted leading-relaxed">
                    Empezás vos: contale en qué estás pensando para resolver este ejercicio.
                  </p>
                </div>
              </div>
            )}
            {messages.map((m, i) => {
              const isLastTutor =
                m.role === "tutor" && messages.findLastIndex((mm) => mm.role === "tutor") === i
              const isUser = m.role === "user"
              return (
                <div
                  key={`${m.ts}-${i}`}
                  className={`animate-fade-in-up flex items-start gap-2.5 ${
                    isUser ? "flex-row-reverse" : ""
                  }`}
                >
                  {/* Avatar */}
                  <div
                    aria-hidden="true"
                    className={`shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full ${
                      isUser
                        ? "bg-accent-brand text-white"
                        : "bg-level-n4/10 text-level-n4 border border-level-n4/30"
                    }`}
                    style={!isUser ? { color: "var(--color-level-n4)" } : undefined}
                  >
                    {isUser ? (
                      <User className="h-3.5 w-3.5" />
                    ) : (
                      <Bot className="h-3.5 w-3.5" />
                    )}
                  </div>
                  {/* Burbuja */}
                  <div className={`flex flex-col gap-1 max-w-[80%] ${isUser ? "items-end" : ""}`}>
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted">
                      {isUser ? "Vos" : "Tutor"}
                    </span>
                    <div
                      data-testid={isLastTutor ? "tutor-message-last" : undefined}
                      className={`rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                        isUser
                          ? "bg-accent-brand text-white rounded-tr-sm"
                          : "bg-surface-alt text-body border border-border-soft rounded-tl-sm"
                      }`}
                    >
                      {m.content ||
                        (m.role === "tutor" && streaming ? (
                          <span className="inline-flex gap-1 items-center text-muted">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted animate-pulse-soft" />
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted animate-pulse-soft animate-delay-150" />
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted animate-pulse-soft animate-delay-300" />
                          </span>
                        ) : (
                          ""
                        ))}
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-border-soft p-3 bg-surface-alt/40">
            <div className="flex gap-2 items-end">
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
                placeholder="Escribí tu mensaje · Enter para enviar"
                rows={2}
                disabled={streaming}
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-surface text-ink resize-none focus:outline-none focus:border-accent-brand focus:ring-2 focus:ring-accent-brand/20 transition-all placeholder:text-muted-soft"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={streaming || !input.trim()}
                aria-label="Enviar mensaje"
                className="press-shrink shrink-0 inline-flex items-center justify-center h-[42px] w-[42px] rounded-lg bg-accent-brand text-white hover:bg-accent-brand-deep disabled:bg-border-strong disabled:cursor-not-allowed transition-colors"
              >
                {streaming ? (
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full motion-safe:animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
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

function PanelHeader({
  level,
  label,
  icon,
  colorVar,
  badge,
  badgePulse = false,
}: {
  level: "N1" | "N2" | "N3" | "N4"
  label: string
  icon: React.ReactNode
  colorVar: string
  badge?: string
  badgePulse?: boolean
}) {
  return (
    <div
      data-testid={`section-kicker-${level.toLowerCase()}`}
      className="relative px-4 py-3 border-b border-border-soft bg-surface-alt/40 flex items-center gap-3"
    >
      {/* Banda vertical del color del nivel */}
      <div
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-0.5"
        style={{ backgroundColor: colorVar }}
      />
      <div
        className="inline-flex h-6 w-6 items-center justify-center rounded-md"
        style={{
          backgroundColor: `color-mix(in oklch, ${colorVar} 12%, transparent)`,
          color: colorVar,
        }}
      >
        {icon}
      </div>
      <div className="flex flex-col gap-0 min-w-0 flex-1">
        <span
          className="text-[9px] uppercase tracking-[0.14em] font-semibold leading-none"
          style={{ color: colorVar }}
        >
          {level}
        </span>
        <h2 className="text-sm font-semibold text-ink leading-tight tracking-tight">
          {label}
        </h2>
      </div>
      {badge && (
        <span
          className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface border border-border-soft text-[10px] font-medium text-muted ${
            badgePulse ? "animate-pulse-soft" : ""
          }`}
        >
          {badgePulse && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-success" />
          )}
          {badge}
        </span>
      )}
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
  // Reading time reporter: siempre activo mientras el panel está visible.
  // El toggle open/close del layout viejo de 2-cols ya no aplica — en el
  // layout 3-cols cada panel ocupa su columna entera.
  const enunciadoRef = useReadingTimeReporter(episodeId, episodeId !== null)

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
    <>
      {/* Sub-header con metadata de la TP/ejercicio */}
      <div className="px-4 py-2 border-b border-border-soft bg-surface-alt/40 text-[11px] text-muted font-mono flex items-center justify-between">
        <span className="truncate">{headerLabel}</span>
      </div>
      {/* Contenido scroll fluido — ocupa toda la altura disponible del panel */}
      <div
        ref={enunciadoRef}
        className="flex-1 overflow-y-auto px-5 py-4 text-sm text-body leading-relaxed"
      >
        <MarkdownRenderer content={displayContent} />
      </div>
    </>
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
      color: "bg-green-100 text-green-900",
    },
    apropiacion_superficial: {
      emoji: "🤔",
      label: "Apropiación superficial",
      color: "bg-warning-soft text-warning",
    },
    delegacion_pasiva: {
      emoji: "⚠️",
      label: "Delegación pasiva",
      color: "bg-danger-soft text-danger",
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
        <h3 className="text-sm font-semibold uppercase text-muted mb-3">
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

      <div className="rounded-lg border border-border-soft p-4 mb-6 text-xs text-muted font-mono">
        Hash de configuración del clasificador: {classification.classifier_config_hash.slice(0, 16)}
        ...
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2 bg-accent-brand hover:bg-accent-brand-deep text-white rounded text-sm"
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
    <div className="rounded-lg border border-border-soft p-4 bg-white">
      <h4 className="font-medium text-sm">{title}</h4>
      <p className="text-xs text-muted mt-1 mb-3">{description}</p>
      <Meter value={value} />
      {secondary && (
        <div className="mt-3 pt-3 border-t border-border-soft">
          <p className="text-xs text-muted mb-1">{secondary.label}</p>
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
    return <div className="text-xs text-muted-soft">sin datos</div>
  }
  const pct = Math.round(value * 100)
  const goodHigh = !invertScale
  const isGood = goodHigh ? pct > 60 : pct < 40
  const barColor = isGood ? "bg-success" : pct > 40 && pct < 70 ? "bg-warning" : "bg-danger"
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-mono text-lg">{value.toFixed(2)}</span>
        <span className="text-xs text-muted-soft">{pct}%</span>
      </div>
      <div className="h-2 bg-surface-alt rounded overflow-hidden">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// Default export para retro-compat con `App.tsx` viejo (queda como referencia
// no utilizada cuando main.tsx usa RouterProvider). NO romper si alguien
// importa `EpisodePage`.
export default EpisodeView
