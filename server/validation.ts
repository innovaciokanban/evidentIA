import { z } from 'zod'

export const roleSchema = z.enum(['SUPERUSER', 'COMPANY_ADMIN', 'COMPANY_USER'])
export const statusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
export const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])

/**
 * Referencia a Company o User por id. Prisma los declaran con cuid(), pero prisma/seed.ts los
 * inserta con gen_random_uuid(): la base real (incluida UAT) contiene ambos formatos, así que se
 * aceptan los dos y sigue rechazando cualquier cadena que no sea un id de verdad. Las entidades que
 * solo nacen desde Prisma (Recommendation, SWOTItem, StrategicCross, ...) se quedan en cuid().
 */
export const idReference = z.union([z.string().cuid(), z.string().uuid()])

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
})

export const ticketCreateSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(5000),
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  assignedToId: idReference.nullable().optional(),
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
  companyId: idReference.nullable().optional(),
})

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  password: z.string().min(8).max(128).optional(),
  role: roleSchema.optional(),
  companyId: idReference.nullable().optional(),
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
export const processCategorySchema = z.enum(['estrategico', 'misional', 'apoyo'])
export const processTypeForCategory = { estrategico: 'STRATEGIC', misional: 'MISSIONAL', apoyo: 'SUPPORT' } as const
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
  category: processCategorySchema,
  objective: z.string().trim().min(3).max(2000),
  description: z.string().trim().max(5000).nullable().optional(),
  frequency: processReferenceFieldSchema.nullable().optional(),
  organizationalArea: processReferenceFieldSchema.nullable().optional(),
  supervision: processReferenceFieldSchema.nullable().optional(),
  executionType: processReferenceFieldSchema.nullable().optional(),
  thirdPartyProvided: z.boolean().optional(),
  critical: z.boolean().optional(),
  affectsAccounting: z.boolean().optional(),
  personalData: z.boolean().optional(),
  status: processStatusSchema.optional(),
  responsibleId: idReference.nullable().optional(),
  companyId: idReference.optional(),
}).refine(
  (value) => processTypeForCategory[value.category] === value.type,
  { path: ['category'], message: 'Process type does not match selected category' },
)

/** La edición no mueve el proceso de empresa: cambiar de compañía no está soportado. */
export const processUpdateSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  objective: z.string().trim().min(3).max(2000).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  frequency: processReferenceFieldSchema.nullable().optional(),
  organizationalArea: processReferenceFieldSchema.nullable().optional(),
  supervision: processReferenceFieldSchema.nullable().optional(),
  executionType: processReferenceFieldSchema.nullable().optional(),
  thirdPartyProvided: z.boolean().optional(),
  critical: z.boolean().optional(),
  affectsAccounting: z.boolean().optional(),
  personalData: z.boolean().optional(),
  status: processStatusSchema.optional(),
  responsibleId: idReference.nullable().optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const processQuerySchema = z.object({
  companyId: idReference.optional(),
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

// Estados documentales del procedimiento, espejo de ProcedureStatus: DRAFT es el único estado
// editable; APPROVED solo se abandona abriendo una nueva revisión para no pisar lo aprobado.
export const procedureStatusSchema = z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'OBSOLETE'])

const procedureText = (max: number) => z.string().trim().min(1).max(max)
// El responsable se valida contra la empresa en la API; la base existente también contiene UUIDs
// (mismo criterio que kpiResponsibleId).
const procedureResponsibleId = z.string().trim().min(1).max(64).nullable().optional()

export const procedureCreateSchema = z.object({
  code: procedureText(40).refine((value) => value.length >= 2, 'Code must have at least 2 characters'),
  name: procedureText(160).refine((value) => value.length >= 3, 'Name must have at least 3 characters'),
  objective: procedureText(2000),
  scope: procedureText(2000),
  description: z.string().trim().max(10000).nullable().optional(),
  responsibleId: procedureResponsibleId,
})

