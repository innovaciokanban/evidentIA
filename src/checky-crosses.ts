import type { CheckyMessage, CheckySuggestionStatus, CrossOrigin, CrossType, StrategicCross, StrategySource, SWOTType } from './types'

/**
 * Toda estrategia que llega a Ponderación se valora en su tarjeta: la que propuso la IA, la que
 * aceptó Checky y la de un cruce aceptado. El origen (quién creó el cruce, USER o IA) no participa
 * en la decisión: solo dice de dónde vino, nunca si se puede valorar.
 */
export const isWeightableStrategySource = (source: StrategySource): boolean =>
  source === 'AI_ANALYSIS' || source === 'CHECKY' || source === 'STRATEGIC_CROSS'

/**
 * Regla de pareja DOFA en la capa de lectura: los únicos cruces válidos son FO, FA, DO y DA, es
 * decir un factor interno (fortaleza o debilidad) con uno externo (oportunidad o amenaza), siempre
 * distintos. Es la misma tabla que usa la matriz para decidir si se puede soltar un factor sobre
 * otro, y por eso vive aquí y no duplicada dentro de la sección de Checky.
 */
export function crossTypeForPair(a: SWOTType, b: SWOTType): CrossType | null {
  if (a === b) return null
  const pair = [a, b].sort().join(':')
  const matrix: Record<string, CrossType> = { 'OPPORTUNITY:STRENGTH': 'FO', 'STRENGTH:THREAT': 'FA', 'OPPORTUNITY:WEAKNESS': 'DO', 'THREAT:WEAKNESS': 'DA' }
  return matrix[pair] ?? null
}

export function isCompatibleCrossPair(a: SWOTType, b: SWOTType): boolean { return crossTypeForPair(a, b) !== null }

/** Texto de estrategia listo para comparar: la misma normalización que usa el servidor para el
 *  ancla y para no repetir una estrategia. Solo recorta, colapsa espacios y pasa a minúsculas. */
export const normalizeStrategyText = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase()

const hasText = (value: string | null | undefined): value is string => typeof value === 'string' && value.trim().length > 0

/** Origen tal como se lee en esta sección: la procedencia del cruce, nunca una calidad. */
export const crossStrategyOriginLabels: Record<CrossOrigin, string> = { USER: 'Usuario', AI: 'IA / Checky', BOTH: 'Usuario + IA' }

const decidedLabels: Record<CheckySuggestionStatus, string | null> = { PENDING: null, ACCEPTED: 'Aceptada', REJECTED: 'Rechazada' }

/**
 * Una estrategia dentro de la tarjeta de su cruce. `owner` dice desde qué flujo se decide: la
 * estrategia del propio cruce se acepta con el estado del cruce, y la propuesta de Checky con el
 * flujo de sugerencias que ya existe (que reutiliza el cruce y nunca crea otro).
 *
 * `acceptLabel` solo existe mientras no se ha decidido, que es lo que hace que la tarjeta deje de
 * ofrecer "Aceptar estrategia" en cuanto se acepta, sin recargar nada.
 */
export type CrossStrategyBlock = {
  key: string
  owner: 'CROSS' | 'CHECKY'
  messageId: string | null
  crossId: string
  title: string | null
  description: string
  status: CheckySuggestionStatus
  acceptLabel: string | null
  decidedLabel: string | null
}

export type CrossStrategyEntry = {
  cross: StrategicCross
  /** Par validado contra la matriz, que es el que se pinta como chip DOFA. */
  crossType: CrossType
  group: 'user' | 'ai'
  originLabel: string
  blocks: CrossStrategyBlock[]
}

const blockOf = (input: Omit<CrossStrategyBlock, 'acceptLabel' | 'decidedLabel'>): CrossStrategyBlock => ({
  ...input,
  acceptLabel: input.status === 'PENDING' ? 'Aceptar estrategia' : null,
  decidedLabel: decidedLabels[input.status],
})

/**
 * Decide el estado que se lee para una misma estrategia vista desde el cruce y desde la propuesta
 * de Checky: si cualquiera de los dos la aceptó, está aceptada, y solo se queda pendiente cuando
 * ninguna de las dos partes se ha pronunciado. Así una estrategia no puede aparecer aceptada en un
 * sitio y pendiente en otro dentro de la misma tarjeta.
 */
const mergeStatus = (crossStatus: CheckySuggestionStatus | null, suggestionStatus: CheckySuggestionStatus | null): CheckySuggestionStatus => {
  const statuses = [crossStatus, suggestionStatus]
  if (statuses.includes('ACCEPTED')) return 'ACCEPTED'
  if (statuses.includes('REJECTED')) return 'REJECTED'
  return 'PENDING'
}

