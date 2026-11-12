import { z } from 'zod'
import { calendarDateToUtc, isCalendarDate } from './calendar-dates.js'

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

/**
 * User-entered deadlines are calendar dates. YYYY-MM-DD is stored at UTC midnight so the value
 * survives JSON/Prisma round trips without shifting when the server runs outside the business zone.
 * Full ISO timestamps remain accepted for existing clients, but new calendar strings are validated
 * strictly so dates such as 2026-02-30 cannot be normalized into another day.
 */
const calendarDateInput = z.preprocess((value, context) => {
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) return value
    context.addIssue({ code: 'custom', message: 'Invalid date' })
    return z.NEVER
  }
  if (typeof value !== 'string') {
    context.addIssue({ code: 'custom', message: 'Date must be YYYY-MM-DD' })
    return z.NEVER
  }
  const trimmed = value.trim()
  if (isCalendarDate(trimmed)) return calendarDateToUtc(trimmed)
  if (/T/.test(trimmed)) {
    const legacyDate = new Date(trimmed)
    if (!Number.isNaN(legacyDate.getTime())) return legacyDate
  }
  context.addIssue({ code: 'custom', message: 'Date must be a valid YYYY-MM-DD calendar date' })
  return z.NEVER
}, z.date())

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
})

export const ticketCreateSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(5000),
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  dueDate: calendarDateInput.nullable().optional(),
  assignedToId: idReference.nullable().optional(),
})

export const ticketUpdateSchema = ticketCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const ticketDriveReferenceCreateSchema = z.object({
  driveFileId: z.string().trim().min(1).max(200),
})

export const ticketQuerySchema = z.object({
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  search: z.string().trim().max(120).optional(),
})

export const ticketHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  search: z.string().trim().max(120).optional(),
  assignedToId: idReference.optional(),
  eventType: z.enum(['TICKET_CREATED', 'TICKET_UPDATED', 'TICKET_ASSIGNED', 'TICKET_ASSIGNMENT_REQUESTED', 'TICKET_ASSIGNMENT_ACCEPTED', 'TICKET_ASSIGNMENT_REJECTED', 'TICKET_ASSIGNMENT_CANCELLED', 'TICKET_ASSIGNMENT_SUPERSEDED', 'TICKET_UNASSIGNED', 'TICKET_STATUS_CHANGED', 'TICKET_PRIORITY_CHANGED', 'TICKET_DUE_DATE_CHANGED', 'EVIDENCE_ATTACHED', 'EVIDENCE_DELETED', 'TICKET_DELETED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, 'Invalid history date range')

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
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const userDeactivateSchema = z.object({
  reason: z.string().trim().min(3).max(500),
})

export const userReactivateSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
}).default({})

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
  kpis: z.lazy(() => embeddedKpiListSchema).optional(),
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
  kpis: z.lazy(() => embeddedKpiListSchema).optional(),
  kpiUnlinkIds: z.array(idReference).max(50).optional(),
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

export const kpiCatalogQuerySchema = kpiQuerySchema.extend({
  companyId: idReference.optional(),
})

const embeddedKpiSchema = kpiCreateSchema.extend({ id: idReference.optional() }).strict()
export const embeddedKpiListSchema = z.array(embeddedKpiSchema).max(50).superRefine((items, context) => {
  const names = new Set<string>()
  const ids = new Set<string>()
  items.forEach((item, index) => {
    const normalizedName = item.name.trim().replace(/\s+/g, ' ').toLowerCase()
    if (names.has(normalizedName)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'name'], message: 'KPI names must be unique in this form' })
    names.add(normalizedName)
    if (item.id && ids.has(item.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'id'], message: 'A KPI cannot be listed twice' })
    if (item.id) ids.add(item.id)
  })
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
  kpis: embeddedKpiListSchema.optional(),
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

// ---- Módulo Aseguramiento de Calidad (Auditorías de calidad) ----