export const procedureUpdateSchema = procedureCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const procedureQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: procedureStatusSchema.optional(),
})

// Transición de estado del flujo de revisión. La máquina de transiciones permitidas se valida en
// el servidor; aquí solo se acota la forma del comentario que la acompaña.
export const procedureStatusChangeSchema = z.object({
  status: procedureStatusSchema,
  comment: z.string().trim().max(1000).optional(),
})

// Consulta paginada del historial de versiones, mismo formato que riskAuditQuerySchema. El listado
// de acciones es cerrado: solo el backend las emite, el cliente solo puede filtrar.
export const procedureHistoryActionSchema = z.enum(['CREATED', 'UPDATED', 'STATUS_CHANGED'])
export const procedureHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  action: procedureHistoryActionSchema.optional(),
})

// ---- Módulo Auditorías de calidad (Trazabilidad y Control) ----

// Espejo de AuditStatus. PLANNED e IN_PROGRESS son los estados operativos; CLOSED y CANCELLED son
// terminales y bloquean toda escritura posterior (la máquina de transiciones se valida en el servidor).
export const auditStatusSchema = z.enum(['PLANNED', 'IN_PROGRESS', 'CLOSED', 'CANCELLED'])
export const auditFindingTypeSchema = z.enum(['NONCONFORMITY', 'OBSERVATION', 'OPPORTUNITY'])
export const auditFindingSeveritySchema = z.enum(['CRITICAL', 'MAJOR', 'MINOR'])
export const auditFindingStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED'])

const auditText = (max: number) => z.string().trim().min(1).max(max)
// El responsable/auditor se valida contra la empresa en la API; la base existente también contiene
// UUIDs (mismo criterio que kpiResponsibleId y procedureResponsibleId).
const auditUserId = z.string().trim().min(1).max(64).nullable().optional()

export const auditCreateSchema = z.object({
  title: auditText(160).refine((value) => value.length >= 3, 'Title must have at least 3 characters'),
  auditType: z.string().trim().max(80).nullable().optional(),
  scope: auditText(2000),
  objectives: z.string().trim().max(2000).nullable().optional(),
  criteria: auditText(2000),
  plannedDate: z.coerce.date().nullable().optional(),
  leadAuditorId: auditUserId,
  responsibleId: auditUserId,
})

export const auditUpdateSchema = auditCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one audit field is required',
)

export const auditQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: auditStatusSchema.optional(),
})

/**
 * Transición de estado de la auditoría. La máquina de transiciones permitidas se valida en el
 * servidor; aquí solo se acota la forma. Cerrarse exige resumen (se valida en el handler con el
 * estado guardado, porque en PATCH no viene el estado actual).
 */
export const auditStatusChangeSchema = z.object({
  status: auditStatusSchema,
  summary: z.string().trim().max(10000).optional(),
})

export const auditFindingCreateSchema = z.object({
  title: auditText(200).refine((value) => value.length >= 3, 'Title must have at least 3 characters'),
  description: auditText(5000),
  type: auditFindingTypeSchema,
  severity: auditFindingSeveritySchema,
  dueDate: z.coerce.date().nullable().optional(),
  responsibleId: auditUserId,
})

export const auditFindingUpdateSchema = auditFindingCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one finding field is required',
)

/**
 * Transición de estado de un hallazgo. RESOLVED exige resolución con contenido; VERIFIED la pone
 * en el servidor con el actor de sesión y la fecha actual (nunca llegan del cliente).
 */
export const auditFindingStatusChangeSchema = z.object({
  status: auditFindingStatusSchema,
  resolution: z.string().trim().max(5000).optional(),
}).refine(
  (value) => value.status !== 'RESOLVED' || Boolean(value.resolution && value.resolution.length >= 3),
  { message: 'Resolving a finding requires a resolution with at least 3 characters', path: ['resolution'] },
)

