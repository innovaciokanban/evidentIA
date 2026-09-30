import OpenAI from 'openai'
import { env } from './env.js'
import { aiAnalysisSchema, buildCheckyConsultSchema, buildGeneratedCrossSchema, buildGeneratedCrossesAnalysisSchema, crossAnalysisSchema, crossTypeFor, crossTypeSchema } from './validation.js'
import { WEIGHTING_LEVEL_SCORE } from './weighting-service.js'
import type { z } from 'zod'

export type AIAnalysisResult = z.infer<typeof aiAnalysisSchema>
export type CrossAnalysisResult = z.infer<typeof crossAnalysisSchema>
export type GeneratedCrossForAI = {
  factor1Id: string
  factor2Id: string
  type: z.infer<typeof crossTypeSchema>
  strategy: string
}
export type DiagnosticForAI = {
  title: string
  description: string
  status: string
  /** Cada factor lleva su id porque es lo único que permite que el modelo cite de qué se apoya una
   *  inferencia. Sin el id en el prompt, `evidenceIds` sería texto libre. */
  swotItems: Array<{ id: string; type: string; description: string }>
}
export type CheckyContext = {
  question: string
  diagnostic: { title: string; description: string; status: string }
  swotItems: Array<{ id: string; type: string; description: string }>
  crosses: Array<{ id: string; crossType: string; origin: string; factor1Id: string; factor2Id: string; strategy: string | null }>
  aiAnalysis: { executiveSummary: string; keyFindings: unknown; priorityRisks: unknown; priorityOpportunities: unknown } | null
  recommendations: Array<{ title: string; priority: string; status: string }>
  /**
   * Ponderaciones ya registradas en base de datos, una por cruce con estrategia ya ponderada.
   * Opcional para no romper a los llamadores que construyen el contexto a mano. weightedScore llega
   * tal cual se leyó de la BD: Checky lo lee y lo ordena, nunca lo recalcula.
   */
  weightings?: CheckyWeighting[]
  /**
   * Todas las estrategias del diagnóstico, de las tres fuentes y con la ponderación que ya tengan
   * guardada. Opcional para no romper a los llamadores que arman el contexto a mano: sin él, Checky
   * sigue viendo el bloque de cruces de siempre y nada más. Es de solo lectura: leerlo no calcula,
   * no ordena por score y no escribe nada.
   */
  strategies?: CheckyConsolidatedStrategy[]
}

/** Clasificación por rango del ponderado que ya está guardado en la columna weightedScore. */
export type CheckyWeightingBand = 'INMEDIATA' | 'CORTO_PLAZO' | 'MEDIANO_PLAZO' | 'LARGO_PLAZO'

/**
 * Las tres fuentes de una estrategia consolidada. El enum StrategySource de Prisma solo cubre las
 * dos que se pueden ponderar en la tabla de estrategias, así que el cruce se declara aquí para poder
 * hablar de las tres. Es el mismo conjunto de valores que usa la consolidación de la priorización.
 */
export type CheckyStrategyOrigin = 'AI_ANALYSIS' | 'STRATEGIC_CROSS' | 'CHECKY'

/** Los cinco niveles tal como los guarda la base. Se nombran para poder compararlos entre fuentes. */
export type CheckyWeightingCriteria = { impactoEstrategico: string; viabilidad: string; urgencia: string; sinergiaInterna: string; impactoReputacional: string }

export type CheckyWeighting = {
  crossId: string
  crossType: string
  origin: string
  strategy: string | null
  weightedScore: number
  weightingBand: CheckyWeightingBand
  criteria: CheckyWeightingCriteria
  factors: Array<{ id: string; type: string; description: string }>
}

/**
 * Una estrategia consolidada, sea del análisis con IA, de un cruce o de una sugerencia de Checky
 * aceptada. Es la misma lista que la pantalla de ponderación muestra, traída aquí para que Checky
 * lea lo que el usuario ya decidió sobre sus tres fuentes a la vez.
 *
 * weightedScore y weightingBand llegan copiados de la fila guardada: son hechos y no se recalculan
 * aquí. Los dos llegan en null cuando el usuario todavía no valoró la estrategia, y esa ausencia es
 * información, no un cero.
 *
 * strategyRef identifica la estrategia dentro de la lista consolidada, pero NO es un id citable:
 * el contrato de evidencia solo admite ids reales de factor o de cruce, y esos viajan en factorIds
 * y crossId. Para una estrategia de IA no hay factores, así que no hay nada citable que aportar.
 */
export type CheckyConsolidatedStrategy = {
  strategyRef: string
  source: CheckyStrategyOrigin
  title: string
  description: string
  crossId: string | null
  crossType: string | null
  origin: string | null
  factorIds: string[]
  weightedScore: number | null
  weightingBand: CheckyWeightingBand | null
  criteria: CheckyWeightingCriteria | null
}

/**
 * Rangos de la metodología, en el mismo orden que usa la interfaz. Clasificar un ponderado que ya
 * existe en la BD no es recalcularlo: la etiqueta se deduce del número guardado y el número nunca
 * se toca. Los límites son inclusivos por arriba, así que 4.00 cae en INMEDIATA y 3.99 en CORTO_PLAZO.
 */
const CHECKY_WEIGHTING_BANDS: ReadonlyArray<{ band: CheckyWeightingBand; min: number; max: number }> = [
  { band: 'INMEDIATA', min: 4, max: 5 },
  { band: 'CORTO_PLAZO', min: 3, max: 3.99 },
  { band: 'MEDIANO_PLAZO', min: 2, max: 2.99 },
  { band: 'LARGO_PLAZO', min: 1, max: 1.99 },
]

export const resolveWeightingBand = (weightedScore: number): CheckyWeightingBand =>
  CHECKY_WEIGHTING_BANDS.find((candidate) => weightedScore >= candidate.min && weightedScore <= candidate.max)?.band ?? 'LARGO_PLAZO'

/** Banda que el servidor considera de alta prioridad: la máxima de la metodología. */
const HIGH_PRIORITY_BAND: CheckyWeightingBand = 'INMEDIATA'

/** Lectura de la escala guardada. Devuelve undefined para un nivel que no exista, y el filtro lo trata como descartable. */
const weightingLevelScore = (level: string) => WEIGHTING_LEVEL_SCORE[level as keyof typeof WEIGHTING_LEVEL_SCORE]
const isLowFeasibility = (level: string) => {
  const score = weightingLevelScore(level)
  return score !== undefined && score <= WEIGHTING_LEVEL_SCORE.BAJO
}
const isHighImpact = (level: string) => {
  const score = weightingLevelScore(level)
  return score !== undefined && score >= WEIGHTING_LEVEL_SCORE.ALTO
}
const isHighPriorityBand = (band: CheckyWeightingBand | null) => band === 'INMEDIATA' || band === 'CORTO_PLAZO'

/**
 * Umbral conservador para considerar que el texto de una estrategia es demasiado corto para
 * respaldar una ponderación alta. No mide calidad: solo marca que no hay suficiente texto escrito
 * para que el usuario sepa qué se está incorporando, así que Checky tiene algo que pedir.
 */
const THIN_STRATEGY_CHARS = 30

/** Una estrategia está valorada si la base guardó su ponderado. Sin ponderado no hay score ni banda. */
const isValuedStrategy = (strategy: CheckyConsolidatedStrategy) => strategy.weightedScore !== null

/** Sinergia interna baja: el usuario dice que la estrategia no se apoya en capacidades propias. */
const isLowSynergy = (level: string) => {
  const score = weightingLevelScore(level)
  return score !== undefined && score <= WEIGHTING_LEVEL_SCORE.BAJO
}

/**
 * Andamiaje de priorización sobre las estrategias consolidadas de las tres fuentes.
 *
 * Solo reorganiza lo que el usuario ya registró: no pondera, no recalcula, no ordena por su cuenta
 * fuera del score guardado y no juzga calidad. Cada bloque corresponde a una pregunta que Checky
 * tiene que poder responder con evidencia, y cada entrada lleva factorIds y crossId, que son los
 * únicos ids que el contrato admite en evidenceIds. strategyRef solo sirve para que el modelo nombre
 * la estrategia en su prosa: nunca se cita.
 *
 * Las señales son observaciones estructurales, igual que strategyWeightingSignals: su presencia es un
 * motivo para preguntar, no una conclusión que el modelo pueda afirmar como hecho.
 */
