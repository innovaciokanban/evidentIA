import { describe, expect, it } from 'vitest'
import { followUpHasPendingWork, isActiveAuditFollowUpStatus, isTreatmentEvidenceCoherent } from './audit-follow-up.policy.js'

describe('audit follow-up CAPA policy', () => {
  it('recognizes only enabled and in-progress follow-ups as active', () => {
    expect(isActiveAuditFollowUpStatus('ENABLED')).toBe(true)
    expect(isActiveAuditFollowUpStatus('IN_PROGRESS')).toBe(true)
    expect(isActiveAuditFollowUpStatus('COMPLETED')).toBe(false)
    expect(isActiveAuditFollowUpStatus('CANCELLED')).toBe(false)
  })

  it('rejects official report PDFs and cross-audit evidence, but accepts matching treatment evidence', () => {
    const base = {
      evaluationAuditId: 'audit-1',
      evaluationFindingId: 'finding-1',
      evaluationActionId: 'action-1',
      evidenceAuditId: 'audit-1',
      evidenceFindingId: 'finding-1',
      evidenceActionId: null,
    }
    expect(isTreatmentEvidenceCoherent(base)).toBe(true)
    expect(isTreatmentEvidenceCoherent({ ...base, evidenceAuditId: 'audit-2' })).toBe(false)
    expect(isTreatmentEvidenceCoherent({ ...base, isOfficialReportPdf: true })).toBe(false)
  })

  it('blocks CAPA completion while any mandatory pending work remains', () => {
    expect(followUpHasPendingWork({ pendingFindings: 0, pendingActions: 0, pendingEvaluations: 0 })).toBe(false)
    expect(followUpHasPendingWork({ pendingFindings: 1, pendingActions: 0, pendingEvaluations: 0 })).toBe(true)
    expect(followUpHasPendingWork({ pendingFindings: 0, pendingActions: 1, pendingEvaluations: 0 })).toBe(true)
    expect(followUpHasPendingWork({ pendingFindings: 0, pendingActions: 0, pendingEvaluations: 1 })).toBe(true)
  })
})
