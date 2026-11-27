export const isActiveAuditFollowUpStatus = (status: string | null | undefined): boolean => status === 'ENABLED' || status === 'IN_PROGRESS'

export const isTreatmentEvidenceCoherent = ({
  evaluationAuditId,
  evaluationFindingId,
  evaluationActionId,
  evidenceAuditId,
  evidenceFindingId,
  evidenceActionId,
  isOfficialReportPdf = false,
}: {
  evaluationAuditId: string
  evaluationFindingId: string
  evaluationActionId: string
  evidenceAuditId: string
  evidenceFindingId: string | null
  evidenceActionId: string | null
  isOfficialReportPdf?: boolean
}): boolean => !isOfficialReportPdf
  && evidenceAuditId === evaluationAuditId
  && (evidenceActionId === evaluationActionId || evidenceFindingId === evaluationFindingId || (evidenceActionId === null && evidenceFindingId === null))

export const followUpHasPendingWork = ({
  pendingFindings,
  pendingActions,
  pendingEvaluations,
}: {
  pendingFindings: number
  pendingActions: number
  pendingEvaluations: number
}): boolean => pendingFindings > 0 || pendingActions > 0 || pendingEvaluations > 0
