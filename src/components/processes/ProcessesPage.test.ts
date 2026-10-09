import { describe, expect, it } from 'vitest'
import type { Process } from '../../types'
import type { ProcessDraft } from './ProcessForm'
import { categoryOf, createProcessPayload, groupProcesses } from './ProcessesPage'

const processOf = (type: Process['type'], name: string): Process => ({ type, name } as Process)

const draft: ProcessDraft = {
  name: 'Gestión de proveedores',
  type: 'SUPPORT',
  objective: 'Asegurar proveedores adecuados',
  description: '',
  code: 'PROC-999',
  responsibleId: '',
  companyId: '550e8400-e29b-41d4-a716-446655440000',
  version: '1.0',
  frequency: '',
  organizationalArea: '',
  supervision: '',
  executionType: '',
  status: 'ACTIVE',
  updatedAt: null,
  thirdPartyProvided: false,
  critical: false,
  affectsAccounting: false,
  personalData: false,
}

describe('organización del mapa de procesos', () => {
  it('mapea cada tipo a su banda y mantiene los tres grupos', () => {
    expect(categoryOf.STRATEGIC).toBe('estrategico')
    expect(categoryOf.MISSIONAL).toBe('misional')
    expect(categoryOf.SUPPORT).toBe('apoyo')

    const grouped = groupProcesses([
      processOf('SUPPORT', 'Soporte'),
      processOf('STRATEGIC', 'Dirección'),
      processOf('MISSIONAL', 'Operación'),
    ])
    expect(grouped.estrategico.map((item) => item.name)).toEqual(['Dirección'])
    expect(grouped.misional.map((item) => item.name)).toEqual(['Operación'])
    expect(grouped.apoyo.map((item) => item.name)).toEqual(['Soporte'])
  })

  it('conserva vacía la banda que no tiene procesos', () => {
    const grouped = groupProcesses([processOf('MISSIONAL', 'Operación')])
    expect(grouped.estrategico).toEqual([])
    expect(grouped.apoyo).toEqual([])
  })
})

describe('payload de creación de procesos', () => {
  it('hereda el tipo de la categoría y no envía el código ni campos eliminados', () => {
    const payload = createProcessPayload(draft)

    expect(payload).toMatchObject({
      type: 'SUPPORT',
      category: 'apoyo',
      companyId: draft.companyId,
      status: 'ACTIVE',
      objective: 'Asegurar proveedores adecuados',
    })
    expect(payload.responsibleId).toBeNull()
    expect(payload.description).toBeNull()
    // El código lo genera el backend con bloqueo; los campos de control ya no existen.
    expect(payload).not.toHaveProperty('code')
    expect(payload).not.toHaveProperty('cashMovement')
    expect(payload).not.toHaveProperty('contingencyPlan')
    expect(payload).not.toHaveProperty('taxOperations')
  })
})
