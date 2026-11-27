import type { Audit, AuditEvent } from '../../types'
import { eventLabel } from './quality.model'

const auditTimeZone = 'America/Bogota'
const calendarDateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: auditTimeZone })
const dateTimeFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: auditTimeZone })

const calendarDateValue = (value: string): Date | null => {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day, 12)
}

export const formatAuditCalendarDate = (value: string | null | undefined): string => {
  if (!value) return 'Sin fecha'
  const date = calendarDateValue(value)
  return date && !Number.isNaN(date.getTime()) ? calendarDateFormatter.format(date) : 'Fecha no disponible'
}

export const formatAuditDateTime = (value: string | null | undefined): string => {
  if (!value) return 'Sin fecha'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : dateTimeFormatter.format(date)
}

const technicalLabels: Record<string, string> = {
  OPEN: 'Abierto',
  IN_PROGRESS: 'En curso',
  PENDING: 'Pendiente',
  NON_CONFORM: 'No conforme',
  CONFORM: 'Conforme',
  NOT_APPLICABLE: 'No aplica',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado',
  PLANNED: 'Planificada',
  CLOSED: 'Cerrada',
  RESOLVED: 'Resuelto',
  VERIFIED: 'Verificado',
  READY: 'Disponible',
  FAILED: 'Fallido',
  DELETE_PENDING: 'Eliminación pendiente',
  RETRYABLE: 'Reintento programado',
  CRITICAL: 'Crítica',
  HIGH: 'Alta',
  MEDIUM: 'Media',
  LOW: 'Baja',
  MAJOR: 'Mayor',
  MINOR: 'Menor',
  NONCONFORMITY: 'No conformidad',
  OBSERVATION: 'Observación',
  OPPORTUNITY: 'Oportunidad',
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  MANUAL: 'Manual',
  FIVE_WHYS: 'Five Whys',
  ISHIKAWA: 'Ishikawa',
  POTENTIAL: 'Potencial',
  DISCARDED: 'Descartada',
  IN_REVIEW: 'En revisión',
  APPROVED: 'Aprobado',
  OBSOLETE: 'Obsoleto',
  SUPERUSER: 'Superusuario',
  COMPANY_ADMIN: 'Administrador',
  COMPANY_USER: 'Usuario de empresa',
  LEAD: 'Líder',
  MEMBER: 'Integrante',
  CLEAR: 'Sin conflicto',
  CONFLICT: 'Conflicto',
  MITIGATED: 'Mitigado',
  SATISFACTORY: 'Satisfactoria',
  PARTIAL: 'Parcial',
  ISSUE: 'Con incidencia',
}

const fieldLabels: Record<string, string> = {
  status: 'Estado',
  actualStart: 'Inicio real',
  actualEnd: 'Fin real',
  executionResult: 'Resultado de ejecución',
  executionObservations: 'Observaciones de ejecución',
  checklistItems: 'Ítems de checklist',
  evidences: 'Evidencias URL',
  evidenceFiles: 'Archivos de evidencia',
  findings: 'Hallazgos',
  containmentMeasures: 'Medidas de contención',
  consequencesIdentified: 'Consecuencias identificadas',
  consequencesTreatment: 'Tratamiento de consecuencias',
  plannedDate: 'Fecha prevista',
  executedAt: 'Fecha real de ejecución',
  observations: 'Observaciones',
  methodology: 'Metodología',
  problemDescription: 'Descripción del problema',
  responsibleId: 'Responsable',
  justification: 'Justificación',
  supportingEvidence: 'Evidencia de soporte',
  ishikawaCategory: 'Categoría Ishikawa',
  sequence: 'Secuencia',
  question: 'Pregunta',
  answer: 'Respuesta',
  analysisId: 'Identificación del análisis',
  causeId: 'Identificación de la causa',
  stepId: 'Identificación del paso',
  findingId: 'Identificación del hallazgo',
  previousStatus: 'Estado anterior',
  newStatus: 'Estado nuevo',
  objective: 'Objetivo',
  implementationPlan: 'Plan de implementación',
  resources: 'Recursos',
  observations: 'Observaciones',
  evidenceRequired: 'Evidencia requerida',
  progressPercent: 'Porcentaje de avance',
  workflowVersion: 'Versión del flujo',
  acceptanceCriterion: 'Criterio de aceptación',
  actionId: 'Acción correctiva asociada',
  outcome: 'Dictamen de eficacia',
  conclusion: 'Conclusión técnica',
  recurrenceDetected: 'Recurrencia detectada',
  recurrenceDescription: 'Descripción de recurrencia',
  criterionResult: 'Resultado de criterio de eficacia',
}

