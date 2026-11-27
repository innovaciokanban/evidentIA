import type {
  Audit,
  AuditChecklistResult,
  AuditCorrectiveAction,
  AuditCorrectiveActionPriority,
  AuditCorrectiveActionStatus,
  AuditEvent,
  AuditEventType,
  AuditEvidenceFile,
  AuditFinding,
  AuditFindingSeverity,
  AuditFindingStatus,
  AuditFindingType,
  AuditKind,
  AuditStatus,
  Process,
  Procedure,
} from '../../types'

// Catálogos y máquinas de estado del módulo Aseguramiento de Calidad. Espejo exacto de las
// máquinas del servidor (server/app.ts): el cliente solo propone transiciones permitidas.

export const auditStatusLabels: Record<AuditStatus, string> = {
  PLANNED: 'Planificada',
  IN_PROGRESS: 'En curso',
  CLOSED: 'Cerrada',
  CANCELLED: 'Cancelada',
}

export const auditTransitions: Record<AuditStatus, Array<{ to: AuditStatus; label: string }>> = {
  PLANNED: [
    { to: 'IN_PROGRESS', label: 'Iniciar auditoría' },
    { to: 'CANCELLED', label: 'Cancelar' },
  ],
  IN_PROGRESS: [
    { to: 'CLOSED', label: 'Cerrar auditoría' },
    { to: 'CANCELLED', label: 'Cancelar' },
  ],
  CLOSED: [],
  CANCELLED: [],
}

export const isTerminalAudit = (audit: Pick<Audit, 'status'>): boolean =>
  audit.status === 'CLOSED' || audit.status === 'CANCELLED'

export const findingStatusLabels: Record<AuditFindingStatus, string> = {
  OPEN: 'Abierto',
  IN_PROGRESS: 'En curso',
  RESOLVED: 'Resuelto',
  VERIFIED: 'Verificado',
}

export const findingTransitions: Record<AuditFindingStatus, Array<{ to: AuditFindingStatus; label: string }>> = {
  OPEN: [
    { to: 'IN_PROGRESS', label: 'Iniciar seguimiento' },
    { to: 'RESOLVED', label: 'Resolver' },
  ],
  IN_PROGRESS: [{ to: 'RESOLVED', label: 'Resolver' }],
  RESOLVED: [{ to: 'VERIFIED', label: 'Verificar' }],
  VERIFIED: [],
}

export const findingTypeLabels: Record<AuditFindingType, string> = {
  NONCONFORMITY: 'No conformidad',
  OBSERVATION: 'Observación',
  OPPORTUNITY: 'Oportunidad de mejora',
}

export const findingSeverityLabels: Record<AuditFindingSeverity, string> = {
  CRITICAL: 'Crítica',
  MAJOR: 'Mayor',
  MINOR: 'Menor',
}

export const checklistResultLabels: Record<AuditChecklistResult, string> = {
  PENDING: 'Pendiente',
  CONFORM: 'Conforme',
  NON_CONFORM: 'No conforme',
  NOT_APPLICABLE: 'No aplica',
}

export const checklistResults: AuditChecklistResult[] = ['PENDING', 'CONFORM', 'NON_CONFORM', 'NOT_APPLICABLE']

export const actionStatusLabels: Record<AuditCorrectiveActionStatus, string> = {
  OPEN: 'Abierta',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
}

export const actionTransitions: Record<AuditCorrectiveActionStatus, Array<{ to: AuditCorrectiveActionStatus; label: string }>> = {
  OPEN: [
    { to: 'IN_PROGRESS', label: 'Iniciar' },
    { to: 'CANCELLED', label: 'Cancelar' },
  ],
  IN_PROGRESS: [
    { to: 'COMPLETED', label: 'Completar' },
    { to: 'CANCELLED', label: 'Cancelar' },
  ],
  COMPLETED: [],
  CANCELLED: [],
}

export const actionPriorityLabels: Record<AuditCorrectiveActionPriority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
}

