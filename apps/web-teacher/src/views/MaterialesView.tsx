/**
 * Vista de gestión de materiales del curso (RAG).
 *
 * Permite al docente:
 *  - Subir PDFs / Markdown / ZIP / texto plano para indexar en el RAG
 *  - Ver el listado de materiales con su estado de procesamiento
 *  - Eliminar materiales (soft delete)
 *
 * Estado del pipeline (estado del Material):
 *   uploaded → extracting → chunking → embedding → indexed
 *                                                  ↘ failed
 *
 * Para los estados intermedios, polleamos cada 2s al endpoint GET /materiales/{id}
 * hasta que llegue a un estado terminal (indexed | failed). El polling se cancela
 * en cleanup del useEffect cuando el componente se desmonta.
 */
import { HelpButton, PageContainer } from "@platform/ui"
import { useCallback, useEffect, useRef, useState } from "react"
import { useComisionLabel } from "../components/ComisionSelector"
import { type Material, type MaterialEstado, type MaterialTipo, materialesApi } from "../lib/api"
import { helpContent } from "../utils/helpContent"

interface Props {
  comisionId: string
  getToken: () => Promise<string | null>
}

const TERMINAL_STATES: MaterialEstado[] = ["indexed", "failed"]

const TIPO_LABEL: Record<MaterialTipo, string> = {
  pdf: "PDF",
  markdown: "Markdown",
  code_archive: "ZIP",
  text: "Texto",
  video: "Video",
}

const TIPO_COLOR: Record<MaterialTipo, string> = {
  pdf: "bg-red-100 text-red-800 border-red-200",
  markdown: "bg-blue-100 text-blue-800 border-blue-200",
  code_archive: "bg-green-100 text-green-800 border-green-200",
  text: "bg-slate-100 text-slate-800 border-slate-200",
  video: "bg-violet-100 text-violet-800 border-violet-200",
}

const ESTADO_LABEL: Record<MaterialEstado, string> = {
  uploaded: "Subido",
  extracting: "Extrayendo texto",
  chunking: "Particionando",
  embedding: "Embeddings",
  indexed: "Indexado",
  failed: "Error",
}

const ESTADO_COLOR: Record<MaterialEstado, string> = {
  uploaded: "bg-slate-200 text-slate-800",
  extracting: "bg-slate-200 text-slate-800",
  chunking: "bg-slate-200 text-slate-800",
  embedding: "bg-slate-200 text-slate-800",
  indexed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.floor((now - then) / 1000)
  if (diffSec < 60) return "hace unos segundos"
  if (diffSec < 3600) return `hace ${Math.floor(diffSec / 60)} min`
  if (diffSec < 86400) return `hace ${Math.floor(diffSec / 3600)} h`
  if (diffSec < 86400 * 2) return "ayer"
  if (diffSec < 86400 * 7) return `hace ${Math.floor(diffSec / 86400)} días`
  return new Date(iso).toLocaleDateString()
}

