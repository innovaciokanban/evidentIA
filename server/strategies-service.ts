import type { CrossOrigin, CrossType } from '@prisma/client'
import type { CheckyWeightingBand } from './ai-service.js'
import { normalizeStrategyText, strategySourceRef, strategyWeightingView, type StoredStrategyWeighting, type StoredWeighting, type StrategyWeightingView } from './strategy-weighting-service.js'

export type { StrategyWeightingView, StoredWeighting }

/**
 * Fuentes de una estrategia para la priorización. El orden declara la precedencia cuando el mismo
 * texto aparece en más de una: gana el cruce, porque es el único con ponderación y con sus dos
 * factores, y su texto es el que el usuario escribió o aceptó.
 *
 * Solo AI_ANALYSIS y CHECKY son ponderables aquí: el cruce conserva su contrato de siempre y sigue
 * pesándose en StrategicCrossWeighting.
 */
export const STRATEGY_SOURCES = ['AI_ANALYSIS', 'STRATEGIC_CROSS', 'CHECKY'] as const
export type StrategySource = (typeof STRATEGY_SOURCES)[number]

/** Cuadrantes en el orden en que los devuelve el análisis con IA. */
export const AI_STRATEGY_QUADRANTS = ['FO', 'DO', 'FA', 'DA'] as const

export type StrategyFactor = { id: string; type: string; description: string }

export type StrategyTaskPlan = {
  id: string
  strategySource: string | null
  strategySourceRef: string | null
  strategyTitle: string | null
  strategyDescription: string | null
  items: Array<{
    id: string
    title: string
    responsibleId: string | null
    responsible: { id: string; name: string } | null
    dueDate: Date | null
    ticket: { id: string; status: string } | null
  }>
}

/** Criterios tal como los guarda la base, con la fila que los respalda para el cruce. */

/**
 * Ponderación tal como se le entrega al cliente: los cinco niveles, el ponderado guardado y la banda
 * deducida de ese número. Es la misma forma para las tres fuentes, para que la pantalla de
 * priorización no tenga que preguntar de dónde salió cada una. El cliente solo la lee: nunca la
 * envía ni la recalcula. La define strategy-weighting-service para que el cruce y la estrategia nueva
 * no puedan divergir.
 */

/**
 * Una estrategia consolidada, lista para que la pantalla de priorización la ordene y la compare.
 * weightedScore y weightingBand se copian de la ponderación guardada y la banda se deduce con el
 * mismo resolveWeightingBand que ya usa Checky, nunca se calcula aquí.
 */
export type StrategyForPrioritization = {
  id: string
  title: string
  description: string
  source: StrategySource
  crossId: string | null
  crossType: CrossType | null
  origin: CrossOrigin | null
  factor1: StrategyFactor | null
  factor2: StrategyFactor | null
  weighting: StrategyWeightingView | null
  weightedScore: number | null
  weightingBand: CheckyWeightingBand | null
  actionPlan?: StrategyTaskPlan | null
}

/** Crucetype con su ponderación incluida, tal como lo devuelve la consulta que arma el contexto. */
export type CrossStrategySource = {
  id: string
  crossType: CrossType
  origin: CrossOrigin
  factor1: StrategyFactor
  factor2: StrategyFactor
  strategy: string | null
  weighting: (StoredWeighting & { id: string; crossId: string }) | null
}
/** Una estrategia del análisis con IA: texto plano dentro de su cuadrante, sin cruce asociado. */
export type AiStrategySource = { analysisId: string; quadrant: CrossType; index: number; text: string }

/** Sugerencia de Checky aceptada. factors ya viene resuelta y acotada a este diagnóstico. */
export type CheckyStrategySource = {
  messageId: string
  category: string
  evidenceIds: string[]
  title: string | null
  description: string | null
  factors: StrategyFactor[]
}

export type StrategySources = {
  crosses: CrossStrategySource[]
  aiStrategies: AiStrategySource[]
  checkySuggestions: CheckyStrategySource[]
  /**
   * Ponderacion necesita conservar como CHECKY las sugerencias MISSING_CROSSES aceptadas. La
   * consolidacion normal no lo activa porque el cruce DOFA relacionado conserva precedencia alli.
   */
  includeMissingCrossStrategies?: boolean
  /**
   * Ponderaciones de AI_ANALYSIS y CHECKY ya filtradas por diagnóstico, indexadas por sourceRef.
   * Es opcional para que la consolidación siga siendo usable sin leer la tabla: sin él, esas
   * estrategias salen con weighting null, que es lo correcto para un diagnóstico todavía sin valorar.
   */
  weightings?: Map<string, StoredStrategyWeighting>
}

const TITLE_LIMIT = 90