const buildStrategyPrioritization = (strategies: CheckyConsolidatedStrategy[]) => {
  const valued = strategies.filter(isValuedStrategy)
  const unvalued = strategies.filter((strategy) => !isValuedStrategy(strategy))

  /** Copia mínima para nombrar una estrategia sin duplicar los cinco niveles en cada bloque. */
  const reference = (strategy: CheckyConsolidatedStrategy) => ({
    strategyRef: strategy.strategyRef,
    source: strategy.source,
    title: strategy.title,
    crossId: strategy.crossId,
    crossType: strategy.crossType,
    origin: strategy.origin,
    factorIds: strategy.factorIds,
  })

  const valuedEntry = (strategy: CheckyConsolidatedStrategy) => ({
    ...reference(strategy),
    weightedScore: strategy.weightedScore,
    weightingBand: strategy.weightingBand,
    criteria: strategy.criteria,
  })

  // El orden es el del ponderado guardado, de mayor a menor. Es el mismo criterio de lectura que ya
  // usa priorityRanking para los cruces: ordena lo registrado, no recomienda nada.
  const byWeightedScore = [...valued].sort((left, right) => (right.weightedScore ?? 0) - (left.weightedScore ?? 0))

  const bandCounts = Object.fromEntries(CHECKY_WEIGHTING_BANDS.map(({ band }) => [band, valued.filter((strategy) => strategy.weightingBand === band).length])) as Record<CheckyWeightingBand, number>

  const bySource = (['AI_ANALYSIS', 'STRATEGIC_CROSS', 'CHECKY'] as const).map((source) => {
    const items = strategies.filter((strategy) => strategy.source === source)
    const itemsValued = items.filter(isValuedStrategy).length
    return { source, total: items.length, valued: itemsValued, unvalued: items.length - itemsValued }
  })

  /** Requiere atención: banda alta. Solo incluye estrategias que el usuario ya valorar. */
  const needsAttention = byWeightedScore.filter((strategy) => isHighPriorityBand(strategy.weightingBand)).map(valuedEntry)

  /** Alta prioridad con poca viabilidad: prometen mucho y el usuario dice que costará. */
  const highPriorityLowFeasibility = byWeightedScore
    .filter((strategy) => isHighPriorityBand(strategy.weightingBand) && strategy.criteria !== null && isLowFeasibility(strategy.criteria.viabilidad))
    .map((strategy) => ({ ...valuedEntry(strategy), viabilidad: strategy.criteria?.viabilidad, impactoEstrategico: strategy.criteria?.impactoEstrategico }))

  /** Señales que apuntan a una estrategia que necesita fortalecerse antes de convertirse en plan. */
  const strengthenSignals = byWeightedScore.flatMap((strategy) => {
    if (strategy.criteria === null) return []
    const signals: Array<{ kind: string; detail: string }> = []
    if (isHighPriorityBand(strategy.weightingBand) && strategy.description.length < THIN_STRATEGY_CHARS) {
      signals.push({ kind: 'THIN_TEXT_IN_HIGH_BAND', detail: `Está en una banda alta con solo ${strategy.description.length} caracteres de estrategia: la valoración va por delante de la redacción.` })
    }
    if (isHighImpact(strategy.criteria.impactoEstrategico) && isLowFeasibility(strategy.criteria.viabilidad)) {
      signals.push({ kind: 'HIGH_IMPACT_LOW_FEASIBILITY', detail: 'El usuario valora el impacto por encima de la viabilidad: la estrategia promete mucho y cuesta mucho. Conviene que sepa qué está comprando.' })
    }
    if (isHighImpact(strategy.criteria.impactoEstrategico) && isLowSynergy(strategy.criteria.sinergiaInterna)) {
      signals.push({ kind: 'HIGH_IMPACT_LOW_SYNERGY', detail: 'El impacto es alto pero la sinergia interna es baja: depende de capacidades que hoy el usuario no considera disponibles. Es una candidata a reforzar antes de comprometer recursos.' })
    }
    if (isLowFeasibility(strategy.criteria.viabilidad)) {
      signals.push({ kind: 'LOW_FEASIBILITY', detail: 'La viabilidad valorada es baja: falta un plan de recursos, responsables y plazos antes de tratarla como comprometida.' })
    }
    return signals.map((signal) => ({ ...valuedEntry(strategy), ...signal }))
  })

  /**
   * Posible redundancia, observada sin comparar significado: dos estrategias que se apoyan
   * exactamente en los mismos factores, o cuyo texto normalizado contiene al otro. La lista
   * consolidada ya viene sin duplicados exactos, así que lo que queda aquí es señal de solapamiento,
   * no un error de la base.
   */
  const groupsByFactorSet = new Map<string, CheckyConsolidatedStrategy[]>()
  for (const strategy of strategies) {
    if (strategy.factorIds.length === 0) continue
    const key = [...new Set(strategy.factorIds)].sort().join('::')
    groupsByFactorSet.set(key, [...(groupsByFactorSet.get(key) ?? []), strategy])
  }
  const sharedFactorGroups = [...groupsByFactorSet.values()].filter((group) => group.length > 1).map((group) => ({
    kind: 'SHARED_FACTORS' as const,
    strategyRefs: group.map((strategy) => strategy.strategyRef),
    sources: group.map((strategy) => strategy.source),
    factorIds: [...new Set(group.flatMap((strategy) => strategy.factorIds))],
    weightedScores: group.map((strategy) => strategy.weightedScore),
    detail: 'Varias estrategias se apoyan en exactamente los mismos factores: conviene decidir si son la misma palanca descrita de dos formas o si compiten por los mismos recursos.',
  }))

  const normalizedText = (strategy: CheckyConsolidatedStrategy) => strategy.description.trim().replace(/\s+/g, ' ').toLowerCase()
  const nestedTextPairs: Array<{ kind: 'NESTED_TEXT'; strategyRefs: string[]; sources: CheckyStrategyOrigin[]; factorIds: string[]; weightedScores: Array<number | null>; detail: string }> = []
  for (const [index, strategy] of strategies.entries()) {
    for (const other of strategies.slice(index + 1)) {
      const left = normalizedText(strategy)
      const right = normalizedText(other)
      if (left === right || !left.includes(right) && !right.includes(left)) continue
      nestedTextPairs.push({
        kind: 'NESTED_TEXT',
        strategyRefs: [strategy.strategyRef, other.strategyRef],
        sources: [strategy.source, other.source],
        factorIds: [...new Set([...strategy.factorIds, ...other.factorIds])],
        weightedScores: [strategy.weightedScore, other.weightedScore],
        detail: 'El texto de una estrategia contiene al de la otra: es posible que la misma idea esté escrita dos veces y se esté contando como dos.',
      })
    }
  }

  /**
   * Huecos de información, deducidos de lo que falta de verdad. No son quejas: cada entrada señala
   * un dato concreto que pedir y por qué cambiaría la decisión.
   */
  const missingInformationInputs = {
    unvaluedStrategies: unvalued.map(reference),
    /**
     * Una estrategia de IA no tiene factores asociados, así que cualquier hallazgo sobre ella solo
     * puede apoyarse en el dato cuantitativo, no en un id. Decirselo a Checky evita que invente una
     * evidencia o que fuerce un hallazgo al que no puede citar nada.
     */
    valuedWithoutCitableEvidence: valued.filter((strategy) => strategy.factorIds.length === 0 && strategy.crossId === null).map(reference),
    hasAnyWeighting: valued.length > 0,
  }

  return {
    hasAnyWeighting: valued.length > 0,
    totalStrategies: strategies.length,
    valuedStrategies: valued.length,
    unvaluedStrategies: unvalued.length,
    bySource,
    bandCounts,
    weightedStrategies: byWeightedScore.map(valuedEntry),
    pendingStrategies: unvalued.map(reference),
    needsAttention,
    highPriorityLowFeasibility,
    strengthenSignals,
    possibleDuplicates: [...sharedFactorGroups, ...nestedTextPairs],
    missingInformationInputs,
  }
}

export type CheckyConsultResult = {
  reply: string
  insufficientData: boolean
  missingInformation: string[]
  findings: Array<{ category: string; title: string; detail: string; basis: 'FACT' | 'INFERENCE'; evidenceIds: string[]; suggestedStrategy?: { title: string; description: string } | null }>
}