// Espejo de AuditStatus. PLANNED e IN_PROGRESS son los estados operativos; CLOSED y CANCELLED son
// terminales y bloquean toda escritura posterior (la máquina de transiciones se valida en el servidor).
export const auditStatusSchema = z.enum(['PLANNED', 'IN_PROGRESS', 'CLOSED', 'CANCELLED'])
export const auditFindingTypeSchema = z.enum(['NONCONFORMITY', 'OBSERVATION', 'OPPORTUNITY'])
export const auditFindingSeveritySchema = z.enum(['CRITICAL', 'MAJOR', 'MINOR'])
export const auditFindingStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED'])
// Tipo de auditoría: catálogo cerrado de interfaz. El formulario lo muestra como select
// obligatorio; en el modelo sigue siendo String para no romper auditorías legadas con otros textos
// (al editarlas la API exige elegir uno de estos tres valores).
export const auditKindSchema = z.enum(['Interna', 'Externa', 'Mixta'])
export const auditChecklistResultSchema = z.enum(['PENDING', 'CONFORM', 'NON_CONFORM', 'NOT_APPLICABLE'])
export const auditCorrectiveActionStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
export const auditCorrectiveActionPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])

const auditText = (max: number) => z.string().trim().min(1).max(max)
// El responsable/auditor se valida contra la empresa en la API; la base existente también contiene
// UUIDs (mismo criterio que kpiResponsibleId y procedureResponsibleId).
const auditUserId = z.string().trim().min(1).max(64).nullable().optional()
const auditIdList = z.array(idReference).max(50)

const auditFields = {
  title: auditText(160).refine((value) => value.length >= 3, 'Title must have at least 3 characters'),
  auditType: auditKindSchema,
  scope: auditText(2000),
  objectives: z.string().trim().max(2000).nullable().optional(),
  criteria: auditText(2000),
  plannedDate: z.coerce.date().nullable().optional(),
  leadAuditorId: auditUserId,
  responsibleId: auditUserId,
}

export const auditCreateSchema = z.object({
  ...auditFields,
  // Procesos y procedimientos adicionales que quedan vinculados en la MISMA transacción del alta.
  // El proceso principal viaja en la ruta (o en processId para la variante /api/audits) y no se
  // duplica aquí; la API valida que todos pertenezcan a la empresa de la auditoría.
  processIds: auditIdList.optional(),
  procedureIds: auditIdList.optional(),
})

export const auditUpdateSchema = z.object(auditFields).partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one audit field is required',
)

// Vínculos de una auditoría con procesos y procedimientos adicionales. La ruta sustituye el conjunto
// completo (sin duplicados: la clave primaria compuesta lo impide y la API deduplica antes de tocar
// la base). Los ids se validan contra la empresa de la auditoría antes de escribir.
export const auditRelationsUpdateSchema = z.object({
  processIds: auditIdList,
  procedureIds: auditIdList,
})

export const auditQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: auditStatusSchema.optional(),
  processId: z.string().trim().min(1).max(64).optional(),
})

