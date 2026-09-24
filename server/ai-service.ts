import OpenAI from 'openai'
import { env } from './env.js'
import { aiAnalysisSchema, buildGeneratedCrossSchema, buildGeneratedCrossesAnalysisSchema, crossAnalysisSchema, crossTypeSchema } from './validation.js'
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

export class AIService {
  private readonly client: OpenAIClient | null

  constructor(client?: OpenAIClient) {
    this.client = client ?? (env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) as unknown as OpenAIClient : null)
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
  }
}