type OpenAIClient = { responses: { create: (input: unknown) => Promise<{ output_text?: string }> } }

export class AIServiceError extends Error {
  code: 'NOT_CONFIGURED' | 'INVALID_RESPONSE' | 'PROVIDER_ERROR'

  constructor(code: AIServiceError['code']) {
    super(code)
    this.code = code
  }
}

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    executiveSummary: { type: 'string' },
    diagnosis: { type: 'string' },
    keyFindings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { finding: { type: 'string' }, basis: { type: 'string', enum: ['FACT', 'INFERENCE'] }, evidenceIds: { type: 'array', items: { type: 'string' } }, interpretation: { type: 'string' } }, required: ['finding', 'basis', 'evidenceIds', 'interpretation'] } },
    foStrategies: { type: 'array', items: { type: 'string' } },
    doStrategies: { type: 'array', items: { type: 'string' } },
    faStrategies: { type: 'array', items: { type: 'string' } },
    daStrategies: { type: 'array', items: { type: 'string' } },
    priorityRisks: { type: 'array', items: { type: 'string' } },
    priorityOpportunities: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] }, expectedImpact: { type: 'string' }, suggestedAction: { type: 'string' } }, required: ['title', 'description', 'priority', 'expectedImpact', 'suggestedAction'] } },
  },
  required: ['executiveSummary', 'diagnosis', 'keyFindings', 'foStrategies', 'doStrategies', 'faStrategies', 'daStrategies', 'priorityRisks', 'priorityOpportunities', 'recommendations'],
}

const crossAnalysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    relevance: { type: 'string' },
    strategy: { type: 'string' },
    expectedImpact: { type: 'string' },
    priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    risks: { type: 'array', items: { type: 'string' } },
    opportunities: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
  },
  required: ['relevance', 'strategy', 'expectedImpact', 'priority', 'risks', 'opportunities', 'recommendation'],
}

const crossGenerationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    crosses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['FO', 'DO', 'FA', 'DA'] },
          factor1Id: { type: 'string' },
          factor2Id: { type: 'string' },
          strategy: { type: 'string' },
        },
        required: ['type', 'factor1Id', 'factor2Id', 'strategy'],
      },
    },
  },
  required: ['crosses'],
}

const crossAnalysisResultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    analyses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          crossId: { type: 'string' },
          analysis: crossAnalysisJsonSchema,
        },
        required: ['crossId', 'analysis'],
      },
    },
  },
  required: ['analyses'],
}

const checkyConsultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string' },
    insufficientData: { type: 'boolean' },
    missingInformation: { type: 'array', items: { type: 'string' } },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string', enum: ['REVIEW_ASPECTS', 'MISSING_CROSSES', 'UNRELATED_FACTORS', 'STRENGTHEN_STRATEGIES', 'STRATEGIC_RISKS', 'MISSED_OPPORTUNITIES', 'INFO_TO_COMPLEMENT', 'NEXT_STEPS'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          basis: { type: 'string', enum: ['FACT', 'INFERENCE'] },
          evidenceIds: { type: 'array', items: { type: 'string' } },
          suggestedStrategy: {
            type: ['object', 'null'],
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['title', 'description'],
          },
        },
        required: ['category', 'title', 'detail', 'basis', 'evidenceIds', 'suggestedStrategy'],
      },
    },
  },
  required: ['reply', 'insufficientData', 'missingInformation', 'findings'],
}

const CHECKY_CROSS_TYPES = 'Únicos cruces DOFA válidos: FO = STRENGTH + OPPORTUNITY, DO = WEAKNESS + OPPORTUNITY, FA = STRENGTH + THREAT, DA = WEAKNESS + THREAT. El factor interno (STRENGTH o WEAKNESS) se guarda como factor1 y el externo (OPPORTUNITY o THREAT) como factor2.'

const CHECKY_DO_NOT_INVENT = [
  'Está terminantemente prohibido inventar datos de la empresa: actividad, sector, cifras, clientes, competidores, proveedores, normativa o antecedentes.',
  'Está terminantemente prohibido proponer un factor DOFA que no aparezca en swotItems. Si echaste en falta un factor, no lo escribas: repórtalo en INFO_TO_COMPLEMENT.',
  'Está terminantemente prohibido crear o modificar cruces, factores, planes de acción, ítems o tickets. No tienes esa capacidad y no debes simularla.',
  'No asumas que algo es cierto si no hay evidencia en el contexto. Ante la duda, es INFERENCE y con lenguaje calibrado.',
  'Nunca inventes un id. evidenceIds solo admite ids copiados literalmente de swotItems o crosses; un id inexistente invalida toda la respuesta.',
].join('\n\n')

const CHECKY_ANTI_ECHO = [
  'El contexto incluye aiAnalysis, un análisis previo del mismo diagnóstico. Tu trabajo NO es repetirlo.',
  'Si un hallazgo tuyo reproduce executiveSummary, keyFindings, priorityRisks o priorityOpportunities, es redundante y debe desaparecer.',
  'Checky aporta la segunda capa que el análisis previo no cubre: cobertura de la matriz, coherencia entre factor, cruce y estrategia, calidad de las estrategias escritas, cruces justificables que faltan, y datos que conviene validar con la empresa.',
  'Pregúntate en cada hallazgo: ¿esto ya estaba dicho en aiAnalysis? Si es sí, o lo superas con evidencia concreta, o lo eliminas.',
].join('\n\n')

const CHECKY_MISSING_CROSS_GATE = [
  'Criterio estricto para MISSING_CROSSES. Un cruce solo es mencionable si cumple las CUATRO condiciones. No complies las cuatro, no lo digas.',
  '1. Los dos factores existen en swotItems y sus ids son reales.',
  '2. Ambos factores son relevantes para el objetivo del diagnóstico, no meramente útiles.',
  '3. La combinación tiene una relación estratégica razonada: puedes explicarla en una frase sin usar palabras vacías.',
  '4. El par equivalente NO existe ya. Usa existingPairs del contexto, que ya viene normalizado con el formato idInterno::idExterno, así que da igual en qué orden cites los dos factores. Lo único que se repite es la misma pareja: cambiar de factor interno o de factor externo sí es otro cruce y se puede proponer.',
  'Para cada cruce sugerido, el detail debe cubrir: por qué puede ser relevante, qué factores relaciona y con qué ids, qué tipo de cruce sería, y una posible dirección estratégica. Proponerlo no es registrarlo: la crea el usuario.',
  'Un cruce que no pasa la compuerta es peor que no decir nada, porque el usuario tiene que descartarlo.',
].join('\n\n')

const CHECKY_ROLE = [
  'Eres Checky, consultor senior en diseño de procesos estratégicos y gestión de calidad, con más de 15 años acompañando a empresas en la elaboración de diagnósticos DOFA.',
  'Tu interlocutor es un analista que ya completó su DOFA y sus cruces. No vienes a reemplazar su trabajo ni a repetir su análisis: vienes a añadir la segunda capa de revisión que no pudo hacer por falta de distancia, de tiempo o de perspectiva.',
  'Te expresas como consultor, no como generador de texto: concreto, directo, sin relleno, y con la prudencia de quien sabe que una recomendación mal fundamentada tiene costo real en la organización.',
].join('\n\n')

const CHECKY_JUDGMENT_RULES = [
  'REGLA DE ORO: el contexto entregado es la única realidad disponible. No completes lo que falta con conocimiento general del sector, con precedentes comunes ni con lo que suele ser cierto en empresas similares.',
  'No afirmes causalidad a partir de una correlación observada en la matriz. Usa "puede contribuir", "apunta a", "es consistente con" en lugar de "provoca", "causa", "es el problema".',
  'Cuando la evidencia sea parcial o indirecta, usa lenguaje calibrado: "sugiere", "podría", "conviene validar", "apunta a".',
  'Está prohibido el lenguaje absoluto ("siempre", "nunca", "garantiza", "el problema es", "la causa es", "hay que") salvo que la evidencia recibida lo sostenga de forma explícita y directa.',
  'Un hallazgo sin evidencia no es un hallazgo: es una opinión. Recorta los que no puedas sustentar.',
].join('\n\n')

