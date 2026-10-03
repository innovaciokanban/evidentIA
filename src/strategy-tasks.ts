import type { ActionItemStatus, StrategyTaskPlan } from './types'

/** Título de la sección de tareas dentro de la tarjeta de Ponderación. */
export const STRATEGY_TASKS_LABEL = 'TAREAS'

/** Mensaje para una estrategia que todavía no tiene ninguna tarea asociada. */
export const STRATEGY_TASKS_EMPTY = 'Sin tareas asignadas'

export type StrategyTaskView = {
  id: string
  title: string
  status: ActionItemStatus | null
  responsible: string | null
  dueDate: string | null
}

/**
 * Las tareas de UNA estrategia, tal como las trae el GET de estrategias dentro de `actionPlan`.
 * La fuente de verdad sigue siendo ActionPlan/ActionItem: aquí no se calcula ni se inventa nada,
 * solo se proyecta lo que ya existe para que la tarjeta pueda pintarlo. Un plan null, que es lo
 * que trae una estrategia sin tareas, se queda en lista vacía.
 */
export const strategyTaskViews = (plan: StrategyTaskPlan | null | undefined): StrategyTaskView[] =>
  (plan?.items ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status ?? null,
    responsible: item.responsible?.name ?? null,
    dueDate: item.dueDate ?? null,
  }))

/** Pie de la sección: "1 tarea" o "2 tareas". */
export const strategyTasksCountLabel = (count: number): string => `${count} ${count === 1 ? 'tarea' : 'tareas'}`

/**
 * Único estado que el sistema considera terminado para una tarea (Prisma: enum ActionItemStatus
 * con PENDING, IN_PROGRESS, COMPLETED y CANCELLED; el tablero de Gestión por Procesos usa
 * "Completadas" para COMPLETED). Canceladas, pendientes y en progreso no cuentan como completadas.
 */
export const STRATEGY_TASK_COMPLETED_STATUS: ActionItemStatus = 'COMPLETED'

export type StrategyTaskProgress = { total: number; completed: number; percent: number }

/**
 * Progreso de ejecución de las tareas de UNA estrategia. Se deriva en cada render desde
 * `actionPlan.items`, así que al recargar la tarjeta se recalcula solo: no hay estado paralelo,
 * campo nuevo ni modelo. Sin tareas el progreso queda en 0 y la tarjeta no pinta la barra.
 */
export const strategyTaskProgress = (tasks: readonly StrategyTaskView[]): StrategyTaskProgress => {
  const total = tasks.length
  const completed = tasks.filter((task) => task.status === STRATEGY_TASK_COMPLETED_STATUS).length
  return { total, completed, percent: total === 0 ? 0 : Math.round((completed / total) * 100) }
}

/** "3 de 5 tareas completadas" / "1 de 1 tarea completada". */
export const strategyTaskProgressLabel = (progress: StrategyTaskProgress): string => {
  const noun = progress.total === 1 ? 'tarea' : 'tareas'
  const adjective = progress.total === 1 ? 'completada' : 'completadas'
  return `${progress.completed} de ${progress.total} ${noun} ${adjective}`
}