export const auditKindLabels: Record<AuditKind, string> = {
  Interna: 'Interna',
  Externa: 'Externa',
  Mixta: 'Mixta',
}

export const auditKinds: AuditKind[] = ['Interna', 'Externa', 'Mixta']

export const auditEventLabels: Record<AuditEventType, string> = {
  AUDIT_CREATED: 'Auditoría creada',
  AUDIT_UPDATED: 'Auditoría actualizada',
  STATUS_CHANGED: 'Cambio de estado',
  FINDING_CREATED: 'Hallazgo creado',
  FINDING_UPDATED: 'Hallazgo actualizado',
  FINDING_STATUS_CHANGED: 'Estado del hallazgo',
  FINDING_DELETED: 'Hallazgo eliminado',
  EVIDENCE_CREATED: 'Evidencia registrada',
  EVIDENCE_UPDATED: 'Evidencia actualizada',
  EVIDENCE_DELETED: 'Evidencia eliminada',
  AUDIT_RELATIONS_UPDATED: 'Relaciones actualizadas',
  CHECKLIST_CREATED: 'Lista creada',
  CHECKLIST_UPDATED: 'Lista actualizada',
  CHECKLIST_DELETED: 'Lista eliminada',
  CHECKLIST_ITEM_CREATED: 'Ítem añadido',
  CHECKLIST_ITEM_UPDATED: 'Ítem actualizado',
  CHECKLIST_ITEM_DELETED: 'Ítem eliminado',
  EVIDENCE_FILE_CREATED: 'PDF adjuntado',
  EVIDENCE_FILE_DELETED: 'PDF eliminado',
  EVIDENCE_FILE_STORAGE_READY: 'PDF disponible',
  EVIDENCE_FILE_STORAGE_FAILED: 'Error de almacenamiento del PDF',
  EVIDENCE_FILE_DELETE_PENDING: 'Eliminación de PDF pendiente',
  ACTION_CREATED: 'Acción correctiva creada',
  ACTION_UPDATED: 'Acción correctiva actualizada',
  ACTION_STATUS_CHANGED: 'Estado de la acción',
  ACTION_PROGRESS_ADDED: 'Avance registrado',
  TEAM_MEMBER_ASSIGNED: 'Integrante asignado',
  TEAM_MEMBER_UPDATED: 'Equipo auditor actualizado',
  TEAM_MEMBER_REMOVED: 'Integrante retirado',
  INDEPENDENCE_EVALUATED: 'Independencia evaluada',
  AUDIT_PLAN_ACTIVITY_EXECUTION_STARTED: 'Actividad iniciada',
  AUDIT_PLAN_ACTIVITY_EXECUTION_UPDATED: 'Avance de actividad actualizado',
  AUDIT_PLAN_ACTIVITY_EXECUTION_COMPLETED: 'Actividad completada',
  AUDIT_PLAN_ACTIVITY_EXECUTION_CANCELLED: 'Actividad cancelada',
  AUDIT_PLAN_ACTIVITY_RESOURCE_LINKED: 'Recurso vinculado',
  AUDIT_PLAN_ACTIVITY_RESOURCE_UNLINKED: 'Recurso desvinculado',
  IMMEDIATE_CORRECTION_CREATED: 'Corrección inmediata registrada',
  IMMEDIATE_CORRECTION_UPDATED: 'Corrección inmediata actualizada',
  IMMEDIATE_CORRECTION_STATUS_CHANGED: 'Estado de corrección inmediata',
  ROOT_CAUSE_ANALYSIS_CREATED: 'Análisis de causa raíz creado',
  ROOT_CAUSE_ANALYSIS_UPDATED: 'Análisis de causa raíz actualizado',
  ROOT_CAUSE_ANALYSIS_STATUS_CHANGED: 'Estado del análisis de causa raíz',
  ROOT_CAUSE_CREATED: 'Causa raíz creada',
  ROOT_CAUSE_UPDATED: 'Causa raíz actualizada',
  ROOT_CAUSE_STATUS_CHANGED: 'Estado de la causa raíz',
  ROOT_CAUSE_FIVE_WHY_STEP_CREATED: 'Paso de Five Whys creado',
  ROOT_CAUSE_FIVE_WHY_STEP_UPDATED: 'Paso de Five Whys actualizado',
  ROOT_CAUSE_FIVE_WHY_STEP_DELETED: 'Paso de Five Whys eliminado',
  CORRECTIVE_ACTION_CAUSE_LINKED: 'Causa vinculada a acción correctiva',
  CORRECTIVE_ACTION_CAUSE_UNLINKED: 'Causa desvinculada de acción correctiva',
  EFFICACY_EVALUATION_CREATED: 'Evaluación de eficacia planificada',
  EFFICACY_EVALUATION_UPDATED: 'Evaluación de eficacia actualizada',
  EFFICACY_EVALUATION_PROGRESS_ADDED: 'Avance de eficacia registrado',
  EFFICACY_EVALUATION_STARTED: 'Evaluación de eficacia iniciada',
  EFFICACY_EVALUATION_COMPLETED: 'Evaluación de eficacia finalizada',
  EFFICACY_EVALUATION_CANCELLED: 'Evaluación de eficacia cancelada',
  EFFICACY_EVALUATION_EVIDENCE_LINKED: 'Evidencia de eficacia vinculada',
  EFFICACY_EVALUATION_EVIDENCE_UNLINKED: 'Evidencia de eficacia desvinculada',
}