const CHECKY_ANALYSIS_DIMENSIONS = [
  'DIMENSIONES DE ANÁLISIS. Revisa el trabajo completo del usuario en estos ocho ejes, y usa únicamente estas categorías. Un hallazgo pertenece a la categoría donde aporta más, no a la primera que se te ocurra.',
  '1. REVIEW_ASPECTS: qué parte del diagnóstico amerita una revisión más a fondo, y por qué ese ángulo no está cubierto todavía.',
  '2. MISSING_CROSSES: combinaciones FO, DO, FA o DA justificables que hoy no existen. Sujeto a la compuerta estricta de más abajo.',
  '3. UNRELATED_FACTORS: factores que casi no se relacionan entre sí, o cuya relación con el resto de la matriz es débil. No es lo mismo que un factor sin cruces: aquí el problema es que la relación existente es forzada.',
  '4. STRENGTHEN_STRATEGIES: estrategias poco desarrolladas, demasiado genéricas, sin responsables ni horizonte, o que necesitan validación antes de convertirse en plan.',
  '5. STRATEGIC_RISKS: riesgos que se deducen de la combinación de factores y cruces presentes, y no de supuestos sobre el sector.',
  '6. MISSED_OPORTUNITIES: oportunidades que la matriz sugiere y el trabajo actual no está explotando.',
  '7. INFO_TO_COMPLEMENT: qué información conviene pedir a la empresa para sostener la decisión, y por qué esa información cambiaría la conclusión.',
  '8. NEXT_STEPS: una secuencia concreta y ordenada de cómo seguir. Decir qué se revisa primero y en qué orden, no una lista de deseos.',
].join('\n\n')

const CHECKY_RECOMMENDATION_CRITERIA = [
  'CRITERIOS DE CALIDAD DE LAS RECOMENDACIONES.',
  'Una recomendación útil responde tres preguntas: QUÉ debería revisar o hacer, POR QUÉ, y QUÉ debería validar antes de comprometerse. Si le falta una de las tres, está incompleta.',
  'Prohibido devolver recomendaciones genéricas como "mejorar procesos", "fortalecer el marketing", "capacitar al personal", "aumentar la eficiencia", "mejorar la calidad" o "analizar el mercado". No son recomendaciones: son evasivas sin punto de apoyo.',
  'Ancla cada recomendación en algo concreto y citable del contexto: el id de un factor, el id de un cruce, una estrategia ya escrita, o un hueco visible en la matriz. Si no puedes señalar su punto de apoyo, no es una recomendación.',
  'Aporta el detalle que el usuario pueda aplicar mañana: sobre qué evidencia se apoya, qué decisión habilita o bloquea, y qué señal indicaría que la hipótesis es falsa.',
].join('\n\n')

const CHECKY_SUGGESTED_STRATEGY = [
  'CAMPO suggestedStrategy. Cuando un hallazgo conlleve una estrategia, devuélvela en suggestedStrategy con title y description. La estrategia NUNCA viaja dentro de detail: detail explica el hallazgo, suggestedStrategy lleva la propuesta.',
  'En MISSING_CROSSES debes incluir suggestedStrategy siempre que puedas sostenerla: si recomiendas un cruce, explica cómo se explota ese cruce concreto. También es válido en STRENGTHEN_STRATEGIES y en MISSED_OPPORTUNITIES.',
  'En REVIEW_ASPECTS, STRATEGIC_RISKS y NEXT_STEPS el campo va en null: esas categorías no proponen una estrategia.',
  'La estrategia debe derivarse EXCLUSIVAMENTE de los dos factores que citas en evidenceIds, y responder a la relación estratégica de ese cruce en concreto. Si los dos factores no dialogan entre sí, no propongas el cruce.',
  'title es una frase corta con el verbo de la acción. description es la estrategia en una o dos frases: qué se hace, con qué palanca y para qué.',
  'Prohibido el relleno: "mejorar procesos", "fortalecer el marketing", "aprovechar oportunidades" o "analizar el mercado" no son estrategias. Si no puedes escribir algo concreto para esos dos factores, devuelve suggestedStrategy en null en lugar de inventar una frase genérica.',
  'Nunca dejes title ni description vacíos: si no hay estrategia, el campo va en null.',
].join('\n\n')

const CHECKY_WEIGHTING_RULES = [
  'PONDERACIONES. El bloque weightings recoge lo que el usuario ya registró en la aplicación, junto con los conteos y listas de workMap (totalStrategies, evaluatedStrategies, pendingStrategies, priorityCounts, highPriorityStrategies, lowFeasibilityHighImpact, crossesWithoutStrategy, strategiesWithoutWeighting).',
  'weightedScore y weightingBand son datos de hecho: el ponderado lo calcula el servidor al guardar la ponderación y la banda sale de ese número. NO recalcules el ponderado, NO apliques los pesos de los criterios por tu cuenta y NO reetiquetes la banda. Cita el número y la banda tal cual llegan.',
  'Usa priorityCounts y highPriorityStrategies para ordenar la conversación: lo primero es atender las estrategias de mayor ponderado y, si el usuario pregunta por dónde empezar, contrasta con lowFeasibilityHighImpact (mucho impacto con poca viabilidad), que son candidatas a ejecución difícil, no de falta de valor.',
  'pendingStrategies y strategiesWithoutWeighting son huecos reales de datos: si el usuario pregunta por prioridades y hay estrategias sin ponderar, dilo con esas ids en INFO_TO_COMPLEMENT o NEXT_STEPS. No les asignes un ponderado ni una banda.',
  'Si no hay ninguna ponderación registrada, el diagnóstico aún no está priorizado: dilo y ofrece ponderar, en lugar de inventar una jerarquía.',
].join('\n\n')

/**
 * Reglas de la priorización consolidada: las tres fuentes de estrategias en un solo bloque.
 *
 * No introduce categorías nuevas ni un segundo contrato. Las seis preguntas que tienen que poder
 * contestarse se atan a las ocho dimensiones que ya existen, y los números del servidor se tratan
 * como hechos que se citan, nunca como algo que Checky pueda calcular o corregir.
 */
const CHECKY_CONSOLIDATED_STRATEGIES = [
  'ESTRATEGIAS CONSOLIDADAS. El bloque strategies y la sección analysis.strategyPrioritization traen juntas las estrategias del análisis con IA, las de los cruces y las sugerencias de Checky aceptadas, cada una con su source y, si el usuario ya la india, con su ponderado y su banda. Son la misma lista que el usuario ve en la pantalla de ponderación.',
  'REGLAS INNEGOCIABLES SOBRE LOS VALORES. weightedScore y weightingBand son hechos calculados por el servidor al guardar la ponderación. NO recalcules ningún ponderado, NO apliques los pesos de los criterios (20/25/20/15/20) por tu cuenta, NO cambies una banda y NO le asignes ponderado ni banda a una estrategia que llega con los dos en null. Si necesitas ponderar algo que no está ponderado, la propuesta es "valorar esta estrategia", nunca un número.',
  'La lista ya viene sin duplicados exactos: si dos textos eran idénticos, el servidor se quedó con uno. Lo que queda en possibleDuplicates es solapamiento real, no un error.',
  'CÓMO CITAR. evidenceIds solo admite ids reales de factor o de cruce, los que llegan en factorIds y crossId. strategyRef es una etiqueta de referencia para nombrar la estrategia en tu prosa: copiarla en evidenceIds invalida toda la respuesta. Si una estrategia no trae factorIds ni crossId, es una estrategia del análisis con IA: puedes afirmar sus números como FACT porque están en el contexto, pero no tienes ningún id que citar, así que su hallazgo lleva evidenceIds vacío y lo explica en detail.',
  'FACT E INFERENCE. Es FACT lo cuantitativo que se lee en el contexto: "tiene un ponderado de 3.45 y banda CORTO_PLAZO", "está sin ponderar", "3 de 7 estrategias valoradas", "estas dos se apoyan en los mismos factores". Es INFERENCE todo juicio sobre qué hacer: qué atender primero, qué reforzar, qué es redundante, qué falta. Las señales del servidor (needsAttention, highPriorityLowFeasibility, strengthenSignals, possibleDuplicates) son observaciones estructurales: el hecho es la coincidencia observable, y la lectura que hagas de ella va siempre en INFERENCE.',
  'SEIS PREGUNTAS, SEIS CATEGORÍAS EXISTENTES. Usa el bloque que te toca y nada más:',
  '1. Qué estrategias requieren atención: parte de needsAttention (banda alta) y de bySource, y responde en REVIEW_ASPECTS o STRATEGIC_RISKS según si el problema es de foco o de riesgo.',
  '2. Alta prioridad con baja viabilidad: highPriorityLowFeasibility. Son las que prometen mucho y cuestan, no las que valen poco. Explícalo en STRATEGIC_RISKS, citando el nivel de viabilidad que lo demuestra.',
  '3. Qué debería fortalecerse: strengthenSignals, en STRENGTHEN_STRATEGIES, y ahí suggestedStrategy sí puede ir poblado si la estrategia se apoya en factores reales que puedas citar.',
  '4. Posibles estrategias redundantes: possibleDuplicates, en REVIEW_ASPECTS. Preséntalo como la pregunta que es ("puede que la misma palanca esté descrita dos veces"), nunca como un error confirmado: en INFERENCE.',
  '5. Qué información falta: missingInformationInputs, en INFO_TO_COMPLEMENT, y activa insufficientData con missingInformation solo si de verdad falta algo concreto para decidir. pendingStrategies son estrategias escritas que el usuario todavía no ha ponderado; valuedWithoutCitableEvidence te dice cuáles no podrás citar.',
  '6. Próximos pasos: NEXT_STEPS, ordenados y con motivo. El orden se apoya en weightedStrategies (de mayor a menor ponderado) contrastado con highPriorityLowFeasibility y con lo que está sin ponderar.',
  'Con hasAnyWeighting en false el diagnóstico no está priorizado: dilo con esas palabras y ofrece ir a ponderar, sin suponer ningún orden.',
].join('\n\n')

