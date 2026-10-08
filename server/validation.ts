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
  companyId: z.union([z.string().cuid(), z.string().uuid()]).nullable().optional(),
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

export const processTypeSchema = z.enum(['STRATEGIC', 'MISSIONAL', 'SUPPORT'])
export const processStatusSchema = z.enum(['ACTIVE', 'INACTIVE'])

const processReferenceFieldSchema = z.string().trim().max(120)

/**
 * Alta de un proceso. El nombre y el objetivo no admiten solo espacios: el `trim` va antes del
 * `min`, de modo que "   " no sirve para pasar la validación. `companyId` es opcional porque solo
 * lo envía el súper usuario, que no tiene empresa propia; para los roles de empresa el servidor
 * toma la de la sesión y nunca la lee del cuerpo.
 */
export const processCreateSchema = z.object({
  name: z.string().trim().min(3).max(120),
  type: processTypeSchema,
  objective: z.string().trim().min(3).max(2000),
  description: z.string().trim().max(5000).nullable().optional(),
  code: z.string().trim().max(40).nullable().optional(),
  version: processReferenceFieldSchema.nullable().optional(),
  frequency: processReferenceFieldSchema.nullable().optional(),
  organizationalArea: processReferenceFieldSchema.nullable().optional(),
  supervision: processReferenceFieldSchema.nullable().optional(),
  deliveryMethod: processReferenceFieldSchema.nullable().optional(),
  executionType: processReferenceFieldSchema.nullable().optional(),
  thirdPartyProvided: z.boolean().optional(),
  critical: z.boolean().optional(),
  cashMovement: z.boolean().optional(),
  contingencyPlan: z.boolean().optional(),
  taxOperations: z.boolean().optional(),
  affectsAccounting: z.boolean().optional(),
  personalData: z.boolean().optional(),
  status: processStatusSchema.optional(),
  responsibleId: z.string().cuid().nullable().optional(),
  companyId: z.string().cuid().optional(),
})

/** La edición no mueve el proceso de empresa: cambiar de compañía no está soportado. */
export const processUpdateSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  type: processTypeSchema.optional(),
  objective: z.string().trim().min(3).max(2000).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  code: z.string().trim().max(40).nullable().optional(),
  version: processReferenceFieldSchema.nullable().optional(),
  frequency: processReferenceFieldSchema.nullable().optional(),
  organizationalArea: processReferenceFieldSchema.nullable().optional(),
  supervision: processReferenceFieldSchema.nullable().optional(),
  deliveryMethod: processReferenceFieldSchema.nullable().optional(),
  executionType: processReferenceFieldSchema.nullable().optional(),
  thirdPartyProvided: z.boolean().optional(),
  critical: z.boolean().optional(),
  cashMovement: z.boolean().optional(),
  contingencyPlan: z.boolean().optional(),
  taxOperations: z.boolean().optional(),
  affectsAccounting: z.boolean().optional(),
  personalData: z.boolean().optional(),
  status: processStatusSchema.optional(),
  responsibleId: z.string().cuid().nullable().optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const processQuerySchema = z.object({
  companyId: z.string().cuid().optional(),
})

const kpiText = (max: number) => z.string().trim().min(1).max(max)
const kpiNullableText = (max: number) => z.string().trim().max(max).nullable().optional()
// Los ids de usuarios se validan contra la empresa en la API; la base existente también contiene UUIDs.
const kpiResponsibleId = z.string().trim().min(1).max(64).nullable().optional()

export const kpiCreateSchema = z.object({
  name: kpiText(120).refine((value) => value.length >= 3, 'Name must have at least 3 characters'),
  description: kpiText(5000),
  frequency: kpiText(80),
  target: kpiText(120),
  formula: kpiText(1000),
  dataSource: kpiText(1000),
  unit: kpiText(80),
  reportResponsibleId: kpiResponsibleId,
  monitorResponsibleId: kpiResponsibleId,
  greenThreshold: kpiNullableText(120),
  yellowThreshold: kpiNullableText(120),
  redThreshold: kpiNullableText(120),
})

export const kpiUpdateSchema = kpiCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const kpiQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
})

