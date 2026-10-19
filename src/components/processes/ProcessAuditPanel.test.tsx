import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Process } from '../../types'
import { ProcessAuditPanel, type AuditUser } from './ProcessAuditPanel'
import { auditModuleLabels, auditTransitions, findingTransitions } from './ProcessAuditPanel.model'

const process: Process = {
  id: 'cmprocess000000000000000001',
  companyId: 'cmcompany00000000000000001',
  name: 'Gestión Comercial',
  code: 'PROC-01',
  type: 'MISSIONAL',
  version: '1.0',
  frequency: null,
  organizationalArea: null,
  supervision: null,
  executionType: null,
  objective: 'Gestionar las oportunidades comerciales.',
  description: null,
  status: 'ACTIVE',
  thirdPartyProvided: false,
  critical: false,
  affectsAccounting: false,
  personalData: false,
  responsible: null,
  createdAt: '2026-10-18T10:00:00.000Z',
  updatedAt: '2026-10-18T10:00:00.000Z',
}

const users: AuditUser[] = [
  { id: 'cmadmin000000000000000001', name: 'Audit Admin', companyId: process.companyId },
]

const render = (canWrite: boolean) => renderToStaticMarkup(
  <ProcessAuditPanel process={process} users={users} canWrite={canWrite} onBack={vi.fn()} />,
)

describe('ProcessAuditPanel', () => {
  it('muestra el encabezado, el contexto del proceso y la carga inicial', () => {
    const markup = render(true)
    expect(markup).toContain('GESTIÓN POR PROCESOS / MÓDULO AUDITORÍAS')
    expect(markup).toContain('Auditorías')
    expect(markup).toContain('Gestión Comercial')
    expect(markup).toContain('PROC-01')
    expect(markup).toContain('Cargando auditorías...')
    expect(markup).toContain('+ Nueva auditoría')
  })

  it('oculta la acción de creación a los usuarios sin permiso de escritura', () => {
    const markup = render(false)
    expect(markup).not.toContain('+ Nueva auditoría')
    expect(markup).toContain('Volver a la caracterización')
  })

  it('describe el flujo de auditorías en el panel de listado', () => {
    const markup = render(true)
    expect(markup).toContain('AUDITORÍAS DEL PROCESO')
    expect(markup).toContain('Planifica, ejecuta y da seguimiento')
  })
})

describe('máquinas de estado del módulo de auditorías', () => {
  it('refleja el flujo del servidor: planificada → en curso → cerrada, con cancelación', () => {
    expect(auditTransitions.PLANNED.map((transition) => transition.to)).toEqual(['IN_PROGRESS', 'CANCELLED'])
    expect(auditTransitions.IN_PROGRESS.map((transition) => transition.to)).toEqual(['CLOSED', 'CANCELLED'])
    expect(auditTransitions.CLOSED).toHaveLength(0)
    expect(auditTransitions.CANCELLED).toHaveLength(0)
  })

  it('refleja el flujo de hallazgos solo hacia adelante, con verificado terminal', () => {
    expect(findingTransitions.OPEN.map((transition) => transition.to)).toEqual(['IN_PROGRESS', 'RESOLVED'])
    expect(findingTransitions.IN_PROGRESS.map((transition) => transition.to)).toEqual(['RESOLVED'])
    expect(findingTransitions.RESOLVED.map((transition) => transition.to)).toEqual(['VERIFIED'])
    expect(findingTransitions.VERIFIED).toHaveLength(0)
  })

  it('expone etiquetas en español para los catálogos del módulo', () => {
    expect(auditModuleLabels.auditStatusLabels.CLOSED).toBe('Cerrada')
    expect(auditModuleLabels.findingStatusLabels.VERIFIED).toBe('Verificado')
    expect(auditModuleLabels.findingSeverityLabels.MAJOR).toBe('Mayor')
    expect(auditModuleLabels.findingTypeLabels.NONCONFORMITY).toBe('No conformidad')
    expect(auditModuleLabels.auditEventLabels.FINDING_DELETED).toBe('Hallazgo eliminado')
  })
})
