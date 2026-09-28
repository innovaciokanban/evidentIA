import { createHash } from 'node:crypto'
import type { StrategySource, WeightingLevel } from '@prisma/client'
import { resolveWeightingBand, type CheckyWeightingBand } from './ai-service.js'
import { calculateWeightedScore, type WeightingCriteria } from './weighting-service.js'

/**
 * Fuentes que se pueden ponderar sin ser un cruce. Deliberadamente no incluye STRATEGIC_CROSS: los
 * cruces siguen pesándose en StrategicCrossWeighting a través de PUT /api/crosses/:id/weighting, y
 * esta tabla no lo reemplaza ni lo duplica.
 */
export const WEIGHTABLE_STRATEGY_SOURCES = ['AI_ANALYSIS', 'CHECKY'] as const
export type WeightableStrategySource = (typeof WEIGHTABLE_STRATEGY_SOURCES)[number]

export const isWeightableStrategySource = (value: unknown): value is WeightableStrategySource =>
  typeof value === 'string' && (WEIGHTABLE_STRATEGY_SOURCES as readonly string[]).includes(value)

/** Fuentes que la API admite en el cuerpo de la ponderación, en el mismo orden del enum de Prisma. */
export const STRATEGY_WEIGHTING_SOURCE_VALUES: StrategySource[] = ['AI_ANALYSIS', 'CHECKY']

/**
 * Forma única de comparar dos textos de estrategia. Es la misma clave que usa la consolidación para
 * no repetir una estrategia, a propósito: si la clave de deduplicar y la de ponderar fueran
 * distintas, un ponderado podría quedar pegado a un texto que ya no es el que se compara.
 * Solo normaliza: no reescribe, no resume y no ordena palabras.
 */
export const normalizeStrategyText = (description: string): string => description.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Ancla estable de una estrategia: SHA-256 del texto normalizado. Es un hash del contenido y no un
 * índice de posición, así que la misma estrategia produce el mismo sourceRef aunque se repita en
 * otra fila del análisis con IA, se acepte desde otra sesión de Checky o cambie de fuente. Si el
 * texto cambia de verdad, el ponderado deja de encontrar coincidencia y la estrategia vuelve a estar
 * sin valorar, que es la semántica correcta: se ponderó otra estrategia.
 */
export const strategySourceRef = (description: string): string => createHash('sha256').update(normalizeStrategyText(description), 'utf8').digest('hex')

/** Los cinco niveles y el ponderado guardado: la forma común de las tres fuentes. */
export type StrategyWeightingCriteria = {
  impactoEstrategico: WeightingLevel
  viabilidad: WeightingLevel
  urgencia: WeightingLevel
  sinergiaInterna: WeightingLevel
  impactoReputacional: WeightingLevel
  weightedScore: number
}

/** Criterios tal como los guarda la base, con la fila que los respalda para el cruce. */
export type StoredWeighting = StrategyWeightingCriteria

/** Ponderación guardada de IA o Checky: los criterios más su ancla. */
export type StoredStrategyWeighting = StrategyWeightingCriteria & {
  source: StrategySource
  sourceRef: string
}

/**
 * Lo que ve el cliente de una ponderación guardada: los cinco niveles, el ponderado y la banda. La
 * banda se deduce con el mismo resolveWeightingBand que usan los cruces y Checky, nunca se guarda.
 *
 * Se nombran los campos uno por uno en vez de extender la fila: así ni el id de la fila ni su
 * sourceRef se filtran al cliente, y las tres fuentes devuelven exactamente la misma forma.
 */
export type StrategyWeightingView = StrategyWeightingCriteria & { weightingBand: CheckyWeightingBand }

/**
 * Convierte cualquier ponderación guardada en la vista del cliente, sea de cruce, de IA o de Checky.
 * weightedScore se copia sin recalcularlo: el ponderado es histórico y volver a calcularlo aquí solo
 * serviría para contradecir a la base.
 */
export const strategyWeightingView = (weighting: StrategyWeightingCriteria): StrategyWeightingView => ({
  impactoEstrategico: weighting.impactoEstrategico,
  viabilidad: weighting.viabilidad,
  urgencia: weighting.urgencia,
  sinergiaInterna: weighting.sinergiaInterna,
  impactoReputacional: weighting.impactoReputacional,
  weightedScore: weighting.weightedScore,
  weightingBand: resolveWeightingBand(weighting.weightedScore),
})

/**
 * Datos que se escriben al guardar. El ponderado se calcula aquí y no se lee del cuerpo: el cliente
 * solo elige niveles. Delega en calculateWeightedScore para que los pesos de la metodología
 * (20/25/20/15/20) vivan en un solo sitio; si esta función los repitiera, un cambio de peso tendría
 * que hacerse dos veces y una de las dos quedaría vieja.
 */
export const strategyWeightingUpsertData = (criteria: WeightingCriteria, createdById: string) => ({
  ...criteria,
  weightedScore: calculateWeightedScore(criteria),
  createdById,
})

/**
 * Índice de lectura para la consolidación: sourceRef → ponderación guardada. La clave es el hash del
 * texto, no el id de fila, y no lleva el diagnóstico porque la consulta que lo arma ya viene acotada
 * a uno solo.
 */
export const indexStrategyWeightings = (weightings: StoredStrategyWeighting[]): Map<string, StoredStrategyWeighting> =>
  new Map(weightings.map((weighting) => [weighting.sourceRef, weighting]))
