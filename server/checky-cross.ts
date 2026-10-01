import { crossTypeFor } from './validation.js'

/**
 * Regla de negocio de Checky: la Matriz DOFA (StrategicCross) es la fuente de verdad. Una sugerencia
 * solo puede ser estrategia si detrás hay una pareja DOFA válida entre DOS factores reales del
 * diagnóstico. Los únicos cruces válidos son FO (Fortaleza + Oportunidad), FA (Fortaleza + Amenaza),
 * DO (Debilidad + Oportunidad) y DA (Debilidad + Amenaza).
 *
 * La pareja se resuelve en este orden, siempre contra los SWOTItem y los StrategicCross reales que
 * entrega la ruta, nunca contra el texto de la IA:
 *  A. un evidenceId que es un StrategicCross: se valida que exista y que sus dos factores formen un
 *     cruce permitido → esa pareja es la de ese cruce.
 *  B. sin cruce citado, exactamente dos evidenceIds que son factores distintos del diagnóstico.
 *  C. ids que no son factores se intentan resolver contra StrategicCross existentes.
 *  D. dos factores reales compatibles sin cruce previo: la pareja se construye y Checky puede
 *     proponer ese cruce nuevo.
 *  E. sin pareja válida: null. La sugerencia se descarta; jamás se persiste, nunca llega a tarjeta y
 *     nunca se muestra "POSIBLE CRUCE NO EXPLORADO".
 *
 * Aplica a las sugerencias que pretenden ser estrategia: las de la categoría MISSING_CROSSES y las
 * que traen un suggestedStrategy completo. Un hallazgo informativo sin pareja (una observación con
 * evidence vacío, por ejemplo) no es una estrategia: no tiene estrategia que proponer, no puede
 * llegar a Ponderación y por eso no se le exige pareja.
 */

export type CheckyFactorRef = { id: string; type: string; description?: string | null }
export type CheckyCrossRef = { id: string; factor1Id: string; factor2Id: string }
export type CheckyCrossType = 'FO' | 'FA' | 'DO' | 'DA'

/** La pareja DOFA ya validada, con el factor interno primero, igual que la guarda StrategicCross. */
export type CheckyCrossPair = {
  factor1Id: string
  factor2Id: string
  crossType: CheckyCrossType
  factor1: CheckyFactorRef
  factor2: CheckyFactorRef
  /**
   * StrategicCross existente que corresponde a esta pareja, si lo hay: ya sea porque la sugerencia lo
   * citó o porque la pareja coincide con un cruce de la matriz. La aceptación reutiliza ese cruce en
   * vez de crear otro.
   */
  crossId: string | null
}

/**
 * Forma común entre un hallazgo recién devuelto por el modelo (category, evidenceIds y
 * suggestedStrategy) y una fila ya persistida de CheckyMessage (suggestedStrategyTitle y
 * suggestedStrategyDescription). Ambas representan lo mismo para esta regla.
 */
export type CheckySuggestionInput = {
  category?: string | null
  evidenceIds?: readonly string[] | null
  suggestedStrategy?: { title?: string | null; description?: string | null } | null
  suggestedStrategyTitle?: string | null
  suggestedStrategyDescription?: string | null
}

type CheckySuggestionSnapshot = { category: string | null; evidenceIds: string[]; strategyTitle: string | null; strategyDescription: string | null }

const snapshotOf = (suggestion: CheckySuggestionInput): CheckySuggestionSnapshot => ({
  category: suggestion.category ?? null,
  evidenceIds: [...(suggestion.evidenceIds ?? [])],
  strategyTitle: suggestion.suggestedStrategy?.title ?? suggestion.suggestedStrategyTitle ?? null,
  strategyDescription: suggestion.suggestedStrategy?.description ?? suggestion.suggestedStrategyDescription ?? null,
})

const hasText = (value: string | null | undefined): value is string => typeof value === 'string' && value.trim().length > 0

const INTERNAL_FACTOR_TYPES = new Set(['STRENGTH', 'WEAKNESS'])

const pairOf = (first: CheckyFactorRef, second: CheckyFactorRef): Omit<CheckyCrossPair, 'crossId'> | null => {
  if (first.id === second.id) return null
  const internal = INTERNAL_FACTOR_TYPES.has(first.type) ? first : INTERNAL_FACTOR_TYPES.has(second.type) ? second : null
  if (!internal) return null
  const external = internal.id === first.id ? second : first
  const crossType = crossTypeFor(internal.type, external.type)
  if (!crossType) return null
  return { factor1Id: internal.id, factor2Id: external.id, crossType: crossType as CheckyCrossType, factor1: internal, factor2: external }
}

/**
 * True cuando la sugerencia pretende ser estrategia y por eso necesita una pareja DOFA válida:
 * MISSING_CROSSES propone crear un cruce, y un suggestedStrategy completo es la estrategia que
 * puede llegar a Ponderación. Todo lo demás es lectura, no estrategia.
 */