export const auditModuleLabels = {
  auditStatusLabels,
  findingStatusLabels,
  findingTypeLabels,
  findingSeverityLabels,
  checklistResultLabels,
  actionStatusLabels,
  actionPriorityLabels,
  auditEventLabels,
}

// El draft del formulario unifica proceso principal y relaciones en dos listas: processIds
// (el primero es el ancla `processId` del backend, obligatoria) y procedureIds. El formulario
// decide el ancla al crear; en edición la ancla es inmutable y se envía solo como referencia.
export type AuditDraft = {
  title: string
  auditType: AuditKind | ''
  scope: string
  objectives: string
  criteria: string
  plannedDate: string
  leadAuditorId: string
  responsibleId: string
  processIds: string[]
  procedureIds: string[]
}

export const emptyAuditDraft: AuditDraft = {
  title: '', auditType: '', scope: '', objectives: '', criteria: '', plannedDate: '', leadAuditorId: '', responsibleId: '', processIds: [], procedureIds: [],
}

export const draftFromAudit = (audit: Audit): AuditDraft => ({
  title: audit.title,
  auditType: (audit.auditType === 'Interna' || audit.auditType === 'Externa' || audit.auditType === 'Mixta') ? audit.auditType : '',
  scope: audit.scope,
  objectives: audit.objectives ?? '',
  criteria: audit.criteria,
  plannedDate: audit.plannedDate ? audit.plannedDate.slice(0, 10) : '',
  leadAuditorId: audit.leadAuditor?.id ?? '',
  responsibleId: audit.responsible?.id ?? '',
  processIds: [audit.processId, ...(audit.relatedProcesses ?? []).map((process) => process.id).filter((id) => id !== audit.processId)],
  procedureIds: (audit.procedures ?? []).map((procedure) => procedure.id),
})

export type FindingDraft = {
  title: string
  description: string
  type: AuditFindingType
  severity: AuditFindingSeverity
  dueDate: string
  responsibleId: string
  itemId: string
  processId: string
  procedureId: string
  efficacyVerification: string
}

export const emptyFindingDraft: FindingDraft = {
  title: '', description: '', type: 'NONCONFORMITY', severity: 'MINOR', dueDate: '', responsibleId: '', itemId: '', processId: '', procedureId: '', efficacyVerification: '',
}

