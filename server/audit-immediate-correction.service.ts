import { AuditImmediateCorrectionStatus, Prisma } from '@prisma/client'

export const auditImmediateCorrectionInclude = {
  responsible: { select: { id: true, name: true, isActive: true } },
  createdBy: { select: { id: true, name: true, isActive: true } },
} as const

export type AuditImmediateCorrectionWithInclude = Prisma.AuditImmediateCorrectionGetPayload<{ include: typeof auditImmediateCorrectionInclude }>

export const auditImmediateCorrectionTransitions: Record<AuditImmediateCorrectionStatus, AuditImmediateCorrectionStatus[]> = {
  [AuditImmediateCorrectionStatus.OPEN]: [AuditImmediateCorrectionStatus.IN_PROGRESS, AuditImmediateCorrectionStatus.CANCELLED],
  [AuditImmediateCorrectionStatus.IN_PROGRESS]: [AuditImmediateCorrectionStatus.COMPLETED, AuditImmediateCorrectionStatus.CANCELLED],
  [AuditImmediateCorrectionStatus.COMPLETED]: [],
  [AuditImmediateCorrectionStatus.CANCELLED]: [],
}

export const canTransitionAuditImmediateCorrection = (from: AuditImmediateCorrectionStatus, to: AuditImmediateCorrectionStatus): boolean =>
  from !== to && auditImmediateCorrectionTransitions[from].includes(to)

export const auditImmediateCorrectionStatusNames: Record<AuditImmediateCorrectionStatus, string> = {
  [AuditImmediateCorrectionStatus.OPEN]: 'Abierta',
  [AuditImmediateCorrectionStatus.IN_PROGRESS]: 'En curso',
  [AuditImmediateCorrectionStatus.COMPLETED]: 'Completada',
  [AuditImmediateCorrectionStatus.CANCELLED]: 'Cancelada',
}

export const auditImmediateCorrectionView = (correction: AuditImmediateCorrectionWithInclude) => ({
  id: correction.id,
  findingId: correction.findingId,
  description: correction.description,
  containmentMeasures: correction.containmentMeasures,
  consequencesIdentified: correction.consequencesIdentified,
  consequencesTreatment: correction.consequencesTreatment,
  responsible: correction.responsible,
  plannedDate: correction.plannedDate,
  executedAt: correction.executedAt,
  status: correction.status,
  observations: correction.observations,
  createdBy: correction.createdBy,
  createdAt: correction.createdAt,
  updatedAt: correction.updatedAt,
})
