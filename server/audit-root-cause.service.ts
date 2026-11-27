import { AuditRootCauseAnalysisStatus, AuditRootCauseStatus, Prisma } from '@prisma/client'

export const auditRootCauseAnalysisInclude = {
  responsible: { select: { id: true, name: true, isActive: true } },
  createdBy: { select: { id: true, name: true, isActive: true } },
  confirmedBy: { select: { id: true, name: true, isActive: true } },
  causes: {
    orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }],
    include: {
      createdBy: { select: { id: true, name: true, isActive: true } },
      confirmedBy: { select: { id: true, name: true, isActive: true } },
    },
  },
  fiveWhySteps: { orderBy: { sequence: 'asc' } },
} satisfies Prisma.AuditRootCauseAnalysisInclude

export const auditRootCauseInclude = {
  createdBy: { select: { id: true, name: true, isActive: true } },
  confirmedBy: { select: { id: true, name: true, isActive: true } },
} as const

export type AuditRootCauseAnalysisWithInclude = Prisma.AuditRootCauseAnalysisGetPayload<{
  include: typeof auditRootCauseAnalysisInclude
}>

export const auditRootCauseAnalysisTransitions: Record<AuditRootCauseAnalysisStatus, AuditRootCauseAnalysisStatus[]> = {
  [AuditRootCauseAnalysisStatus.DRAFT]: [AuditRootCauseAnalysisStatus.CONFIRMED],
  [AuditRootCauseAnalysisStatus.CONFIRMED]: [],
}

export const auditRootCauseTransitions: Record<AuditRootCauseStatus, AuditRootCauseStatus[]> = {
  [AuditRootCauseStatus.POTENTIAL]: [AuditRootCauseStatus.CONFIRMED, AuditRootCauseStatus.DISCARDED],
  [AuditRootCauseStatus.CONFIRMED]: [],
  [AuditRootCauseStatus.DISCARDED]: [],
}

export const canTransitionAuditRootCauseAnalysis = (from: AuditRootCauseAnalysisStatus, to: AuditRootCauseAnalysisStatus): boolean =>
  from !== to && auditRootCauseAnalysisTransitions[from].includes(to)

export const canTransitionAuditRootCause = (from: AuditRootCauseStatus, to: AuditRootCauseStatus): boolean =>
  from !== to && auditRootCauseTransitions[from].includes(to)

const userView = (user: { id: string; name: string; isActive: boolean } | null) => user

export const auditRootCauseView = (cause: AuditRootCauseAnalysisWithInclude['causes'][number]) => ({
  id: cause.id,
  analysisId: cause.analysisId,
  findingId: cause.findingId,
  status: cause.status,
  description: cause.description,
  justification: cause.justification,
  supportingEvidence: cause.supportingEvidence,
  ishikawaCategory: cause.ishikawaCategory,
  position: cause.position,
  createdBy: userView(cause.createdBy),
  confirmedBy: userView(cause.confirmedBy),
  confirmedAt: cause.confirmedAt,
  createdAt: cause.createdAt,
  updatedAt: cause.updatedAt,
})

export const auditRootCauseFiveWhyStepView = (step: AuditRootCauseAnalysisWithInclude['fiveWhySteps'][number]) => ({
  id: step.id,
  analysisId: step.analysisId,
  sequence: step.sequence,
  question: step.question,
  answer: step.answer,
  createdAt: step.createdAt,
  updatedAt: step.updatedAt,
})

export const auditRootCauseAnalysisView = (analysis: AuditRootCauseAnalysisWithInclude) => ({
  id: analysis.id,
  findingId: analysis.findingId,
  methodology: analysis.methodology,
  status: analysis.status,
  origin: analysis.origin,
  problemDescription: analysis.problemDescription,
  responsible: userView(analysis.responsible),
  createdBy: userView(analysis.createdBy),
  confirmedBy: userView(analysis.confirmedBy),
  confirmedAt: analysis.confirmedAt,
  causes: analysis.causes.map(auditRootCauseView),
  fiveWhySteps: analysis.fiveWhySteps.map(auditRootCauseFiveWhyStepView),
  createdAt: analysis.createdAt,
  updatedAt: analysis.updatedAt,
})
