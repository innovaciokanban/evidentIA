import { describe, expect, it } from 'vitest'
import { STRATEGY_TASK_COMPLETED_STATUS, STRATEGY_TASKS_EMPTY, STRATEGY_TASKS_LABEL, strategyTaskProgress, strategyTaskProgressLabel, strategyTaskViews, strategyTasksCountLabel } from './strategy-tasks'
import type { StrategyTaskPlan } from './types'

type TaskItem = StrategyTaskPlan['items'][number]

const plan = (items: TaskItem[]): StrategyTaskPlan => ({
  id: 'cmactionplan000000000001',
  strategySource: 'CHECKY',
  strategySourceRef: 'origen',
  strategyTitle: null,
  strategyDescription: null,
  items,
})

const task = (id: string, title: string, overrides: Partial<TaskItem> = {}): TaskItem => ({
  id,
  title,
  status: 'PENDING',
  responsibleId: 'cmuser0000000000000001',
  responsible: { id: 'cmuser0000000000000001', name: 'Ana Pérez' },
  dueDate: '2026-10-10',
  ticket: null,
  ...overrides,
})

describe('las tareas dentro de la tarjeta de Ponderación', () => {
  it('una estrategia sin tareas queda con el mensaje "Sin tareas asignadas"', () => {
    expect(STRATEGY_TASKS_LABEL).toBe('TAREAS')
    expect(STRATEGY_TASKS_EMPTY).toBe('Sin tareas asignadas')
    expect(strategyTaskViews(null)).toEqual([])
    expect(strategyTaskViews(undefined)).toEqual([])
    expect(strategyTaskViews(plan([]))).toEqual([])
  })

  it('una estrategia con una tarea devuelve esa tarea y no otra', () => {
    const only = task('cmactionitemtareas0000001', 'Recolectar las preguntas frecuentes del soporte')

    const views = strategyTaskViews(plan([only]))

    expect(views).toHaveLength(1)
    expect(views[0]).toEqual({ id: only.id, title: only.title, status: 'PENDING', responsible: 'Ana Pérez', dueDate: '2026-10-10' })
    expect(strategyTasksCountLabel(views.length)).toBe('1 tarea')
  })

  it('una estrategia con varias tareas devuelve todas, en orden', () => {
    const items = [
      task('cmactionitemtareas0000001', 'Recolectar las preguntas frecuentes del soporte'),
      task('cmactionitemtareas0000002', 'Crear base de conocimiento', { status: 'IN_PROGRESS' }),
      task('cmactionitemtareas0000003', 'Publicar la guía del soporte'),
    ]

    const views = strategyTaskViews(plan(items))

    expect(views.map((view) => view.title)).toEqual(items.map((item) => item.title))
    expect(views.map((view) => view.status)).toEqual(['PENDING', 'IN_PROGRESS', 'PENDING'])
    expect(strategyTasksCountLabel(views.length)).toBe('3 tareas')
  })

  it('cada estrategia lee solo su propio plan, sin mezclar tareas', () => {
    const fromCross = plan([task('cmactionitemtareas0000cru', 'Cerrar el plan del cruce FO')])
    const fromChecky = [task('cmactionitemtareas000000k1', 'Primera tarea de Checky'), task('cmactionitemtareas000000k2', 'Segunda tarea de Checky')]

    expect(strategyTaskViews(fromCross).map((view) => view.id)).toEqual(['cmactionitemtareas0000cru'])
    expect(strategyTaskViews(plan(fromChecky)).map((view) => view.id)).toEqual(fromChecky.map((item) => item.id))
  })

  it('no devuelve la misma tarea dos veces', () => {
    const items = [task('cmactionitemtareas0000001', 'Una tarea'), task('cmactionitemtareas0000002', 'Otra tarea')]

    const views = strategyTaskViews(plan(items))

    expect(views).toHaveLength(items.length)
    expect(new Set(views.map((view) => view.id)).size).toBe(views.length)
  })

  it('omite el responsable o la fecha cuando la tarea no los trae', () => {
    const views = strategyTaskViews(plan([task('cmactionitemtareas0000009', 'Tarea sin datos', { responsible: null, dueDate: null })]))

    expect(views[0].responsible).toBeNull()
    expect(views[0].dueDate).toBeNull()
  })
})

