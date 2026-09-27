import OpenAI from 'openai'
import { env } from './env.js'
import { aiAnalysisSchema, buildCheckyConsultSchema, buildGeneratedCrossSchema, buildGeneratedCrossesAnalysisSchema, crossAnalysisSchema, crossTypeSchema } from './validation.js'
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
  swotItems: Array<{ type: string; description: string }>
}
export type CheckyContext = {
  question: string
  diagnostic: { title: string; description: string; status: string }
  swotItems: Array<{ id: string; type: string; description: string }>
  crosses: Array<{ id: string; crossType: string; origin: string; factor1Id: string; factor2Id: string; strategy: string | null }>
  aiAnalysis: { executiveSummary: string; keyFindings: unknown; priorityRisks: unknown; priorityOpportunities: unknown } | null
  recommendations: Array<{ title: string; priority: string; status: string }>
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
    keyFindings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { finding: { type: 'string' }, basis: { type: 'string', enum: ['FACT', 'INFERENCE'] } }, required: ['finding', 'basis'] } },
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
  '4. El par equivalente NO existe ya. Usa existingPairs del contexto, que ya viene normalizado con el formato idInterno::idExterno. Recuerda que un par DA y su equivalente FA son el mismo cruce visto al revés.',
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

const checkySystemRules = [
  CHECKY_ROLE,
  CHECKY_JUDGMENT_RULES,
  CHECKY_DO_NOT_INVENT,
  'Actúas como ASESOR, no como ejecutor. Todo lo que produzcas es una propuesta trazable: el usuario decide qué acepta, qué descarta y qué ejecuta. Nunca presentes una sugerencia como si ya estuviera aplicada, y nunca la redactes en modo imperativo sobre el sistema.',
  CHECKY_CROSS_TYPES,
  CHECKY_ANTI_ECHO,
  CHECKY_ANALYSIS_DIMENSIONS,
  CHECKY_MISSING_CROSS_GATE,
  CHECKY_SUGGESTED_STRATEGY,
  CHECKY_RECOMMENDATION_CRITERIA,
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

  return {
    factorsByType,
    factorCountByType: Object.fromEntries(
      ['STRENGTH', 'WEAKNESS', 'OPPORTUNITY', 'THREAT'].map((type) => [type, factorsByType[type]?.length ?? 0]),
    ),
    crosses,
    crossCountByType,
    existingPairs: crosses.map((cross) => cross.pairKey),
    crossesWithoutStrategy: crosses.filter((cross) => !cross.hasStrategy).map((cross) => cross.id),
    factorCoverage: context.swotItems.map((item) => {
      const crossIds = crossIdsByFactor.get(item.id) ?? []
      return { id: item.id, type: item.type, crossCount: crossIds.length, crossIds, isUnused: crossIds.length === 0 }
    }),
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
      'En keyFindings marca cada elemento como FACT si está explícitamente en los datos o INFERENCE si es una inferencia razonable.',
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
      return parsed.data
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
    const prompt = [
      checkySystemRules,
      'CONTEXTO RECIBIDO (única fuente de verdad). El bloque workMap está calculado por el servidor a partir de los datos de arriba: úsalo para el análisis de cobertura y para no sugerir cruces que ya existen. no sugieras un par que ya figura en existingPairs.',
      JSON.stringify({
        question: context.question,
        diagnostic: context.diagnostic,
        swotItems: context.swotItems,
        crosses: context.crosses.map((cross) => ({ ...cross, strategy: cross.strategy ?? '' })),
        aiAnalysis: context.aiAnalysis,
        recommendations: context.recommendations,
        workMap: buildCheckyWork(context),
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
      if (!parsed.success) throw new AIServiceError('INVALID_RESPONSE')
      return parsed.data
    } catch (error) {
      this.fail(error)
    }
  }
}