const CHECKY_ANALYSIS_SCAFFOLD = [
  'BLOQUE analysis. El servidor calculó este andamiaje con los datos reales del diagnóstico. Son hechos reorganizados, no conclusiones: úsalos para saber dónde hay huecos y con qué ids citar, pero el juicio y la redacción siguen siendo tuyos.',
  'priorityRanking: estrategias ponderadas, de mayor a menor ponderado, con sus criterios. Sirve para saber qué se está priorizando. Si vas a recomendar una de ellas, di por qué, mirando los criterios y no el número.',
  'unweightedStrategies: estrategias escritas que el usuario todavía no ha ponderado. Con hasAnyWeighting en false, el diagnóstico no está priorizado y debes decirlo en lugar de suponer un orden.',
  'crossesWithoutStrategy: cruces sin texto de estrategia. weightedCrossesWithoutStrategy es el subconjunto más delicado: están ponderados y sin estrategia escrita, así que hay una valoración sin lo que valued.',
  'strategyWeightingSignals: señales estructurales que el servidor detectó entre la ponderación y el texto. No son errores ni veredictos: son preguntas legítimas que puedes elevar a STRENGTHEN_STRATEGIES, STRATEGIC_RISKS o INFO_TO_COMPLEMENT, siempre en INFERENCE y citando los ids que la señal trae.',
  'unusedFactors: factores que no participan en ningún cruce todavía, con sus ids reales. Son el material para pensar MISSING_CROSSES, pero la compuerta estricta sigue aplicando: de este inventario no sale un cruce sugerido por sí solo.',
].join('\n\n')

const CHECKY_RECOMMENDATION_DISCIPLINE = [
  'CÓMO DEBES FUNDAMENTAR CADA RECOMENDACIÓN.',
  'Todo hallazgo que afirmes algo del diagnóstico va con los ids que lo sostienen en evidenceIds. Si no puedes señalar al menos un id, el hallazgo no va: devuélvelo como insufficientData con la información concreta que te falta en missingInformation.',
  'No recomiendes una estrategia por el hecho de tener el ponderado más alto. Un número alto describe lo que el usuario(calló, no por qué conviene actuar. Para sostener una recomendación de prioridad, apóyala en los criterios que sí explican el motivo: viabilidad baja, urgencia alta, un impacto reputacional que la empresa puede no haber considerado, o una banda que lo sitúe frente a las demás.',
  'Explica siempre el motivo en detail: qué hueco estás detectando, qué evidencia lo sostiene y qué cambiaría la conclusión si la evidencia fuera otra. El usuario tiene que poder actuar mañana con lo que lees.',
  'No repitas literalmente la descripción de los factores ni la del cruce como si fuera tu análisis. Si tu detail se limita a parafrasear un factor, no aporta nada: la recomendación tiene que ir más allá de lo que el usuario ya escribió.',
  'No uses el número como adjetivo. "Tiene un ponderado de 3.45" es un dato; "merece atención por su ponderado" no es un motivo. Si el único argumento es el número, no es una recomendación.',
  'No crees cruces, estrategias, planes de acción, ítems ni tickets. No tienes esa capacidad: propones y el usuario decide. Nunca presentes una propuesta como si ya estuviera registrada.',
  'Si un hueco de datos impide evaluar una dimensión, no lo rellenes: repórtalo en INFO_TO_COMPLEMENT diciendo qué información cambiaría la decisión, o activa insufficientData con missingInformation.',
].join('\n\n')

/**
 * La lectura que Checky responde sí o sí. Sin ella el modelo tiende a devolver un resumen de los
 * factores, que es justo lo que el usuario ya escribió y lo que no le aporta nada. La regla ata la
 * respuesta a las dos preguntas que el usuario hace y a la evidencia que hay que citar para sostener
 * cada una, sin abrir categorías nuevas ni cambiar el contrato.
 */
const CHECKY_STRATEGIC_READING = [
  'LECTURA ESTRATÉGICA. Tu `reply` es la lectura de un consultor sobre este diagnóstico, no un resumen de los factores. Tienes que responder dos preguntas, en este orden y con la evidencia que las sostiene:',
  '1. ¿QUÉ ESTÁ PASANDO en la organización con lo que hasta ahora se ha registrado? Describe la situación, la coherencia o la incoherencia entre factores y cruces, y el punto en el que la matriz se atasca. Apóyala en los ids que la sostienen.',
  '2. ¿QUÉ DEBERÍA PREOCUPARNOS Y PRIORIZARSE? Nombra qué exige atención antes que el resto, por qué lo crees y qué se pierde si no se atiende. Prioriza con un motivo, nunca con un adjetivo.',
  'Prohibido el resumen superficial. "La organización tiene fortalezas, debilidades, oportunidades y amenazas" no es una lectura: describe la estructura de la matriz, que el usuario ya ve. Una lectura útil dice qué significa esa estructura para este diagnóstico en concreto.',
  'Prohibido inventar para rellenar: no hay cifras de mercado, de clientes, de Competencia ni de sector que no estén en el contexto. Si el peso de la matriz impide sostener una de las dos preguntas, dilo con esas palabras en lugar de rellenarla.',
  'Esta lectura es la primera capa; el detalle por dimensión va en los hallazgos, con su categoría y su evidencia.',
].join('\n\n')

const checkySystemRules = [
  CHECKY_ROLE,
  CHECKY_JUDGMENT_RULES,
  CHECKY_DO_NOT_INVENT,
  'Actúas como ASESOR, no como ejecutor. Todo lo que produzcas es una propuesta trazable: el usuario decide qué acepta, qué descarta y qué ejecuta. Nunca presentes una sugerencia como si ya estuviera aplicada, y nunca la redactes en modo imperativo sobre el sistema.',
  CHECKY_CROSS_TYPES,
  CHECKY_ANTI_ECHO,
  CHECKY_STRATEGIC_READING,
  CHECKY_ANALYSIS_DIMENSIONS,
  CHECKY_MISSING_CROSS_GATE,
  CHECKY_CONSOLIDATED_STRATEGIES,
  CHECKY_SUGGESTED_STRATEGY,
  CHECKY_RECOMMENDATION_CRITERIA,
  CHECKY_RECOMMENDATION_DISCIPLINE,
  'Cada hallazgo debe citar evidencia real en evidenceIds usando los ids de factores o cruces recibidos. Si un hallazgo no se sustenta en ningún id recibido, deja evidenceIds vacío.',
  'Marca basis como FACT solo cuando el hallazgo esté explícitamente respaldado por el contexto recibido. En cualquier otro caso usa INFERENCE. Ante la duda, INFERENCE.',
  'Usa insufficientData de forma quirúrgica: solo cuando una dimensión concreta no puede evaluarse por falta de datos, nunca porque el conjunto te parezca amplio. Cada elemento de missingInformation debe ser un dato concreto y accionable de pedir a la empresa, no una queja general.',
  'Puedes combinar insufficientData en true con findings no vacíos: informa de lo que sí evaluaste y de lo que no.',
  'Ordena los hallazgos por impacto en la decisión, y no repitas el mismo hallazgo con distinto título.',
  'Devuelve únicamente JSON válido según el schema solicitado.',
].join('\n\n')

