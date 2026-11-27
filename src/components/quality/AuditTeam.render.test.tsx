import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AuditTeamMember, Auditor } from '../../types'
import { AuditIndependenceForm } from './AuditIndependenceForm'
import { AuditTeamAssignmentForm } from './AuditTeamAssignmentForm'
import { AuditTeamSection } from './AuditTeamSection'
import { teamReadiness } from './audit-team.model'

const noop = () => {}
const auditor = {
  id: 'auditor-1',
  companyId: 'company-1',
  name: 'Ana Auditora',
  email: 'ana@example.com',
  phone: null,
  type: 'INTERNAL',
  position: 'Coordinadora',
  organization: null,
  experience: '8 años',
  status: 'AVAILABLE',
  observations: null,
  createdById: null,
  createdBy: null,
  competencies: [{ id: 'competency-1', auditorId: 'auditor-1', name: 'ISO 9001', level: 5, evidence: 'Certificado', createdAt: '', updatedAt: '' }],
  createdAt: '',
  updatedAt: '',
} as Auditor

const member = {
  id: 'member-1',
  auditId: 'audit-1',
  auditorId: auditor.id,
  companyId: 'company-1',
  role: 'MEMBER',
  assignedAt: '2026-11-21T10:00:00.000Z',
  assignedBy: { id: 'user-1', name: 'Admin', email: 'admin@example.com', isActive: true },
  observations: null,
  isActive: true,
  removedAt: null,
  removedBy: null,
  independenceStatus: 'MITIGATED',
  independenceDeclaration: 'Se revisaron relaciones previas.',
  conflictDescription: 'Consultoría anterior.',
  mitigationMeasures: 'Revisión independiente.',
  independenceEvaluatedAt: '2026-11-21T11:00:00.000Z',
  independenceEvaluatedBy: { id: 'user-1', name: 'Admin', email: 'admin@example.com', isActive: true },
  createdAt: '2026-11-21T10:00:00.000Z',
  updatedAt: '2026-11-21T11:00:00.000Z',
  auditor: {
    id: auditor.id,
    companyId: auditor.companyId,
    name: auditor.name,
    email: auditor.email,
    phone: auditor.phone,
    type: auditor.type,
    position: auditor.position,
    organization: auditor.organization,
    experience: auditor.experience,
    status: auditor.status,
    observations: auditor.observations,
    competencies: auditor.competencies,
  },
} as AuditTeamMember

describe('AuditTeam frontend', () => {
  it('renders the real API loading state without fictitious members', () => {
    const markup = renderToStaticMarkup(<AuditTeamSection auditId="audit-1" companyId="company-1" canWrite={false} readOnly />)
    expect(markup).toContain('Cargando equipo auditor')
    expect(markup).not.toContain('Ana Auditora')
  })

  it('renders assignment controls and warns before replacing an existing leader', () => {
    const markup = renderToStaticMarkup(<AuditTeamAssignmentForm auditors={[auditor]} leaderExists saving={false} error="" onSubmit={noop} onClose={noop} />)
    expect(markup).toContain('Solo aparecen auditores disponibles')
    expect(markup).toContain('Ya existe un líder')
    expect(markup).toContain('Asignar al equipo')
    expect(markup).not.toContain('Auditor ficticio')
  })

  it('keeps MITIGATED distinct from CLEAR and requires mitigation context', () => {
    const markup = renderToStaticMarkup(<AuditIndependenceForm member={member} saving={false} error="" onSubmit={noop} onClose={noop} />)
    expect(markup).toContain('Mitigado no equivale a sin conflicto')
    expect(markup).toContain('Consultoría anterior.')
    expect(markup).toContain('Revisión independiente.')
    expect(markup).toContain('Guardar evaluación')
  })

  it('does not call the team prepared when independence is pending or conflicted', () => {
    expect(teamReadiness([{ ...member, independenceStatus: 'PENDING' }])).toBe('PENDING')
    expect(teamReadiness([{ ...member, independenceStatus: 'CONFLICT' }])).toBe('CONFLICT')
    expect(teamReadiness([member])).toBe('MITIGATED')
    expect(teamReadiness([{ ...member, independenceStatus: 'CLEAR' }])).toBe('READY')
  })
})
