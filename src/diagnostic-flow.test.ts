import { describe, expect, it } from 'vitest'
import { diagnosticFlow } from './diagnostic-flow'

describe('navegación del análisis estratégico', () => {
  it('mantiene Objetivos SMART después de Ponderación dentro del mismo flujo', () => {
    expect(diagnosticFlow.map((step) => step.key)).toEqual(['diagnostico', 'dofa', 'checky', 'ponderacion', 'objetivos'])
    expect(diagnosticFlow.map((step) => step.label)).toEqual(['Análisis estratégico', 'Matriz DOFA', 'Checky', 'Ponderación', 'Objetivos SMART'])
  })
})
