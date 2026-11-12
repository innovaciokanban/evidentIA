import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Dispatch, SetStateAction } from 'react'
import { ProcessForm, type ProcessDraft } from './ProcessForm'

const draft: ProcessDraft = {
  name: '', type: 'MISSIONAL', objective: '', description: '', code: '', responsibleId: '', companyId: 'company-1',
  version: '1.0', frequency: '', organizationalArea: '', supervision: '', executionType: '',
  status: 'ACTIVE', updatedAt: null, thirdPartyProvided: false, critical: false, affectsAccounting: false, personalData: false,
}

const company = { id: 'company-1', name: 'Acme Consultores', identification: '900123', industry: 'Servicios', description: 'Empresa', admin: null, createdAt: '', updatedAt: '' }
const existingKpi = {
  id: 'ckpi00000000000000000001', processId: 'process-2', companyId: 'company-1', name: 'KPI existente', description: 'Indicador reutilizable',
  frequency: 'Mensual', target: '95%', formula: 'Cumplidos / totales', dataSource: 'Reporte', unit: '%', reportResponsible: null, monitorResponsible: null,
  greenThreshold: null, yellowThreshold: null, redThreshold: null, createdAt: '', updatedAt: '',
}

describe('ProcessForm embebido', () => {
  it('renderiza la ficha principal sin wrapper de modal', () => {
    const markup = renderToStaticMarkup(
      <ProcessForm
        draft={draft}
        setDraft={vi.fn() as unknown as Dispatch<SetStateAction<ProcessDraft>>}
        users={[]}
        companies={[company]}
        editing={false}
        readOnly={false}
        saving={false}
        error=""
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(markup).toContain('process-characterization')
    expect(markup).toContain('NUEVO PROCESO')
    expect(markup).toContain('CARACTERIZACIÓN DEL PROCESO')
    expect(markup).toContain('Tipo de proceso')
    expect(markup).toContain('Misional')
    expect(markup).toContain('<span>Código</span>')
    expect(markup).toContain('<span>Versión</span>')
    expect(markup).toContain('<strong>1.0</strong>')
    expect(markup).toContain('Se asignará automáticamente')
    expect(markup).toContain('<span>Empresa</span>')
    expect(markup).not.toContain('<span>Entidad</span>')
    expect(markup).toContain('ATRIBUTOS')
    expect(markup).toContain('Crear KPI nuevo')
    expect(markup).toContain('role="switch"')
    expect(markup).not.toContain('Medio de entrega')
    expect(markup).not.toContain('Mov. efectivo')
    expect(markup).not.toContain('Plan contingencia')
    expect(markup).not.toContain('Op. tributarias')
    expect(markup).not.toContain('drawer-backdrop')
    expect(markup).not.toContain('centered-modal')
  })

  it('ofrece crear KPI nuevo y vincular KPI existente del catálogo de la empresa', () => {
    const markup = renderToStaticMarkup(
      <ProcessForm
        draft={{ ...draft, kpis: [] }}
        setDraft={vi.fn() as unknown as Dispatch<SetStateAction<ProcessDraft>>}
        users={[]}
        companies={[company]}
        editing={false}
        readOnly={false}
        saving={false}
        error=""
        onSubmit={vi.fn()}
        onClose={vi.fn()}
        availableKpis={[existingKpi]}
      />,
    )

    expect(markup).toContain('Crear KPI nuevo')
    expect(markup).toContain('Vincular KPI existente')
    expect(markup).toContain('KPI existente')
  })

  it('cambia el encabezado para edición', () => {
    const markup = renderToStaticMarkup(
      <ProcessForm
        draft={{ ...draft, name: 'Proceso existente' }}
        setDraft={vi.fn() as unknown as Dispatch<SetStateAction<ProcessDraft>>}
        users={[]}
        companies={[company]}
        editing
        readOnly={false}
        saving={false}
        error=""
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(markup).toContain('EDITAR PROCESO')
    expect(markup).toContain('Proceso existente')
  })

  it('en solo lectura oculta las acciones de edición pero conserva la navegación', () => {
    const markup = renderToStaticMarkup(
      <ProcessForm
        draft={{ ...draft, name: 'Proceso existente' }}
        setDraft={vi.fn() as unknown as Dispatch<SetStateAction<ProcessDraft>>}
        users={[]}
        companies={[company]}
        editing
        readOnly
        saving={false}
        error=""
        onSubmit={vi.fn()}
        onClose={vi.fn()}
        onOpenKpis={vi.fn()}
        onOpenRisks={vi.fn()}
        onOpenChangeHistory={vi.fn()}
        onOpenProcedures={vi.fn()}
      />,
    )

    expect(markup).toContain('VER PROCESO')
    expect(markup).toContain('Volver al mapa')
    expect(markup).not.toContain('Guardar cambios')
    expect(markup).not.toContain('Guardar proceso')
    expect(markup).toContain('<fieldset disabled')
    expect(markup).toContain('<strong>Procedimiento</strong>')
    expect(markup).toContain('<strong>KPI</strong>')
    expect(markup).toContain('Riesgos')
    expect(markup).toContain('<strong>Control de cambios</strong>')
    expect(markup).not.toContain('<strong>Valor</strong>')
    expect(markup).not.toContain('Entrega al cliente')
    expect(markup).not.toContain('<strong>Auditoría</strong>')
  })
})
