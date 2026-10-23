import type {
  Audit,
  AuditChecklistResult,
  AuditCorrectiveActionPriority,
  AuditCorrectiveActionStatus,
  AuditEvent,
  AuditEventType,
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
  ACTION_CREATED: 'Acción correctiva creada',
  ACTION_UPDATED: 'Acción correctiva actualizada',
  ACTION_STATUS_CHANGED: 'Estado de la acción',
  ACTION_PROGRESS_ADDED: 'Avance registrado',
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

export type AuditDraft = {
  title: string
  auditType: AuditKind | ''
  processId: string
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
  title: '', auditType: '', processId: '', scope: '', objectives: '', criteria: '', plannedDate: '', leadAuditorId: '', responsibleId: '', processIds: [], procedureIds: [],
}

export const draftFromAudit = (audit: Audit): AuditDraft => ({
  title: audit.title,
  auditType: (audit.auditType === 'Interna' || audit.auditType === 'Externa' || audit.auditType === 'Mixta') ? audit.auditType : '',
  processId: audit.processId,
  scope: audit.scope,
  objectives: audit.objectives ?? '',
  criteria: audit.criteria,
  plannedDate: audit.plannedDate ? audit.plannedDate.slice(0, 10) : '',
  leadAuditorId: audit.leadAuditor?.id ?? '',
  responsibleId: audit.responsible?.id ?? '',
  processIds: (audit.relatedProcesses ?? []).map((process) => process.id),
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

export type ChecklistItemDraft = {
  description: string
  criteria: string
  required: boolean
}

export const emptyChecklistItemDraft: ChecklistItemDraft = { description: '', criteria: '', required: true }

/** Personas de la empresa visibles para los selectores del módulo. */
export type QualityUser = Pick<import('../../types').User, 'id' | 'name'> & { companyId: string | null }

export type QualityProcessOption = Pick<Process, 'id' | 'name' | 'code' | 'companyId'>
export type QualityProcedureOption = Pick<Procedure, 'id' | 'name' | 'code' | 'processId'>

export const auditHistoryEventTypeLabels = auditEventLabels

export const eventLabel = (event: Pick<AuditEvent, 'eventType'>): string => auditEventLabels[event.eventType] ?? event.eventType

export const formatBytes = (size: number): string => {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
