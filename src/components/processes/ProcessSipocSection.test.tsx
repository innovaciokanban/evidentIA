import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProcessSipocItem } from '../../types'
import { SipocColumn, kindMeta } from './ProcessSipocSection'

describe('tarjeta Proceso del SIPOC', () => {
  const item: ProcessSipocItem = { id: 'step-1', processId: 'process-1', description: 'Validar solicitud', createdAt: '', updatedAt: '' }
  const noop = () => undefined

  it('muestra el estado vacío y el contador sin inventar caracterización', () => {
    const markup = renderToStaticMarkup(<SipocColumn kind="processes" items={[]} readOnly={false} editor={null} draft="" saving={false} error="" onCreate={noop} onEdit={noop} onRemove={noop} onDraftChange={noop} onSubmit={noop} onCancel={noop} />)

    expect(markup).toContain('sipoc-process')
    expect(markup).toContain('Sin procesos registrados')
    expect(markup).toContain('+ Agregar proceso')
    expect(markup).toContain('>0</span>')
    expect(markup).not.toContain('Gestionar solicitudes')
    expect(markup).not.toContain('Coordina la atención y respuesta.')
  })

  it('muestra actividades, contador y respeta el modo de lectura', () => {
    const markup = renderToStaticMarkup(<SipocColumn kind="processes" items={[item]} readOnly editor={null} draft="" saving={false} error="" onCreate={noop} onEdit={noop} onRemove={noop} onDraftChange={noop} onSubmit={noop} onCancel={noop} />)

    expect(markup).toContain('PROCESO')
    expect(markup).toContain('Validar solicitud')
    expect(markup).toContain('>1</span>')
    expect(markup).not.toContain('+ Agregar proceso')
    expect(markup).not.toContain('Editar Validar solicitud')
  })

  it('conserva el orden de las cinco tarjetas', () => {
    expect(Object.keys(kindMeta)).toEqual(['suppliers', 'inputs', 'processes', 'outputs', 'customers'])
  })
})
