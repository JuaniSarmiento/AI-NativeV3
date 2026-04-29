/**
 * Vista de etiquetado humano — el docente revisa episodios clasificados
 * por el modelo y marca su propio juicio. Al final calcula Kappa inter-rater
 * contra las predicciones del clasificador.
 *
 * Flow:
 *  1. Docente selecciona cohorte
 *  2. Carga N episodios con su clasificación del modelo
 *  3. Por cada episodio, elige su propia etiqueta (3 botones)
 *  4. Al terminar, dispara compute_kappa con (rater_a=modelo, rater_b=humano)
 *  5. Muestra κ + interpretación + matriz de confusión
 */
import { PageContainer } from "@platform/ui"
import { useState } from "react"
import {
  type AppropriationLabel,
  type KappaRating,
  type KappaResult,
  computeKappa,
} from "../lib/api"
import { helpContent } from "../utils/helpContent"

const CATEGORIES: AppropriationLabel[] = [
  "delegacion_pasiva",
  "apropiacion_superficial",
  "apropiacion_reflexiva",
]

const CATEGORY_LABELS: Record<AppropriationLabel, string> = {
  delegacion_pasiva: "Delegación pasiva",
  apropiacion_superficial: "Apropiación superficial",
  apropiacion_reflexiva: "Apropiación reflexiva",
}

const CATEGORY_COLORS: Record<AppropriationLabel, string> = {
  delegacion_pasiva: "bg-red-500 hover:bg-red-600",
  apropiacion_superficial: "bg-amber-500 hover:bg-amber-600",
  apropiacion_reflexiva: "bg-green-600 hover:bg-green-700",
}

interface EpisodeToRate {
  episode_id: string
  classifier_label: AppropriationLabel // predicción del modelo
  summary: string // resumen del episodio (primeras 200 chars de prompts)
}

interface Props {
  getToken: () => Promise<string | null>
  // En producción estos episodes vienen de un endpoint de la cohorte;
  // acá los recibimos como prop para mantener el componente testeable.
  episodes: EpisodeToRate[]
}

