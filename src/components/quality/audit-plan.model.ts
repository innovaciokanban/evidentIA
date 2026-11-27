import type { AuditPlanActivity, AuditPlanActivityStatus, AuditPlanActivityType, AuditPlanStatus, AuditTeamMember } from '../../types'

export const auditPlanStatusLabels: Record<AuditPlanStatus, string> = {
  DRAFT: 'Borrador',
  READY: 'Listo para aprobación',
  APPROVED: 'Aprobado',
  CANCELLED: 'Cancelado',
}

export const auditPlanActivityTypeLabels: Record<AuditPlanActivityType, string> = {
  OPENING_MEETING: 'Reunión de apertura',
  DOCUMENT_REVIEW: 'Revisión documental',
  INTERVIEW: 'Entrevista',
  PROCESS_REVIEW: 'Revisión del proceso',
  CLOSING_MEETING: 'Reunión de cierre',
  OTHER: 'Otra actividad',
}

export const auditPlanActivityStatusLabels: Record<AuditPlanActivityStatus, string> = {
  PLANNED: 'Planificada',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Retirada',
}

export type AuditPlanDraft = {
  methodology: string
  samplingMethod: string
  resources: string
  notes: string
}

export const emptyAuditPlanDraft: AuditPlanDraft = {
  methodology: '',
  samplingMethod: '',
  resources: '',
  notes: '',
}

export type AuditPlanActivityDraft = {
  type: AuditPlanActivityType
  title: string
  description: string
  scheduledStart: string
  scheduledEnd: string
  location: string
  responsibleId: string
  processId: string
  auditorIds: string[]
  notes: string
}

export const emptyAuditPlanActivityDraft: AuditPlanActivityDraft = {
  type: 'OTHER',
  title: '',
  description: '',
  scheduledStart: '',
  scheduledEnd: '',
  location: '',
  responsibleId: '',
  processId: '',
  auditorIds: [],
  notes: '',
}

const pad = (value: number): string => String(value).padStart(2, '0')

export const toDateTimeLocal = (value: string | null | undefined): string => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const toIsoDateTime = (value: string): string => new Date(value).toISOString()

export const activityDraftFromActivity = (activity: AuditPlanActivity): AuditPlanActivityDraft => ({
  type: activity.type,
  title: activity.title,
  description: activity.description ?? '',
  scheduledStart: toDateTimeLocal(activity.scheduledStart),
  scheduledEnd: toDateTimeLocal(activity.scheduledEnd),
  location: activity.location ?? '',
  responsibleId: activity.responsible?.id ?? '',
  processId: activity.process?.id ?? '',
  auditorIds: (activity.auditors ?? []).map((auditor) => auditor.teamMemberId),
  notes: activity.notes ?? '',
})

export const validateActivityDraft = (draft: AuditPlanActivityDraft): string => {
  if (draft.title.trim().length < 3) return 'El título debe tener al menos 3 caracteres.'
  if (!draft.scheduledStart || !draft.scheduledEnd) return 'Indica la fecha y hora de inicio y fin.'
  const start = new Date(draft.scheduledStart)
  const end = new Date(draft.scheduledEnd)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Las fechas de la actividad no son válidas.'
  if (start >= end) return 'La hora de fin debe ser posterior a la hora de inicio.'
  return ''
}

export const activeActivities = (activities: AuditPlanActivity[]): AuditPlanActivity[] => activities
  .filter((activity) => activity.status !== 'CANCELLED')
  .slice()
  .sort((left, right) => new Date(left.scheduledStart).getTime() - new Date(right.scheduledStart).getTime())

export const independenceSummary = (members: AuditTeamMember[]) => ({
  total: members.length,
  clear: members.filter((member) => member.independenceStatus === 'CLEAR').length,
  pending: members.filter((member) => member.independenceStatus === 'PENDING').length,
  conflicts: members.filter((member) => member.independenceStatus === 'CONFLICT').length,
  mitigated: members.filter((member) => member.independenceStatus === 'MITIGATED').length,
  leaders: members.filter((member) => member.role === 'LEAD').length,
})

export const independenceSummaryLabel = (members: AuditTeamMember[]): string => {
  const summary = independenceSummary(members)
  if (summary.total === 0) return 'Sin equipo auditor'
  if (summary.conflicts > 0) return 'Conflicto abierto'
  if (summary.pending > 0) return 'Evaluaciones pendientes'
  if (summary.mitigated > 0) return 'Con mitigaciones documentadas'
  return 'Evaluado sin conflictos'
}