export const draftFromFinding = (finding: AuditFinding): FindingDraft => ({
  title: finding.title,
  description: finding.description,
  type: finding.type,
  severity: finding.severity,
  dueDate: finding.dueDate ? finding.dueDate.slice(0, 10) : '',
  responsibleId: finding.responsible?.id ?? '',
  itemId: finding.itemId ?? '',
  processId: finding.processId ?? '',
  procedureId: finding.procedureId ?? '',
  efficacyVerification: finding.efficacyVerification ?? '',
})

export type EvidenceDraft = {
  name: string
  description: string
  url: string
  findingId: string
}

export const emptyEvidenceDraft: EvidenceDraft = { name: '', description: '', url: '', findingId: '' }

export type ActionDraft = {
  title: string
  description: string
  responsibleId: string
  priority: AuditCorrectiveActionPriority
  required: boolean
  dueDate: string
}

export const emptyActionDraft: ActionDraft = {
  title: '', description: '', responsibleId: '', priority: 'MEDIUM', required: true, dueDate: '',
}

export type ChecklistDraft = { name: string }
export const emptyChecklistDraft: ChecklistDraft = { name: '' }

export type ChecklistItemOrigin = 'MANUAL' | 'CHECKY'
export type AuditChecklistItemContext = {
  verification: string
  source: string
  dimension: string
  origin: ChecklistItemOrigin
}

export const checklistItemContext = (criteria: string): AuditChecklistItemContext => {
  const lines = criteria.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const valueFor = (prefix: string) => lines.find((line) => line.toLowerCase().startsWith(prefix.toLowerCase()))?.slice(prefix.length).trim() || null
  const expectedEvidence = valueFor('Evidencia esperada:')
  const source = valueFor('Fuente:')
  const dimension = valueFor('Dimensión:')
  const origin = valueFor('Origen:')
  const contentLines = lines.filter((line) => !['evidencia esperada:', 'fuente:', 'dimensión:', 'origen:'].some((prefix) => line.toLowerCase().startsWith(prefix)))
  return {
    verification: (expectedEvidence ?? contentLines.join('\n')) || criteria,
    source: source ?? 'No especificada',
    dimension: dimension ?? 'No especificada',
    origin: origin?.toLowerCase() === 'checky' || Boolean(expectedEvidence) ? 'CHECKY' : 'MANUAL',
  }
}

export type ChecklistItemDraft = {
  description: string
  criteria: string
  source: string
  dimension: AuditChecklistAIDimension | ''
  origin: ChecklistItemOrigin
  required: boolean
}

export const emptyChecklistItemDraft: ChecklistItemDraft = { description: '', criteria: '', source: '', dimension: '', origin: 'MANUAL', required: true }

export type AuditChecklistAIDimension = 'COMPLIANCE' | 'IMPLEMENTATION' | 'EFFECTIVENESS'
export type AuditChecklistAIContextSelection = { activityId: string; dimension: AuditChecklistAIDimension | '' }
export type AuditChecklistAIProposal = {
  id: string
  question: string
  expectedEvidence: string
  sourceId: string
  sourceType: 'PROCESS' | 'PROCEDURE' | 'SIPOC' | 'RISK' | 'CONTROL'
  source: string
  dimension: AuditChecklistAIDimension
  selected: boolean
}

export const auditChecklistAIProcessLabels: Record<Process['type'], string> = {
  STRATEGIC: 'Estratégico',
  MISSIONAL: 'Misional',
  SUPPORT: 'Apoyo',
}

const auditChecklistAISourceLabels: Record<AuditChecklistAIProposal['sourceType'], string> = {
  PROCESS: 'Proceso',
  PROCEDURE: 'Procedimiento',
  SIPOC: 'SIPOC',
  RISK: 'Riesgo',
  CONTROL: 'Control',
}

export type AuditChecklistAIProposalContext = {
  process: string | null
  processType: Process['type'] | null
  procedure: string | null
  source: string
  sourceTypeLabel: string
}