export type AuditHistoryChange = {
  field: string
  label?: string
  previousValue: unknown
  newValue: unknown
}

export const auditHistoryGlyph = (eventType: AuditEvent['eventType']): string => {
  if (eventType.includes('DELETED')) return '−'
  if (eventType.includes('UNLINKED')) return '−'
  if (eventType.includes('LINKED')) return '+'
  if (eventType.includes('STATUS')) return '↕'
  if (eventType.includes('PROGRESS') || eventType.includes('EXECUTION')) return '↗'
  if (eventType.includes('EVIDENCE') || eventType.includes('CHECKLIST')) return '▣'
  if (eventType.includes('CREATED')) return '+'
  return '✎'
}

export const auditHistoryCategory = (eventType: AuditEvent['eventType']): string => {
  if (eventType.startsWith('AUDIT_PLAN_ACTIVITY_')) return 'Ejecución'
  if (eventType.includes('FINDING')) return 'Hallazgo'
  if (eventType.includes('IMMEDIATE_CORRECTION')) return 'Corrección inmediata'
  if (eventType.includes('ROOT_CAUSE')) return 'Causa raíz'
  if (eventType.includes('CORRECTIVE_ACTION_CAUSE')) return 'Vinculación de causas'
  if (eventType.includes('ACTION')) return 'Acción'
  if (eventType.includes('EVIDENCE')) return 'Evidencia'
  if (eventType.includes('CHECKLIST')) return 'Checklist'
  return 'Auditoría'
}

export const auditHistoryChanges = (event: AuditEvent): AuditHistoryChange[] => event.changes as unknown as AuditHistoryChange[]

export const auditHistoryChangeLabel = (change: AuditHistoryChange): string => change.label ?? fieldLabels[change.field] ?? change.field

const resourceName = (field: string, value: unknown, audit: Audit): string => {
  const id = String(value)
  if (field === 'checklistItems') return (audit.checklists ?? []).flatMap((checklist) => checklist.items).find((item) => item.id === id)?.description ?? id
  if (field === 'evidences') return audit.evidences.find((evidence) => evidence.id === id)?.name ?? id
  if (field === 'evidenceFiles') return audit.evidenceFiles?.find((file) => file.id === id)?.filename ?? id
  if (field === 'findings') return audit.findings.find((finding) => finding.id === id)?.title ?? id
  return id
}

export const auditHistoryValue = (value: unknown, field: string, audit: Audit): string => {
  if (value === null || value === '') return 'Sin valor'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (field === 'plannedDate') return formatAuditCalendarDate(String(value))
  if (field === 'actualStart' || field === 'actualEnd' || field === 'executedAt') {
    const stringValue = String(value)
    return /^\d{4}-\d{2}-\d{2}$/.test(stringValue) ? formatAuditCalendarDate(stringValue) : formatAuditDateTime(stringValue)
  }
  if (Array.isArray(value)) return value.map((entry) => resourceName(field, entry, audit)).join(' · ')
  if (typeof value === 'object') return JSON.stringify(value)
  return technicalLabels[String(value)] ?? String(value)
}

const rootCauseEventTitle = (event: AuditEvent): string | null => {
  if (!event.eventType.includes('ROOT_CAUSE')) return null
  const normalized = event.summary.trim().toLowerCase().replace(/\.$/, '')
  if (normalized === 'root cause analysis confirmed') return 'Análisis de causa raíz confirmado'
  if (normalized === 'root cause updated') return 'Causa raíz actualizada'
  if (normalized === 'root cause confirmed') return 'Causa raíz confirmada'
  if (normalized === 'root cause discarded') return 'Causa raíz descartada'
  if (normalized === 'root cause created') return 'Causa raíz creada'
  if (normalized === 'root cause analysis updated' || /^root cause analysis [\w-]+ updated$/.test(normalized)) return 'Análisis de causa raíz actualizado'
  if (normalized.startsWith('root cause analysis for finding ')) return 'Análisis de causa raíz creado'
  if (normalized.match(/^five whys step \d+ created$/)) return 'Paso Five Whys creado'
  if (normalized.match(/^five whys step \d+ updated$/)) return 'Paso Five Whys actualizado'
  if (normalized.match(/^five whys step \d+ deleted$/)) return 'Paso Five Whys eliminado'
  return null
}

