import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AuditCorrectiveAction, AuditFinding } from '../../types'
import { EfficacyVerificationPanel } from './EfficacyVerificationPanel'

const action = {
  id: 'action-1', findingId: 'finding-1', title: 'Control documental', description: 'Acción completada.', status: 'COMPLETED', priority: 'HIGH', required: true, workflowVersion: 1, dueDate: null, completedAt: '2026-11-20T00:00:00.000Z', responsible: { id: 'user-1', name: 'Auditor', isActive: true }, progress: [], acceptanceCriteria: [], evidences: [{ id: 'evidence-1', auditId: 'audit-1', findingId: 'finding-1', actionId: 'action-1', name: 'Acta', description: 'Acta', url: 'https://example.test/acta', createdAt: '', updatedAt: '' }], evidenceFiles: [{ id: 'file-1', storageState: 'READY' }], createdAt: '', updatedAt: '',
} as unknown as AuditCorrectiveAction

const finding = {
  id: 'finding-1', auditId: 'audit-1', title: 'Falta de control', description: 'Hallazgo', type: 'NONCONFORMITY', severity: 'MAJOR', status: 'RESOLVED', dueDate: null, responsible: null, resolution: 'Acción implementada', verifiedBy: null, verifiedAt: null, itemId: null, item: null, processId: null, process: null, procedureId: null, procedure: null, efficacyVerification: null, efficacyVerifiedBy: null, efficacyVerifiedAt: null, actions: [action], efficacyEvaluations: [], createdAt: '', updatedAt: '',
} as unknown as AuditFinding

describe('EfficacyVerificationPanel', () => {
  it('renders completed actions as available for a future efficacy evaluation', () => {
    const markup = renderToStaticMarkup(<EfficacyVerificationPanel auditId="audit-1" finding={finding} users={[{ id: 'user-1', name: 'Auditor', email: 'auditor@example.com', companyId: 'company-1', role: 'COMPANY_ADMIN', isActive: true }]} canWrite onChanged={vi.fn()} onError={vi.fn()} onNotice={vi.fn()} />)
    expect(markup).toContain('Verificación integral de eficacia')
    expect(markup).toContain('Planificar evaluación')
    expect(markup).toContain('Control documental')
    expect(markup).toContain('evaluaciones de eficacia históricas')
  })

  it('shows in-progress controls and keeps terminal evaluations read-only', () => {
    const evaluation = {
      id: 'evaluation-1', auditId: 'audit-1', findingId: 'finding-1', actionId: 'action-1', status: 'COMPLETED', outcome: 'EFFECTIVE', responsible: { id: 'user-1', name: 'Auditor', isActive: true }, scheduledDate: null, methodology: 'RECORD_REVIEW', methodologyOther: null, observationPeriod: '30 días', observationStartDate: null, observationEndDate: null, scope: 'Muestra posterior', observations: null, conclusion: 'La acción fue eficaz.', recurrenceDetected: false, recurrenceDescription: null, recurrenceIdentifiedAt: null, startedAt: '', completedAt: '', completedBy: { id: 'user-1', name: 'Auditor', isActive: true }, createdBy: { id: 'user-1', name: 'Auditor', isActive: true }, criteria: [{ id: 'criterion-result-1', evaluationId: 'evaluation-1', criterionId: 'criterion-1', description: 'La recurrencia disminuye', expectedResult: 'No se repite', required: true, resultObtained: 'Sin recurrencia', measuredValue: '0', measurementUnit: 'casos', sampleSize: 20, isMet: true, observations: null, evaluatedBy: { id: 'user-1', name: 'Auditor', isActive: true }, evaluatedAt: '', createdAt: '', updatedAt: '', sourceCriterion: null }], progress: [], evidences: [], evidenceFiles: [], createdAt: '', updatedAt: '',
    } as unknown as AuditFinding['efficacyEvaluations'][number]
    const markup = renderToStaticMarkup(<EfficacyVerificationPanel auditId="audit-1" finding={{ ...finding, efficacyEvaluations: [evaluation] }} users={[]} canWrite onChanged={vi.fn()} onError={vi.fn()} onNotice={vi.fn()} />)
    expect(markup).toContain('Evaluación finalizada en solo lectura')
    expect(markup).toContain('Eficaz')
    expect(markup).not.toContain('Guardar resultado')
    expect(markup).not.toContain('Cancelar evaluación')
    const inProgressMarkup = renderToStaticMarkup(<EfficacyVerificationPanel auditId="audit-1" finding={{ ...finding, efficacyEvaluations: [{ ...evaluation, status: 'IN_PROGRESS' }] }} users={[]} canWrite onChanged={vi.fn()} onError={vi.fn()} onNotice={vi.fn()} />)
    expect(inProgressMarkup).toContain('quality-checkbox-field')
    expect(inProgressMarkup).toContain('Se detectó recurrencia')
  })
})
