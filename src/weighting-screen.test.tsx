import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StrategyWeightingScreen } from './App'
import type { ActionItemStatus, CrossWeightingCriteria, Diagnostic, DiagnosticStrategy, StrategyTaskPlan } from './types'

const criteria: CrossWeightingCriteria = { impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'ALTO', sinergiaInterna: 'MEDIO', impactoReputacional: 'MEDIO' }

const planOf = (statuses: ActionItemStatus[], planId: string): StrategyTaskPlan => ({
  id: planId,
  strategySource: 'CHECKY',
  strategySourceRef: `origen-${planId}`,
  strategyTitle: null,
  strategyDescription: null,
  items: statuses.map((status, index) => ({
    id: `${planId}item${index + 1}`,
    title: `Tarea ${index + 1}`,
    status,
    responsibleId: 'cmuser0000000000000001',
    responsible: { id: 'cmuser0000000000000001', name: 'Andres Zapata' },
    dueDate: '2026-10-04',
    ticket: null,
  })),
})

const strategyOf = ({ id, ponderada, statuses, title }: { id: string; ponderada: boolean; statuses: ActionItemStatus[]; title?: string }): DiagnosticStrategy => ({
  id,
  title: title ?? `Estrategia ${id}`,
  description: `Descripción de la estrategia ${id}.`,
  source: 'CHECKY',
  crossId: null,
  crossType: null,
  origin: null,
  factor1: null,
  factor2: null,
  weighting: ponderada ? { ...criteria, weightedScore: 4.4, weightingBand: 'INMEDIATA' } : null,
  weightedScore: ponderada ? 4.4 : null,
  weightingBand: ponderada ? 'INMEDIATA' : null,
  actionPlan: statuses.length > 0 || ponderada ? planOf(statuses, `${id}plan`) : null,
})

const diagnostic = { id: 'cmdiagnosticponderacion0001' } as unknown as Diagnostic

const renderScreen = (strategies: DiagnosticStrategy[]): string => renderToStaticMarkup(
  <StrategyWeightingScreen diagnostic={diagnostic} canValue initialStrategies={strategies} />,
)

/** Posición del bloque nuevo y de la fila de resumen existente en la pintada. */
const globalAt = (markup: string): number => markup.indexOf('class="swz-global-tasks"')
const summaryAt = (markup: string): number => markup.indexOf('class="swz-summary"')

