import type { WeightingLevel } from '@prisma/client'

/**
 * Peso de cada criterio en el ponderado. La suma es 1, y el resultado vive siempre entre 1 y 5
 * porque la escala va de MUY_BAJO (1) a MUY_ALTO (5). Estos pesos son la fuente de verdad: el
 * cliente nunca los envía ni los ve, solo elige el nivel de cada criterio.
 */
export const WEIGHTING_CRITERIA = {
  impactoEstrategico: 0.2,
  viabilidad: 0.25,
  urgencia: 0.2,
  sinergiaInterna: 0.15,
  impactoReputacional: 0.2,
} as const

export type WeightingCriteria = { [K in keyof typeof WEIGHTING_CRITERIA]: WeightingLevel }

/** Escala de la metodología. Se mantiene aquí para que el cliente no tenga que conocer los números. */
export const WEIGHTING_LEVEL_SCORE: Record<WeightingLevel, number> = {
  MUY_BAJO: 1,
  BAJO: 2,
  MEDIO: 3,
  ALTO: 4,
  MUY_ALTO: 5,
}

const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Ponderado de una estrategia a partir de sus cinco criterios. Es una función pura y sin IA: la
 * misma entrada siempre produce el mismo número, y la entrada solo puede ser un nivel de la escala.
 */
export const calculateWeightedScore = (criteria: WeightingCriteria): number => {
  const total = (Object.keys(WEIGHTING_CRITERIA) as Array<keyof WeightingCriteria>)
    .reduce((sum, criterion) => sum + WEIGHTING_LEVEL_SCORE[criteria[criterion]] * WEIGHTING_CRITERIA[criterion], 0)
  return round2(total)
}
