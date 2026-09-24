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