/**
 * Transición de estado de la auditoría. La máquina de transiciones permitidas se valida en el
 * servidor; aquí solo se acota la forma. Cerrarse exige resumen (se valida en el handler con el
 * estado guardado, porque en PATCH no viene el estado actual) y que no queden ítems obligatorios
 * de las listas de verificación en PENDING (también se valida en el servidor con el estado real).
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
  // Vínculos opcionales: ítem de checklist, proceso (principal o relacionado de la auditoría) y
  // procedimiento (de la empresa de la auditoría). La ruta valida cada pertenencia.
  itemId: z.string().trim().min(1).max(64).nullable().optional(),
  processId: z.string().trim().min(1).max(64).nullable().optional(),
  procedureId: z.string().trim().min(1).max(64).nullable().optional(),
})

export const auditFindingUpdateSchema = auditFindingCreateSchema.extend({
  // Verificación de eficacia de la acción correctiva: exigida por el servidor al verificar un
  // hallazgo de tipo No conformidad (cuando corresponde), nunca inventada en el cliente.
  efficacyVerification: z.string().trim().max(5000).nullable().optional(),
}).partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one finding field is required',
)

/**
 * Transición de estado de un hallazgo. RESOLVED exige resolución con contenido y que no queden
 * acciones correctivas obligatorias sin estado final (ambas reglas se re-validan en el servidor
 * dentro de la transacción); VERIFIED exige haber sido resuelto previamente y, para las No
 * conformidades, tener registrada la verificación de eficacia.
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

// ---- Listas de verificación ----

export const auditChecklistCreateSchema = z.object({
  name: auditText(160),
})

export const auditChecklistUpdateSchema = auditChecklistCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one checklist field is required',
)

export const auditChecklistItemCreateSchema = z.object({
  description: auditText(2000),
  criteria: auditText(2000),
  required: z.boolean().optional(),
  // Posición de ordenación; si no viene, la ruta la coloca al final de la lista.
  position: z.coerce.number().int().min(0).max(10000).optional(),
})

export const auditChecklistItemUpdateSchema = z.object({
  description: auditText(2000).optional(),
  criteria: auditText(2000).optional(),
  result: auditChecklistResultSchema.optional(),
  observations: z.string().trim().max(2000).nullable().optional(),
  // Al abandonar NON_CONFORM el cliente debe confirmar que revisó el hallazgo asociado.
  // La confirmación no cambia ni elimina el hallazgo.
  findingReviewConfirmed: z.boolean().optional(),
  required: z.boolean().optional(),
  position: z.coerce.number().int().min(0).max(10000).optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  'At least one checklist item field is required',
)

export const auditChecklistAIDimensionSchema = z.enum(['COMPLIANCE', 'IMPLEMENTATION', 'EFFECTIVENESS'])
export const auditChecklistAISourceTypeSchema = z.enum(['PROCESS', 'PROCEDURE', 'SIPOC', 'RISK', 'CONTROL'])
export const auditChecklistAIGenerationRequestSchema = z.object({
  maxQuestions: z.coerce.number().int().min(1).max(20).optional(),
}).strict()
export const auditChecklistAIGenerationSchema = z.object({
  proposals: z.array(z.object({
    question: auditText(2000).refine((value) => value.length >= 10, 'Question must have at least 10 characters'),
    expectedEvidence: auditText(1600).refine((value) => value.length >= 3, 'Expected evidence is required'),
    sourceId: idReference,
    sourceType: auditChecklistAISourceTypeSchema,
    source: auditText(240).refine((value) => value.length >= 3, 'Source is required'),
    dimension: auditChecklistAIDimensionSchema,
  }).strict()).max(20),
  missingInformation: z.array(z.string().trim().min(1).max(500)).max(10),
}).strict()

// ---- Acciones correctivas ----

export const auditCorrectiveActionCreateSchema = z.object({
  title: auditText(200).refine((value) => value.length >= 3, 'Title must have at least 3 characters'),
  description: auditText(5000),
  responsibleId: auditUserId,
  priority: auditCorrectiveActionPrioritySchema.optional(),
  required: z.boolean().optional(),
  dueDate: z.coerce.date().nullable().optional(),
})

export const auditCorrectiveActionUpdateSchema = auditCorrectiveActionCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one corrective action field is required',
)

// Transición de estado de una acción correctiva. La máquina permitida (solo avances hacia estados
// finales, con reapertura limitada) se valida en el servidor con el estado guardado.
export const auditCorrectiveActionStatusChangeSchema = z.object({
  status: auditCorrectiveActionStatusSchema,
})

export const auditActionProgressCreateSchema = z.object({
  note: auditText(2000),
  percent: z.coerce.number().int().min(0).max(100).nullable().optional(),
})

// Consulta paginada del historial de una auditoría, mismo formato que riskAuditQuerySchema. El
// listado de tipos es cerrado: solo el backend los emite, el cliente solo puede filtrar.
export const auditEventTypeSchema = z.enum([
  'AUDIT_CREATED', 'AUDIT_UPDATED', 'STATUS_CHANGED',
  'FINDING_CREATED', 'FINDING_UPDATED', 'FINDING_STATUS_CHANGED', 'FINDING_DELETED',
  'EVIDENCE_CREATED', 'EVIDENCE_UPDATED', 'EVIDENCE_DELETED',
  'AUDIT_RELATIONS_UPDATED',
  'CHECKLIST_CREATED', 'CHECKLIST_UPDATED', 'CHECKLIST_DELETED',
  'CHECKLIST_ITEM_CREATED', 'CHECKLIST_ITEM_UPDATED', 'CHECKLIST_ITEM_DELETED',
  'EVIDENCE_FILE_CREATED', 'EVIDENCE_FILE_DELETED',
  'ACTION_CREATED', 'ACTION_UPDATED', 'ACTION_STATUS_CHANGED', 'ACTION_PROGRESS_ADDED',
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
  // Solo como guarda de compatibilidad con clientes antiguos: el valor se valida (un enum
  // inválido sigue rechazando la petición) pero NUNCA se usa. La ruta de creación fuerza
  // PENDING porque el veredicto formal lo decide el ciclo de aprobación, nunca el cliente.
  acceptanceStatus: riskAcceptanceStatusSchema.optional(),
  // Tratamiento escogido: Evitar, Mitigar, Transferir o Aceptar. Independiente de acceptanceStatus.
  treatment: riskTreatmentTypeSchema.nullable().optional(),
  mitigationOwnerId: idReference.nullable().optional(),
  // La fecha de inicio del plan de mitigación se retiró del formulario y de la API: el schema
  // deja de aceptarla (Zod descarta claves no declaradas, así que un cliente antiguo que la envíe
  // no rompe la petición y el valor no se persiste). La columna en PostgreSQL se conserva.
  mitigationDueDate: mitigationDate,
  inherentImpact: riskScaleValue,
  inherentProbability: riskScaleValue,
  residualImpact: riskScaleValue,
  residualProbability: riskScaleValue,
})
export const riskUpdateSchema = riskCreateSchema.omit({ riskType: true, acceptanceStatus: true }).partial().extend({
  // En edición el tipo no es editable: la ruta de PATCH lo compara con la categoría derivada del
  // proceso y con el valor almacenado (para tolerar clientes antiguos) y nunca lo persiste.
  riskType: z.string().trim().min(3).max(64).optional(),
  // acceptanceStatus se omite deliberadamente: aunque un cliente lo envíe, Zod descarta la clave
  // (y si fuera el único campo, el refine inferior devuelve 400). La única escritura posible del
  // veredicto pasa por la decisión autorizada del ciclo de aprobación.
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

export const ticketAssignmentApprovalStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'])
export const ticketAssignmentApprovalQuerySchema = z.object({
  status: ticketAssignmentApprovalStatusSchema.optional(),
})

export const ticketAssignmentApprovalDecisionSchema = z.object({
  decision: z.enum(['ACCEPT', 'REJECT']),
  comment: z.string().trim().min(3).max(2000).optional(),
}).refine(
  (value) => value.decision === 'ACCEPT' || Boolean(value.comment),
  { message: 'A rejection requires a mandatory reason', path: ['comment'] },
)

export const ticketAssignmentApprovalCancelSchema = z.object({
  comment: z.string().trim().min(3).max(2000).optional(),
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

/**
 * Alta de una actividad del plan de mitigación desde el panel de riesgos (paso 3). El usuario
 * llena nombre, descripción, responsable y fecha de entrega; el servidor fija prioridad MEDIUM,
 * estado PENDING y crea el ticket asociado en la misma transacción. La descripción es opcional:
 * si no llega, se usa el título para no dejar la actividad sin contexto.
 */