/** Ids de factor que sostiene una sugerencia, desdoblando el id de un cruce en sus dos factores. */
const factorIdsOf = (suggestion: CheckyMessage, crosses: StrategicCross[]): Set<string> => {
  const ids = new Set<string>()
  for (const evidenceId of suggestion.evidenceIds) {
    const cross = crosses.find((candidate) => candidate.id === evidenceId)
    if (cross) {
      ids.add(cross.factor1.id)
      ids.add(cross.factor2.id)
      continue
    }
    ids.add(evidenceId)
  }
  return ids
}

/**
 * Reparte los cruces de la matriz y las propuestas de Checky en una sola tarjeta por cruce.
 *
 * - Un cruce sin pareja DOFA válida no entra nunca: no hay estrategia aceptable que mostrar.
 * - Un cruce entra solo si tiene estrategia escrita o si Checky le propuso una.
 * - Las propuestas de Checky que ya tienen su cruce en la matriz se leen dentro de la tarjeta de
 *   ese cruce y salen de la lista de sugerencias (`hiddenSuggestionIds`), de modo que el mismo
 *   cruce no aparece dos veces ni la misma estrategia figura aceptada en un sitio y pendiente en
 *   otro.
 * - Si la propuesta de Checky es literalmente la estrategia del cruce, se pinta una sola vez y con
 *   el estado resultante de ambas decisiones.
 *
 * Devuelve también los ids de sugerencia que ya están pintadas dentro de una tarjeta, para que el
 * resto de la pantalla no las vuelva a mostrar.
 */
export function buildCrossStrategyEntries(
  crosses: StrategicCross[],
  suggestions: readonly CheckyMessage[],
): { entries: CrossStrategyEntry[]; hiddenSuggestionIds: Set<string> } {
  const entries: CrossStrategyEntry[] = []
  const hiddenSuggestionIds = new Set<string>()
  const proposals = suggestions.filter((suggestion) => suggestion.role === 'CHECKY' && hasText(suggestion.suggestedStrategyDescription))

  for (const cross of crosses) {
    const crossType = crossTypeForPair(cross.factor1.type, cross.factor2.type)
    if (!crossType) continue
    const matched = proposals.filter((proposal) => {
      const factorIds = factorIdsOf(proposal, crosses)
      return factorIds.has(cross.factor1.id) && factorIds.has(cross.factor2.id)
    })
    const crossText = cross.strategy ?? ''
    const blocks: CrossStrategyBlock[] = []
    const seen = new Set<string>()

    if (hasText(crossText)) {
      const crossKey = normalizeStrategyText(crossText)
      // Si Checky propuso exactamente este texto, la tarjeta lo pinta una sola vez y desde el
      // flujo de sugerencias, que es el que ya sabe reutilizar el cruce sin duplicarlo: aquí la
      // clave queda sin reclamar para que la propuesta pueda ocupar su hueco.
      const repeated = matched.some((proposal) => normalizeStrategyText(proposal.suggestedStrategyDescription!) === crossKey)
      if (!repeated) {
        seen.add(crossKey)
        blocks.push(blockOf({ key: `cross:${cross.id}`, owner: 'CROSS', messageId: null, crossId: cross.id, title: null, description: crossText, status: cross.strategyStatus ?? 'PENDING' }))
      }
    }

    for (const proposal of matched) {
      const proposalKey = normalizeStrategyText(proposal.suggestedStrategyDescription!)
      if (seen.has(proposalKey)) continue
      seen.add(proposalKey)
      const sameTextAsCross = hasText(crossText) && normalizeStrategyText(crossText) === proposalKey
      blocks.push(blockOf({
        key: `checky:${proposal.id}`,
        owner: 'CHECKY',
        messageId: proposal.id,
        crossId: cross.id,
        title: proposal.suggestedStrategyTitle,
        description: proposal.suggestedStrategyDescription!,
        status: sameTextAsCross ? mergeStatus(cross.strategyStatus, proposal.status) : proposal.status ?? 'PENDING',
      }))
      hiddenSuggestionIds.add(proposal.id)
    }

    if (blocks.length === 0) continue
    entries.push({
      cross,
      crossType,
      group: cross.origin === 'AI' ? 'ai' : 'user',
      originLabel: crossStrategyOriginLabels[cross.origin],
      blocks,
    })
  }

  return { entries, hiddenSuggestionIds }
}

/** Los dos grupos de la sección, en el mismo orden en que los lee la persona. */
export const crossStrategyGroupLabels: Record<CrossStrategyEntry['group'], { title: string; note: string }> = {
  user: { title: 'Cruces creados por el usuario', note: 'Los que combinaste en la matriz DOFA. Al aceptar su estrategia pasa a Ponderación.' },
  ai: { title: 'Cruces sugeridos por IA / Checky', note: 'Los que propuso la IA o Checky a partir de tus factores. Al aceptar su estrategia pasa a Ponderación.' },
}