/**
 * Las estrategias de IA y las de un cruce son texto plano, sin campo de título. El título es una
 * proyección determinista de ese mismo texto: nunca se escribe ni se resume nada nuevo.
 */
export const strategyTitleFromText = (text: string, limit = TITLE_LIMIT): string => {
  const firstLine = text.split('\n')[0]?.trim() ?? text.trim()
  if (firstLine.length <= limit) return firstLine
  const sentenceEnd = firstLine.search(/[.!?](?=\s|$)/)
  if (sentenceEnd > 0 && sentenceEnd + 1 <= limit) return firstLine.slice(0, sentenceEnd + 1)
  const cut = firstLine.lastIndexOf(' ', limit)
  return `${(cut > 0 ? firstLine.slice(0, cut) : firstLine.slice(0, limit)).trimEnd()}…`
}

/**
 * Clave de duplicado exacto: el texto normalizado de la estrategia. No se compara significado ni se
 * busca similitud, a propósito: dos estrategias parecidas pero distintas son dos estrategias, y la
 * priorización debe verlas separadas. Comparte la normalización con la del ponderado para que la
 * clave de deduplicar y la de ancla no puedan divergir.
 */
const duplicateKey = (description: string) => normalizeStrategyText(description)

/** Extrae los textos de una columna Json del análisis con IA, tolerante a datos antiguos. */
export const readAiStrategyTexts = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
}

/**
 * Reúne las tres fuentes en una sola lista. Es una función pura: no lee la base de datos, no calcula
 * ponderados y no escribe nada. Los ids son sintéticos y estables por origen, así una estrategia
 * conserva su trazabilidad aunque cambie el orden de la lista.
 */
export const collectStrategies = (sources: StrategySources): StrategyForPrioritization[] => {
  const collected: StrategyForPrioritization[] = []
  const seen = new Set<string>()
  const storedWeightings = sources.weightings ?? new Map<string, StoredStrategyWeighting>()
  /**
   * El cruce conserva su ponderación de siempre. IA y Checky la buscan por su ancla de contenido en
   * la tabla de estrategias, y si no hay fila se quedan en null en vez de inventar una nota.
   */
  const weightOf = (description: string): StrategyWeightingView | null => {
    const stored = storedWeightings.get(strategySourceRef(description))
    return stored ? strategyWeightingView(stored) : null
  }
  const push = (strategy: StrategyForPrioritization) => {
    const key = duplicateKey(strategy.description)
    if (seen.has(key)) return
    seen.add(key)
    collected.push(strategy)
  }

  for (const cross of sources.crosses) {
    const description = cross.strategy?.trim() ?? ''
    if (!description) continue
    const weighting = cross.weighting ? strategyWeightingView(cross.weighting) : null
    push({
      id: `cross:${cross.id}`,
      title: strategyTitleFromText(description),
      description,
      source: 'STRATEGIC_CROSS',
      crossId: cross.id,
      crossType: cross.crossType,
      origin: cross.origin,
      factor1: cross.factor1,
      factor2: cross.factor2,
      weighting,
      weightedScore: weighting?.weightedScore ?? null,
      weightingBand: weighting?.weightingBand ?? null,
    })
  }

  for (const entry of sources.aiStrategies) {
    const description = entry.text.trim()
    if (!description) continue
    const weighting = weightOf(description)
    push({
      id: `ai:${entry.analysisId}:${entry.quadrant}:${entry.index}`,
      title: strategyTitleFromText(description),
      description,
      source: 'AI_ANALYSIS',
      crossId: null,
      crossType: entry.quadrant,
      origin: null,
      factor1: null,
      factor2: null,
      weighting,
      weightedScore: weighting?.weightedScore ?? null,
      weightingBand: weighting?.weightingBand ?? null,
    })
  }

  for (const suggestion of sources.checkySuggestions) {
    // Una sugerencia MISSING_CROSSES aceptada ya se materializó como StrategicCross con ese mismo
    // texto, así que entra por la fuente de cruces en la consolidación normal. Ponderación activa
    // includeMissingCrossStrategies para conservar la aceptación explícita de Checky como CHECKY.
    if (suggestion.category === 'MISSING_CROSSES' && !sources.includeMissingCrossStrategies) continue
    const description = suggestion.description?.trim() ?? ''
    if (!description) continue
    const factors = suggestion.factors.slice(0, 2)
    const weighting = weightOf(description)
    push({
      id: `checky:${suggestion.messageId}`,
      title: suggestion.title?.trim() || strategyTitleFromText(description),
      description,
      source: 'CHECKY',
      crossId: null,
      crossType: null,
      origin: null,
      factor1: factors[0] ?? null,
      factor2: factors[1] ?? null,
      weighting,
      weightedScore: weighting?.weightedScore ?? null,
      weightingBand: weighting?.weightingBand ?? null,
    })
  }

  return collected
}
