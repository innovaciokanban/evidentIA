import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Audit, AuditProgram } from '../../types'
import { ApiError } from '../../api'
import { AuditProgramDetail, AuditProgramsPage } from './AuditProgramsPage'
import { auditProgress } from './audit-program.model'
import { auditProgramLoadErrorMessage } from './audit-program-error'

const detailProgram: AuditProgram = {
  id: 'program-1',
  companyId: 'company-1',
  code: 'PA-001',
  name: 'Programa anual',
  objective: 'Verificar controles.',
  scope: 'Procesos críticos.',
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: '2026-12-31T00:00:00.000Z',
  responsibleId: 'user-1',
  responsible: { id: 'user-1', name: 'Ana', isActive: true },
  criteria: 'ISO 9001',
  resources: null,
  risks: null,
  notes: null,
  status: 'ACTIVE',
  audits: [],
  auditSummary: { total: 0, byStatus: { PLANNED: 0, IN_PROGRESS: 0, CLOSED: 0, CANCELLED: 0 }, terminal: 0, nonTerminal: 0 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('AuditProgramsPage rendering', () => {
  it('renders the corporate program workspace and loading state for an administrator', () => {
    const markup = renderToStaticMarkup(<AuditProgramsPage user={{ id: 'user-1', role: 'COMPANY_ADMIN', companyId: 'company-1' }} users={[]} />)
    expect(markup).toContain('Programas de auditoría')
    expect(markup).toContain('Crear')
    expect(markup).toContain('Cargando programas de auditoría')
  })

  it('does not expose write actions to company users', () => {
    const markup = renderToStaticMarkup(<AuditProgramsPage user={{ id: 'user-2', role: 'COMPANY_USER', companyId: 'company-1' }} users={[]} />)
    expect(markup).not.toContain('Nuevo programa')
    expect(markup).toContain('Cargando programas de auditoría')
  })

  it('renders a dedicated audit-records workspace without the program list', () => {
    const markup = renderToStaticMarkup(<AuditProgramsPage user={{ id: 'user-1', role: 'COMPANY_ADMIN', companyId: 'company-1' }} users={[]} view="audits" />)
    expect(markup).toContain('Expedientes de auditoría')
    expect(markup).toContain('Buscar auditorías')
    expect(markup).not.toContain('Cargando programas de auditoría')
  })

  it('explains when the programs API route is unavailable instead of treating it as empty data', () => {
    const message = auditProgramLoadErrorMessage(new ApiError('Not found', 404))
    expect(message).toContain('API de programas de auditoría')
    expect(message).not.toContain('Sin programas de auditoría')
  })

  it('renders the program file with real empty-state tracking', () => {
    const markup = renderToStaticMarkup(<AuditProgramDetail program={detailProgram} audits={[]} companies={[]} canWrite notice="" error="" onBack={() => undefined} onEdit={() => undefined} onDelete={() => undefined} onStatusChange={async () => undefined} onOpenAudit={() => undefined} onNewAudit={() => undefined} />)
    expect(markup).toContain('EXPEDIENTE DEL PROGRAMA')
    expect(markup).toContain('Información general')
    expect(markup).toContain('Auditorías')
    expect(markup).toContain('Finalizar programa')
  })

  it('derives checklist progress from registered checklist items when the aggregate is absent', () => {
    const audit = { findings: [], checklists: [{ items: [{ result: 'PENDING' }, { result: 'CONFORM' }] }] } as unknown as Audit
    expect(auditProgress(audit)).toBe(50)
  })
})
