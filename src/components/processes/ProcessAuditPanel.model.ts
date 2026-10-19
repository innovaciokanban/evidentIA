import type { Audit, AuditEvent, AuditFinding, AuditFindingSeverity, AuditFindingStatus, AuditFindingType, AuditStatus } from '../../types'

// Catálogos y máquinas de estado del módulo Auditorías de calidad, en un archivo aparte para que
// el panel sea "component-only" a ojos de react-refresh. Los estados en plural (AuditStatus,
// AuditFindingStatus) son unitarios en el modelo.

export const auditStatusLabels: Record<AuditStatus, string> = {
  PLANNED: 'Planificada',
  IN_PROGRESS: 'En curso',
  CLOSED: 'Cerrada',
  CANCELLED: 'Cancelada',
}

// Transiciones del flujo de auditoría, espejo exacto de la máquina que valida el servidor:
// PLANNED → IN_PROGRESS → CLOSED; CANCELLED desde cualquier estado no cerrado; los estados
// terminales no se reabren desde esta ruta.
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

export const findingStatusLabels: Record<AuditFindingStatus, string> = {
  OPEN: 'Abierto',
  IN_PROGRESS: 'En curso',
  RESOLVED: 'Resuelto',
  VERIFIED: 'Verificado',
}

// Flujo de un hallazgo, espejo de la máquina del servidor: solo avances hacia adelante.
export const findingTransitions: Record<AuditFindingStatus, Array<{ to: AuditFindingStatus; label: string }>> = {
  OPEN: [
    { to: 'IN_PROGRESS', label: 'Iniciar seguimiento' },
    { to: 'RESOLVED', label: 'Resolver' },
  ],
  IN_PROGRESS: [
    { to: 'RESOLVED', label: 'Resolver' },
  ],
  RESOLVED: [
    { to: 'VERIFIED', label: 'Verificar' },
  ],
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

export const auditEventLabels: Record<AuditEvent['eventType'], string> = {
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
}

/** Público/exportado para pruebas: etiquetas del módulo. */
export const auditModuleLabels = {
  auditStatusLabels,
  findingStatusLabels,
  findingTypeLabels,
  findingSeverityLabels,
  auditEventLabels,
}

export type AuditDraft = {
  title: string
  auditType: string
  scope: string
  objectives: string
  criteria: string
  plannedDate: string
  leadAuditorId: string
  responsibleId: string
}

export const emptyAuditDraft: AuditDraft = {
  title: '', auditType: '', scope: '', objectives: '', criteria: '', plannedDate: '', leadAuditorId: '', responsibleId: '',
}

export const draftFromAudit = (audit: Audit): AuditDraft => ({
  title: audit.title,
  auditType: audit.auditType ?? '',
  scope: audit.scope,
  objectives: audit.objectives ?? '',
  criteria: audit.criteria,
  plannedDate: audit.plannedDate ? audit.plannedDate.slice(0, 10) : '',
  leadAuditorId: audit.leadAuditor?.id ?? '',
  responsibleId: audit.responsible?.id ?? '',
})

export type FindingDraft = {
  title: string
  description: string
  type: AuditFindingType
  severity: AuditFindingSeverity
  dueDate: string
  responsibleId: string
}

export const emptyFindingDraft: FindingDraft = {
  title: '', description: '', type: 'NONCONFORMITY', severity: 'MINOR', dueDate: '', responsibleId: '',
}

export const draftFromFinding = (finding: AuditFinding): FindingDraft => ({
  title: finding.title,
  description: finding.description,
  type: finding.type,
  severity: finding.severity,
  dueDate: finding.dueDate ? finding.dueDate.slice(0, 10) : '',
  responsibleId: finding.responsible?.id ?? '',
})

export type EvidenceDraft = {
  name: string
  description: string
  url: string
  findingId: string
}

export const emptyEvidenceDraft: EvidenceDraft = { name: '', description: '', url: '', findingId: '' }