export const mitigationActivityCreateSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(5000).optional(),
  responsibleId: idReference,
  dueDate: z.coerce.date(),
})

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

export const strategicObjectiveStatusSchema = z.enum(['DRAFT', 'APPROVED'])
export const strategicObjectiveOriginSchema = z.enum(['MANUAL', 'CHECKY'])
export const strategicObjectiveStrategySourceSchema = z.enum(['AI_ANALYSIS', 'CHECKY', 'STRATEGIC_CROSS'])

const strategicObjectiveCriterion = (max: number) => z.string().trim().max(max).nullable().optional()

export const strategicObjectiveIndicatorSchema = z.object({
  name: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  frequency: z.string().trim().max(80).nullable().optional(),
  formula: z.string().trim().max(1000).nullable().optional(),
  dataSource: z.string().trim().max(1000).nullable().optional(),
  unit: z.string().trim().min(1).max(80).optional(),
  reportResponsibleId: z.string().trim().min(1).max(64).nullable().optional(),
  monitorResponsibleId: z.string().trim().min(1).max(64).nullable().optional(),
  greenThreshold: z.string().trim().max(120).nullable().optional(),
  yellowThreshold: z.string().trim().max(120).nullable().optional(),
  redThreshold: z.string().trim().max(120).nullable().optional(),
  baselineValue: z.string().trim().min(1).max(120).optional(),
  targetValue: z.string().trim().min(1).max(120).optional(),
  measurementMethod: z.string().trim().min(3).max(1000).optional(),
  deadline: calendarDateInput.nullable().optional(),
}).strict()

