import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Process } from '../../types'
import { ProcessProcedurePanel, type ProcedureUser } from './ProcessProcedurePanel'

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

const users: ProcedureUser[] = [
  { id: 'cmadmin000000000000000001', name: 'Procedure Admin', companyId: process.companyId },
]

const render = (canWrite: boolean) => renderToStaticMarkup(
  <ProcessProcedurePanel process={process} users={users} canWrite={canWrite} onBack={vi.fn()} />,
)

describe('ProcessProcedurePanel', () => {
  it('muestra el encabezado, el contexto del proceso y la carga inicial', () => {
    const markup = render(true)
    expect(markup).toContain('GESTIÓN POR PROCESOS / MÓDULO PROCEDIMIENTOS')
    expect(markup).toContain('Procedimientos')
    expect(markup).toContain('Gestión Comercial')
    expect(markup).toContain('PROC-01')
    expect(markup).toContain('Cargando procedimientos...')
    expect(markup).toContain('+ Nuevo procedimiento')
  })

  it('oculta la acción de creación a los usuarios sin permiso de escritura', () => {
    const markup = render(false)
    expect(markup).not.toContain('+ Nuevo procedimiento')
    expect(markup).toContain('Volver a la caracterización')
  })

  it('describe el flujo documental en el panel de listado', () => {
    const markup = render(true)
    expect(markup).toContain('Flujo de revisión y aprobación')
    expect(markup).toContain('Documenta, revisa y aprueba los procedimientos')
  })
})
