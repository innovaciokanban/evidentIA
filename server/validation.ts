import { z } from 'zod'

export const roleSchema = z.enum(['SUPERUSER', 'COMPANY_ADMIN', 'COMPANY_USER'])
export const statusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
export const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
})

export const ticketCreateSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(5000),
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  assignedToId: z.string().cuid().nullable().optional(),
})

export const ticketUpdateSchema = ticketCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const ticketQuerySchema = z.object({
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  search: z.string().trim().max(120).optional(),
})

export const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  role: roleSchema,
  companyId: z.string().cuid().nullable().optional(),
})

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  password: z.string().min(8).max(128).optional(),
  role: roleSchema.optional(),
  companyId: z.string().cuid().nullable().optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

const companyDataSchema = z.object({
  name: z.string().trim().min(2).max(120),
  identification: z.string().trim().min(3).max(40),
  industry: z.string().trim().min(2).max(80),
  description: z.string().trim().min(3).max(5000),
})

export const companyCreateSchema = companyDataSchema.extend({
  admin: z.object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8).max(128),
  }).optional(),
})

export const companyUpdateSchema = companyDataSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const companyQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
})

export const diagnosticStatusSchema = z.enum(['DRAFT', 'IN_PROGRESS', 'COMPLETED'])
export const swotTypeSchema = z.enum(['STRENGTH', 'WEAKNESS', 'OPPORTUNITY', 'THREAT'])
export const priorityLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH'])
export const impactSchema = z.enum(['LOW', 'MEDIUM', 'HIGH'])

export const diagnosticCreateSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(5000),
  status: diagnosticStatusSchema.optional(),
})

export const diagnosticUpdateSchema = diagnosticCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const swotItemCreateSchema = z.object({
  type: swotTypeSchema,
  description: z.string().trim().min(3).max(2000),
})

export const swotItemUpdateSchema = swotItemCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const aiFindingSchema = z.object({
  finding: z.string().trim().min(1).max(2000),
  basis: z.enum(['FACT', 'INFERENCE']),
})

export const aiRecommendationSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(3000),
  priority: priorityLevelSchema,
  expectedImpact: z.string().trim().min(1).max(1000),
  suggestedAction: z.string().trim().min(1).max(2000),
})

export const aiAnalysisSchema = z.object({
  executiveSummary: z.string().trim().min(1).max(5000),
  diagnosis: z.string().trim().min(1).max(5000),
  keyFindings: z.array(aiFindingSchema).max(30),
  foStrategies: z.array(z.string().trim().min(1).max(3000)).max(30),
  doStrategies: z.array(z.string().trim().min(1).max(3000)).max(30),
  faStrategies: z.array(z.string().trim().min(1).max(3000)).max(30),
  daStrategies: z.array(z.string().trim().min(1).max(3000)).max(30),
  priorityRisks: z.array(z.string().trim().min(1).max(2000)).max(30),
  priorityOpportunities: z.array(z.string().trim().min(1).max(2000)).max(30),
  recommendations: z.array(aiRecommendationSchema).max(30),
})

export const recommendationStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REJECTED'])
export const actionPlanStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'COMPLETED'])
export const actionItemStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])

export const recommendationUpdateSchema = z.object({
  status: recommendationStatusSchema,
})

export const actionPlanCreateSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(5000),
  status: actionPlanStatusSchema.optional(),
})

export const actionPlanUpdateSchema = actionPlanCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const actionItemCreateSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(5000),
  priority: priorityLevelSchema,
  status: actionItemStatusSchema.optional(),
  recommendationId: z.string().cuid().nullable().optional(),
  responsibleId: z.string().cuid().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
})

export const actionItemUpdateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().min(3).max(5000).optional(),
  priority: priorityLevelSchema.optional(),
  status: actionItemStatusSchema.optional(),
  recommendationId: z.string().cuid().nullable().optional(),
  responsibleId: z.string().cuid().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const crossTypeSchema = z.enum(['FO', 'DO', 'FA', 'DA'])
export const crossOriginSchema = z.enum(['USER', 'AI', 'BOTH'])

export const crossCreateSchema = z.object({
  factor1Id: z.string().cuid(),
  factor2Id: z.string().cuid(),
  strategy: z.string().trim().min(3).max(3000).optional(),
})

