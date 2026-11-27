import type { AuditCorrectiveAction } from '../../types'

export const CORRECTIVE_ACTION_UPCOMING_DAYS = 7

export type CorrectiveActionDeadlineStatus = 'PENDING' | 'IN_PROGRESS' | 'UPCOMING' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED'

const bogotaCalendarToday = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())

export const actionCurrentPercent = (action: AuditCorrectiveAction): number => {
  if (typeof action.progressPercent === 'number') return action.progressPercent
  return action.progress.find((entry) => entry.percent !== null)?.percent ?? 0
}

export const actionDeadlineStatus = (action: AuditCorrectiveAction, today = bogotaCalendarToday()): CorrectiveActionDeadlineStatus => {
  if (action.status === 'COMPLETED') return 'COMPLETED'
  if (action.status === 'CANCELLED') return 'CANCELLED'
  if (!action.dueDate) return action.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'PENDING'
  const dueDate = action.dueDate.slice(0, 10)
  if (dueDate < today) return 'OVERDUE'
  const todayValue = Date.parse(`${today}T00:00:00Z`)
  const dueValue = Date.parse(`${dueDate}T00:00:00Z`)
  if (dueValue - todayValue <= CORRECTIVE_ACTION_UPCOMING_DAYS * 86400000) return 'UPCOMING'
  return action.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'PENDING'
}

export const correctiveActionDeadlineLabels: Record<CorrectiveActionDeadlineStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  UPCOMING: 'Próxima a vencer',
  OVERDUE: 'Vencida',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
}

export const mandatoryImplementationCriteria = (action: AuditCorrectiveAction) => (action.acceptanceCriteria ?? []).filter((criterion) => criterion.type === 'IMPLEMENTATION' && criterion.required)

export const pendingImplementationCriteria = (action: AuditCorrectiveAction) => mandatoryImplementationCriteria(action).filter((criterion) => !criterion.isMet)

export const actionCanComplete = (action: AuditCorrectiveAction): boolean => (
  action.workflowVersion !== 1
  || Boolean(action.responsible?.isActive)
  && actionCurrentPercent(action) === 100
  && pendingImplementationCriteria(action).length === 0
)
