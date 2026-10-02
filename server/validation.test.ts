import { describe, expect, it } from 'vitest'
import { strategyTasksCreateSchema } from './validation.js'

/**
 * Valores reales de la base: la estrategia de un cruce, una tarea ya creada y los dos formatos
 * de id de usuario que conviven hoy (cuid que genera Prisma y uuid que genera el seed).
 */
const strategyId = 'cross:cmurbmfzj0000d8l5vdwk5vev'
const cuidResponsible = 'cmug062nu0004acl5z7e8bvgs'
const uuidResponsible = 'cafe89c0-079b-4f41-97d0-5d6de3b5f147'
const existingTask = { title: 'tarea para esta estrategia', responsibleId: cuidResponsible, dueDate: '2026-10-04T00:00:00.000Z' }

const payloadOf = (tasks: unknown[]) => ({ strategyId, tasks })

const issuesOf = (payload: unknown) => {
  const parsed = strategyTasksCreateSchema.safeParse(payload)
  return parsed.success ? null : parsed.error.issues
}

describe('lo que puede enviar el modal de crear tareas', () => {
  it('una tarea existente válida no produce "Invalid strategy task data"', () => {
    expect(issuesOf(payloadOf([existingTask]))).toBeNull()
  })

  it('acepta la fecha existente en ISO y la fecha del formulario en YYYY-MM-DD', () => {
    const fromBackend = strategyTasksCreateSchema.parse(payloadOf([existingTask]))
    const fromForm = strategyTasksCreateSchema.parse(payloadOf([{ ...existingTask, dueDate: '2026-10-08' }]))
    expect(fromBackend.tasks[0].dueDate.toISOString()).toBe('2026-10-04T00:00:00.000Z')
    expect(fromForm.tasks[0].dueDate.toISOString()).toBe('2026-10-08T00:00:00.000Z')
  })

  it('acepta como responsable el id cuid y el id uuid reales', () => {
    expect(issuesOf(payloadOf([{ ...existingTask, responsibleId: cuidResponsible }]))).toBeNull()
    expect(issuesOf(payloadOf([{ ...existingTask, responsibleId: uuidResponsible }]))).toBeNull()
  })

  it('una estrategia sin tareas sigue pudiendo recibir su primera tarea', () => {
    expect(issuesOf(payloadOf([{ title: 'Primera tarea del plan', responsibleId: uuidResponsible, dueDate: '2026-10-12' }]))).toBeNull()
  })

  it('varias tareas existentes se validan todas en el mismo envío', () => {
    const tasks = [1, 2, 3].map((number) => ({ title: `Tarea existente ${number}`, responsibleId: cuidResponsible, dueDate: '2026-10-10' }))
    expect(issuesOf(payloadOf(tasks))).toBeNull()
  })

  it('sigue rechazando un envío sin responsable y títulos fuera de rango', () => {
    expect(issuesOf(payloadOf([{ ...existingTask, responsibleId: '' }]))).not.toBeNull()
    expect(issuesOf(payloadOf([{ ...existingTask, responsibleId: null }]))).not.toBeNull()
    expect(issuesOf(payloadOf([{ ...existingTask, title: 'ab' }]))).not.toBeNull()
    expect(issuesOf(payloadOf([{ ...existingTask, title: 'x'.repeat(121) }]))).not.toBeNull()
    expect(issuesOf({ strategyId, tasks: [] })).not.toBeNull()
  })
})
