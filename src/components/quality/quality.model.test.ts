import { describe, expect, it } from 'vitest'
import type { Audit } from '../../types'
import {
  actionStatusLabels,
  actionTransitions,
  auditStatusLabels,
  auditTransitions,
  checklistResultLabels,
  checklistResults,
  draftFromAudit,
  emptyActionDraft,
  emptyAuditDraft,
  emptyChecklistItemDraft,
  emptyFindingDraft,
  eventLabel,
  findingSeverityLabels,
  findingStatusLabels,
  findingTransitions,
  findingTypeLabels,
  formatBytes,
  isTerminalAudit,
} from './quality.model'

const baseAudit = {
  id: 'audit-1',
  companyId: 'company-1',
  processId: 'process-1',
  code: 'AUD-001',
  title: 'Auditoría interna',
  auditType: 'Interna',
  status: 'PLANNED',
  scope: 'Alcance',
  objectives: null,
  criteria: 'Criterios',
  plannedDate: null,
  startDate: null,
  endDate: null,
  summary: null,
  process: { id: 'process-1', companyId: 'company-1', name: 'Proceso', code: 'PROC-01' },
  leadAuditor: null,
  responsible: null,
  findings: [],
  evidences: [],
  evidenceFiles: [],
  relatedProcesses: [],
  procedures: [],
  checklists: [],
  checklistProgress: null,
  indicators: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as Audit

describe('quality.model', () => {
  it('exposes audit status labels and legal transitions', () => {
    expect(auditStatusLabels.PLANNED).toBe('Planificada')
    expect(auditTransitions.PLANNED.map((item) => item.to)).toEqual(['IN_PROGRESS', 'CANCELLED'])
    expect(auditTransitions.IN_PROGRESS.map((item) => item.to)).toEqual(['CLOSED', 'CANCELLED'])
    expect(auditTransitions.CLOSED).toEqual([])
    expect(auditTransitions.CANCELLED).toEqual([])
  })

  it('detects terminal audits', () => {
    expect(isTerminalAudit({ status: 'CLOSED' })).toBe(true)
    expect(isTerminalAudit({ status: 'CANCELLED' })).toBe(true)
    expect(isTerminalAudit({ status: 'PLANNED' })).toBe(false)
    expect(isTerminalAudit({ status: 'IN_PROGRESS' })).toBe(false)
  })

  it('mirrors the finding lifecycle and catalogs', () => {
    expect(findingStatusLabels.VERIFIED).toBe('Verificado')
    expect(findingTransitions.OPEN.map((item) => item.to)).toEqual(['IN_PROGRESS', 'RESOLVED'])
    expect(findingTransitions.IN_PROGRESS.map((item) => item.to)).toEqual(['RESOLVED'])
    expect(findingTransitions.RESOLVED.map((item) => item.to)).toEqual(['VERIFIED'])
    expect(findingTransitions.VERIFIED).toEqual([])
    expect(findingTypeLabels.NONCONFORMITY).toBe('No conformidad')
    expect(findingSeverityLabels.MAJOR).toBe('Mayor')
  })

  it('mirrors the corrective action machine and result catalog', () => {
    expect(actionStatusLabels.OPEN).toBe('Abierta')
    expect(actionTransitions.OPEN.map((item) => item.to)).toEqual(['IN_PROGRESS', 'CANCELLED'])
    expect(actionTransitions.IN_PROGRESS.map((item) => item.to)).toEqual(['COMPLETED', 'CANCELLED'])
    expect(actionTransitions.COMPLETED).toEqual([])
    expect(actionTransitions.CANCELLED).toEqual([])
    expect(checklistResults).toEqual(['PENDING', 'CONFORM', 'NON_CONFORM', 'NOT_APPLICABLE'])
    expect(checklistResultLabels.NON_CONFORM).toBe('No conforme')
  })

  it('builds empty drafts and formats helpers', () => {
    expect(emptyAuditDraft).toMatchObject({ title: '', auditType: '', processId: '', leadAuditorId: '', responsibleId: '', processIds: [], procedureIds: [] })
    expect(emptyFindingDraft).toMatchObject({ title: '', type: 'NONCONFORMITY', severity: 'MINOR', itemId: '', processId: '', procedureId: '' })
    expect(emptyActionDraft).toMatchObject({ title: '', priority: 'MEDIUM', required: true })
    expect(emptyChecklistItemDraft).toMatchObject({ description: '', criteria: '', required: true })
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(eventLabel({ eventType: 'AUDIT_CREATED' } as never)).toContain('Auditoría')
    expect(eventLabel({ eventType: 'FINDING_CREATED' } as never)).toContain('Hallazgo')
  })

  it('maps an existing audit into the form draft', () => {
    const draft = draftFromAudit({ ...baseAudit, title: 'Existente', auditType: 'Externa', processId: 'process-9' })
    expect(draft).toMatchObject({ title: 'Existente', auditType: 'Externa', processId: 'process-9', processIds: [], procedureIds: [] })
  })
})
