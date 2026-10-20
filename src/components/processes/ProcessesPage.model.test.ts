import { describe, expect, it } from 'vitest'
import { processDeleteErrorMessage } from './ProcessesPage.model'

describe('processDeleteErrorMessage', () => {
  it('explica el historial de cambios y ofrece poner el Estado en Inactivo (En pausa)', () => {
    const message = processDeleteErrorMessage('CHANGE_HISTORY')
    expect(message).toContain('historial de cambios')
    expect(message).toContain('Control de cambios')
    expect(message).toContain('Estado en «Inactivo»')
    expect(message).toContain('En pausa')
  })

  it('explica los registros relacionados sin pedir borrarlos y sin prometer eliminación', () => {
    const message = processDeleteErrorMessage('RELATED_RECORDS')
    expect(message).toContain('registros relacionados')
    expect(message).toContain('SIPOC')
    expect(message).toContain('Revisa esos módulos')
    expect(message).toContain('En pausa')
  })

  it('usa un mensaje genérico cuando la API no informa el motivo', () => {
    expect(processDeleteErrorMessage(undefined)).toBe('No se pudo eliminar el proceso.')
  })
})