export function MaterialesView({ comisionId, getToken }: Props) {
  const comisionLabelText = useComisionLabel(comisionId)
  const [materiales, setMateriales] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Map de id → timeout pendiente de polling. Se limpia en cleanup.
  const pollTimers = useRef<Map<string, number>>(new Map())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refreshList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await materialesApi.list({ comision_id: comisionId }, getToken)
      setMateriales(r.data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [comisionId, getToken])

  useEffect(() => {
    refreshList()
  }, [refreshList])

  // Polling de materiales en estado intermedio.
  useEffect(() => {
    const timers = pollTimers.current

    const pollOne = (id: string) => {
      const tick = async () => {
        try {
          const updated = await materialesApi.get(id, getToken)
          setMateriales((prev) => prev.map((m) => (m.id === id ? updated : m)))
          if (!TERMINAL_STATES.includes(updated.estado)) {
            const handle = window.setTimeout(tick, 2000)
            timers.set(id, handle)
          } else {
            timers.delete(id)
          }
        } catch {
          // Silencio en errores transitorios — el próximo refresh corregirá.
          timers.delete(id)
        }
      }
      const handle = window.setTimeout(tick, 2000)
      timers.set(id, handle)
    }

    for (const m of materiales) {
      if (!TERMINAL_STATES.includes(m.estado) && !timers.has(m.id)) {
        pollOne(m.id)
      }
    }

    return () => {
      // Sólo cleanup en unmount real; los timers en curso siguen vigentes
      // entre re-renders porque el ref es estable.
    }
  }, [materiales, getToken])

  // Cleanup completo al desmontar.
  useEffect(() => {
    const timers = pollTimers.current
    return () => {
      for (const handle of timers.values()) {
        clearTimeout(handle)
      }
      timers.clear()
    }
  }, [])

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      await materialesApi.upload(comisionId, file, getToken)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
      await refreshList()
    } catch (e) {
      const msg = String(e)
      if (msg.includes("413")) {
        setUploadError("El archivo supera el límite de 50 MB.")
      } else {
        setUploadError(msg)
      }
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (m: Material) => {
    const ok = window.confirm(`¿Eliminar el material "${m.nombre}"? El RAG dejará de usarlo.`)
    if (!ok) return
    try {
      await materialesApi.delete(m.id, getToken)
      await refreshList()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <PageContainer
      title="Materiales del curso"
      description={`Corpus del RAG para el tutor socrático. Comisión: ${comisionLabelText}`}
      helpContent={helpContent.materiales}
    >
      <div className="space-y-6 max-w-6xl">
        {/* Upload form */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <HelpButton
              size="sm"
              title="Subir material"
              content={
                <div className="space-y-3 text-zinc-300">
                  <p>
                    <strong>Formatos y limites aceptados</strong>:
                  </p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li>
                      <strong>PDF:</strong> Apuntes, libros, guias de ejercicios.
                    </li>
                    <li>
                      <strong>Markdown (.md):</strong> Documentacion, tutoriales estructurados.
                    </li>
                    <li>
                      <strong>Texto (.txt):</strong> Material de referencia en texto plano.
                    </li>
                    <li>
                      <strong>ZIP:</strong> Archivos de codigo fuente (se indexa el contenido
                      interno).
                    </li>
                    <li>
                      <strong>Tamano maximo:</strong> 50 MB por archivo.
                    </li>
                  </ul>
                </div>
              }
            />
            <h2 className="text-sm font-medium">Subir material nuevo</h2>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.md,.txt,.zip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={uploading}
              className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-slate-300 file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100 file:cursor-pointer"
            />
            {file && (
              <span className="text-xs text-slate-500">
                {file.name} · {formatBytes(file.size)}
              </span>
            )}
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || uploading}
              className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded font-medium"
            >
              {uploading ? "Subiendo..." : "Subir"}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Formatos aceptados: PDF, Markdown (.md), texto (.txt), ZIP de código. Tamaño máximo: 50
            MB por archivo.
          </p>
          {uploadError && (
            <div className="p-2 rounded bg-red-50 text-red-900 text-xs">{uploadError}</div>
          )}
        </div>

        {/* Materials list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Materiales ({materiales.length})</h2>

            <button
              type="button"
              onClick={refreshList}
              disabled={loading}
              className="px-3 py-1 text-xs border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
            >
              {loading ? "Cargando..." : "Refrescar"}
            </button>
          </div>

          {error && <div className="p-3 rounded bg-red-50 text-red-900 text-sm">{error}</div>}

          {loading && materiales.length === 0 ? (
            <div className="p-8 text-center text-slate-500">Cargando materiales...</div>
          ) : materiales.length === 0 ? (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-slate-500">
              No hay materiales subidos para esta comisión todavía.
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Nombre</th>
                    <th className="text-left px-4 py-2 font-medium">Tipo</th>
                    <th className="text-right px-4 py-2 font-medium">Tamaño</th>
                    <th className="text-left px-4 py-2 font-medium">Estado</th>
                    <th className="text-right px-4 py-2 font-medium">Chunks</th>
                    <th className="text-left px-4 py-2 font-medium">Subido</th>
                    <th className="text-right px-4 py-2 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {materiales.map((m) => (
                    <MaterialRow key={m.id} material={m} onDelete={() => handleDelete(m)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  )
}

function MaterialRow({
  material,
  onDelete,
}: {
  material: Material
  onDelete: () => void
}) {
  const tipo = material.tipo
  const estado = material.estado
  const isProcessing = !TERMINAL_STATES.includes(estado)

  return (
    <tr className="border-b border-slate-100 dark:border-slate-800/50 last:border-0">
      <td className="px-4 py-2">
        <div className="font-medium truncate max-w-xs" title={material.nombre}>
          {material.nombre}
        </div>
        {material.error_message && (
          <div
            className="text-xs text-[var(--color-danger)] mt-0.5 truncate max-w-xs"
            title={material.error_message}
          >
            {material.error_message}
          </div>
        )}
      </td>
      <td className="px-4 py-2">
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${TIPO_COLOR[tipo]}`}
        >
          {TIPO_LABEL[tipo]}
        </span>
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-slate-600">
        {formatBytes(material.tamano_bytes)}
      </td>
      <td className="px-4 py-2">
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ESTADO_COLOR[estado]} ${
            isProcessing ? "animate-pulse" : ""
          }`}
        >
          {ESTADO_LABEL[estado]}
        </span>
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-slate-600">
        {material.chunks_count ?? "—"}
      </td>
      <td className="px-4 py-2 text-xs text-slate-500" title={material.created_at}>
        {formatRelative(material.created_at)}
      </td>
      <td className="px-4 py-2 text-right">
        <button
          type="button"
          onClick={onDelete}
          className="px-2 py-1 text-xs text-red-700 hover:bg-red-50 rounded"
        >
          Eliminar
        </button>
      </td>
    </tr>
  )
}
