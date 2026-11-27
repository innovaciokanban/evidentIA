import { describe, expect, it } from 'vitest'
import type { AuditPlanActivity, AuditTeamMember } from '../../types'
import {
  activeActivities,
  activityDraftFromActivity,
  independenceSummary,
  independenceSummaryLabel,
  validateActivityDraft,
  type AuditPlanActivityDraft,
} from './audit-plan.model'

const draft = (overrides: Partial<AuditPlanActivityDraft> = {}): AuditPlanActivityDraft => ({
  type: 'INTERVIEW',
  title: 'Entrevista de proceso',
  description: '',
  scheduledStart: '2026-11-21T09:00',
  scheduledEnd: '2026-11-21T10:00',
  location: '',
  responsibleId: '',
  processId: '',
  auditorIds: [],
  notes: '',
  ...overrides,
})

const activity = (overrides: Partial<AuditPlanActivity>): AuditPlanActivity => ({
  id: 'activity-1',
  auditPlanId: 'plan-1',
  position: 1,
  type: 'INTERVIEW',
  title: 'Entrevista',
  description: null,
  scheduledStart: '2026-11-21T10:00:00.000Z',
  scheduledEnd: '2026-11-21T11:00:00.000Z',
  location: null,
  responsible: null,
  process: null,
  auditors: [],
  status: 'PLANNED',
  notes: null,
  createdAt: '',
  updatedAt: '',
  ...overrides,
})

const member = (independenceStatus: AuditTeamMember['independenceStatus'], role: AuditTeamMember['role'] = 'MEMBER'): AuditTeamMember => ({
  id: `${independenceStatus}-${role}`,
  auditId: 'audit-1',
  auditorId: 'auditor-1',
  companyId: 'company-1',
  role,
  assignedAt: '',
  assignedBy: null,
  observations: null,
  isActive: true,
  removedAt: null,
  removedBy: null,
  independenceStatus,
  independenceDeclaration: null,
  conflictDescription: null,
  mitigationMeasures: null,
  independenceEvaluatedAt: null,
  independenceEvaluatedBy: null,
  createdAt: '',
  updatedAt: '',
  auditor: {
    id: 'auditor-1',
    companyId: 'company-1',
    name: 'Auditor',
    email: 'auditor@example.com',
    phone: null,
    type: 'INTERNAL',
    position: null,
    organization: null,
    experience: null,
    status: 'AVAILABLE',
    observations: null,
    competencies: [],
  },
})

describe('audit-plan.model', () => {
  it('validates required activity fields and chronological dates', () => {
    expect(validateActivityDraft(draft({ title: 'No' }))).toContain('al menos 3')
    expect(validateActivityDraft(draft({ scheduledStart: '', scheduledEnd: '' }))).toContain('fecha y hora')
    expect(validateActivityDraft(draft({ scheduledStart: '2026-11-21T11:00', scheduledEnd: '2026-11-21T10:00' }))).toContain('posterior')
    expect(validateActivityDraft(draft())).toBe('')
  })

  it('sorts active agenda items and excludes retired activities', () => {
    const items = activeActivities([
      activity({ id: 'later', scheduledStart: '2026-11-21T12:00:00.000Z' }),
      activity({ id: 'retired', status: 'CANCELLED' }),
      activity({ id: 'first', scheduledStart: '2026-11-21T09:00:00.000Z' }),
    ])
    expect(items.map((item) => item.id)).toEqual(['first', 'later'])
  })

  it('hydrates assigned auditors into the activity draft', () => {
    const result = activityDraftFromActivity(activity({ auditors: [{ id: 'assignment-1', teamMemberId: 'member-1', auditorId: 'auditor-1', name: 'Ana Auditora', email: 'ana@example.com', role: 'LEAD', type: 'INTERNAL', independenceStatus: 'CLEAR', mitigationMeasures: null }] }))
    expect(result.auditorIds).toEqual(['member-1'])
  })

  it('keeps pending, conflicted and mitigated independence distinct', () => {
    const members = [member('CLEAR', 'LEAD'), member('MITIGATED'), member('PENDING'), member('CONFLICT')]
    expect(independenceSummary(members)).toMatchObject({ total: 4, clear: 1, mitigated: 1, pending: 1, conflicts: 1, leaders: 1 })
    expect(independenceSummaryLabel(members)).toBe('Conflicto abierto')
    expect(independenceSummaryLabel([member('MITIGATED', 'LEAD')])).toBe('Con mitigaciones documentadas')
    expect(independenceSummaryLabel([member('PENDING', 'LEAD')])).toBe('Evaluaciones pendientes')
  })
})
