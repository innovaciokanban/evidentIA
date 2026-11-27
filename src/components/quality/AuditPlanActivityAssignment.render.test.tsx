import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AuditPlanActivityDraft, } from './audit-plan.model'
import type { AuditPlanActivityAuditor, AuditTeamMember } from '../../types'
import { ActivityAuditorSummary, ActivityEditorWithAuditors } from './AuditPlanActivityAssignment'

const noop = () => {}

const draft: AuditPlanActivityDraft = {
  type: 'INTERVIEW',
  title: 'Entrevista de proceso',
  description: '',
  scheduledStart: '2026-11-21T09:00',
  scheduledEnd: '2026-11-21T10:00',
  location: '',
  responsibleId: '',
  processId: '',
  auditorIds: ['member-1'],
  notes: '',
}

const member = {
  id: 'member-1',
  role: 'LEAD',
  isActive: true,
  removedAt: null,
  auditor: { id: 'auditor-1', name: 'Ana Auditora', type: 'INTERNAL' },
  independenceStatus: 'CLEAR',
} as AuditTeamMember

const assignedAuditor = { id: 'assignment-1', teamMemberId: 'member-1', auditorId: 'auditor-1', name: 'Ana Auditora', email: 'ana@example.com', role: 'LEAD', type: 'INTERNAL', independenceStatus: 'CLEAR', mitigationMeasures: null } as AuditPlanActivityAuditor

describe('AuditPlanActivityAssignment frontend', () => {
  it('renders active team members as selectable activity auditors', () => {
    const markup = renderToStaticMarkup(<ActivityEditorWithAuditors draft={draft} users={[]} processes={[]} members={[member]} saving={false} error="" editing={false} onChange={noop} onSubmit={noop} onClose={noop} />)
    expect(markup).toContain('Auditores de la actividad')
    expect(markup).toContain('Ana Auditora')
    expect(markup).toContain('Responsable operativo')
    expect(markup).toContain('checked')
  })

  it('shows assigned auditors separately from the operational responsible', () => {
    const markup = renderToStaticMarkup(<ActivityAuditorSummary auditors={[assignedAuditor]} />)
    expect(markup).toContain('Auditores')
    expect(markup).toContain('Ana Auditora')
    expect(markup).toContain('Líder')
  })
})