export const sipocKindSchema = z.enum(['suppliers', 'inputs', 'outputs', 'customers'])
export const sipocItemCreateSchema = z.object({
  description: z.string().trim().min(1).max(500),
})
export const sipocItemUpdateSchema = sipocItemCreateSchema

const riskScaleValue = z.number().int().min(1).max(5)
export const riskCreateSchema = z.object({
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(5000),
  riskType: z.string().trim().min(2).max(120),
  bpmnActivity: z.string().trim().min(2).max(160),
  inherentImpact: riskScaleValue,
  inherentProbability: riskScaleValue,
  residualImpact: riskScaleValue,
  residualProbability: riskScaleValue,
})
export const riskUpdateSchema = riskCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one risk field is required',
)

export const riskControlEvaluationSchema = z.enum(['PENDING', 'WEAK', 'PARTIAL', 'EFFECTIVE'])
export const riskControlCreateSchema = z.object({
  description: z.string().trim().min(3).max(1000),
  evaluation: riskControlEvaluationSchema.default('PENDING'),
})
export const riskControlUpdateSchema = riskControlCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one control field is required',
)

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

/** Los ids de los factores DOFA de los que se apoya la inferencia, para poder leer su evidencia. Van
 *  con `default([])` y no son obligatorios a propósito: `keyFindings` es un Json que ya está escrito
 *  en la base sin este campo, y endurecer el schema haría que esas lecturas viejas dejaran de poder
 *  leerse al abrir el diagnóstico. Lo que sí se exige es que sean ids de verdad, y eso lo comprueba el
 *  servicio contra la matriz del diagnóstico, no el schema. */
export const aiFindingSchema = z.object({
  finding: z.string().trim().min(1).max(2000),
  basis: z.enum(['FACT', 'INFERENCE']),
  evidenceIds: z.array(z.string().trim().min(1).max(64)).max(8).default([]),
  /** Campo nuevo para separar la conclusión de la explicación sin romper lecturas ya guardadas. */
  interpretation: z.string().trim().max(3000).optional(),
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

export const strategyTasksCreateSchema = z.object({
  strategyId: z.string().trim().min(1).max(200),
  tasks: z.array(z.object({
    title: z.string().trim().min(3).max(120),
    // Los ids de usuario de esta base no tienen un solo formato: Prisma genera cuid y el seed
    // genera uuid (gen_random_uuid). Exigir cuid rechazaba responsables reales con un
    // "Invalid strategy task data". El endpoint comprueba además que el responsable exista y
    // pertenezca a la compañía, así que aquí solo se pide que venga un id.
    responsibleId: z.string().trim().min(1),
    dueDate: z.coerce.date(),
  })).min(1).max(50),
})

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
  /**
   * Decisión sobre la estrategia del cruce tomada en Checky. Es el mismo enum que usan las
   * sugerencias, así que la pantalla pinta el mismo badge en los dos casos y Ponderación reconoce
   * sin traducir qué estrategias aceptó la persona.
   */
  strategyStatus: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).optional(),
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

/**
 * Fuentes que admiten ponderación consolidada. Los cruces no entran aquí: se pesan con
 * crossWeightingSchema contra su propio cruce.
 */
/**
 * Fuentes que Ponderación puede enviar en una valoración. STRATEGIC_CROSS se acepta aquí porque la
 * estrategia de un cruce aceptado en Checky se valora en esta misma pantalla, pero el endpoint la
 * redirige a StrategicCrossWeighting: esta solicitud nunca escribe en la tabla de estrategias.
 */
export const weightableStrategySourceSchema = z.enum(['AI_ANALYSIS', 'CHECKY', 'STRATEGIC_CROSS'])

/**
 * Ponderación de una estrategia consolidada. El ancla (`source` y `sourceRef`) llega del cliente
 * pero el servidor la revalida contra la consolidación real del diagnóstico, así que aquí solo se
 * comprueba la forma. `strict()` hace que weightedScore, diagnosticId, createdById, id o cualquier
 * otro campo inesperado sean un error en lugar de ignorarse: el ponderado es del servidor.
 */
export const strategyWeightingSchema = crossWeightingSchema.extend({
  source: weightableStrategySourceSchema,
  sourceRef: z.string().trim().min(1).max(128),
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