export function KappaRatingView({ getToken, episodes }: Props) {
  const [humanLabels, setHumanLabels] = useState<Record<string, AppropriationLabel>>({})
  const [result, setResult] = useState<KappaResult | null>(null)
  const [computing, setComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allLabeled = episodes.every((e) => humanLabels[e.episode_id])
  const labeledCount = Object.keys(humanLabels).length

  const handleLabel = (episodeId: string, label: AppropriationLabel) => {
    setHumanLabels((prev) => ({ ...prev, [episodeId]: label }))
  }

  const handleCompute = async () => {
    setComputing(true)
    setError(null)
    try {
      const ratings: KappaRating[] = episodes.map((e) => {
        const raterB = humanLabels[e.episode_id]
        // Invariante: el botón "Calcular Kappa" sólo se habilita cuando
        // `allLabeled === true`. Si esto falla, hay un bug de UI (race entre
        // re-render y click) — preferimos fallar explícito antes que mandar
        // datos incompletos al backend.
        if (!raterB) {
          throw new Error(`Episodio ${e.episode_id} sin etiqueta humana`)
        }
        return {
          episode_id: e.episode_id,
          rater_a: e.classifier_label,
          rater_b: raterB,
        }
      })
      const r = await computeKappa(ratings, getToken)
      setResult(r)
    } catch (e) {
      setError(String(e))
    } finally {
      setComputing(false)
    }
  }

  const handleReset = () => {
    setHumanLabels({})
    setResult(null)
    setError(null)
  }

  return (
    <PageContainer
      title="Inter-rater agreement (Kappa)"
      description="Compara tu juicio con el del clasificador automatico N4. Target de la tesis: kappa >= 0.6."
      helpContent={helpContent.kappaRating}
    >
      <div className="space-y-6 max-w-5xl">
        {!result && (
          <>
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="text-sm">
                <span className="font-medium">{labeledCount}</span> de{" "}
                <span className="font-medium">{episodes.length}</span> episodios etiquetados
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={labeledCount === 0}
                  className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  Reiniciar
                </button>
                <button
                  type="button"
                  onClick={handleCompute}
                  disabled={!allLabeled || computing}
                  className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded font-medium"
                >
                  {computing ? "Calculando..." : "Calcular Kappa"}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {episodes.map((ep) => {
                const currentLabel = humanLabels[ep.episode_id]
                return (
                  <EpisodeRatingCard
                    key={ep.episode_id}
                    episode={ep}
                    {...(currentLabel ? { currentLabel } : {})}
                    onLabel={(l) => handleLabel(ep.episode_id, l)}
                  />
                )
              })}
            </div>
          </>
        )}

        {error && <div className="p-3 rounded bg-red-50 text-red-900 text-sm">{error}</div>}

        {result && <KappaResultPanel result={result} onReset={handleReset} />}
      </div>
    </PageContainer>
  )
}

function EpisodeRatingCard({
  episode,
  currentLabel,
  onLabel,
}: {
  episode: EpisodeToRate
  currentLabel?: AppropriationLabel
  onLabel: (l: AppropriationLabel) => void
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-slate-500">{episode.episode_id.slice(0, 12)}</div>
          <p className="text-sm mt-1 line-clamp-2">{episode.summary}</p>
        </div>
        <div className="text-xs text-right shrink-0">
          <div className="text-slate-500">Modelo dijo:</div>
          <div className="font-medium">{CATEGORY_LABELS[episode.classifier_label]}</div>
        </div>
      </div>

      <div className="flex gap-2">
        {CATEGORIES.map((cat) => {
          const selected = currentLabel === cat
          return (
            <button
              key={cat}
              type="button"
              onClick={() => onLabel(cat)}
              className={`flex-1 px-3 py-2 rounded text-white text-xs font-medium transition ${CATEGORY_COLORS[cat]} ${
                selected ? "ring-2 ring-offset-2 ring-blue-500" : "opacity-70"
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function KappaResultPanel({
  result,
  onReset,
}: {
  result: KappaResult
  onReset: () => void
}) {
  const { kappa, interpretation, confusion_matrix, per_class_agreement } = result

  const interpretationColor =
    kappa >= 0.81
      ? "text-green-700 bg-green-50"
      : kappa >= 0.61
        ? "text-green-700 bg-green-50"
        : kappa >= 0.41
          ? "text-amber-700 bg-amber-50"
          : "text-red-700 bg-red-50"

  return (
    <div className="space-y-5">
      <div className={`rounded-lg p-6 ${interpretationColor}`}>
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-sm opacity-80">Cohen's Kappa</div>
            <div className="text-5xl font-semibold mt-1">{kappa.toFixed(4)}</div>
          </div>
          <div className="text-right">
            <div className="text-sm opacity-80">Interpretación</div>
            <div className="text-lg font-medium mt-1">{interpretation}</div>
          </div>
        </div>
        <div className="mt-4 text-sm opacity-80">
          Sobre {result.n_episodes} episodios. Acuerdo observado:{" "}
          {(result.observed_agreement * 100).toFixed(1)}%. Esperado por azar:{" "}
          {(result.expected_agreement * 100).toFixed(1)}%.
        </div>
      </div>

      {/* Matriz de confusión */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <h3 className="font-medium mb-3">Matriz de confusión</h3>
        <p className="text-xs text-slate-500 mb-3">
          Filas = etiqueta del modelo · Columnas = etiqueta humana
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="text-left py-2 font-medium"> </th>
              {CATEGORIES.map((c) => (
                <th key={c} className="text-center py-2 font-medium text-xs px-2">
                  {CATEGORY_LABELS[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((row) => (
              <tr key={row} className="border-b border-slate-100 dark:border-slate-800/50">
                <td className="py-2 pr-4 text-xs text-slate-600">{CATEGORY_LABELS[row]}</td>
                {CATEGORIES.map((col) => {
                  const val = confusion_matrix[row]?.[col] ?? 0
                  const isDiagonal = row === col
                  return (
                    <td
                      key={col}
                      className={`text-center py-2 px-2 ${
                        isDiagonal ? "bg-green-50 font-medium" : ""
                      }`}
                    >
                      {val}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-class agreement */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <h3 className="font-medium mb-3">Acuerdo por clase</h3>
        <div className="space-y-2">
          {CATEGORIES.map((c) => {
            const val = per_class_agreement[c] ?? 0
            return (
              <div key={c} className="flex items-center gap-3">
                <div className="min-w-[180px] text-sm">{CATEGORY_LABELS[c]}</div>
                <div className="flex-1 h-3 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                  <div className="h-full bg-blue-500" style={{ width: `${val * 100}%` }} />
                </div>
                <div className="text-xs text-slate-500 min-w-[50px] text-right">
                  {(val * 100).toFixed(1)}%
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="px-4 py-2 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        Clasificar otro batch
      </button>
    </div>
  )
}