// Solo enlaces http(s): mismo contrato que RiskEvidence, sin guardar archivos ni rutas del servidor.
const auditEvidenceUrl = z.string().trim().url('Evidence link must be a valid URL').refine(
  (value) => /^https?:\/\//i.test(value),
  'Evidence link must start with http:// or https://',
)
export const auditEvidenceCreateSchema = z.object({
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(2000),
  url: auditEvidenceUrl.max(500),
  // Hallazgo al que se ancla la evidencia (opcional). La ruta comprueba que pertenezca a esta misma
  // auditoría: no se admiten referencias cruzadas entre empresas o auditorías.
  findingId: z.string().trim().min(1).max(64).nullable().optional(),
})
export const auditEvidenceUpdateSchema = auditEvidenceCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one evidence field is required',
)

// Consulta paginada del historial de una auditoría, mismo formato que riskAuditQuerySchema. El
// listado de tipos es cerrado: solo el backend los emite, el cliente solo puede filtrar.
export const auditEventTypeSchema = z.enum([
  'AUDIT_CREATED', 'AUDIT_UPDATED', 'STATUS_CHANGED',
  'FINDING_CREATED', 'FINDING_UPDATED', 'FINDING_STATUS_CHANGED', 'FINDING_DELETED',
  'EVIDENCE_CREATED', 'EVIDENCE_UPDATED', 'EVIDENCE_DELETED',
])
export const auditHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  eventType: auditEventTypeSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export const sipocKindSchema = z.enum(['suppliers', 'inputs', 'processes', 'outputs', 'customers'])
export const sipocItemCreateSchema = z.object({
  description: z.string().trim().min(1).max(500),
})
export const sipocItemUpdateSchema = sipocItemCreateSchema

const riskScaleValue = z.number().int().min(1).max(5)
// Categorías codificables: determinan el prefijo del código automático (EST/MIS/APO).
// Los tipos legados (TACTICO, OPERACIONAL, textos históricos) ya no se pueden crear.
export const riskTypeSchema = z.enum(['ESTRATEGICO', 'MISIONAL', 'APOYO'])
export const riskAcceptanceStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REJECTED'])
export const riskTreatmentTypeSchema = z.enum(['AVOID', 'MITIGATE', 'TRANSFER', 'ACCEPT'])
const mitigationDate = z.coerce.date().nullable().optional()
export const riskCreateSchema = z.object({
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(5000),
  // El tipo real lo determina el servidor a partir del proceso asociado; aquí solo se acepta como
  // guarda de compatibilidad con clientes antiguos y la ruta de creación lo valida contra el
  // proceso, de modo que un cuerpo con una categoría incompatible se rechaza en lugar de guardarse.
  riskType: riskTypeSchema.optional(),
  // Kept optional while Risk.bpmnActivity remains NOT NULL in PostgreSQL.
  bpmnActivity: z.string().trim().min(2).max(160).optional(),
  riskOwnerId: idReference.nullable().optional(),
  // Estado inicial PENDING (sin decisión); la aceptación es un veredicto formal y no
  // depende del tratamiento elegido para el riesgo.
  acceptanceStatus: riskAcceptanceStatusSchema.optional(),
  // Tratamiento escogido: Evitar, Mitigar, Transferir o Aceptar. Independiente de acceptanceStatus.
  treatment: riskTreatmentTypeSchema.nullable().optional(),
  mitigationOwnerId: idReference.nullable().optional(),
  mitigationStartDate: mitigationDate,
  mitigationDueDate: mitigationDate,
  inherentImpact: riskScaleValue,
  inherentProbability: riskScaleValue,
  residualImpact: riskScaleValue,
  residualProbability: riskScaleValue,
})
export const riskUpdateSchema = riskCreateSchema.omit({ riskType: true }).partial().extend({
  // En edición el tipo no es editable: la ruta de PATCH lo compara con la categoría derivada del
  // proceso y con el valor almacenado (para tolerar clientes antiguos) y nunca lo persiste.
  riskType: z.string().trim().min(3).max(64).optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  'At least one risk field is required',
)

export const riskControlEvaluationSchema = z.enum(['PENDING', 'WEAK', 'PARTIAL', 'EFFECTIVE'])
export const riskControlCreateSchema = z.object({
  description: z.string().trim().min(3).max(1000),
  evaluation: riskControlEvaluationSchema.default('PENDING'),
})
// Sin heredar el default de creación: en PATCH solo debe persistir lo enviado y `{}` debe fallar.
export const riskControlUpdateSchema = z.object({
  description: z.string().trim().min(3).max(1000).optional(),
  evaluation: riskControlEvaluationSchema.optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  'At least one control field is required',
)

// Decisión del dueño sobre un ciclo de aprobación. El rechazo exige motivo obligatorio; la
// aprobación puede llevar comentario opcional. El servidor ignora cualquier userId/riskId del
// cuerpo: quién decide sale de la sesión y el riesgo del ciclo solicitado.
export const riskApprovalDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().min(3).max(2000).optional(),
}).refine(
  (value) => value.decision === 'APPROVE' || Boolean(value.comment),
  { message: 'A rejection requires a mandatory reason', path: ['comment'] },
)
export const riskApprovalQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'OUTDATED']).optional(),
})

