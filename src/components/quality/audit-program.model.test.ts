import { describe, expect, it } from 'vitest'
import type { AuditProgram } from '../../types'
import { auditProgramDraftFromProgram, auditProgramProgress, auditProgramStats, isTerminalAuditProgram } from './audit-program.model'

const program = (overrides: Partial<AuditProgram> = {}): AuditProgram => ({
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
  resources: 'Equipo auditor',
  risks: 'Disponibilidad',
  notes: 'Notas',
  status: 'ACTIVE',
  audits: [],
  auditSummary: { total: 2, byStatus: { PLANNED: 1, IN_PROGRESS: 0, CLOSED: 1, CANCELLED: 0 }, terminal: 1, nonTerminal: 1 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

describe('audit program model', () => {
  it('summarizes states and calculates real linked-audit progress', () => {
    const stats = auditProgramStats([program(), program({ id: 'program-2', status: 'DRAFT' }), program({ id: 'program-3', status: 'COMPLETED' })])
    expect(stats).toEqual({ total: 3, active: 1, draft: 1, completed: 1 })
    expect(auditProgramProgress(program())).toBe(50)
    expect(auditProgramProgress(program({ auditSummary: { total: 0, byStatus: { PLANNED: 0, IN_PROGRESS: 0, CLOSED: 0, CANCELLED: 0 }, terminal: 0, nonTerminal: 0 } }))).toBe(0)
  })

  it('prepares editable dates and optional fields without changing the API contract', () => {
    expect(auditProgramDraftFromProgram(program())).toMatchObject({ companyId: 'company-1', startDate: '2026-01-01', endDate: '2026-12-31', resources: 'Equipo auditor' })
    expect(isTerminalAuditProgram(program({ status: 'COMPLETED' }))).toBe(true)
    expect(isTerminalAuditProgram(program({ status: 'CANCELLED' }))).toBe(true)
    expect(isTerminalAuditProgram(program({ status: 'DRAFT' }))).toBe(false)
  })
})