export const requiresCheckyCrossPair = (suggestion: CheckySuggestionInput): boolean => {
  const snapshot = snapshotOf(suggestion)
  if (snapshot.category === 'MISSING_CROSSES') return true
  return hasText(snapshot.strategyTitle) && hasText(snapshot.strategyDescription)
}

/**
 * Resuelve la pareja DOFA de una sugerencia siguiendo el orden A → E de la regla de negocio.
 *
 * Primero mira si la evidencia cita un StrategicCross existente (A/C): ese cruce ya es una pareja
 * registrada y válida, así que manda. Después mira si cita exactamente dos factores reales del
 * diagnóstico (B/D): si además hay un cruce para esa pareja, se devuelve su id para reutilizarlo;
 * si no lo hay, Checky puede proponer el cruce nuevo. Cualquier otra cosa es null.
 *
 * Devuelve la pareja con el factor interno primero, su tipo FO/FA/DO/DA y el cruce existente si lo
 * hay, o null cuando no hay pareja posible: ids que no existen, un solo factor, el mismo factor
 * repetido, más de dos factores (no hay un factor1/factor2 identificable) o una combinación que la
 * matriz no permite.
 */
export const resolveCheckyCrossPair = (
  suggestion: CheckySuggestionInput,
  factors: readonly CheckyFactorRef[],
  crosses: readonly CheckyCrossRef[],
): CheckyCrossPair | null => {
  const snapshot = snapshotOf(suggestion)
  const factorById = new Map(factors.map((factor) => [factor.id, factor]))
  const crossById = new Map(crosses.map((cross) => [cross.id, cross]))

  for (const id of new Set(snapshot.evidenceIds)) {
    const cross = crossById.get(id)
    if (!cross) continue
    const first = factorById.get(cross.factor1Id)
    const second = factorById.get(cross.factor2Id)
    if (!first || !second) continue
    const pair = pairOf(first, second)
    if (pair) return { ...pair, crossId: cross.id }
  }

  const citedFactorIds = [...new Set(snapshot.evidenceIds.filter((id) => factorById.has(id)))]
  if (citedFactorIds.length === 2) {
    const [first, second] = citedFactorIds.map((id) => factorById.get(id)!)
    const pair = pairOf(first, second)
    if (pair) {
      const existing = crosses.find((cross) =>
        (cross.factor1Id === pair.factor1Id && cross.factor2Id === pair.factor2Id) ||
        (cross.factor1Id === pair.factor2Id && cross.factor2Id === pair.factor1Id),
      )
      return { ...pair, crossId: existing ? existing.id : null }
    }
  }
  return null
}

/** Clave de pareja normalizada con el factor interno primero, la misma que usa el resto del flujo. */
export const checkyPairKey = (pair: CheckyCrossPair): string => `${pair.factor1Id}::${pair.factor2Id}`

/**
 * La evidencia con la que se persiste y se lee la pareja: los dos ids de factor resueltos siempre
 * están, además de cualquier id citado (un cruce, por ejemplo). La tarjeta de Checky pinta la pareja
 * a partir de los factores, así que con solo el id del cruce la pantalla no podría mostrar qué DOFA
 * combina.
 */
export const checkyEvidenceWithPair = (evidenceIds: readonly string[], pair: CheckyCrossPair): string[] => {
  const withPair = [...evidenceIds]
  for (const factorId of [pair.factor1Id, pair.factor2Id]) {
    if (!withPair.includes(factorId)) withPair.push(factorId)
  }
  return withPair
}

/**
 * Filtra las sugerencias que pretenden ser estrategia sin pareja DOFA válida. Es el gate que
 * descarta antes de persistir y, como protección adicional, el que impide que registros inválidos
 * ya guardados vuelvan a proyectarse en Checky ni en los endpoints de estrategias.
 *
 * Las sugerencias que no pretenden ser estrategia se conservan tal cual: no compiten con la matriz
 * DOFA y nunca llegan a Ponderación, porque sin suggestedStrategy no hay estrategia que ponderar.
 *
 * Además descarta los duplicados de MISSING_CROSSES dentro de la misma respuesta: la misma pareja no
 * se propone dos veces de una vez. Una pareja que ya existe como StrategicCross no se descarta aquí:
 * se conserva y se relaciona con ese cruce, que es la fuente de verdad, sin crear otro.
 */
export const filterCheckySuggestions = <T extends CheckySuggestionInput>(
  suggestions: readonly T[],
  factors: readonly CheckyFactorRef[],
  crosses: readonly CheckyCrossRef[],
): T[] => {
  const proposedPairs = new Set<string>()
  return suggestions.filter((suggestion) => {
    if (!requiresCheckyCrossPair(suggestion)) return true
    const pair = resolveCheckyCrossPair(suggestion, factors, crosses)
    if (!pair) return false
    if (snapshotOf(suggestion).category !== 'MISSING_CROSSES') return true
    const key = checkyPairKey(pair)
    if (proposedPairs.has(key)) return false
    proposedPairs.add(key)
    return true
  })
}