// Consulta paginada del historial de un riesgo. El listado de tipos es cerrado (el cliente no
// puede escribir eventos, solo filtrar por los que el backend emite). pageSize limitado a 50 para
// que ninguna página pueda pedir el historial completo de golpe.
export const riskAuditEventTypeSchema = z.enum([
  'RISK_CREATED', 'RISK_UPDATED',
  'CONTROL_CREATED', 'CONTROL_UPDATED', 'CONTROL_DELETED',
  'EVIDENCE_CREATED', 'EVIDENCE_UPDATED', 'EVIDENCE_DELETED',
  'APPROVAL_REQUESTED', 'APPROVAL_DECIDED', 'APPROVAL_OUTDATED',
  'TICKET_CREATED', 'TICKET_STATUS_CHANGED',
])
export const riskAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  eventType: riskAuditEventTypeSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

// Solo enlaces http(s): no se guardan archivos ni rutas del servidor, solo la URL de la evidencia.
const riskEvidenceUrl = z.string().trim().url('Evidence link must be a valid URL').refine(
  (value) => /^https?:\/\//i.test(value),
  'Evidence link must start with http:// or https://',
)
export const riskEvidenceCreateSchema = z.object({
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(2000),
  url: riskEvidenceUrl.max(500),
})
export const riskEvidenceUpdateSchema = riskEvidenceCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one evidence field is required',
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
  // Riesgo cuyo plan de mitigación ejecuta este plan. Solo nace desde Prisma (cuid); el endpoint
  // comprueba además que el riesgo exista y sea de la misma empresa que el diagnóstico. null
  // desvincula el plan de un riesgo.
  riskId: z.string().cuid().nullable().optional(),
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
  // Recommendation solo nacen desde Prisma (cuid); el endpoint comprueba además que la
  // recomendación pertenezca a este diagnóstico. El responsable sí es un User, con cuid o uuid.
  recommendationId: z.string().cuid().nullable().optional(),
  responsibleId: idReference.nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
})

export const actionItemUpdateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().min(3).max(5000).optional(),
  priority: priorityLevelSchema.optional(),
  status: actionItemStatusSchema.optional(),
  recommendationId: z.string().cuid().nullable().optional(),
  responsibleId: idReference.nullable().optional(),
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
  // Los factores DOFA son SWOTItem: solo nacen desde Prisma, nunca desde el seed, así que sus ids
  // son cuid. El endpoint exige además que ambos pertenezcan a la matriz del diagnóstico.
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