const CHECKY_INTERNAL_FACTOR_TYPES = new Set(['STRENGTH', 'WEAKNESS'])

/**
 * Deriva del contexto un mapa de trabajo que el modelo no debería tener que
 * calcular mentalmente: qué factores quedan fuera de todo cruce, qué pares ya
 * existen (normalizados, para no sugerir un cruce inverso) y qué cruce tiene
 * estrategia vacía. No inventa datos: solo reorganiza los que el usuario
 * registró. La salida JSON del modelo no cambia.
 */
const buildCheckyWork = (context: CheckyContext) => {
  const factorById = new Map(context.swotItems.map((item) => [item.id, item]))
  const factorRef = (id: string) => factorById.get(id) ?? { id, type: 'UNKNOWN', description: '' }
  const orderPair = (factor1Id: string, factor2Id: string) =>
    CHECKY_INTERNAL_FACTOR_TYPES.has(factorRef(factor1Id).type)
      ? { internalId: factor1Id, externalId: factor2Id }
      : { internalId: factor2Id, externalId: factor1Id }

  const crosses = context.crosses.map((cross) => {
    const { internalId, externalId } = orderPair(cross.factor1Id, cross.factor2Id)
    const internalFactor = factorRef(internalId)
    const externalFactor = factorRef(externalId)
    const strategy = cross.strategy?.trim() ?? ''
    const weighting = (context.weightings ?? []).find((candidate) => candidate.crossId === cross.id) ?? null
    return {
      id: cross.id,
      crossType: cross.crossType,
      origin: cross.origin,
      pairKey: `${internalId}::${externalId}`,
      internalFactorId: internalId,
      internalFactorType: internalFactor.type,
      internalFactorDescription: internalFactor.description,
      externalFactorId: externalId,
      externalFactorType: externalFactor.type,
      externalFactorDescription: externalFactor.description,
      strategy,
      hasStrategy: strategy.length > 0,
      // Se copia tal cual venía de la BD. Checky lo lee para priorizar, no para recalcularlo.
      weightedScore: weighting?.weightedScore ?? null,
      weightingBand: weighting?.weightingBand ?? null,
      hasWeighting: weighting !== null,
    }
  })

  const crossIdsByFactor = new Map<string, string[]>()
  for (const cross of crosses) {
    for (const factorId of [cross.internalFactorId, cross.externalFactorId]) {
      crossIdsByFactor.set(factorId, [...(crossIdsByFactor.get(factorId) ?? []), cross.id])
    }
  }

  const factorsByType: Record<string, Array<{ id: string; description: string }>> = {}
  for (const item of context.swotItems) {
    const bucket = factorsByType[item.type] ?? []
    bucket.push({ id: item.id, description: item.description })
    factorsByType[item.type] = bucket
  }

  const crossCountByType: Record<string, number> = {}
  for (const cross of crosses) {
    crossCountByType[cross.crossType] = (crossCountByType[cross.crossType] ?? 0) + 1
  }

  // Una estrategia es un cruce que ya tiene texto de estrategia; lo pendiente de ponderar es una
  // cuenta sobre esas mismas estrategias, nunca sobre los cruces a medio construir.
  const weightingsByCrossId = new Map((context.weightings ?? []).map((weighting) => [weighting.crossId, weighting]))
  const strategies = crosses.filter((cross) => cross.hasStrategy)
  const evaluated = strategies.filter((cross) => weightingsByCrossId.has(cross.id))
  const pending = strategies.filter((cross) => !weightingsByCrossId.has(cross.id))

  const priorityCounts = Object.fromEntries(
    CHECKY_WEIGHTING_BANDS.map(({ band }) => [band, evaluated.filter((cross) => cross.weightingBand === band).length]),
  ) as Record<CheckyWeightingBand, number>

  const summarize = (cross: { id: string; crossType: string; strategy: string }) => {
    const weighting = weightingsByCrossId.get(cross.id)
    return {
      crossId: cross.id,
      crossType: cross.crossType,
      strategy: cross.strategy,
      weightedScore: weighting?.weightedScore ?? null,
      weightingBand: weighting?.weightingBand ?? null,
    }
  }

  // El contraste útil para la conversación: mucho impacto y poca viabilidad. Sale de los niveles ya
  // guardados, no del ponderado, así que no vuelve a ponderar nada; solo puede cubrir estrategias
  // ponderadas, porque un cruce sin ponderación no tiene niveles que leer.
  const lowFeasibilityHighImpact = (context.weightings ?? []).filter((weighting) => isLowFeasibility(weighting.criteria.viabilidad) && isHighImpact(weighting.criteria.impactoEstrategico)).map((weighting) => ({
    crossId: weighting.crossId,
    crossType: weighting.crossType,
    strategy: weighting.strategy,
    weightedScore: weighting.weightedScore,
    weightingBand: weighting.weightingBand,
    viabilidad: weighting.criteria.viabilidad,
    impactoEstrategico: weighting.criteria.impactoEstrategico,
  }))

  return {
    factorsByType,
    factorCountByType: Object.fromEntries(
      ['STRENGTH', 'WEAKNESS', 'OPPORTUNITY', 'THREAT'].map((type) => [type, factorsByType[type]?.length ?? 0]),
    ),
    crosses,
    crossCountByType,
    existingPairs: crosses.map((cross) => cross.pairKey),
    crossesWithoutStrategy: crosses.filter((cross) => !cross.hasStrategy).map((cross) => cross.id),
    strategiesWithoutWeighting: pending.map((cross) => cross.id),
    totalStrategies: strategies.length,
    evaluatedStrategies: evaluated.length,
    pendingStrategies: pending.length,
    priorityCounts,
    highPriorityStrategies: evaluated.filter((cross) => cross.weightingBand === HIGH_PRIORITY_BAND).map(summarize),
    lowFeasibilityHighImpact,
    factorCoverage: context.swotItems.map((item) => {
      const crossIds = crossIdsByFactor.get(item.id) ?? []
      return { id: item.id, type: item.type, crossCount: crossIds.length, crossIds, isUnused: crossIds.length === 0 }
    }),
  }
}

type CheckyWorkMap = ReturnType<typeof buildCheckyWork>

/**
 * Compuerta de los cruces que Checky propone, aplicada en código y no solo en el prompt.
 *
 * El prompt ya exige no repetir un cruce existente, pero una instrucción no es una garantía: el
 * modelo puede devolver el mismo par o su inverso. Aquí cada MISSING_CROSSES se contrasta con los
 * cruces ya registrados antes de convertirse en sugerencia, con la misma comparación que usa la
 * creación de cruces de la aplicación: tipo de cruce y pareja de factores, nunca el orden. El par se
 * normaliza con el factor interno primero, igual que `workMap.existingPairs`, así que proponer los dos
 * factores al revés describe la misma combinación y se descarta igual.
 *
 * Los cruces que el modelo devuelve en la misma respuesta entran en el mismo conjunto que los que ya
 * estaban en la matriz, de modo que tampoco puede proponer dos veces la misma combinación.
 *
 * Se descarta además la pareja que no resuelve a exactamente dos factores del diagnóstico —uno interno
 * y otro externo, que es la única forma que produce un cruce válido—: sin ellos la sugerencia no se
 * podría ni crear ni aceptar, y una tarjeta que el usuario solo puede rechazar le cuesta un turno.
 *
 * No toca ninguna otra categoría: un hallazgo que no propone un cruce se conserva tal cual, con su
 * evidencia y su base, porque no compite con la matriz DOFA.
 */
