import { Prisma } from '@prisma/client'

export const auditCorrectiveActionCauseInclude = {
  cause: {
    include: {
      analysis: { select: { id: true, findingId: true, methodology: true, status: true, origin: true, problemDescription: true } },
      createdBy: { select: { id: true, name: true, isActive: true } },
      confirmedBy: { select: { id: true, name: true, isActive: true } },
    },
  },
  action: {
    include: { responsible: { select: { id: true, name: true, isActive: true } } },
  },
  linkedBy: { select: { id: true, name: true, isActive: true } },
  removedBy: { select: { id: true, name: true, isActive: true } },
} as const

export type AuditCorrectiveActionCauseWithInclude = Prisma.AuditCorrectiveActionCauseGetPayload<{
  include: typeof auditCorrectiveActionCauseInclude
}>

export const auditRootCauseEligibilityInclude = {
  analysis: { select: { id: true, findingId: true, methodology: true, status: true, origin: true, problemDescription: true } },
  createdBy: { select: { id: true, name: true, isActive: true } },
  confirmedBy: { select: { id: true, name: true, isActive: true } },
} as const

export type AuditRootCauseEligibleWithInclude = Prisma.AuditRootCauseGetPayload<{
  include: typeof auditRootCauseEligibilityInclude
}>

const userView = (user: { id: string; name: string; isActive: boolean } | null) => user

export const auditRootCauseEligibleView = (cause: AuditRootCauseEligibleWithInclude) => ({
  id: cause.id,
  analysisId: cause.analysisId,
  findingId: cause.findingId,
  status: cause.status,
  description: cause.description,
  justification: cause.justification,
  supportingEvidence: cause.supportingEvidence,
  ishikawaCategory: cause.ishikawaCategory,
  position: cause.position,
  analysis: cause.analysis,
  createdBy: userView(cause.createdBy),
  confirmedBy: userView(cause.confirmedBy),
  confirmedAt: cause.confirmedAt,
  createdAt: cause.createdAt,
  updatedAt: cause.updatedAt,
})

export const auditCorrectiveActionCauseView = (association: AuditCorrectiveActionCauseWithInclude) => ({
  id: association.id,
  findingId: association.findingId,
  actionId: association.actionId,
  causeId: association.causeId,
  isActive: association.isActive,
  linkedAt: association.linkedAt,
  linkedBy: userView(association.linkedBy),
  removedAt: association.removedAt,
  removedBy: userView(association.removedBy),
  cause: {
    id: association.cause.id,
    analysisId: association.cause.analysisId,
    findingId: association.cause.findingId,
    status: association.cause.status,
    description: association.cause.description,
    justification: association.cause.justification,
    supportingEvidence: association.cause.supportingEvidence,
    ishikawaCategory: association.cause.ishikawaCategory,
    position: association.cause.position,
    analysis: association.cause.analysis,
    createdBy: userView(association.cause.createdBy),
    confirmedBy: userView(association.cause.confirmedBy),
    confirmedAt: association.cause.confirmedAt,
    createdAt: association.cause.createdAt,
    updatedAt: association.cause.updatedAt,
  },
  action: {
    id: association.action.id,
    findingId: association.action.findingId,
    title: association.action.title,
    status: association.action.status,
    responsible: userView(association.action.responsible),
  },
})