export const crossUpdateSchema = z.object({
  strategy: z.string().trim().min(3).max(3000).optional(),
  priority: priorityLevelSchema.optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const weightingLevelSchema = z.enum(['MUY_BAJO', 'BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO'])

/**
 * El cliente solo elige el nivel de cada criterio. `strict()` hace que un campo inesperado sea un
 * error en lugar de ignorarse, de modo que nobody pueda intentar fijar weightedScore desde fuera.
 */
export const crossWeightingSchema = z.object({
  impactoEstrategico: weightingLevelSchema,
  viabilidad: weightingLevelSchema,
  urgencia: weightingLevelSchema,
  sinergiaInterna: weightingLevelSchema,
  impactoReputacional: weightingLevelSchema,
}).strict()

export const crossAnalyzeSchema = z.object({
  crosses: z.array(z.string().cuid()).max(200).optional(),
  origin: crossOriginSchema.optional(),
}).optional()

export const crossAnalysisSchema = z.object({
  relevance: z.string().trim().min(1).max(5000),
  strategy: z.string().trim().min(1).max(3000),
  expectedImpact: z.string().trim().min(1).max(3000),
  priority: priorityLevelSchema,
  risks: z.array(z.string().trim().min(1).max(2000)).max(30),
  opportunities: z.array(z.string().trim().min(1).max(2000)).max(30),
  recommendation: z.string().trim().min(1).max(5000),
})

const SWOT_TO_CROSS_PARTNER: Record<string, string[]> = {
  STRENGTH: ['OPPORTUNITY', 'THREAT'],
  WEAKNESS: ['OPPORTUNITY', 'THREAT'],
  OPPORTUNITY: ['STRENGTH', 'WEAKNESS'],
  THREAT: ['STRENGTH', 'WEAKNESS'],
}

const CROSS_TYPE_MATRIX: Record<string, string | undefined> = {
  'STRENGTH:OPPORTUNITY': 'FO', 'OPPORTUNITY:STRENGTH': 'FO',
  'WEAKNESS:OPPORTUNITY': 'DO', 'OPPORTUNITY:WEAKNESS': 'DO',
  'STRENGTH:THREAT': 'FA', 'THREAT:STRENGTH': 'FA',
  'WEAKNESS:THREAT': 'DA', 'THREAT:WEAKNESS': 'DA',
}

export function crossTypeFor(factor1Type: string, factor2Type: string): string | null {
  return CROSS_TYPE_MATRIX[`${factor1Type}:${factor2Type}`] ?? null
}

export function isCompatibleCrossTarget(sourceType: string, targetType: string): boolean {
  return (SWOT_TO_CROSS_PARTNER[sourceType] ?? []).includes(targetType)
}

export function buildGeneratedCrossSchema(allowedIds: Set<string>, typeMap: Map<string, string>) {
  return z.object({
    crosses: z.array(z.object({
      type: crossTypeSchema,
      factor1Id: z.string().refine((v) => allowedIds.has(v), 'Factor must be a valid existing item'),
      factor2Id: z.string().refine((v) => allowedIds.has(v), 'Factor must be a valid existing item'),
      strategy: z.string().trim().min(1).max(3000),
    }).superRefine((cross, ctx) => {
      if (cross.factor1Id === cross.factor2Id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Factors must be different' })
      }
      const t1 = typeMap.get(cross.factor1Id)
      const t2 = typeMap.get(cross.factor2Id)
      if (t1 && t2 && !isCompatibleCrossTarget(t1, t2)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'These factors are not compatible for a strategic cross' })
      }
    })).max(30),
  })
}

export function buildGeneratedCrossesAnalysisSchema(allowedIds: Set<string>) {
  return z.object({
    analyses: z.array(z.object({
      crossId: z.string().refine((v) => allowedIds.has(v), 'Cross must be a valid existing cross'),
      analysis: crossAnalysisSchema,
    })).max(200),
  })
}

export const checkyMessageRoleSchema = z.enum(['USER', 'CHECKY'])
export const checkyFindingBasisSchema = z.enum(['FACT', 'INFERENCE'])
export const checkySuggestionStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REJECTED'])

export const checkyCategorySchema = z.enum([
  'REVIEW_ASPECTS',
  'MISSING_CROSSES',
  'UNRELATED_FACTORS',
  'STRENGTHEN_STRATEGIES',
  'STRATEGIC_RISKS',
  'MISSED_OPPORTUNITIES',
  'INFO_TO_COMPLEMENT',
  'NEXT_STEPS',
])

export const checkySessionCreateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
})

export const checkyMessageCreateSchema = z.object({
  content: z.string().trim().min(1).max(4000),
})

export const checkySuggestionDecisionSchema = z.object({
  status: z.enum(['ACCEPTED', 'REJECTED']),
  decisionNote: z.string().trim().min(1).max(1000).optional(),
})

/**
 * Estrategia que Checky propone para un hallazgo, como estructura y no como prosa. El JSON schema
 * estricto obliga a enviar siempre la clave, así que `null` significa "esta categoría no lleva
 * estrategia". Si viene, debe ser completa: `title` y `description` con contenido real. Un hallazgo
 * que no puede sostener una estrategia concreta omite el campo en lugar de devolverlo vacío.
 */
export const checkySuggestedStrategySchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(20).max(2000),
})

export function buildCheckyConsultSchema(allowedIds: Set<string>) {
  return z.object({
    reply: z.string().trim().min(1).max(5000),
    insufficientData: z.boolean(),
    missingInformation: z.array(z.string().trim().min(1).max(1000)).max(20),
    findings: z.array(z.object({
      category: checkyCategorySchema,
      title: z.string().trim().min(1).max(200),
      detail: z.string().trim().min(1).max(3000),
      basis: checkyFindingBasisSchema,
      evidenceIds: z.array(z.string().refine((v) => allowedIds.has(v), 'Evidence must reference an existing SWOT factor or strategic cross')).max(20),
      suggestedStrategy: checkySuggestedStrategySchema.nullish(),
    })).max(40),
  }).superRefine((result, ctx) => {
    if (!result.insufficientData && result.findings.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['findings'], message: 'Checky must return at least one finding or declare insufficient data' })
    }
    if (result.insufficientData && result.missingInformation.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['missingInformation'], message: 'Insufficient data must state which information is missing' })
    }
  })
}
