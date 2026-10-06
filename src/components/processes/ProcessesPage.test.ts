import { describe, expect, it } from 'vitest'
import type { Process } from '../../types'
import { categoryOf, groupProcesses } from './ProcessesPage'

const processOf = (type: Process['type'], name: string): Process => ({ type, name } as Process)

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