export const auditChecklistAIContext = (proposal: AuditChecklistAIProposal, audit: Audit, processes: Process[]): AuditChecklistAIProposalContext => {
  const procedure = audit.procedures?.find((item) => item.id === proposal.sourceId)
  const processId = procedure?.processId ?? (proposal.sourceType === 'PROCESS' ? proposal.sourceId : null)
  const process = processId ? processes.find((item) => item.id === processId) : null
  return {
    process: process ? `${auditChecklistAIProcessLabels[process.type]} · ${process.code ?? 'Proceso'} · ${process.name}` : null,
    processType: process?.type ?? null,
    procedure: procedure ? `${procedure.code} · ${procedure.name}` : null,
    source: proposal.source,
    sourceTypeLabel: auditChecklistAISourceLabels[proposal.sourceType],
  }
}

export const auditChecklistAIDimensionLabels: Record<AuditChecklistAIDimension, string> = {
  COMPLIANCE: 'Cumplimiento',
  IMPLEMENTATION: 'Implementación',
  EFFECTIVENESS: 'Eficacia',
}

export const auditChecklistAIGenerationPayload = (context?: AuditChecklistAIContextSelection | null): Record<string, string> => {
  if (!context?.activityId) return {}
  return {
    activityId: context.activityId,
    ...(context.dimension ? { dimension: context.dimension } : {}),
  }
}

export const checklistCriteriaFromAIProposal = (proposal: Pick<AuditChecklistAIProposal, 'expectedEvidence' | 'source' | 'dimension'>): string => [
  `Evidencia esperada: ${proposal.expectedEvidence.trim()}`,
  `Fuente: ${proposal.source.trim()}`,
  `Dimensión: ${auditChecklistAIDimensionLabels[proposal.dimension]}`,
  'Origen: Checky',
].join('\n')

export const mergeAuditChecklistActivityItemIds = (existingIds: string[], createdIds: string[]): string[] => [...new Set([...existingIds, ...createdIds])]

export const mergeAuditFindingActivityIds = (existingIds: string[], findingId: string): string[] => [...new Set([...existingIds, findingId])]

export const mergeAuditEvidenceActivityIds = (existingIds: string[], evidenceId: string): string[] => [...new Set([...existingIds, evidenceId])]

export const auditEvidenceActivityLinkRequest = (kind: 'url' | 'pdf', existingIds: string[], evidenceId: string) => ({
  endpoint: kind === 'url' ? 'evidences' : 'evidence-files',
  field: kind === 'url' ? 'evidenceIds' : 'evidenceFileIds',
  ids: mergeAuditEvidenceActivityIds(existingIds, evidenceId),
})

export const auditEvidenceActivityLinkErrorMessage = (status: number, reason: string | undefined, serverMessage: string, fallback: string): string => {
  if (reason === 'EVIDENCE_LINKED_TO_ACTIVITY') return 'Esta evidencia no puede eliminarse porque está vinculada o tiene vínculos históricos con actividades de auditoría.'
  if (reason === 'EVIDENCE_FILE_LINKED_TO_ACTIVITY') return 'Este archivo no puede eliminarse porque está vinculado o tiene vínculos históricos con actividades de auditoría.'
  if (status === 409) return 'La evidencia oficial permanece guardada, pero la actividad ya no permite nuevos vínculos. Puedes reintentar la asociación si vuelve a estar disponible.'
  return serverMessage || fallback
}

export const auditFindingActivityLinkErrorMessage = (status: number, reason: string | undefined, serverMessage: string, fallback: string): string => {
  if (reason === 'FINDING_LINKED_TO_ACTIVITY') return 'El hallazgo ya está vinculado a una actividad; no se modificaron los vínculos existentes.'
  if (status === 409) return 'La actividad ya no permite cambios. El hallazgo oficial permanece guardado y puedes reintentar cuando corresponda.'
  return serverMessage || fallback
}