const correctiveActionCauseEventTitle = (event: AuditEvent): string | null => {
  if (!event.eventType.includes('CORRECTIVE_ACTION_CAUSE')) return null
  const normalized = event.summary.trim().toLowerCase().replace(/\.$/, '')
  if (normalized.startsWith('root cause linked to corrective action')) return 'Causa raíz vinculada a acción correctiva'
  if (normalized.startsWith('root cause unlinked from corrective action')) return 'Causa raíz desvinculada de acción correctiva'
  return null
}

export const auditHistoryChangeValue = (event: AuditEvent, change: AuditHistoryChange, audit: Audit, value: unknown = change.newValue): string => (
  event.eventType === 'IMMEDIATE_CORRECTION_STATUS_CHANGED'
  && event.metadata?.newStatus === 'COMPLETED'
  && change.field === 'executedAt'
  && value === change.newValue
    ? formatAuditDateTime(event.occurredAt)
    : event.eventType === 'ROOT_CAUSE_STATUS_CHANGED' && (change.field === 'status' || change.field === 'previousStatus' || change.field === 'newStatus')
      ? ({ POTENTIAL: 'Potencial', CONFIRMED: 'Confirmada', DISCARDED: 'Descartada' } as Record<string, string>)[String(value)] ?? String(value)
      : event.eventType === 'ROOT_CAUSE_ANALYSIS_STATUS_CHANGED' && (change.field === 'status' || change.field === 'previousStatus' || change.field === 'newStatus')
        ? ({ DRAFT: 'Borrador', CONFIRMED: 'Confirmado' } as Record<string, string>)[String(value)] ?? String(value)
        : auditHistoryValue(value, change.field, audit)
)

export const auditHistoryPresentation = (event: AuditEvent): { title: string; detail: string } => {
  const translatedRootTitle = rootCauseEventTitle(event)
  const translatedCauseLinkTitle = correctiveActionCauseEventTitle(event)
  const title = translatedRootTitle ?? translatedCauseLinkTitle ?? eventLabel(event)
  if (event.eventType === 'ROOT_CAUSE_ANALYSIS_CREATED') {
    const finding = event.summary.match(/finding\s+["«]([^"»]+)["»]/i)?.[1]
    return { title, detail: finding ? `Hallazgo: ${finding}` : '' }
  }
  if (event.eventType.startsWith('ROOT_CAUSE_FIVE_WHY_STEP_')) {
    const sequence = event.summary.match(/step\s+(\d+)/i)?.[1]
    return { title, detail: sequence ? `Paso ${sequence}` : '' }
  }
  if (translatedRootTitle) return { title, detail: '' }
  if (translatedCauseLinkTitle) {
    const action = event.summary.match(/action\s+["«]([^"»]+)["»]/i)?.[1]
    return { title, detail: action ? `Acción: ${action}` : '' }
  }
  if (event.eventType.startsWith('AUDIT_PLAN_ACTIVITY_')) {
    const activity = event.summary.match(/:\s*(.+)$/)?.[1]?.trim() ?? event.summary
    return { title, detail: activity }
  }
  const quoted = event.summary.match(/«([^»]+)»/)
  if (!quoted || quoted.index === undefined) return { title, detail: event.summary === title ? '' : event.summary }
  const suffix = event.summary.slice(quoted.index + quoted[0].length).trim()
  const genericSuffixes = new Set(['creado', 'creada', 'actualizado', 'actualizada', 'eliminado', 'eliminada', 'registrada', 'adjuntada', 'añadido', 'añadida'])
  return { title, detail: [quoted[1], suffix && !genericSuffixes.has(suffix) ? suffix : ''].filter(Boolean).join(' · ') }
}
