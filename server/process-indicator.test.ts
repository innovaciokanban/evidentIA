import { describe, expect, it } from 'vitest'
import { processCreateSchema, processIndicatorCreateSchema, processIndicatorListSchema, processIndicatorUpdateSchema } from './validation.js'

const responsibleId = 'cmresponsible000000000000001'
const indicator = {
  name: 'Cumplimiento de entregas',
  description: 'Mide el cumplimiento de los compromisos del proceso.',
  frequency: 'Mensual',
  target: '95%',
  formula: 'Entregas a tiempo / total de entregas',
  dataSource: 'Sistema comercial',
  unit: 'Porcentaje',
  reportResponsibleId: responsibleId,
  monitorResponsibleId: null,
  greenThreshold: '>= 95%',
  yellowThreshold: '80% - 94%',
  redThreshold: '< 80%',
  baselineValue: '88%',
  measurementMethod: 'Corte mensual',
  deadline: '2026-12-31',
}

describe('validación de indicadores propios de procesos', () => {
  it('acepta un indicador completo y convierte la fecha calendario a UTC', () => {
    const parsed = processIndicatorCreateSchema.parse(indicator)
    expect(parsed.name).toBe(indicator.name)
    expect(parsed.deadline?.toISOString()).toBe('2026-12-31T00:00:00.000Z')
  })

  it('acepta actualización parcial, pero no una actualización vacía', () => {
    expect(processIndicatorUpdateSchema.parse({ target: '98%' })).toEqual({ target: '98%' })
    expect(processIndicatorUpdateSchema.safeParse({}).success).toBe(false)
  })

  it('rechaza nombres duplicados ignorando mayúsculas y espacios', () => {
    const parsed = processIndicatorListSchema.safeParse([
      indicator,
      { ...indicator, name: '  cumplimiento   DE entregas ' },
    ])
    expect(parsed.success).toBe(false)
  })

  it('permite crear procesos sin indicadores o con varios indicadores propios', () => {
    const base = { name: 'Gestión Comercial', type: 'MISSIONAL', category: 'misional', objective: 'Atender las solicitudes comerciales.' } as const
    const indicators = [indicator, { ...indicator, name: 'Tiempo de respuesta' }, { ...indicator, name: 'Satisfacción del cliente' }]
    expect(processCreateSchema.safeParse(base).success).toBe(true)
    expect(processCreateSchema.safeParse({ ...base, indicators: [indicator] }).success).toBe(true)
    expect(processCreateSchema.safeParse({ ...base, indicators }).success).toBe(true)
  })

  it('rechaza campos de catálogo KPI en indicadores propios', () => {
    expect(processIndicatorCreateSchema.safeParse({ ...indicator, id: 'legacy-kpi-id' }).success).toBe(false)
  })
})