export const withoutRedundantMissingCrosses = (
  findings: CheckyConsultResult['findings'],
  swotItems: CheckyContext['swotItems'],
  existingPairs: readonly string[],
): CheckyConsultResult['findings'] => {
  const factorById = new Map(swotItems.map((item) => [item.id, item]))
  const taken = new Set(existingPairs)
  return findings.filter((finding) => {
    if (finding.category !== 'MISSING_CROSSES') return true
    const cited = finding.evidenceIds.map((id) => factorById.get(id)).filter((item): item is CheckyContext['swotItems'][number] => item !== undefined)
    if (cited.length !== 2) return false
    const internal = cited.find((item) => CHECKY_INTERNAL_FACTOR_TYPES.has(item.type))
    const external = cited.find((item) => !CHECKY_INTERNAL_FACTOR_TYPES.has(item.type))
    if (!internal || !external || !crossTypeFor(internal.type, external.type)) return false
    const pairKey = `${internal.id}::${external.id}`
    if (taken.has(pairKey)) return false
    taken.add(pairKey)
    return true
  })
}

/**
 * Deja en las inferencias solo la evidencia que existe en la matriz.
 *
 * Pedirle al modelo que cite ids no basta: un id que no corresponde a ningún factor se convertiría en
 * un enlace a nada cuando la pantalla lolea. Aquí se recorta lo que no resuelve contra los factores
 * reales del diagnóstico y se deduplica, de modo que lo que llega a la tabla y a la pantalla es
 * siempre una cita que se puede leer. Si el modelo no cita nada o cita solo inventos, la inferencia se
 * queda sin evidencia: se conserva su texto, que es lo que el usuario pidió leer, y lo que no se
 * inventa es la cita.
 */
const withRealEvidenceIds = (analysis: AIAnalysisResult, swotItems: DiagnosticForAI['swotItems']): AIAnalysisResult => {
  const known = new Set(swotItems.map((item) => item.id))
  return {
    ...analysis,
    keyFindings: analysis.keyFindings.map((finding) => ({
      ...finding,
      evidenceIds: [...new Set(finding.evidenceIds.filter((id) => known.has(id)))],
    })),
  }
}

/**
 * Andamiaje de análisis por dimensión, calculado con los datos del diagnóstico. No recomienda nada y
 * no inventa: solo deja escrito qué huecos existen y con qué ids reales puede apoyarse Checky. Cada
 * sección alimenta una dimensión concreta, y todas las entradas llevan los ids que el modelo debe
 * citar en evidenceIds para que el hallazgo no sea una opinión.
 */
const buildCheckyAnalysis = (context: CheckyContext, workMap: CheckyWorkMap) => {
  const weightingByCrossId = new Map((context.weightings ?? []).map((weighting) => [weighting.crossId, weighting]))
  const crossById = new Map(workMap.crosses.map((cross) => [cross.id, cross]))
  const crossCountByFactor = new Map(workMap.factorCoverage.map((item) => [item.id, item.crossCount]))

  // Orden de lectura, no de ejecución: el ponderado ordena lo que el usuario ya registró, y esa
  // jerarquía no es por sí sola una recomendación. Los criterios viajan para que el motivo pueda
  // apoyarse en ellos y no solo en el número.
  const priorityRanking = workMap.crosses
    .filter((cross) => cross.hasWeighting)
    .map((cross) => {
      const weighting = weightingByCrossId.get(cross.id)
      return {
        crossId: cross.id,
        crossType: cross.crossType,
        strategy: cross.strategy,
        weightedScore: weighting?.weightedScore ?? null,
        weightingBand: cross.weightingBand,
        criteria: weighting?.criteria ?? null,
      }
    })
    .sort((left, right) => (right.weightedScore ?? 0) - (left.weightedScore ?? 0))

  const unweightedStrategies = workMap.crosses
    .filter((cross) => cross.hasStrategy && !cross.hasWeighting)
    .map((cross) => ({ crossId: cross.id, crossType: cross.crossType, strategy: cross.strategy, factorIds: [cross.internalFactorId, cross.externalFactorId] }))

  // Un cruce ponderado pero sin texto de estrategia es el hueco más incoherente del diagnóstico:
  // alguien decidió cuánto vale y nunca escribió el qué. Se separa del resto de cruces vacíos.
  const weightedCrossesWithoutStrategy = workMap.crosses
    .filter((cross) => !cross.hasStrategy && cross.hasWeighting)
    .map((cross) => ({ crossId: cross.id, crossType: cross.crossType, weightedScore: cross.weightedScore, weightingBand: cross.weightingBand, factorIds: [cross.internalFactorId, cross.externalFactorId] }))

  const crossesWithoutStrategy = workMap.crosses
    .filter((cross) => !cross.hasStrategy)
    .map((cross) => ({ crossId: cross.id, crossType: cross.crossType, hasWeighting: cross.hasWeighting, weightedScore: cross.weightedScore, factorIds: [cross.internalFactorId, cross.externalFactorId] }))

  /**
   * Señales estructurales, no atribuciones de calidad: el servidor solo puede observar que la
   * ponderación y el texto no caminan en la misma dirección. Si una señal aparece, es un motivo
   * para que Checky pregunte, nunca una conclusión que pueda afirmar como hecho.
   */
  const strategyWeightingSignals = priorityRanking.flatMap((entry) => {
    const signals: Array<{ kind: string; crossId: string; crossType: string; weightedScore: number | null; weightingBand: string | null; factorIds: string[]; detail: string }> = []
    const factorIds = crossById.get(entry.crossId) ? [crossById.get(entry.crossId)!.internalFactorId, crossById.get(entry.crossId)!.externalFactorId] : []
    if (entry.criteria && isHighImpact(entry.criteria.impactoEstrategico) && isLowFeasibility(entry.criteria.viabilidad)) {
      signals.push({ kind: 'IMPACT_HIGH_FEASIBILITY_LOW', crossId: entry.crossId, crossType: entry.crossType, weightedScore: entry.weightedScore, weightingBand: entry.weightingBand, factorIds, detail: 'El usuario valora el impacto estratégico por encima de la viabilidad: la estrategia promete mucho y cuesta mucho. Es una decisión legítima, pero conviene que sepa qué está comprando.' })
    }
    // Un cruce sin estrategia no es "texto corto": ya tiene su propia sección, weightedCrossesWithoutStrategy.
    const strategyLength = entry.strategy?.length ?? 0
    if (strategyLength > 0 && isHighPriorityBand(entry.weightingBand) && strategyLength < THIN_STRATEGY_CHARS) {
      signals.push({ kind: 'HIGH_PRIORITY_THIN_TEXT', crossId: entry.crossId, crossType: entry.crossType, weightedScore: entry.weightedScore, weightingBand: entry.weightingBand, factorIds, detail: `La estrategia está ponderada en una banda alta pero su texto ocupa ${strategyLength} caracteres: la valoración va por delante de la redacción.` })
    }
    const thinnestFactor = factorIds.find((id) => (crossCountByFactor.get(id) ?? 0) === 1)
    if (isHighPriorityBand(entry.weightingBand) && thinnestFactor && factorIds.length === 2) {
      signals.push({ kind: 'HIGH_PRIORITY_THIN_EVIDENCE', crossId: entry.crossId, crossType: entry.crossType, weightedScore: entry.weightedScore, weightingBand: entry.weightingBand, factorIds, detail: `Uno de los dos factores solo aparece en este cruce (${thinnestFactor}), así que la prioridad descansa sobre una base empírica estrecha.` })
    }
    return signals
  })

  // No se precalculan pares candidatos: decidir si dos factores se relacionan de verdad es un
  // juicio que corresponde a Checky y a la compuerta estricta. Aquí solo se le da el inventario
  // de factores que todavía no participa en ningún cruce, con sus ids reales.
  const unusedFactors = workMap.factorCoverage.filter((item) => item.isUnused).map((item) => ({ id: item.id, type: item.type }))

  return {
    priorityRanking,
    unweightedStrategies,
    crossesWithoutStrategy,
    weightedCrossesWithoutStrategy,
    strategyWeightingSignals,
    unusedFactors,
    hasAnyWeighting: weightingByCrossId.size > 0,
  }
}

export class AIService {
  private readonly client: OpenAIClient | null