const strategicObjectiveIndicatorListSchema = z.array(strategicObjectiveIndicatorSchema).max(20).superRefine((indicators, context) => {
  const seen = new Set<string>()
  indicators.forEach((indicator, index) => {
    const signature = JSON.stringify(indicator)
    if (seen.has(signature)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: 'Indicators must not be duplicated' })
    seen.add(signature)
  })
})

const strategicObjectiveSuggestionText = (max: number) => z.string().trim().max(max).nullable()
const strategicObjectiveSuggestionDate = z.string().trim().refine(isCalendarDate, 'Deadline must be a valid YYYY-MM-DD date').nullable()

/**
 * Stored Checky proposal document. All keys are explicit so the immutable original and the editable
 * copy can be compared without relying on optional-field semantics. Dates stay as calendar strings
 * because this document is persisted as JSON and must not depend on a server timezone.
 */
const strategicObjectiveSuggestionIndicatorSchema = z.object({
  name: strategicObjectiveSuggestionText(200),
  description: strategicObjectiveSuggestionText(5000).optional(),
  frequency: strategicObjectiveSuggestionText(80).optional(),
  formula: strategicObjectiveSuggestionText(1000).optional(),
  dataSource: strategicObjectiveSuggestionText(1000).optional(),
  unit: strategicObjectiveSuggestionText(80),
  reportResponsibleId: idReference.nullable().optional(),
  monitorResponsibleId: idReference.nullable().optional(),
  greenThreshold: strategicObjectiveSuggestionText(120).optional(),
  yellowThreshold: strategicObjectiveSuggestionText(120).optional(),
  redThreshold: strategicObjectiveSuggestionText(120).optional(),
  baselineValue: strategicObjectiveSuggestionText(120),
  targetValue: strategicObjectiveSuggestionText(120),
  measurementMethod: strategicObjectiveSuggestionText(1000),
  deadline: strategicObjectiveSuggestionDate,
}).strict()

const strategicObjectiveSuggestionIndicatorListSchema = z.array(strategicObjectiveSuggestionIndicatorSchema).max(20).superRefine((indicators, context) => {
  const seen = new Set<string>()
  indicators.forEach((indicator, index) => {
    const signature = JSON.stringify(indicator)
    if (seen.has(signature)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: 'Indicators must not be duplicated' })
    seen.add(signature)
  })
})

export const strategicObjectiveSuggestionPayloadSchema = z.object({
  title: z.string().trim().min(3).max(200),
  statement: z.string().trim().min(3).max(5000),
  specificCriteria: strategicObjectiveSuggestionText(2000),
  measurableCriteria: strategicObjectiveSuggestionText(2000),
  achievableCriteria: strategicObjectiveSuggestionText(2000),
  relevantCriteria: strategicObjectiveSuggestionText(2000),
  timeBoundCriteria: strategicObjectiveSuggestionText(2000),
  indicators: strategicObjectiveSuggestionIndicatorListSchema.optional(),
  indicator: strategicObjectiveSuggestionIndicatorSchema.nullable().optional(),
}).strict().refine((payload) => payload.indicators !== undefined || payload.indicator !== undefined, 'Indicators are required')

export const strategicObjectiveSuggestionStrategyRefsSchema = z.array(
  z.string().trim().min(1).max(200),
).max(8).refine(
  (refs) => new Set(refs).size === refs.length,
  'Strategy references must not be duplicated',
)

export const strategicObjectiveSuggestionUpdateSchema = z.object({
  editablePayload: strategicObjectiveSuggestionPayloadSchema,
}).strict()

export const strategicObjectiveSuggestionRejectionSchema = z.object({
  decisionNote: z.string().trim().min(1).max(1000).optional(),
}).strict()

