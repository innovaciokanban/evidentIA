import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ProcessCard, ProcessMapBand } from './ProcessCard'
import type { Process } from '../../types'

const process: Process = {
  id: 'cmprocess000000000000000001',
  companyId: 'cmcompany00000000000000001',
  name: 'Gestión Comercial',
  code: 'PR-001',
  type: 'MISSIONAL',
  version: '1.0',
  frequency: 'Mensual',
  organizationalArea: 'Comercial',
  supervision: 'Jefatura comercial',
  executionType: 'Interna',
  objective: 'Gestionar las oportunidades comerciales.',
  description: 'Acompaña la relación con clientes.',
  status: 'ACTIVE',
  thirdPartyProvided: false,
  critical: false,
  affectsAccounting: false,
  personalData: false,
  responsible: { id: 'cmuser0000000000000000001', name: 'Andrés Santacruz' },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
}

const band = {
  key: 'misional' as const,
  title: 'Misionales',
  role: 'Generación de valor',
  description: 'Procesos que generan valor directamente para el cliente.',
  icon: <span>◈</span>,
}

describe('ProcessCard', () => {
  it('muestra el resumen del proceso y sus acciones', () => {
    const markup = renderToStaticMarkup(
      <ProcessCard
        name="Gestión Comercial"
        code="PR-001"
        objective="Gestionar las oportunidades comerciales."
        description="Acompaña la relación con clientes."
        category="misional"
        status="active"
        responsible="Andrés Santacruz"
        onOpen={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(markup).toContain('Gestión Comercial')
    expect(markup).toContain('PR-001')
    expect(markup).toContain('Acompaña la relación con clientes.')
    expect(markup).not.toContain('Andrés Santacruz')
    expect(markup).not.toContain('Gestionar las oportunidades comerciales.')
    expect(markup).toContain('Activo')
    expect(markup).toContain('Ver proceso')
    expect(markup).toContain('Eliminar')
  })

  it('solo permite navegar cuando no hay permiso de eliminación', () => {
    const markup = renderToStaticMarkup(
      <ProcessCard
        name="Gestión Comercial"
        code="PR-001"
        objective="Gestionar las oportunidades comerciales."
        description="Acompaña la relación con clientes."
        category="misional"
        status="active"
        responsible="Andrés Santacruz"
        onOpen={vi.fn()}
      />,
    )

    expect(markup).toContain('Ver proceso')
    expect(markup).not.toContain('Eliminar')
  })
})

describe('ProcessMapBand', () => {
  it('con permiso de escritura muestra las acciones de crear y eliminar', () => {
    const markup = renderToStaticMarkup(
      <ProcessMapBand
        band={band}
        processes={[process]}
        canCreate
        onOpenProcess={vi.fn()}
        onCreateProcess={vi.fn()}
        onDeleteProcess={vi.fn()}
      />,
    )

    expect(markup).toContain('Misionales')
    expect(markup).toContain('Gestión Comercial')
    expect(markup).toContain('Activo')
    expect(markup).toContain('Ver proceso')
    expect(markup).toContain('Eliminar')
    expect(markup).toContain('Agregar proceso')
  })

  it('en solo lectura conserva la navegación y oculta crear y eliminar', () => {
    const markup = renderToStaticMarkup(
      <ProcessMapBand
        band={band}
        processes={[process]}
        canCreate={false}
        onOpenProcess={vi.fn()}
        onCreateProcess={vi.fn()}
        onDeleteProcess={vi.fn()}
      />,
    )

    expect(markup).toContain('Misionales')
    expect(markup).toContain('Gestión Comercial')
    expect(markup).toContain('Ver proceso')
    expect(markup).not.toContain('Eliminar')
    expect(markup).not.toContain('Agregar proceso')
  })

  it('marca el estado visual del proceso a partir del estado del backend', () => {
    const markup = renderToStaticMarkup(
      <ProcessMapBand
        band={band}
        processes={[process, { ...process, id: 'cmprocess000000000000000002', status: 'INACTIVE' }]}
        canCreate
        onOpenProcess={vi.fn()}
        onCreateProcess={vi.fn()}
        onDeleteProcess={vi.fn()}
      />,
    )

    expect(markup).toContain('Activo')
    expect(markup).toContain('En pausa')
    expect(markup).toContain('process-arrow')
  })
})
