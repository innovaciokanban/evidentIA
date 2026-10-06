import { describe, expect, it } from 'vitest'
import { globalStrategyTaskProgress, strategyTaskProgressLabel } from './strategy-tasks'
import type { ActionItemStatus, StrategyTaskPlan } from './types'

const planOf = (statuses: ActionItemStatus[], planId = 'cmplantareasglobal0001'): StrategyTaskPlan => ({
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

/** Lo que la pantalla entrega: las estrategias que ya pasaron el filtro de "Ponderadas". */
const ponderada = (plan: StrategyTaskPlan | null): { actionPlan: StrategyTaskPlan | null } => ({ actionPlan: plan })

describe('avance global de tareas de las estrategias ponderadas', () => {
  it('1. sin estrategias ponderadas el avance global es 0%', () => {
    expect(globalStrategyTaskProgress([])).toEqual({ total: 0, completed: 0, percent: 0 })
  })

  it('2. una estrategia ponderada con 3 tareas sin completar marca 0%', () => {
    const progress = globalStrategyTaskProgress([ponderada(planOf(['PENDING', 'PENDING', 'PENDING']))])
    expect(progress).toEqual({ total: 3, completed: 0, percent: 0 })
  })

  it('3. una estrategia ponderada con 3 tareas y 1 completada marca 33%', () => {
    const progress = globalStrategyTaskProgress([ponderada(planOf(['COMPLETED', 'PENDING', 'PENDING']))])
    expect(progress).toEqual({ total: 3, completed: 1, percent: 33 })
  })

  it('4. una estrategia ponderada con las 3 tareas completadas marca 100%', () => {
    const progress = globalStrategyTaskProgress([ponderada(planOf(['COMPLETED', 'COMPLETED', 'COMPLETED']))])
    expect(progress).toEqual({ total: 3, completed: 3, percent: 100 })
  })

  it('5. dos estrategias ponderadas suman sus tareas: 2 de 5 = 40%', () => {
    const progress = globalStrategyTaskProgress([
      ponderada(planOf(['COMPLETED', 'PENDING'], 'cmplantareasglobal000a')),
      ponderada(planOf(['COMPLETED', 'PENDING', 'PENDING'], 'cmplantareasglobal000b')),
    ])
    expect(progress).toEqual({ total: 5, completed: 2, percent: 40 })
  })

  it('6. una estrategia ponderada sin tareas aporta 0 y no rompe la división', () => {
    const progress = globalStrategyTaskProgress([
      ponderada(planOf(['COMPLETED', 'COMPLETED', 'PENDING'], 'cmplantareasglobal000a')),
      ponderada(planOf([], 'cmplantareasglobal000b')),
      ponderada(planOf(['COMPLETED', 'PENDING'], 'cmplantareasglobal000c')),
    ])
    expect(progress).toEqual({ total: 5, completed: 3, percent: 60 })
  })

  it('9. usa cantidad real de tareas, nunca el promedio de los porcentajes', () => {
    const nueveCompletadas: ActionItemStatus[] = Array.from({ length: 9 }, () => 'COMPLETED')
    const progress = globalStrategyTaskProgress([
      ponderada(planOf(['COMPLETED', 'PENDING'], 'cmplantareasglobal000a')),
      ponderada(planOf([...nueveCompletadas, 'PENDING'], 'cmplantareasglobal000b')),
    ])
    // 1/2 (50%) y 9/10 (90%): el promedio daría 70%, la suma real da 10/12 = 83%.
    expect(progress).toEqual({ total: 12, completed: 10, percent: 83 })
    expect(progress.percent).not.toBe(70)
  })

  it('solo COMPLETED cuenta como completada: PENDING, IN_PROGRESS y CANCELLED no', () => {
    const progress = globalStrategyTaskProgress([ponderada(planOf(['PENDING', 'IN_PROGRESS', 'CANCELLED']))])
    expect(progress).toEqual({ total: 3, completed: 0, percent: 0 })
  })

  it('10. al cambiar el estado de una tarea el cálculo refleja los datos actuales', () => {
    const plan = planOf(['PENDING', 'PENDING', 'PENDING', 'PENDING', 'PENDING'])
    expect(globalStrategyTaskProgress([ponderada(plan)]).percent).toBe(0)

    const conUnaCompletada = planOf(['COMPLETED', 'PENDING', 'PENDING', 'PENDING', 'PENDING'])
    expect(globalStrategyTaskProgress([ponderada(conUnaCompletada)])).toEqual({ total: 5, completed: 1, percent: 20 })

    const conDosCompletadas = planOf(['COMPLETED', 'COMPLETED', 'PENDING', 'PENDING', 'PENDING'])
    expect(globalStrategyTaskProgress([ponderada(conDosCompletadas)])).toEqual({ total: 5, completed: 2, percent: 40 })
  })

  it('11. al crear tareas nuevas el total crece', () => {
    const antes = globalStrategyTaskProgress([ponderada(planOf(['COMPLETED']))])
    const despues = globalStrategyTaskProgress([
      ponderada(planOf(['COMPLETED', 'PENDING', 'PENDING'])),
    ])
    expect(antes).toEqual({ total: 1, completed: 1, percent: 100 })
    expect(despues).toEqual({ total: 3, completed: 1, percent: 33 })
  })

  it('12. al ponderar una nueva estrategia sus tareas entran al cálculo', () => {
    const dosPonderadas = globalStrategyTaskProgress([
      ponderada(planOf(['COMPLETED', 'PENDING', 'PENDING'], 'cmplantareasglobal000a')),
      ponderada(planOf(['COMPLETED', 'PENDING'], 'cmplantareasglobal000b')),
    ])
    const tresPonderadas = globalStrategyTaskProgress([
      ponderada(planOf(['COMPLETED', 'PENDING', 'PENDING'], 'cmplantareasglobal000a')),
      ponderada(planOf(['COMPLETED', 'PENDING'], 'cmplantareasglobal000b')),
      ponderada(planOf(['COMPLETED', 'COMPLETED', 'PENDING', 'PENDING'], 'cmplantareasglobal000c')),
    ])
    expect(dosPonderadas).toEqual({ total: 5, completed: 2, percent: 40 })
    expect(tresPonderadas).toEqual({ total: 9, completed: 4, percent: 44 })
  })

  it('sin tareas en ninguna ponderada queda en 0%, nunca 100%', () => {
    const progress = globalStrategyTaskProgress([ponderada(planOf([])), ponderada(null)])
    expect(progress).toEqual({ total: 0, completed: 0, percent: 0 })
    expect(strategyTaskProgressLabel(progress)).toBe('0 de 0 tareas completadas')
  })

  it('la etiqueta del bloque es "X de Y tareas completadas"', () => {
    expect(strategyTaskProgressLabel(globalStrategyTaskProgress([ponderada(planOf([
      'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED',
      'PENDING', 'PENDING', 'PENDING', 'PENDING',
    ]))]))).toBe('6 de 10 tareas completadas')
  })
})