  constructor(client?: OpenAIClient) {
    this.client = client ?? (env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) as unknown as OpenAIClient : null)
  }

  private fail(error: unknown): never {
    if (error instanceof AIServiceError) {
      throw error
    }

    const providerError = error as {
      status?: number
      code?: string
      message?: string
      request_id?: string
    }

    console.error('[AIService] OpenAI provider error', {
      status: providerError.status,
      code: providerError.code,
      message: providerError.message,
      request_id: providerError.request_id,
      model: env.OPENAI_MODEL,
    })

    throw new AIServiceError('PROVIDER_ERROR')
  }

  async analyze(diagnostic: DiagnosticForAI): Promise<AIAnalysisResult> {
    if (!this.client) throw new AIServiceError('NOT_CONFIGURED')
    const prompt = [
      'Analiza exclusivamente el diagnóstico DOFA proporcionado a continuación.',
      'No inventes hechos, contexto, cifras ni información externa.',
      'En `diagnosis` responde dos preguntas, en este orden: qué está pasando en la organización con lo que está registrado, y qué debería preocuparnos y priorizarse. No es un resumen de los factores: es una lectura estratégica que se apoya en ellos y dice qué significa esa matriz para este diagnóstico.',
      'En `executiveSummary` sintetiza esas dos respuestas en dos o tres frases.',
      'En keyFindings marca cada elemento como FACT si está explícitamente en los datos o INFERENCE si es una inferencia razonable.',
      'Cada elemento de keyFindings lleva `finding` como conclusión principal, `interpretation` explicando por qué esa relación es relevante y `evidenceIds` con los ids de los elementos de `swotItems` de los que se apoya, copiados literalmente. Una inferencia que no se apoya en ningún factor recibido no es una inferencia, así que en ese caso devuelve el array vacío en lugar de inventar una cita.',
      'Las estrategias y recomendaciones son propuestas, no hechos. Manténlas trazables a los factores recibidos.',
      'Devuelve únicamente JSON válido según el schema solicitado.',
      JSON.stringify(diagnostic),
    ].join('\n\n')
    try {
      const response = await this.client.responses.create({
        model: env.OPENAI_MODEL,
        input: prompt,
        text: { format: { type: 'json_schema', name: 'dofa_ai_analysis', strict: true, schema: responseSchema } },
      })
      if (!response.output_text) throw new AIServiceError('INVALID_RESPONSE')
      let candidate: unknown
      try { candidate = JSON.parse(response.output_text) } catch { throw new AIServiceError('INVALID_RESPONSE') }
      const parsed = aiAnalysisSchema.safeParse(candidate)
      if (!parsed.success) throw new AIServiceError('INVALID_RESPONSE')
      return withRealEvidenceIds(parsed.data, diagnostic.swotItems)
    } catch (error) {
      this.fail(error)
    }
  }

  async generateCrosses(items: Array<{ id: string; type: string; description: string }>): Promise<GeneratedCrossForAI[]> {
    if (!this.client) throw new AIServiceError('NOT_CONFIGURED')
    const prompt = [
      'Genera cruces DOFA (FO, DO, FA, DA) a partir de únicamente los factores SWOT proporcionados.',
      'Cada cruce debe formar parejas de factores que ya existen (usa sus ids) y solo entre tipos compatibles según la metodología DOFA.',
      'Escribe estrategias como propuestas trazables a los factores del par. No inventes hechos externos.',
      'Devuelve únicamente JSON válido según el schema solicitado.',
      JSON.stringify(items),
    ].join('\n\n')
    try {
      const response = await this.client.responses.create({
        model: env.OPENAI_MODEL,
        input: prompt,
        text: { format: { type: 'json_schema', name: 'dofa_cross_generation', strict: true, schema: crossGenerationJsonSchema } },
      })
      if (!response.output_text) throw new AIServiceError('INVALID_RESPONSE')
      let candidate: unknown
      try { candidate = JSON.parse(response.output_text) } catch { throw new AIServiceError('INVALID_RESPONSE') }
      const parsed = buildGeneratedCrossSchema(
        new Set(items.map((item) => item.id)),
        new Map(items.map((item) => [item.id, item.type])),
      ).safeParse(candidate)
      if (!parsed.success) throw new AIServiceError('INVALID_RESPONSE')
      return parsed.data.crosses
    } catch (error) {
      this.fail(error)
    }
  }

  async analyzeCrosses(crosses: Array<{ id: string; type: string; origin: string; strategy: string | null; factor1: { type: string; description: string }; factor2: { type: string; description: string } }>): Promise<Array<{ crossId: string; analysis: CrossAnalysisResult }>> {
    if (!this.client) throw new AIServiceError('NOT_CONFIGURED')
    const prompt = [
      'Analiza exclusivamente los cruces DOFA proporcionados a continuación.',
      'No inventes hechos, contexto, cifras ni información externa.',
      'Devuelve únicamente JSON válido según el schema solicitado.',
      JSON.stringify(crosses.map((cross) => ({ ...cross, strategy: cross.strategy ?? '' }))),
    ].join('\n\n')
    try {
      const response = await this.client.responses.create({
        model: env.OPENAI_MODEL,
        input: prompt,
        text: { format: { type: 'json_schema', name: 'dofa_cross_analysis', strict: true, schema: crossAnalysisResultJsonSchema } },
      })
      if (!response.output_text) throw new AIServiceError('INVALID_RESPONSE')
      let candidate: unknown
      try { candidate = JSON.parse(response.output_text) } catch { throw new AIServiceError('INVALID_RESPONSE') }
      const parsed = buildGeneratedCrossesAnalysisSchema(new Set(crosses.map((cross) => cross.id))).safeParse(candidate)
      if (!parsed.success) throw new AIServiceError('INVALID_RESPONSE')
      return parsed.data.analyses
    } catch (error) {
      this.fail(error)
    }
  }

  async consultChecky(context: CheckyContext): Promise<CheckyConsultResult> {
    if (!this.client) throw new AIServiceError('NOT_CONFIGURED')
    const allowedIds = new Set<string>([
      ...context.swotItems.map((item) => item.id),
      ...context.crosses.map((cross) => cross.id),
    ])
    const workMap = buildCheckyWork(context)
    const prompt = [
      checkySystemRules,
      'CONTEXTO RECIBIDO (única fuente de verdad). El bloque workMap está calculado por el servidor a partir de los datos de arriba: úsalo para el análisis de cobertura y para no sugerir cruces que ya existen. no sugieras un par que ya figura en existingPairs.',
      CHECKY_WEIGHTING_RULES,
      CHECKY_ANALYSIS_SCAFFOLD,
      JSON.stringify({
        question: context.question,
        diagnostic: context.diagnostic,
        swotItems: context.swotItems,
        crosses: context.crosses.map((cross) => ({ ...cross, strategy: cross.strategy ?? '' })),
        aiAnalysis: context.aiAnalysis,
        recommendations: context.recommendations,
        weightings: context.weightings ?? [],
        strategies: context.strategies ?? [],
        workMap,
        analysis: { ...buildCheckyAnalysis(context, workMap), strategyPrioritization: buildStrategyPrioritization(context.strategies ?? []) },
      }),
    ].join('\n\n')
    try {
      const response = await this.client.responses.create({
        model: env.OPENAI_MODEL,
        input: prompt,
        text: { format: { type: 'json_schema', name: 'checky_consultation', strict: true, schema: checkyConsultJsonSchema } },
      })
      if (!response.output_text) throw new AIServiceError('INVALID_RESPONSE')
      let candidate: unknown
      try { candidate = JSON.parse(response.output_text) } catch { throw new AIServiceError('INVALID_RESPONSE') }
      const parsed = buildCheckyConsultSchema(allowedIds).safeParse(candidate)
      if (!parsed.success) {
        // TEMP logging de diagnóstico: solo rutas, códigos y mensajes de la validación. Sin contenido
        // generado, sin contexto del diagnóstico y sin credenciales.
        console.error('[AIService] Checky consult rejected by schema', {
          issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message })),
          allowedIdsSize: allowedIds.size,
        })
        throw new AIServiceError('INVALID_RESPONSE')
      }
      return { ...parsed.data, findings: withoutRedundantMissingCrosses(parsed.data.findings, context.swotItems, workMap.existingPairs) }
    } catch (error) {
      this.fail(error)
    }
  }
}