describe('el progreso de ejecución de las tareas de una estrategia', () => {
  const progressOf = (items: TaskItem[]) => strategyTaskProgress(strategyTaskViews(plan(items)))

  it('una estrategia sin tareas no tiene progreso que mostrar', () => {
    expect(strategyTaskProgress(strategyTaskViews(null))).toEqual({ total: 0, completed: 0, percent: 0 })
    expect(strategyTaskProgress([])).toEqual({ total: 0, completed: 0, percent: 0 })
  })

  it('una única tarea pendiente marca 0%', () => {
    expect(progressOf([task('cmactionitemtareas0000001', 'Publicar la guía del soporte')])).toEqual({ total: 1, completed: 0, percent: 0 })
  })

  it('una única tarea completada marca 100%', () => {
    expect(progressOf([task('cmactionitemtareas0000001', 'Publicar la guía del soporte', { status: 'COMPLETED' })])).toEqual({ total: 1, completed: 1, percent: 100 })
    expect(strategyTaskProgressLabel({ total: 1, completed: 1, percent: 100 })).toBe('1 de 1 tarea completada')
  })

  it('dos tareas con una completada marcan 50%', () => {
    const items = [
      task('cmactionitemtareas0000001', 'Recolectar preguntas frecuentes', { status: 'COMPLETED' }),
      task('cmactionitemtareas0000002', 'Crear base de conocimiento'),
    ]

    expect(progressOf(items)).toEqual({ total: 2, completed: 1, percent: 50 })
    expect(strategyTaskProgressLabel({ total: 2, completed: 1, percent: 50 })).toBe('1 de 2 tareas completadas')
  })

  it('cinco tareas con tres completadas marcan 60%', () => {
    const items = [1, 2, 3, 4, 5].map((number) => task(`cmactionitemtareas000000${number}`, `Tarea ${number}`, { status: number <= 3 ? 'COMPLETED' : 'PENDING' }))

    expect(progressOf(items)).toEqual({ total: 5, completed: 3, percent: 60 })
    expect(strategyTaskProgressLabel({ total: 5, completed: 3, percent: 60 })).toBe('3 de 5 tareas completadas')
  })

  it('tres tareas muestran 0%, 33%, 67% y 100% según cuántas estén completadas', () => {
    const items = [1, 2, 3].map((number) => task(`cmactionitemtareas000000${number}`, `Tarea ${number}`))
    const completedFirst = items.map((item, index) => index === 0 ? { ...item, status: 'COMPLETED' as const } : item)
    const completedPair = items.map((item, index) => index < 2 ? { ...item, status: 'COMPLETED' as const } : item)
    const completedAll = items.map((item) => ({ ...item, status: 'COMPLETED' as const }))

    expect(progressOf(items)).toEqual({ total: 3, completed: 0, percent: 0 })
    expect(progressOf(completedFirst)).toEqual({ total: 3, completed: 1, percent: 33 })
    expect(progressOf(completedPair)).toEqual({ total: 3, completed: 2, percent: 67 })
    expect(progressOf(completedAll)).toEqual({ total: 3, completed: 3, percent: 100 })
    expect(strategyTaskProgressLabel({ total: 3, completed: 1, percent: 33 })).toBe('1 de 3 tareas completadas')
    expect(strategyTaskProgressLabel({ total: 3, completed: 3, percent: 100 })).toBe('3 de 3 tareas completadas')
  })

  it('solo COMPLETED cuenta como completada: pendiente, en progreso y cancelada no', () => {
    const items = [
      task('cmactionitemtareas0000001', 'Pendiente', { status: 'PENDING' }),
      task('cmactionitemtareas0000002', 'En progreso', { status: 'IN_PROGRESS' }),
      task('cmactionitemtareas0000003', 'Cancelada', { status: 'CANCELLED' }),
      task('cmactionitemtareas0000004', 'Completada', { status: 'COMPLETED' }),
    ]

    expect(STRATEGY_TASK_COMPLETED_STATUS).toBe('COMPLETED')
    expect(progressOf(items)).toEqual({ total: 4, completed: 1, percent: 25 })
  })

  it('cada estrategia calcula su progreso solo con sus propias tareas', () => {
    const fromCross = plan([task('cmactionitemtareas0000cru', 'Cerrar el plan del cruce FO', { status: 'COMPLETED' })])
    const fromChecky = [task('cmactionitemtareas000000k1', 'Primera tarea de Checky'), task('cmactionitemtareas000000k2', 'Segunda tarea de Checky')]

    expect(strategyTaskProgress(strategyTaskViews(fromCross))).toEqual({ total: 1, completed: 1, percent: 100 })
    expect(strategyTaskProgress(strategyTaskViews(plan(fromChecky)))).toEqual({ total: 2, completed: 0, percent: 0 })
  })

  it('el progreso se deriva del actionPlan.items que ya pinta la tarjeta', () => {
    const stored = plan([
      task('cmactionitemtareas0000001', 'Recolectar preguntas frecuentes', { status: 'COMPLETED' }),
      task('cmactionitemtareas0000002', 'Crear base de conocimiento', { status: 'IN_PROGRESS' }),
      task('cmactionitemtareas0000003', 'Publicar la guía del soporte'),
    ])

    const views = strategyTaskViews(stored)

    expect(strategyTaskProgress(views)).toEqual({
      total: stored.items.length,
      completed: stored.items.filter((item) => item.status === STRATEGY_TASK_COMPLETED_STATUS).length,
      percent: Math.round((stored.items.filter((item) => item.status === STRATEGY_TASK_COMPLETED_STATUS).length / stored.items.length) * 100),
    })
    expect(strategyTasksCountLabel(views.length)).toBe('3 tareas')
  })
})