export const auditChecklistAIErrorMessage = (status: number, serverMessage: string, fallback: string): string => {
  if (status === 400) return 'La solicitud de Checky no es válida. Revisa la dimensión seleccionada.'
  if (status === 403) return 'No tienes permisos para solicitar preguntas a Checky en esta auditoría.'
  if (status === 404) return 'La actividad de origen ya no existe o no pertenece a esta auditoría.'
  if (status === 409) return 'El plan o la actividad ya no permite generar o vincular preguntas.'
  if (status === 429) return 'Se alcanzó el límite temporal de solicitudes a Checky. Espera un momento e inténtalo de nuevo.'
  if (status === 502) return 'Checky devolvió una respuesta inconsistente. No se guardó ninguna pregunta automáticamente.'
  if (status === 503 && /cr[eé]ditos/i.test(serverMessage)) return 'Checky no tiene créditos disponibles para generar propuestas.'
  if (status === 503) return 'Checky no está disponible en este momento. Inténtalo de nuevo más tarde.'
  if (status === 413) return 'La documentación de la auditoría es demasiado grande para analizarla de una vez.'
  return fallback
}

export const normalizeChecklistQuestion = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

export const dedupeAuditChecklistAIProposals = <T extends { question: string }>(existingQuestions: string[], proposals: T[]): T[] => {
  const seen = new Set(existingQuestions.map(normalizeChecklistQuestion))
  return proposals.filter((proposal) => {
    const normalized = normalizeChecklistQuestion(proposal.question)
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

/** Personas de la empresa visibles para los selectores del módulo. */
export type QualityUser = Pick<import('../../types').User, 'id' | 'name' | 'isActive'> & { companyId: string | null }

export type QualityProcessOption = Pick<Process, 'id' | 'name' | 'code' | 'companyId'>
export type QualityProcedureOption = Pick<Procedure, 'id' | 'name' | 'code' | 'processId'>

export const auditHistoryEventTypeLabels = auditEventLabels

export const eventLabel = (event: Pick<AuditEvent, 'eventType'>): string => auditEventLabels[event.eventType] ?? event.eventType

export const formatBytes = (size: number): string => {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

// ---- Espacio de ejecución de la auditoría (resumen, checklist, cierre guiado) ----

/** Secciones del espacio de trabajo del detalle; espejo de las pestañas renderizadas. */
export type AuditWorkspaceSection = 'resumen' | 'plan' | 'equipo' | 'checklist' | 'hallazgos' | 'evidencias' | 'acciones' | 'informe' | 'seguimiento' | 'historial'

export type AuditCloseBlocker = {
  reason: 'CHECKLIST_PENDING' | 'CHECKLIST_FINDING_MISSING' | 'ACTIONS_PENDING' | 'EFFICACY_PENDING' | 'EVIDENCE_PENDING' | 'EVIDENCE_FAILED' | 'EVIDENCE_DELETE_PENDING'
  count: number
  message: string
  /** Sección del espacio de trabajo donde se resuelve el bloqueo. */
  section: AuditWorkspaceSection
}

const isFinalActionStatus = (status: AuditCorrectiveActionStatus): boolean => status === 'COMPLETED' || status === 'CANCELLED'

export type AuditEvidenceStorageSummary = {
  READY: number
  PENDING: number
  FAILED: number
  DELETE_PENDING: number
}

export const auditEvidenceStorageSummary = (audit: Audit): AuditEvidenceStorageSummary => {
  const summary: AuditEvidenceStorageSummary = { READY: 0, PENDING: 0, FAILED: 0, DELETE_PENDING: 0 }
  for (const file of audit.evidenceFiles ?? []) summary[file.storageState] += 1
  return summary
}

/**
 * Condiciones de cierre calculadas en el cliente para el cierre guiado. Es el MISMO criterio que
 * valida el servidor dentro de la transacción (server/app.ts changeAuditStatusHandler): aquí solo
 * sirve para mostrar qué falta; la autoridad sigue siendo el backend.
 */
export const auditCloseBlockers = (audit: Audit): AuditCloseBlocker[] => {
  const blockers: AuditCloseBlocker[] = []
  const items = (audit.checklists ?? []).flatMap((checklist) => checklist.items)
  const actions = (audit.findings ?? []).flatMap((finding) => finding.actions ?? [])
  const missingFindingLinks = items.filter((item) =>
    item.result === 'NON_CONFORM'
    && !(audit.findings ?? []).some((finding) => finding.auditId === audit.id && finding.type === 'NONCONFORMITY' && finding.itemId === item.id),
  ).length
  const requiredPending = items.filter((item) => item.required && item.result === 'PENDING').length
  if (requiredPending > 0) {
    blockers.push({
      reason: 'CHECKLIST_PENDING',
      count: requiredPending,
      message: `${requiredPending} criterio(s) obligatorio(s) sin evaluar`,
      section: 'checklist',
    })
  }
  if (missingFindingLinks > 0) {
    blockers.push({
      reason: 'CHECKLIST_FINDING_MISSING',
      count: missingFindingLinks,
      message: `${missingFindingLinks} no conformidad(es) sin hallazgo válido vinculado`,
      section: 'hallazgos',
    })
  }
  const openRequiredActions = actions.filter((action) => action.required && !isFinalActionStatus(action.status)).length
  if (openRequiredActions > 0) {
    blockers.push({
      reason: 'ACTIONS_PENDING',
      count: openRequiredActions,
      message: `${openRequiredActions} acción(es) correctiva(s) obligatoria(s) pendiente(s)`,
      section: 'acciones',
    })
  }
  const pendingEfficacy = pendingEfficacyFindings(audit).length
  if (pendingEfficacy > 0) {
    blockers.push({
      reason: 'EFFICACY_PENDING',
      count: pendingEfficacy,
      message: `${pendingEfficacy} no conformidad(es) sin verificación de eficacia`,
      section: 'hallazgos',
    })
  }
  const evidenceStorage = auditEvidenceStorageSummary(audit)
  if (evidenceStorage.PENDING > 0) {
    blockers.push({
      reason: 'EVIDENCE_PENDING',
      count: evidenceStorage.PENDING,
      message: `${evidenceStorage.PENDING} archivo(s) de evidencia pendientes de sincronización`,
      section: 'evidencias',
    })
  }
  if (evidenceStorage.FAILED > 0) {
    blockers.push({
      reason: 'EVIDENCE_FAILED',
      count: evidenceStorage.FAILED,
      message: `${evidenceStorage.FAILED} archivo(s) de evidencia con sincronización fallida`,
      section: 'evidencias',
    })
  }
  if (evidenceStorage.DELETE_PENDING > 0) {
    blockers.push({
      reason: 'EVIDENCE_DELETE_PENDING',
      count: evidenceStorage.DELETE_PENDING,
      message: `${evidenceStorage.DELETE_PENDING} eliminación(es) de evidencia pendientes`,
      section: 'evidencias',
    })
  }
  return blockers
}

/** No conformidades resueltas cuya verificación de eficacia todavía no está registrada. */
export const pendingEfficacyFindings = (audit: Audit): AuditFinding[] =>
  (audit.findings ?? []).filter((finding) =>
    finding.type === 'NONCONFORMITY'
    && finding.status === 'RESOLVED'
    && (!finding.efficacyVerification || finding.efficacyVerification.trim().length < 3))

export type AuditExecutionSummary = {
  itemsTotal: number
  itemsEvaluated: number
  itemsPending: number
  itemsRequiredTotal: number
  itemsRequiredEvaluated: number
  itemsRequiredPending: number
  conform: number
  nonConform: number
  notApplicable: number
  findingsTotal: number
  findingsOpen: number
  findingsNonConformity: number
  findingsObservation: number
  findingsOpportunity: number
  actionsTotal: number
  actionsOpen: number
  actionsRequiredOpen: number
  actionsOverdue: number
}

/** Recuento de resultados para el resumen de cierre y los indicadores del espacio de trabajo. */
export const auditExecutionSummary = (audit: Audit, today = new Date()): AuditExecutionSummary => {
  const items = (audit.checklists ?? []).flatMap((checklist) => checklist.items)
  const findings = audit.findings ?? []
  const actions = findings.flatMap((finding) => finding.actions ?? [])
  const requiredItems = items.filter((item) => item.required)
  return {
    itemsTotal: items.length,
    itemsEvaluated: items.filter((item) => item.result !== 'PENDING').length,
    itemsPending: items.filter((item) => item.result === 'PENDING').length,
    itemsRequiredTotal: requiredItems.length,
    itemsRequiredEvaluated: requiredItems.filter((item) => item.result !== 'PENDING').length,
    itemsRequiredPending: requiredItems.filter((item) => item.result === 'PENDING').length,
    conform: items.filter((item) => item.result === 'CONFORM').length,
    nonConform: items.filter((item) => item.result === 'NON_CONFORM').length,
    notApplicable: items.filter((item) => item.result === 'NOT_APPLICABLE').length,
    findingsTotal: findings.length,
    findingsOpen: findings.filter((finding) => finding.status !== 'VERIFIED').length,
    findingsNonConformity: findings.filter((finding) => finding.type === 'NONCONFORMITY').length,
    findingsObservation: findings.filter((finding) => finding.type === 'OBSERVATION').length,
    findingsOpportunity: findings.filter((finding) => finding.type === 'OPPORTUNITY').length,
    actionsTotal: actions.length,
    actionsOpen: actions.filter((action) => !isFinalActionStatus(action.status)).length,
    actionsRequiredOpen: actions.filter((action) => action.required && !isFinalActionStatus(action.status)).length,
    actionsOverdue: actions.filter((action) => isAuditActionOverdue(action, today)).length,
  }
}

/** Acción vencida: con fecha límite pasada y sin estado final (COMPLETED/CANCELLED). */
export const isAuditActionOverdue = (action: Pick<AuditCorrectiveAction, 'dueDate' | 'status'>, today = new Date()): boolean => {
  if (!action.dueDate || isFinalActionStatus(action.status)) return false
  // Se interpreta como fin de día LOCAL: `new Date('YYYY-MM-DD')` cae en medianoche UTC y
  // desplazaría un día la fecha límite en zonas con offset negativo (p. ej. America/Bogota).
  const [year, month, day] = action.dueDate.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return false
  const due = new Date(year, month - 1, day, 23, 59, 59, 999)
  if (Number.isNaN(due.getTime())) return false
  return due.getTime() < today.getTime()
}

/** Etiqueta de la relación de un archivo PDF de evidencia con el registro que lo origina. */
export const evidenceFileRelationLabel = (file: AuditEvidenceFile, audit: Audit): string => {
  if (file.findingId) {
    const finding = audit.findings.find((item) => item.id === file.findingId)
    return `Hallazgo: ${finding?.title ?? '—'}`
  }
  if (file.actionId) {
    const action = audit.findings.flatMap((item) => item.actions ?? []).find((item) => item.id === file.actionId)
    return `Acción: ${action?.title ?? '—'}`
  }
  if (file.itemId) {
    const item = (audit.checklists ?? []).flatMap((checklist) => checklist.items).find((row) => row.id === file.itemId)
    return `Criterio: ${item ? item.description.slice(0, 60) : '—'}`
  }
  return 'Auditoría'
}

export const evidenceStorageStateLabels: Record<AuditEvidenceFile['storageState'], string> = {
  PENDING: 'Procesamiento pendiente',
  READY: 'Disponible',
  DELETE_PENDING: 'Eliminación pendiente',
  FAILED: 'Procesamiento fallido',
}

export const evidenceStorageStateMessages: Record<AuditEvidenceFile['storageState'], string> = {
  PENDING: 'El PDF está registrado y pendiente de procesamiento.',
  READY: 'El PDF está disponible para descarga.',
  DELETE_PENDING: 'La eliminación del PDF está pendiente de procesamiento.',
  FAILED: 'El procesamiento del PDF falló. Revisa la operación de almacenamiento.',
}