/** Reserved for the Fase 3 acceptance endpoint; no route changes status in this phase. */
export const strategicObjectiveSuggestionAcceptanceSchema = z.object({}).strict()

export const strategicObjectiveCreateSchema = z.object({
  title: z.string().trim().min(3).max(200),
  statement: z.string().trim().min(3).max(5000),
  specificCriteria: strategicObjectiveCriterion(2000),
  measurableCriteria: strategicObjectiveCriterion(2000),
  achievableCriteria: strategicObjectiveCriterion(2000),
  relevantCriteria: strategicObjectiveCriterion(2000),
  timeBoundCriteria: strategicObjectiveCriterion(2000),
  origin: strategicObjectiveOriginSchema.optional(),
  indicators: strategicObjectiveIndicatorListSchema.optional(),
  indicator: strategicObjectiveIndicatorSchema.nullable().optional(),
}).strict()

export const strategicObjectiveUpdateSchema = strategicObjectiveCreateSchema.omit({ origin: true }).partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one strategic objective field is required',
)

export const strategicObjectiveStrategyLinkSchema = z.object({
  source: strategicObjectiveStrategySourceSchema,
  sourceRef: z.string().trim().min(1).max(128),
}).strict()

/** La selección es opcional: sin ella Checky recibe todas las estrategias elegibles del diagnóstico. */
export const strategicObjectiveSuggestionRequestSchema = z.object({
  strategyRefs: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
}).strict()

const strategicObjectiveAISuggestionIndicatorSchema = z.object({
  name: z.string().trim().max(200).nullable(),
  description: z.string().trim().max(5000).nullable(),
  frequency: z.string().trim().max(80).nullable(),
  formula: z.string().trim().max(1000).nullable(),
  dataSource: z.string().trim().max(1000).nullable(),
  unit: z.string().trim().max(80).nullable(),
  reportResponsibleId: idReference.nullable(),
  monitorResponsibleId: idReference.nullable(),
  greenThreshold: z.string().trim().max(120).nullable(),
  yellowThreshold: z.string().trim().max(120).nullable(),
  redThreshold: z.string().trim().max(120).nullable(),
  baselineValue: z.string().trim().max(120).nullable(),
  targetValue: z.string().trim().max(120).nullable(),
  measurementMethod: z.string().trim().max(1000).nullable(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
}).strict()

const strategicObjectiveAISuggestionSchema = z.object({
  title: z.string().trim().min(3).max(200),
  statement: z.string().trim().min(3).max(5000),
  specificCriteria: z.string().trim().max(2000).nullable(),
  measurableCriteria: z.string().trim().max(2000).nullable(),
  achievableCriteria: z.string().trim().max(2000).nullable(),
  relevantCriteria: z.string().trim().max(2000).nullable(),
  timeBoundCriteria: z.string().trim().max(2000).nullable(),
  indicators: z.array(strategicObjectiveAISuggestionIndicatorSchema).max(20).default([]),
  indicator: strategicObjectiveAISuggestionIndicatorSchema.nullable().optional(),
  strategyRefs: z.array(z.string().trim().min(1).max(200)).min(1).max(8),
}).strict()

export function buildStrategicObjectiveSuggestionSchema(allowedStrategyRefs: Set<string>) {
  return z.object({
    suggestions: z.array(strategicObjectiveAISuggestionSchema.extend({
      strategyRefs: z.array(z.string().trim().min(1).max(200).refine((value) => allowedStrategyRefs.has(value), 'Strategy must be an eligible strategy from this diagnostic')).min(1).max(8),
    })).max(8),
    missingInformation: z.array(z.string().trim().min(1).max(1000)).max(20),
  }).strict()
}

export const strategicObjectiveApprovalSchema = z.object({}).strict()

export const strategicObjectiveHistoryEventTypeSchema = z.enum(['CREATED', 'UPDATED', 'STATUS_CHANGED', 'STRATEGY_LINKED', 'STRATEGY_UNLINKED'])
export const strategicObjectiveHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  eventType: strategicObjectiveHistoryEventTypeSchema.optional(),
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
export const strategicObjectiveSuggestionStatusSchema = checkySuggestionStatusSchema

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
