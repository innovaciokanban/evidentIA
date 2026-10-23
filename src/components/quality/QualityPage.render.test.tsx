import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Audit } from '../../types'
import { QualityPage } from './QualityPage'

const user = { id: 'user-1', role: 'COMPANY_ADMIN', companyId: 'company-1' }

const audit = {
  id: 'audit-1',
  companyId: 'company-1',
  processId: 'process-1',
  code: 'AUD-001',
  title: 'Auditoría interna',
  auditType: 'Interna',
  status: 'PLANNED',
  scope: 'Procesos críticos',
  objectives: null,
  criteria: 'Manual de calidad',
  plannedDate: null,
  startDate: null,
  endDate: null,
  summary: null,
  process: { id: 'process-1', companyId: 'company-1', name: 'Operación', code: 'PROC-01' },
  leadAuditor: null,
  responsible: null,
  findings: [],
  evidences: [],
  evidenceFiles: [],
  relatedProcesses: [],
  procedures: [],
  checklists: [],
  checklistProgress: null,
  indicators: { findings: 0, openFindings: 0, checklistTotal: 0, checklistRequiredPending: 0, openRequiredActions: 0 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as Audit

describe('QualityPage rendering', () => {
  it('renders the loading state', () => {
    const markup = renderToStaticMarkup(<QualityPage user={user} />)
    expect(markup).toContain('Cargando auditorías')
  })

  it('renders the empty state', () => {
    const markup = renderToStaticMarkup(<QualityPage user={user} initialLoading={false} />)
    expect(markup).toContain('Sin auditorías de calidad')
  })

  it('renders a loaded audit', () => {
    const markup = renderToStaticMarkup(<QualityPage user={user} initialAudits={[audit]} initialLoading={false} />)
    expect(markup).toContain('Auditoría interna')
    expect(markup).toContain('AUD-001')
  })
})
