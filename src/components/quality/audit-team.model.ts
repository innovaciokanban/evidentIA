import type { AuditIndependenceStatus, AuditTeamMember, AuditTeamRole, Auditor } from '../../types'

export const auditTeamRoleLabels: Record<AuditTeamRole, string> = {
  LEAD: 'Líder',
  MEMBER: 'Integrante',
}

export const independenceStatusLabels: Record<AuditIndependenceStatus, string> = {
  PENDING: 'Pendiente',
  CLEAR: 'Sin conflicto',
  CONFLICT: 'Conflicto',
  MITIGATED: 'Mitigado',
}

export const auditorTypeLabels = {
  INTERNAL: 'Interno',
  EXTERNAL: 'Externo',
} as const

export const auditorStatusLabels = {
  AVAILABLE: 'Disponible',
  UNAVAILABLE: 'No disponible',
  INACTIVE: 'Inactivo',
} as const

export const independenceStatusClass = (status: AuditIndependenceStatus): string => status.toLowerCase()

export const activeTeamSummary = (members: AuditTeamMember[]) => ({
  members: members.length,
  leaders: members.filter((member) => member.role === 'LEAD').length,
  pending: members.filter((member) => member.independenceStatus === 'PENDING').length,
  conflicts: members.filter((member) => member.independenceStatus === 'CONFLICT').length,
  mitigated: members.filter((member) => member.independenceStatus === 'MITIGATED').length,
})

export const teamReadiness = (members: AuditTeamMember[]): 'EMPTY' | 'PENDING' | 'CONFLICT' | 'MITIGATED' | 'READY' => {
  if (members.length === 0) return 'EMPTY'
  if (members.some((member) => member.independenceStatus === 'PENDING')) return 'PENDING'
  if (members.some((member) => member.independenceStatus === 'CONFLICT')) return 'CONFLICT'
  if (members.some((member) => member.independenceStatus === 'MITIGATED')) return 'MITIGATED'
  return 'READY'
}

export const availableAuditorsForTeam = (auditors: Auditor[], members: AuditTeamMember[]): Auditor[] => {
  const assignedIds = new Set(members.map((member) => member.auditorId))
  return auditors.filter((auditor) => auditor.status === 'AVAILABLE' && !assignedIds.has(auditor.id))
}
