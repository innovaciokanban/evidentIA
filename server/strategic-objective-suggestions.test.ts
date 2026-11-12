import { describe, expect, it } from 'vitest'
import {
  checkySuggestionStatusSchema,
  strategicObjectiveSuggestionPayloadSchema,
  strategicObjectiveSuggestionStrategyRefsSchema,
} from './validation.js'
import { normalizeStrategicObjectiveSuggestion, strategicObjectiveSuggestionDedupeKey, type StrategicObjectiveSuggestionPayload } from './strategic-objective-suggestions.js'

const payload: StrategicObjectiveSuggestionPayload = {
  title: 'Reducir el tiempo de respuesta',
  statement: 'Reducir el tiempo promedio de respuesta comercial.',
  specificCriteria: 'En el proceso comercial.',
  measurableCriteria: 'Reducirlo en 20%.',
  achievableCriteria: 'Con automatización y capacitación.',
  relevantCriteria: 'Mejora la experiencia del cliente.',
  timeBoundCriteria: 'Durante 2026.',
  indicators: [{
    name: 'Tiempo promedio de respuesta',
    unit: 'Horas',
    baselineValue: '48',
    targetValue: '38',
    measurementMethod: 'Reporte mensual del CRM',
    deadline: '2026-12-31',
  }],
}

describe('persistencia de propuestas SMART de Checky', () => {
  it('valida un payload completo con indicador propio', () => {
    expect(strategicObjectiveSuggestionPayloadSchema.parse(payload)).toEqual(payload)
  })

  it('exige la estructura completa del documento y una fecha calendario válida', () => {
    const { indicators: _indicators, ...withoutIndicators } = payload
    expect(strategicObjectiveSuggestionPayloadSchema.safeParse(withoutIndicators).success).toBe(false)
    expect(strategicObjectiveSuggestionPayloadSchema.safeParse({ ...payload, indicators: [{ ...payload.indicators![0], deadline: '2026-02-30' }] }).success).toBe(false)
    expect(strategicObjectiveSuggestionPayloadSchema.safeParse({ ...payload, indicators: [payload.indicators![0], payload.indicators![0]] }).success).toBe(false)
    expect(strategicObjectiveSuggestionPayloadSchema.safeParse({ ...payload, unexpected: true }).success).toBe(false)
  })

  it('rechaza referencias de estrategia duplicadas', () => {
    expect(strategicObjectiveSuggestionStrategyRefsSchema.safeParse(['cross:one', 'cross:one']).success).toBe(false)
    expect(strategicObjectiveSuggestionStrategyRefsSchema.parse(['cross:one', 'checky:two'])).toEqual(['cross:one', 'checky:two'])
  })

  it('reutiliza exactamente los tres estados de decisión de Checky', () => {
    expect(['PENDING', 'ACCEPTED', 'REJECTED'].map((status) => checkySuggestionStatusSchema.parse(status))).toEqual(['PENDING', 'ACCEPTED', 'REJECTED'])
  })

  it('normaliza espacios, mayúsculas y orden de referencias para deduplicar', () => {
    const equivalent = { ...payload, title: '  REDUCIR   EL TIEMPO DE RESPUESTA  ', indicators: [{ ...payload.indicators![0], name: ' TIEMPO   PROMEDIO DE RESPUESTA ' }] }
    expect(normalizeStrategicObjectiveSuggestion(payload, ['cross:one', 'checky:two'])).toBe(normalizeStrategicObjectiveSuggestion(equivalent, ['checky:two', 'cross:one']))
    expect(strategicObjectiveSuggestionDedupeKey('diagnostic-a', payload, ['cross:one'])).toBe(strategicObjectiveSuggestionDedupeKey('diagnostic-a', equivalent, ['cross:one']))
  })

  it('separa la misma propuesta cuando cambia el diagnóstico o el contenido', () => {
    expect(strategicObjectiveSuggestionDedupeKey('diagnostic-a', payload, ['cross:one'])).not.toBe(strategicObjectiveSuggestionDedupeKey('diagnostic-b', payload, ['cross:one']))
    const changed = { ...payload, indicators: [{ ...payload.indicators![0], targetValue: '99' }] }
    expect(strategicObjectiveSuggestionDedupeKey('diagnostic-a', payload, ['cross:one'])).not.toBe(strategicObjectiveSuggestionDedupeKey('diagnostic-a', changed, ['cross:one']))
  })
})
