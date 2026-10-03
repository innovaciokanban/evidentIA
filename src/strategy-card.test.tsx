import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StrategyValuationCard } from './App'
import { STRATEGY_TASKS_EMPTY, STRATEGY_TASKS_LABEL } from './strategy-tasks'
import type { ActionItemStatus, CrossWeightingCriteria, DiagnosticStrategy, StrategyTaskPlan } from './types'

const criteria: CrossWeightingCriteria = { impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'ALTO', sinergiaInterna: 'MEDIO', impactoReputacional: 'MEDIO' }

const planOf = (statuses: ActionItemStatus[], planId = 'cmplantareas0000000001'): StrategyTaskPlan => ({
  id: planId,
  strategySource: 'CHECKY',
  strategySourceRef: 'origen',
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

const strategyOf = (actionPlan: StrategyTaskPlan | null): DiagnosticStrategy => ({
  id: 'cmstrategy0000000000001',
  title: 'Estandarizar la apertura de cuentas',
  description: 'Definir un procedimiento único para abrir cuentas con responsables y controles definidos.',
  source: 'CHECKY',
  crossId: null,
  crossType: null,
  origin: null,
  factor1: null,
  factor2: null,
  weighting: { ...criteria, weightedScore: 4.4, weightingBand: 'INMEDIATA' },
  weightedScore: 4.4,
  weightingBand: 'INMEDIATA',
  actionPlan,
})

const renderCard = (strategy: DiagnosticStrategy): string => renderToStaticMarkup(
  <StrategyValuationCard
    strategy={strategy}
    draft={criteria}
    levelScores={null}
    state="idle"
    error=""
    canValue
    onChange={() => undefined}
    onSave={() => undefined}
    onCreateTasks={() => undefined}
    initialOpen
  />,
)

/** Posición del indicador de progreso en la tarjeta pintada. -1 cuando no está. */
const meterAt = (markup: string): number => markup.indexOf('class="swz-task-progress')
/** Posición de la sección TAREAS del detalle. */
const tasksSectionAt = (markup: string): number => markup.indexOf(`<p class="detail-label">${STRATEGY_TASKS_LABEL}</p>`)
/** Posición de la calificación (4.40 de 4.40 / 5). */
const scoreAt = (markup: string): number => markup.indexOf('class="swz-score-value"')

describe('la tarjeta de Ponderación: indicador de progreso de tareas', () => {
  it('una estrategia sin tareas no muestra barra de progreso ni indicador superior', () => {
    const withoutPlan = renderCard(strategyOf(null))
    const emptyPlan = renderCard(strategyOf(planOf([])))

    for (const markup of [withoutPlan, emptyPlan]) {
      expect(markup).not.toContain('role="progressbar"')
      expect(markup).not.toContain('class="swz-task-progress')
      expect(markup).toContain(STRATEGY_TASKS_EMPTY)
    }
    expect(tasksSectionAt(withoutPlan)).toBeGreaterThan(-1)
  })

  it('el indicador aparece en la parte superior, junto a la calificación', () => {
    const markup = renderCard(strategyOf(planOf(['PENDING', 'PENDING', 'PENDING'])))

    const indicator = meterAt(markup)
    const score = scoreAt(markup)
    const tasksSection = tasksSectionAt(markup)
    expect(indicator).toBeGreaterThan(-1)
    expect(score).toBeGreaterThan(-1)
    expect(indicator).toBeGreaterThan(score)
    expect(indicator).toBeLessThan(markup.indexOf('class="swz-strategy"'))
    expect(indicator).toBeLessThan(tasksSection)
  })

  it('la sección TAREAS ya no pinta el bloque de progreso y sí conserva el detalle', () => {
    const markup = renderCard(strategyOf(planOf(['PENDING', 'IN_PROGRESS', 'COMPLETED'])))

    expect(markup).not.toContain('Progreso de ejecución')
    expect(markup).not.toContain('class="task-progress')
    expect(markup).toContain(`<p class="detail-label">${STRATEGY_TASKS_LABEL}</p>`)

    const tasksSection = tasksSectionAt(markup)
    expect(tasksSection).toBeGreaterThan(-1)
    const detail = markup.slice(tasksSection)
    expect(detail).toContain('Tarea 1')
    expect(detail).toContain('Tarea 2')
    expect(detail).toContain('Tarea 3')
    expect(detail).toContain('Responsable: Andres Zapata')
    expect(detail).toContain('Fecha límite:')
    expect(detail).toContain('3 tareas')
  })

  it('muestra 0 / 3 y 0% con tres tareas pendientes', () => {
    const markup = renderCard(strategyOf(planOf(['PENDING', 'PENDING', 'PENDING'])))

    expect(markup).toContain('0 / 3')
    expect(markup).toContain('>0%<')
    expect(markup).toContain('aria-valuenow="0"')
    expect(markup).not.toContain('class="swz-task-progress done"')
  })

  it('muestra 1 / 3 y 33% con una tarea completada', () => {
    const markup = renderCard(strategyOf(planOf(['COMPLETED', 'PENDING', 'PENDING'])))

    expect(markup).toContain('1 / 3')
    expect(markup).toContain('>33%<')
    expect(markup).toContain('aria-valuenow="33"')
  })

  it('muestra 2 / 3 y 67% con dos tareas completadas', () => {
    const markup = renderCard(strategyOf(planOf(['COMPLETED', 'COMPLETED', 'PENDING'])))

    expect(markup).toContain('2 / 3')
    expect(markup).toContain('>67%<')
    expect(markup).toContain('aria-valuenow="67"')
  })

  it('muestra 3 / 3 y 100% cuando todas terminan, con el estilo positivo', () => {
    const markup = renderCard(strategyOf(planOf(['COMPLETED', 'COMPLETED', 'COMPLETED'])))

    expect(markup).toContain('3 / 3')
    expect(markup).toContain('>100%<')
    expect(markup).toContain('aria-valuenow="100"')
    expect(markup).toContain('class="swz-task-progress done"')
  })

  it('1 de 1 completada marca 100% y una única tarea pendiente 0%', () => {
    expect(renderCard(strategyOf(planOf(['PENDING'])))).toContain('aria-valuenow="0"')
    expect(renderCard(strategyOf(planOf(['COMPLETED'])))).toContain('aria-valuenow="100"')
    expect(renderCard(strategyOf(planOf(['PENDING'])))).toContain('0 / 1')
    expect(renderCard(strategyOf(planOf(['COMPLETED'])))).toContain('1 / 1')
  })

  it('los estados que no son COMPLETED no cuentan como completados', () => {
    const markup = renderCard(strategyOf(planOf(['PENDING', 'IN_PROGRESS', 'CANCELLED'])))

    expect(markup).toContain('0 / 3')
    expect(markup).toContain('aria-valuenow="0"')
    expect(markup).not.toContain('>33%<')
    expect(markup).not.toContain('>67%<')
  })

  it('cada estrategia lee su propio actionPlan, sin mezclar tareas', () => {
    const first = renderCard(strategyOf(planOf(['PENDING'], 'cmplantareas000000000a')))
    const second = renderCard(strategyOf(planOf(['PENDING', 'PENDING'], 'cmplantareas000000000b')))

    expect(first).toContain('0 / 1')
    expect(first).not.toContain('Tarea 2')
    expect(second).toContain('0 / 2')
    expect(second).not.toContain('1 / 1')
  })

  it('el indicador usa exclusivamente actionPlan.items: sin plan no hay nada que pintar', () => {
    const sinPlan = renderCard(strategyOf(null))
    const conPlan = renderCard(strategyOf(planOf(['PENDING'])))

    expect(sinPlan).not.toContain('role="progressbar"')
    expect(conPlan).toContain('role="progressbar"')
    expect(conPlan).toContain('0 / 1')
  })

  it('al recargar las estrategias el indicador se recalcula desde los datos actuales', () => {
    const antes = renderCard(strategyOf(planOf(['PENDING', 'PENDING', 'PENDING'])))
    const despues = renderCard(strategyOf(planOf(['COMPLETED', 'PENDING', 'PENDING'])))

    expect(antes).toContain('aria-valuenow="0"')
    expect(antes).toContain('>0%<')
    expect(despues).toContain('aria-valuenow="33"')
    expect(despues).toContain('>33%<')
    expect(despues).toContain('1 / 3')
  })
})
