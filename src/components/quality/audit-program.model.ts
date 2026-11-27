import type { Audit, AuditProgram, AuditProgramStatus } from '../../types'
import { auditExecutionSummary } from './quality.model'

export const auditProgramStatusLabels: Record<AuditProgramStatus, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activo',
  COMPLETED: 'Finalizado',
  CANCELLED: 'Cancelado',
}

export const auditProgramStatusOptions: Array<{ value: AuditProgramStatus | ''; label: string }> = [
  { value: '', label: 'Todos los estados' },
  { value: 'ACTIVE', label: 'Activos' },
  { value: 'DRAFT', label: 'Borradores' },
  { value: 'COMPLETED', label: 'Finalizados' },
  { value: 'CANCELLED', label: 'Cancelados' },
]

export type AuditProgramDraft = {
  companyId: string
  name: string
  objective: string
  scope: string
  startDate: string
  endDate: string
  responsibleId: string
  criteria: string
  resources: string
  risks: string
  notes: string
}

export const emptyAuditProgramDraft: AuditProgramDraft = {
  companyId: '',
  name: '',
  objective: '',
  scope: '',
  startDate: '',
  endDate: '',
  responsibleId: '',
  criteria: '',
  resources: '',
  risks: '',
  notes: '',
}

export const auditProgramDraftFromProgram = (program: AuditProgram): AuditProgramDraft => ({
  companyId: program.companyId,
  name: program.name,
  objective: program.objective,
  scope: program.scope,
  startDate: program.startDate.slice(0, 10),
  endDate: program.endDate.slice(0, 10),
  responsibleId: program.responsibleId ?? '',
  criteria: program.criteria,
  resources: program.resources ?? '',
  risks: program.risks ?? '',
  notes: program.notes ?? '',
})

export const isTerminalAuditProgram = (program: Pick<AuditProgram, 'status'>): boolean =>
  program.status === 'COMPLETED' || program.status === 'CANCELLED'

export const auditProgramProgress = (program: Pick<AuditProgram, 'auditSummary'>): number => {
  if (program.auditSummary.total === 0) return 0
  return Math.round((program.auditSummary.terminal / program.auditSummary.total) * 100)
}

export const auditProgress = (audit: Audit): number | null => {
  const progress = audit.checklistProgress ?? (() => {
    const summary = auditExecutionSummary(audit)
    return audit.checklists?.length ? { total: summary.itemsTotal, completed: summary.itemsEvaluated } : null
  })()
  if (!progress || progress.total === 0) return null
  return Math.round((progress.completed / progress.total) * 100)
}

export const auditProgramStats = (programs: AuditProgram[]) => programs.reduce((stats, program) => ({
  total: stats.total + 1,
  active: stats.active + (program.status === 'ACTIVE' ? 1 : 0),
  draft: stats.draft + (program.status === 'DRAFT' ? 1 : 0),
  completed: stats.completed + (program.status === 'COMPLETED' ? 1 : 0),
}), { total: 0, active: 0, draft: 0, completed: 0 })
