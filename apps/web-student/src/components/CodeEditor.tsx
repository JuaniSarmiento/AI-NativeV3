/**
 * Editor de código con Monaco + ejecución Python en Pyodide.
 *
 * Pyodide corre Python completo en el navegador vía WebAssembly. Se
 * carga desde CDN la primera vez (~6 MB) y queda cacheado.
 *
 * Ventajas respecto a ejecución backend:
 *  - Cero costo por ejecución (no consume budget de LLM ni infra)
 *  - Cero riesgo de abuso (cada alumno tiene su propia VM en el browser)
 *  - Latencia mínima tras el primer load
 *
 * Limitaciones:
 *  - Network calls bloqueadas (Pyodide corre en worker aislado)
 *  - Stdlib completa, pero paquetes PyPI requieren micropip
 *  - Ejecución sincrónica; para loops largos el navegador se cuelga
 */
import { type ReactNode, useEffect, useRef, useState } from "react"

type PyodideAPI = {
  runPythonAsync(code: string): Promise<unknown>
  setStdout(opts: { batched: (text: string) => void }): void
  setStderr(opts: { batched: (text: string) => void }): void
}

type PyodideLoader = (options?: { indexURL?: string }) => Promise<PyodideAPI>

declare global {
  interface Window {
    loadPyodide?: PyodideLoader
  }
}

const PYODIDE_VERSION = "0.26.3"
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`


export interface CodeEditorProps {
  initialCode?: string
  onCodeExecuted?: (result: { code: string; output: string; error: string | null; durationMs: number }) => void
  language?: "python"  // en F6+ extendible a más lenguajes
}


export function CodeEditor({
  initialCode = "# Escribí tu código Python acá\n\ndef factorial(n):\n    pass\n",
  onCodeExecuted,
  language = "python",
}: CodeEditorProps): ReactNode {
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<any>(null)
  const pyodideRef = useRef<PyodideAPI | null>(null)

  const [code, setCode] = useState(initialCode)
  const [output, setOutput] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  // 1. Cargar Monaco dinámicamente (evita tamaño inicial del bundle)
  useEffect(() => {
    if (!editorContainerRef.current) return
    if (editorRef.current) return  // ya cargado

    let disposed = false
    ;(async () => {
      const monaco = await import(/* @vite-ignore */ "monaco-editor")
      if (disposed || !editorContainerRef.current) return

      const editor = monaco.editor.create(editorContainerRef.current, {
        value: code,
        language,
        theme: "vs-dark",
        fontSize: 14,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        renderWhitespace: "selection",
        tabSize: 4,
        insertSpaces: true,
      })

      editor.onDidChangeModelContent(() => {
        setCode(editor.getValue())
      })

      editorRef.current = editor
    })()

    return () => {
      disposed = true
      editorRef.current?.dispose?.()
    }
  }, [language])

  // 2. Cargar Pyodide en background (solo Python)
  useEffect(() => {
    if (language !== "python") {
      setLoading(false)
      return
    }
    if (pyodideRef.current) {
      setLoading(false)
      return
    }

    let cancelled = false
    ;(async () => {
      if (!window.loadPyodide) {
        // Inyectar el script de Pyodide del CDN
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script")
          script.src = `${PYODIDE_URL}pyodide.js`
          script.onload = () => resolve()
          script.onerror = () => reject(new Error("Failed to load Pyodide"))
          document.head.appendChild(script)
        })
      }

      if (cancelled || !window.loadPyodide) return
      const py = await window.loadPyodide({ indexURL: PYODIDE_URL })
      if (cancelled) return

      // Capturar stdout/stderr
      py.setStdout({
        batched: (text: string) => setOutput((prev) => prev + text),
      })
      py.setStderr({
        batched: (text: string) => setOutput((prev) => prev + text),
      })

      pyodideRef.current = py
      setLoading(false)
    })().catch((e: unknown) => {
      if (!cancelled) {
        setError(`Error cargando Pyodide: ${String(e)}`)
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [language])


  const runCode = async () => {
    if (!pyodideRef.current || running) return
    setRunning(true)
    setOutput("")
    setError(null)
    const started = performance.now()

    try {
      await pyodideRef.current.runPythonAsync(code)
      const elapsed = performance.now() - started
      onCodeExecuted?.({ code, output, error: null, durationMs: elapsed })
    } catch (e) {
      const errMsg = String(e)
      setError(errMsg)
      const elapsed = performance.now() - started
      onCodeExecuted?.({ code, output, error: errMsg, durationMs: elapsed })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-2">
        <h2 className="text-sm font-medium">Código ({language})</h2>
        <button
          type="button"
          onClick={runCode}
          disabled={loading || running}
          className="px-3 py-1 text-xs rounded bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white font-medium"
        >
          {loading ? "Cargando Python..." : running ? "Ejecutando..." : "▶ Ejecutar"}
        </button>
      </div>

      <div ref={editorContainerRef} className="flex-1 min-h-[200px]" />

      <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100 font-mono text-xs p-3 min-h-[100px] max-h-[200px] overflow-y-auto">
        {output && <pre className="whitespace-pre-wrap">{output}</pre>}
        {error && (
          <pre className="whitespace-pre-wrap text-red-400">{error}</pre>
        )}
        {!output && !error && !running && (
          <span className="text-slate-500">
            {loading
              ? "Cargando runtime Python en el navegador (primera vez ~6 MB)..."
              : "Presioná Ejecutar para correr el código."}
          </span>
        )}
      </div>
    </div>
  )
}