describe('Ponderación: el avance global de tareas convive con los indicadores existentes', () => {
  it('la validación visual: 6 de 10 tareas completadas y 60% antes de la fila existente', () => {
    const markup = renderScreen([
      strategyOf({ id: 'cmstrategyponderada0001', ponderada: true, statuses: ['COMPLETED', 'COMPLETED', 'PENDING'] }),
      strategyOf({ id: 'cmstrategyponderada0002', ponderada: true, statuses: ['COMPLETED', 'PENDING', 'PENDING', 'PENDING'] }),
      strategyOf({ id: 'cmstrategyponderada0003', ponderada: true, statuses: ['COMPLETED', 'COMPLETED', 'COMPLETED'] }),
    ])

    expect(globalAt(markup)).toBeGreaterThan(-1)
    expect(summaryAt(markup)).toBeGreaterThan(-1)
    expect(globalAt(markup)).toBeLessThan(summaryAt(markup))
    expect(markup).toContain('AVANCE GLOBAL DE TAREAS')
    expect(markup).toContain('6 de 10 tareas completadas')
    expect(markup.slice(globalAt(markup), summaryAt(markup))).toContain('60%')
  })

  it('1. sin estrategias ponderadas el bloque marca 0% y sin progreso', () => {
    const sinAceptadas = renderScreen([])
    const sinPonderar = renderScreen([strategyOf({ id: 'cmstrategyponderada0004', ponderada: false, statuses: ['COMPLETED', 'COMPLETED', 'COMPLETED'] })])

    for (const markup of [sinAceptadas, sinPonderar]) {
      expect(globalAt(markup)).toBeGreaterThan(-1)
      expect(markup).toContain('AVANCE GLOBAL DE TAREAS')
      expect(markup).toContain('0 de 0 tareas completadas')
      expect(markup).toContain('Sin progreso')
      expect(markup).toContain('class="swz-global-tasks-percent">0%</strong>')
      expect(markup).toContain('aria-label="0 de 0 tareas completadas" aria-valuenow="0"')
      expect(markup).not.toContain('class="swz-global-tasks-percent">100%</strong>')
    }
    expect(globalAt(sinAceptadas)).toBeLessThan(sinAceptadas.indexOf('No hay estrategias aceptadas'))
  })

  it('7. las tareas de estrategias aceptadas pero sin ponderar no suman', () => {
    const markup = renderScreen([
      strategyOf({ id: 'cmstrategyponderada0005', ponderada: true, statuses: ['COMPLETED', 'PENDING', 'PENDING'] }),
      strategyOf({ id: 'cmstrategyponderada0006', ponderada: false, statuses: ['COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED'] }),
    ])

    // Solo entran las 3 tareas de la estrategia ponderada: la aceptada sin ponderar no aporta.
    expect(markup).toContain('1 de 3 tareas completadas')
    expect(markup).toContain('class="swz-global-tasks-percent">33%</strong>')
    expect(markup).not.toContain('5 de 7')
    expect(markup).not.toContain('71%')
    // Los KPI siguen midiendo lo suyo: 1 de 2 ponderadas = 50%.
    expect(markup).toMatch(/<strong>2<\/strong>/)
    expect(markup).toMatch(/<strong>1<\/strong>/)
    expect(markup).toMatch(/<strong>50%<\/strong>/)
  })

  it('8. las estrategias que no llegaron aceptadas no aportan tareas', () => {
    const markup = renderScreen([strategyOf({ id: 'cmstrategyponderada0007', ponderada: true, statuses: ['COMPLETED', 'PENDING', 'PENDING'] })])
    const rechazada = strategyOf({ id: 'cmstrategyrechazada0001', ponderada: true, statuses: ['COMPLETED', 'COMPLETED'], title: 'Estrategia rechazada' })

    expect(markup).toContain('1 de 3 tareas completadas')
    expect(markup).toContain('>33%<')
    expect(markup).not.toContain(rechazada.title)
    expect(markup).not.toContain('3 de 5')
  })

  it('13. los tres indicadores existentes permanecen sin modificaciones', () => {
    const markup = renderScreen([
      strategyOf({ id: 'cmstrategyponderada0008', ponderada: true, statuses: ['PENDING'] }),
      strategyOf({ id: 'cmstrategyponderada0009', ponderada: true, statuses: ['PENDING'] }),
      strategyOf({ id: 'cmstrategyponderada0010', ponderada: false, statuses: ['PENDING'] }),
    ])
    const resumen = markup.slice(summaryAt(markup), markup.indexOf('class="swz-sources"'))

    expect(resumen).toContain('<div class="swz-summary-card total"')
    expect(resumen).toContain('<div class="swz-summary-card valued"')
    expect(resumen).toContain('<div class="swz-summary-card progress"')
    expect(resumen).toContain('Estrategias aceptadas')
    expect(resumen).toContain('Ponderadas')
    expect(resumen).toContain('Avance')
    expect(resumen).toMatch(/<strong>3<\/strong>/)
    expect(resumen).toMatch(/<strong>2<\/strong>/)
    expect(resumen).toMatch(/<strong>67%<\/strong>/)
    expect(resumen).toContain('class="swz-progress"')
    expect(resumen).toContain('style="width:67%"')
    // La fila nueva no se cuela dentro de la fila de resumen.
    expect(globalAt(markup)).toBeLessThan(summaryAt(markup))
    expect(resumen).not.toContain('AVANCE GLOBAL DE TAREAS')
  })

  it('14. el indicador individual de cada estrategia sigue pintando su progreso', () => {
    const markup = renderScreen([
      strategyOf({ id: 'cmstrategyponderada0011', ponderada: true, statuses: ['COMPLETED', 'PENDING', 'PENDING'] }),
    ])

    expect(markup).toContain('class="swz-task-progress"')
    expect(markup).toContain('1 / 3')
    expect(markup).toContain('class="swz-task-progress-track"')
    expect(markup).toContain('TAREAS')
    expect(markup).toContain('3 tareas')
  })

  it('10. al recargar con un cambio hecho en Tickets el indicador global se actualiza', () => {
    const antes = renderScreen([strategyOf({ id: 'cmstrategyponderada0012', ponderada: true, statuses: ['PENDING', 'PENDING', 'PENDING', 'PENDING', 'PENDING'] })])
    const despues = renderScreen([strategyOf({ id: 'cmstrategyponderada0012', ponderada: true, statuses: ['COMPLETED', 'PENDING', 'PENDING', 'PENDING', 'PENDING'] })])

    expect(antes).toContain('0 de 5 tareas completadas')
    expect(antes).toContain('aria-valuenow="0"')
    expect(despues).toContain('1 de 5 tareas completadas')
    expect(despues).toContain('aria-valuenow="20"')
  })

  it('11 y 12. tareas nuevas y una estrategia recién ponderada recalculan el total', () => {
    const antes = renderScreen([
      strategyOf({ id: 'cmstrategyponderada0013', ponderada: true, statuses: ['COMPLETED', 'PENDING', 'PENDING'] }),
      strategyOf({ id: 'cmstrategyponderada0014', ponderada: true, statuses: ['COMPLETED', 'PENDING'] }),
    ])
    const despues = renderScreen([
      strategyOf({ id: 'cmstrategyponderada0013', ponderada: true, statuses: ['COMPLETED', 'PENDING', 'PENDING'] }),
      strategyOf({ id: 'cmstrategyponderada0014', ponderada: true, statuses: ['COMPLETED', 'PENDING'] }),
      strategyOf({ id: 'cmstrategyponderada0015', ponderada: true, statuses: ['COMPLETED', 'COMPLETED', 'PENDING', 'PENDING'] }),
    ])

    expect(antes).toContain('2 de 5 tareas completadas')
    expect(antes).toContain('aria-valuenow="40"')
    expect(despues).toContain('4 de 9 tareas completadas')
    expect(despues).toContain('aria-valuenow="44"')
    expect(despues).not.toContain('2 de 5 tareas completadas')
  })
})
