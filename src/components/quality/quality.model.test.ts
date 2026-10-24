import { describe, expect, it } from 'vitest'
import type { Audit, AuditCorrectiveAction } from '../../types'
import {
  actionStatusLabels,
  actionTransitions,
  auditCloseBlockers,
  auditExecutionSummary,
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
  evidenceFileRelationLabel,
  findingSeverityLabels,
  findingStatusLabels,
  findingTransitions,
  findingTypeLabels,
  formatBytes,
  isAuditActionOverdue,
  isTerminalAudit,
  pendingEfficacyFindings,
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
    expect(emptyAuditDraft).toMatchObject({ title: '', auditType: '', leadAuditorId: '', responsibleId: '', processIds: [], procedureIds: [] })
    expect(emptyFindingDraft).toMatchObject({ title: '', type: 'NONCONFORMITY', severity: 'MINOR', itemId: '', processId: '', procedureId: '' })
    expect(emptyActionDraft).toMatchObject({ title: '', priority: 'MEDIUM', required: true })
    expect(emptyChecklistItemDraft).toMatchObject({ description: '', criteria: '', required: true })
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(eventLabel({ eventType: 'AUDIT_CREATED' } as never)).toContain('Auditoría')
    expect(eventLabel({ eventType: 'FINDING_CREATED' } as never)).toContain('Hallazgo')
  })

  it('maps an existing audit into the form draft with the anchor process first', () => {
    const draft = draftFromAudit({
      ...baseAudit,
      title: 'Existente',
      auditType: 'Externa',
      processId: 'process-9',
      relatedProcesses: [{ id: 'process-2' }, { id: 'process-9' }],
      procedures: [{ id: 'procedure-5' }],
    } as unknown as Audit)
    expect(draft).toMatchObject({ title: 'Existente', auditType: 'Externa', processIds: ['process-9', 'process-2'], procedureIds: ['procedure-5'] })
  })

  const item = (overrides: Record<string, unknown> = {}) => ({
    id: 'item-1',
    checklistId: 'checklist-1',
    description: '¿Se documenta el proceso?',
    criteria: 'Manual de calidad.',
    required: true,
    result: 'PENDING',
    observations: null,
    position: 1,
    ...overrides,
  })

  const action = (overrides: Partial<AuditCorrectiveAction> = {}): AuditCorrectiveAction => ({
    id: 'action-1',
    findingId: 'finding-1',
    title: 'Capacitar al equipo',
    description: 'Dictar una charla.',
    required: true,
    status: 'OPEN',
    priority: 'MEDIUM',
    dueDate: null,
    completedAt: null,
    responsible: null,
    progress: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  })

  const finding = (overrides: Record<string, unknown> = {}) => ({
    id: 'finding-1',
    auditId: 'audit-1',
    title: 'Hallazgo',
    description: 'Descripción.',
    type: 'OBSERVATION',
    severity: 'MINOR',
    status: 'OPEN',
    resolution: null,
    efficacyVerification: null,
    dueDate: null,
    responsible: null,
    itemId: null,
    process: null,
    procedure: null,
    actions: [],
    ...overrides,
  })

  const auditWith = (overrides: Record<string, unknown>): Audit => ({ ...baseAudit, ...overrides }) as unknown as Audit

  it('mirrors the server close gates with client-side blockers', () => {
    const checklist = { id: 'checklist-1', name: 'Lista', items: [item()] }
    const withChecklist = auditCloseBlockers(auditWith({ checklists: [checklist] }))
    expect(withChecklist).toEqual([
      { reason: 'CHECKLIST_PENDING', count: 1, message: '1 criterio(s) obligatorio(s) sin evaluar', section: 'checklist' },
    ])

    const withAction = auditCloseBlockers(auditWith({ findings: [finding({ actions: [action()] })] }))
    expect(withAction).toEqual([
      { reason: 'ACTIONS_PENDING', count: 1, message: '1 acción(es) correctiva(s) obligatoria(s) pendiente(s)', section: 'acciones' },
    ])

    const withEfficacy = auditCloseBlockers(auditWith({ findings: [finding({ type: 'NONCONFORMITY', status: 'RESOLVED' })] }))
    expect(withEfficacy).toEqual([
      { reason: 'EFFICACY_PENDING', count: 1, message: '1 no conformidad(es) sin verificación de eficacia', section: 'hallazgos' },
    ])

    // Sin requisitos pendientes no hay bloqueos; los opcionales y las acciones finales no cuentan.
    const clean = auditWith({
      checklists: [{ id: 'checklist-1', name: 'Lista', items: [item({ required: false }), item({ id: 'item-2', result: 'CONFORM' })] }],
      findings: [finding({ actions: [action({ status: 'COMPLETED' }), action({ id: 'action-2', required: false })] })],
    })
    expect(auditCloseBlockers(clean)).toEqual([])
  })

  it('summarizes execution progress for the workspace and close panel', () => {
    const today = new Date('2026-06-15T12:00:00.000Z')
    const audit = auditWith({
      checklists: [{
        id: 'checklist-1',
        name: 'Lista',
        items: [
          item({ id: 'item-1', result: 'CONFORM' }),
          item({ id: 'item-2', result: 'NON_CONFORM' }),
          item({ id: 'item-3', result: 'NOT_APPLICABLE', required: false }),
          item({ id: 'item-4' }),
          item({ id: 'item-5', required: false, result: 'PENDING' }),
        ],
      }],
      findings: [
        finding({ id: 'finding-1', type: 'NONCONFORMITY' }),
        finding({ id: 'finding-2', status: 'VERIFIED' }),
        finding({ id: 'finding-3', type: 'OPPORTUNITY' }),
      ],
    })
    const summary = auditExecutionSummary(audit, today)
    expect(summary).toMatchObject({
      itemsTotal: 5,
      itemsEvaluated: 3,
      itemsPending: 2,
      itemsRequiredPending: 1,
      conform: 1,
      nonConform: 1,
      notApplicable: 1,
      findingsTotal: 3,
      findingsOpen: 2,
      findingsNonConformity: 1,
      findingsOpportunity: 1,
      actionsTotal: 0,
      actionsOpen: 0,
      actionsRequiredOpen: 0,
      actionsOverdue: 0,
    })
  })

  it('detects overdue corrective actions without counting final states', () => {
    const today = new Date('2026-06-15T12:00:00.000Z')
    expect(isAuditActionOverdue(action({ dueDate: '2026-06-14' }), today)).toBe(true)
    expect(isAuditActionOverdue(action({ dueDate: '2026-06-15' }), today)).toBe(false)
    expect(isAuditActionOverdue(action({ dueDate: '2026-06-14', status: 'COMPLETED' }), today)).toBe(false)
    expect(isAuditActionOverdue(action({ dueDate: '2026-06-14', status: 'CANCELLED' }), today)).toBe(false)
    expect(isAuditActionOverdue(action({ dueDate: null }), today)).toBe(false)
    expect(isAuditActionOverdue(action({ dueDate: 'no-fecha' }), today)).toBe(false)

    const summary = auditExecutionSummary(auditWith({ findings: [finding({ actions: [action({ dueDate: '2026-06-01' }), action({ id: 'action-2', dueDate: '2026-06-01', status: 'COMPLETED' })] })] }), today)
    expect(summary).toMatchObject({ actionsTotal: 2, actionsOpen: 1, actionsRequiredOpen: 1, actionsOverdue: 1 })
  })

  it('lists resolved nonconformities that still need an efficacy verification', () => {
    const audit = auditWith({
      findings: [
        finding({ id: 'finding-1', type: 'NONCONFORMITY', status: 'RESOLVED', efficacyVerification: null }),
        finding({ id: 'finding-2', type: 'NONCONFORMITY', status: 'RESOLVED', efficacyVerification: '  ab  ' }),
        finding({ id: 'finding-3', type: 'NONCONFORMITY', status: 'RESOLVED', efficacyVerification: 'Seguimiento satisfactorio.' }),
        finding({ id: 'finding-4', type: 'NONCONFORMITY', status: 'OPEN' }),
        finding({ id: 'finding-5', type: 'OBSERVATION', status: 'RESOLVED' }),
      ],
    })
    expect(pendingEfficacyFindings(audit).map((item) => item.id)).toEqual(['finding-1', 'finding-2'])
  })

  it('labels the relation of an evidence file with its origin record', () => {
    const audit = auditWith({
      checklists: [{ id: 'checklist-1', name: 'Lista', items: [item({ description: 'Criterio documental del proceso comercial' })] }],
      findings: [finding({ id: 'finding-9', title: 'No conformidad del proveedor', actions: [action({ id: 'action-9', title: 'Seguimiento al proveedor' })] })],
    })
    expect(evidenceFileRelationLabel({ id: 'f1', findingId: 'finding-9', actionId: null, itemId: null } as never, audit)).toBe('Hallazgo: No conformidad del proveedor')
    expect(evidenceFileRelationLabel({ id: 'f2', findingId: null, actionId: 'action-9', itemId: null } as never, audit)).toBe('Acción: Seguimiento al proveedor')
    expect(evidenceFileRelationLabel({ id: 'f3', findingId: null, actionId: null, itemId: 'item-1' } as never, audit)).toBe('Criterio: Criterio documental del proceso comercial')
    expect(evidenceFileRelationLabel({ id: 'f4', findingId: null, actionId: null, itemId: null } as never, audit)).toBe('Auditoría')
    expect(evidenceFileRelationLabel({ id: 'f5', findingId: 'finding-x', actionId: null, itemId: null } as never, audit)).toBe('Hallazgo: —')
  })
})
