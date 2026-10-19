import bcrypt from 'bcryptjs'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'
import { mitigationCompletedNotification, mitigationNotificationRecipients, mitigationPlansCompleted, riskResidualSectionLink } from './mitigation-plan.js'

/**
 * Arnés de prueba para el aviso "plan de mitigación completado": almacenes en memoria con la misma
 * semántica de rollback que el motor real (clonar + restaurar si la operación lanza), porque el
 * aviso se escribe dentro de la transacción que completa la actividad y un fallo en la
 * notificación tiene que devolver también la actividad a su estado anterior.
 */

type StoredUser = { id: string; email: string; name: string; role: Role; companyId: string }
type StoredNotification = { id: string; userId: string; title: string; body: string; link: string; readAt: Date | null; createdAt: Date }
type StoredItem = { id: string; actionPlanId: string; title: string; description: string; priority: string; status: string; responsibleId: string | null; dueDate: Date | null }
type StoredPlan = { id: string; diagnosticId: string; riskId: string | null; title: string; description: string; status: string; createdById: string }
type StoredTicket = { id: string; status: string; actionItemId: string | null }
type SeedRisk = { id: string; processId: string; code: string | null; name: string; riskOwnerId: string | null; createdById: string | null }

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const processId = 'cmprocess000000000000000001'
const diagnosticId = 'cmdiagnostic000000000001'

const admin = { id: 'cmadmin0000000000000000001', email: 'admin@mitigation.test', name: 'Ben Admin', role: 'COMPANY_ADMIN' as Role, companyId }
const creator = { id: 'cmcreator000000000000000001', email: 'creator@mitigation.test', name: 'Ana Creadora', role: 'COMPANY_USER' as Role, companyId }
const owner = { id: 'cmowner0000000000000000001', email: 'owner@mitigation.test', name: 'Cleo Dueña', role: 'COMPANY_USER' as Role, companyId }
const users: StoredUser[] = [admin, creator, owner]
const passwordHash = bcrypt.hashSync('Password123!', 4)

const defaultRisk: SeedRisk = { id: 'cmrisk000000000000000001', processId, code: 'MIS-R1', name: 'Entrega tardía de información', riskOwnerId: owner.id, createdById: creator.id }
const defaultPlan: StoredPlan = { id: 'cmactionplan000000000001', diagnosticId, riskId: defaultRisk.id, title: 'Plan de mitigación MIS-R1', description: 'Acciones de mitigación del riesgo MIS-R1', status: 'ACTIVE', createdById: creator.id }
const seedItem = (id: string, status: string, actionPlanId = defaultPlan.id): StoredItem => ({ id, actionPlanId, title: `Actividad ${id}`, description: 'Actividad del plan de mitigación', priority: 'HIGH', status, responsibleId: null, dueDate: null })

const foreignProcessId = 'cmprocess000000000000000002'
// El único proceso del arnés pertenece a la empresa de la sesión salvo que el test pida el de otra.
const processForCompanyId = (id: string) => (id === foreignProcessId ? otherCompanyId : companyId)

function makeMitigationDb(options: {
  risk?: SeedRisk | null
  plans?: StoredPlan[]
  items?: StoredItem[]
  failNotifications?: boolean
} = {}) {
  const sessions = new Map<string, string>()
  const risk = options.risk === undefined ? defaultRisk : options.risk
  const storedPlans = structuredClone(options.plans ?? [defaultPlan])
  const storedItems = structuredClone(options.items ?? [seedItem('cmactionitem000000000001', 'PENDING')])
  const storedNotifications: StoredNotification[] = []
  const storedTickets: StoredTicket[] = []
  let nextNotification = 1
  let nextTicket = 1
  let clock = Date.parse('2026-10-01T08:00:00.000Z')
  const stamp = () => new Date((clock += 60_000))
  const planFor = (id: string) => storedPlans.find((plan) => plan.id === id) ?? null
  const itemFor = (id: string) => storedItems.find((item) => item.id === id) ?? null

  const itemWithInclude = (item: StoredItem) => ({
    ...item,
    actionPlan: {
      ...planFor(item.actionPlanId)!,
      createdBy: { id: creator.id, name: creator.name, email: creator.email },
      items: [],
      diagnostic: { companyId: processForCompanyId(processId), company: { id: companyId, name: 'Acme' } },
    },
    recommendation: null,
    responsible: null,
    ticket: storedTickets.find((ticket) => ticket.actionItemId === item.id) ? { id: storedTickets.find((ticket) => ticket.actionItemId === item.id)!.id } : null,
  })
  const planWithInclude = (plan: StoredPlan) => ({
    ...plan,
    createdBy: { id: creator.id, name: creator.name, email: creator.email },
    items: storedItems.filter((item) => item.actionPlanId === plan.id).map(itemWithInclude),
    diagnostic: { companyId, company: { id: companyId, name: 'Acme' } },
  })

  const snapshot = () => ({
    items: structuredClone(storedItems),
    notifications: structuredClone(storedNotifications),
    tickets: structuredClone(storedTickets),
    plans: structuredClone(storedPlans),
  })
  const restore = (state: ReturnType<typeof snapshot>) => {
    // In place: los tests observan el mismo array que el arnés, como el motor real tras un rollback.
    storedItems.splice(0, storedItems.length, ...state.items)
    storedNotifications.splice(0, storedNotifications.length, ...state.notifications)
    storedTickets.splice(0, storedTickets.length, ...state.tickets)
    storedPlans.splice(0, storedPlans.length, ...state.plans)
  }

  const db = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id)
        return user ? { ...user, passwordHash } : null
      }),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => users.filter((user) => where.id.in.includes(user.id)).map((user) => ({ id: user.id }))),
    },
    session: {
      create: vi.fn(async ({ data }: { data: { tokenHash: string; userId: string; expiresAt: Date } }) => {
        sessions.set(data.tokenHash, data.userId)
        return { id: `cmsession${sessions.size}`, expiresAt: data.expiresAt }
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const user = users.find((item) => item.id === sessions.get(where.tokenHash))
        return user ? { id: 'cmsessionactive0000000001', expiresAt: new Date(Date.now() + 3600_000), user: { ...user } } : null
      }),
      delete: vi.fn(async () => ({ id: 'cmsessionactive0000000001' })),
      deleteMany: vi.fn(async () => { sessions.clear(); return { count: 1 } }),
    },
    qualityDiagnostic: {
      findUnique: vi.fn(async () => ({ id: diagnosticId, companyId, company: { id: companyId, name: 'Acme' } })),
    },
    process: {
      // findAccessibleProcess pide el proceso con su empresa: los dos ids del arnés cubren una
      // empresa accesible (la de la sesión) y una ajena, que el endpoint debe rechazar con 404.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === processId) return { id: processId, companyId, company: { id: companyId } }
        if (where.id === foreignProcessId) return { id: foreignProcessId, companyId: otherCompanyId, company: { id: otherCompanyId } }
        return null
      }),
    },
    risk: {
      // Devuelve el riesgo con todo lo que puedan pedir las consultas del flujo (el aviso usa el
      // creador desde el historial, el dueño y los planes con sus actividades; la asociación usa
      // process.companyId). El select real lo arma Prisma; el arnés no lo replica.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (!risk || risk.id !== where.id) return null
        const creatorEvent = risk.createdById ? [{ actorId: risk.createdById }] : []
        return {
          id: risk.id,
          code: risk.code,
          name: risk.name,
          processId: risk.processId,
          riskOwnerId: risk.riskOwnerId,
          process: { companyId: processForCompanyId(risk.processId) },
          auditEvents: creatorEvent,
          mitigationPlans: storedPlans
            .filter((plan) => plan.riskId === risk.id)
            .map((plan) => ({ id: plan.id, items: storedItems.filter((item) => item.actionPlanId === plan.id).map((item) => ({ status: item.status })) })),
        }
      }),
    },
    actionPlan: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const plan = planFor(where.id); return plan ? planWithInclude(plan) : null }),
      // Listado de candidatos a vincular (GET /processes/:id/action-plans): solo planes de la
      // empresa de la sesión, con su progreso y el riesgo al que apuntan hoy.
      findMany: vi.fn(async ({ where }: { where?: { diagnostic?: { companyId?: string } } } = {}) => {
        if (where?.diagnostic?.companyId !== companyId) return []
        return storedPlans.map((plan) => ({
          id: plan.id,
          title: plan.title,
          riskId: plan.riskId,
          items: storedItems.filter((item) => item.actionPlanId === plan.id).map((item) => ({ status: item.status })),
        }))
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created: StoredPlan = { id: 'cmactionplancreated0001', diagnosticId: String(data.diagnosticId), riskId: (data.riskId as string | null) ?? null, title: String(data.title), description: String(data.description), status: String(data.status ?? 'ACTIVE'), createdById: String(data.createdById) }
        storedPlans.push(created)
        return planWithInclude(created)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const plan = planFor(where.id)
        if (!plan) throw new Error('Record to update not found.')
        for (const [key, value] of Object.entries(data)) (plan as unknown as Record<string, unknown>)[key] = value
        return planWithInclude(plan)
      }),
    },
    actionItem: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const item = itemFor(where.id); return item ? itemWithInclude(item) : null }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const item = itemFor(where.id)
        if (!item) throw new Error('Record to update not found.')
        for (const [key, value] of Object.entries(data)) (item as unknown as Record<string, unknown>)[key] = value
        return itemWithInclude(item)
      }),
    },
    ticket: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; actionItemId?: string } }) => {
        const ticket = where.actionItemId
          ? storedTickets.find((item) => item.actionItemId === where.actionItemId)
          : storedTickets.find((item) => item.id === where.id)
        return ticket ? { ...ticket, createdBy: { id: admin.id, companyId }, assignedTo: null, actionItem: null, riskApprovals: [] } : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const ticket: StoredTicket = { id: `cmticketmitigation${String(nextTicket).padStart(4, '0')}`, status: String(data.status ?? 'OPEN'), actionItemId: (data.actionItemId as string | null) ?? null }
        nextTicket += 1
        storedTickets.push(ticket)
        return { ...ticket, createdBy: { id: admin.id, companyId }, assignedTo: null, actionItem: null, riskApprovals: [] }
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const ticket = storedTickets.find((item) => item.id === where.id)
        if (!ticket) throw new Error('Record to update not found.')
        for (const [key, value] of Object.entries(data)) (ticket as unknown as Record<string, unknown>)[key] = value
        return { ...ticket, createdBy: { id: admin.id, companyId }, assignedTo: null, actionItem: null, riskApprovals: [] }
      }),
    },
    notification: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; link: string } }) => {
        const found = storedNotifications.find((item) => item.userId === where.userId && item.link === where.link)
        return found ? { ...found } : null
      }),
      create: vi.fn(async ({ data }: { data: { userId: string; title: string; body: string; link: string } }) => {
        if (options.failNotifications) throw new Error('notification store unavailable')
        const notification: StoredNotification = { id: `cmnotification${String(nextNotification).padStart(10, '0')}`, ...data, readAt: null, createdAt: stamp() }
        nextNotification += 1
        storedNotifications.push(notification)
        return { ...notification }
      }),
    },
    $transaction: vi.fn(async (operation: (client: unknown) => Promise<unknown>) => {
      const backup = snapshot()
      try {
        return await operation(db)
      } catch (error) {
        restore(backup)
        throw error
      }
    }),
  }
  return {
    db: db as unknown as PrismaClient,
    state: { storedPlans, storedItems, storedNotifications, storedTickets },
  }
}

async function loggedIn(db: PrismaClient, email: string) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

const patchItemPath = (itemId: string) => `/api/action-items/${itemId}`
const patchTicketPath = (ticketId: string) => `/api/tickets/${ticketId}`
const expectedLink = `risks/${processId}/${defaultRisk.id}/residual`
const expectedCopy = mitigationCompletedNotification({ code: defaultRisk.code, name: defaultRisk.name })

describe('reglas puras del plan de mitigación', () => {
  it('no considera completado un plan vacío ni uno con actividades pendientes o canceladas', () => {
    expect(mitigationPlansCompleted([])).toBe(false)
    expect(mitigationPlansCompleted([{ id: 'plan', items: [] }])).toBe(false)
    expect(mitigationPlansCompleted([{ id: 'plan', items: [{ status: 'PENDING' }] }])).toBe(false)
    expect(mitigationPlansCompleted([{ id: 'plan', items: [{ status: 'IN_PROGRESS' }] }])).toBe(false)
    expect(mitigationPlansCompleted([{ id: 'plan', items: [{ status: 'CANCELLED' }] }])).toBe(false)
  })

  it('exige COMPLETED en todas las actividades de todos los planes, con al menos una por plan', () => {
    expect(mitigationPlansCompleted([{ id: 'plan', items: [{ status: 'COMPLETED' }, { status: 'COMPLETED' }] }])).toBe(true)
    expect(mitigationPlansCompleted([
      { id: 'plan-a', items: [{ status: 'COMPLETED' }] },
      { id: 'plan-b', items: [{ status: 'PENDING' }] },
    ])).toBe(false)
    expect(mitigationPlansCompleted([
      { id: 'plan-a', items: [{ status: 'COMPLETED' }] },
      { id: 'plan-b', items: [{ status: 'COMPLETED' }] },
    ])).toBe(true)
    expect(mitigationPlansCompleted([{ id: 'plan', items: [{ status: 'COMPLETED' }, { status: 'CANCELLED' }] }])).toBe(false)
  })

  it('arma el enlace de la sección residual y los destinatarios sin duplicar ni inventar', () => {
    expect(riskResidualSectionLink(processId, defaultRisk.id)).toBe(expectedLink)
    expect(mitigationNotificationRecipients(creator.id, owner.id)).toEqual([creator.id, owner.id])
    expect(mitigationNotificationRecipients(creator.id, creator.id)).toEqual([creator.id])
    expect(mitigationNotificationRecipients(null, owner.id)).toEqual([owner.id])
    expect(mitigationNotificationRecipients(undefined, undefined)).toEqual([])
  })

  it('arma el texto del aviso con el código del riesgo, y con su nombre si no tiene código', () => {
    expect(mitigationCompletedNotification({ code: 'MIS-R1', name: 'Entrega tardía' })).toEqual({
      title: 'Riesgo MIS-R1: plan de mitigación completado',
      body: 'Se finalizaron todas las actividades del plan de mitigación del riesgo MIS-R1. Es necesario calificar el riesgo residual registrando su probabilidad e impacto.',
    })
    expect(mitigationCompletedNotification({ code: null, name: 'Entrega tardía' }).title).toContain('Entrega tardía')
  })
})

describe('aviso al cerrar la última actividad del plan de mitigación', () => {
  it('notifica al creador y al dueño del riesgo cuando la última actividad pasa a COMPLETED', async () => {
    const harness = makeMitigationDb({ items: [seedItem('cmactionitem000000000001', 'COMPLETED'), seedItem('cmactionitem000000000002', 'PENDING')] })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.patch(patchItemPath('cmactionitem000000000002')).send({ status: 'COMPLETED' })
    expect(response.status).toBe(200)

    expect(harness.state.storedNotifications).toHaveLength(2)
    const recipients = harness.state.storedNotifications.map((item) => item.userId).sort()
    expect(recipients).toEqual([creator.id, owner.id].sort())
    for (const notification of harness.state.storedNotifications) {
      expect(notification).toMatchObject({ title: expectedCopy.title, body: expectedCopy.body, link: expectedLink, readAt: null })
    }
  })

  it('no avisa mientras quede una actividad pendiente', async () => {
    const harness = makeMitigationDb({ items: [seedItem('cmactionitem000000000001', 'PENDING'), seedItem('cmactionitem000000000002', 'PENDING')] })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.patch(patchItemPath('cmactionitem000000000002')).send({ status: 'COMPLETED' })
    expect(response.status).toBe(200)
    expect(harness.state.storedNotifications).toHaveLength(0)
  })

  it('no avisa cuando la actividad se marca CANCELLED, ni al editar un ítem ya completado sin tocar su estado', async () => {
    const harness = makeMitigationDb({ items: [seedItem('cmactionitem000000000001', 'COMPLETED'), seedItem('cmactionitem000000000002', 'PENDING')] })
    const agent = await loggedIn(harness.db, admin.email)

    const cancelled = await agent.patch(patchItemPath('cmactionitem000000000002')).send({ status: 'CANCELLED' })
    expect(cancelled.status).toBe(200)
    expect(harness.state.storedNotifications).toHaveLength(0)

    const edited = await agent.patch(patchItemPath('cmactionitem000000000001')).send({ title: 'Actividad ya cerrada' })
    expect(edited.status).toBe(200)
    expect(harness.state.storedNotifications).toHaveLength(0)
  })

  it('exige que todos los planes del riesgo estén completos antes de avisar', async () => {
    const plans = [
      { ...defaultPlan, id: 'cmactionplan000000000001', riskId: defaultRisk.id },
      { ...defaultPlan, id: 'cmactionplan000000000002', riskId: defaultRisk.id, title: 'Segundo plan del riesgo' },
    ]
    const harness = makeMitigationDb({
      plans,
      items: [
        seedItem('cmactionitem000000000001', 'PENDING', 'cmactionplan000000000001'),
        seedItem('cmactionitem000000000002', 'COMPLETED', 'cmactionplan000000000002'),
      ],
    })
    const agent = await loggedIn(harness.db, admin.email)

    await agent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'COMPLETED' })
    expect(harness.state.storedNotifications).toHaveLength(2)
  })

  it('deduplica el aviso: reabrir y volver a cerrar la actividad no duplica notificaciones', async () => {
    const harness = makeMitigationDb({ items: [seedItem('cmactionitem000000000001', 'COMPLETED')] })
    const agent = await loggedIn(harness.db, admin.email)

    await agent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'PENDING' })
    await agent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'COMPLETED' })
    expect(harness.state.storedNotifications).toHaveLength(2)

    await agent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'PENDING' })
    await agent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'COMPLETED' })
    expect(harness.state.storedNotifications).toHaveLength(2)
  })

  it('cuando el creador y el dueño son la misma persona recibe una sola notificación', async () => {
    const harness = makeMitigationDb({
      risk: { ...defaultRisk, createdById: owner.id, riskOwnerId: owner.id },
      items: [seedItem('cmactionitem000000000001', 'PENDING')],
    })
    const agent = await loggedIn(harness.db, admin.email)

    await agent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'COMPLETED' })
    expect(harness.state.storedNotifications).toHaveLength(1)
    expect(harness.state.storedNotifications[0]?.userId).toBe(owner.id)
  })

  it('descarta destinatarios que ya no existen y, sin ninguno, no avisa', async () => {
    const harness = makeMitigationDb({
      risk: { ...defaultRisk, createdById: 'cmuserborrado0000000001', riskOwnerId: 'cmuserborrado0000000002' },
      items: [seedItem('cmactionitem000000000001', 'COMPLETED')],
    })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'COMPLETED' })
    expect(response.status).toBe(200)
    expect(harness.state.storedNotifications).toHaveLength(0)
  })

  it('un riesgo sin historial de creación avisa solo al dueño', async () => {
    const harness = makeMitigationDb({
      risk: { ...defaultRisk, createdById: null },
      items: [seedItem('cmactionitem000000000001', 'PENDING')],
    })
    const agent = await loggedIn(harness.db, admin.email)

    await agent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'COMPLETED' })
    expect(harness.state.storedNotifications).toHaveLength(1)
    expect(harness.state.storedNotifications[0]?.userId).toBe(owner.id)
  })

  it('no avisa si el riesgo no tiene dueño ni historial de creación', async () => {
    const harness = makeMitigationDb({
      risk: { ...defaultRisk, createdById: null, riskOwnerId: null },
      items: [seedItem('cmactionitem000000000001', 'COMPLETED')],
    })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'COMPLETED' })
    expect(response.status).toBe(200)
    expect(harness.state.storedNotifications).toHaveLength(0)
  })

  it('ignora los planes que no están vinculados a un riesgo (p. ej. tareas de ponderación)', async () => {
    const harness = makeMitigationDb({
      plans: [{ ...defaultPlan, riskId: null }],
      items: [seedItem('cmactionitem000000000001', 'COMPLETED')],
    })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'COMPLETED' })
    expect(response.status).toBe(200)
    expect(harness.state.storedNotifications).toHaveLength(0)
  })

  it('la notificación y la actividad quedan atadas: si falla el aviso, la actividad no se completa', async () => {
    const harness = makeMitigationDb({ items: [seedItem('cmactionitem000000000001', 'PENDING')], failNotifications: true })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'COMPLETED' })
    expect(response.status).toBe(500)
    expect(harness.state.storedItems[0]?.status).toBe('PENDING')
    expect(harness.state.storedNotifications).toHaveLength(0)
  })

  it('cerrar el ticket vinculado a la última actividad también dispara el aviso', async () => {
    const harness = makeMitigationDb({ items: [seedItem('cmactionitem000000000001', 'IN_PROGRESS')] })
    harness.state.storedTickets.push({ id: 'cmticketmitigacion001', status: 'IN_PROGRESS', actionItemId: 'cmactionitem000000000001' })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.patch(patchTicketPath('cmticketmitigacion001')).send({ status: 'RESOLVED' })
    expect(response.status).toBe(200)
    expect(harness.state.storedItems[0]?.status).toBe('COMPLETED')
    expect(harness.state.storedNotifications).toHaveLength(2)
  })

  it('un ticket que no cambia de estado no reavisa el plan ya completado', async () => {
    const harness = makeMitigationDb({ items: [seedItem('cmactionitem000000000001', 'COMPLETED')] })
    harness.state.storedTickets.push({ id: 'cmticketmitigacion001', status: 'RESOLVED', actionItemId: 'cmactionitem000000000001' })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.patch(patchTicketPath('cmticketmitigacion001')).send({ status: 'RESOLVED' })
    expect(response.status).toBe(200)
    expect(harness.state.storedNotifications).toHaveLength(0)
  })
})

describe('asociar un plan de acción al riesgo que mitiga', () => {
  it('acepta vincular un plan con un riesgo de la misma empresa y permite desvincular con null', async () => {
    const harness = makeMitigationDb()
    const agent = await loggedIn(harness.db, admin.email)

    const linked = await agent.post(`/api/diagnostics/${diagnosticId}/action-plans`).send({ title: 'Plan del riesgo', description: 'Mitigación del riesgo MIS-R1', riskId: defaultRisk.id })
    expect(linked.status).toBe(201)
    expect(linked.body.actionPlan.riskId).toBe(defaultRisk.id)

    const unlinked = await agent.patch('/api/action-plans/cmactionplan000000000001').send({ riskId: null })
    expect(unlinked.status).toBe(200)
    expect(unlinked.body.actionPlan.riskId).toBeNull()
  })

  it('rechaza un riesgo inexistente o de otra empresa, y nunca escribe el vínculo', async () => {
    const harness = makeMitigationDb({
      risk: { ...defaultRisk, processId: foreignProcessId },
    })
    const agent = await loggedIn(harness.db, admin.email)

    const foreign = await agent.post(`/api/diagnostics/${diagnosticId}/action-plans`).send({ title: 'Plan del riesgo', description: 'Mitigación del riesgo ajeno', riskId: defaultRisk.id })
    expect(foreign.status).toBe(400)
    expect(foreign.body.error).toBe('Risk not found')
    expect(harness.state.storedPlans).toHaveLength(1)

    const missing = await agent.post(`/api/diagnostics/${diagnosticId}/action-plans`).send({ title: 'Plan del riesgo', description: 'Mitigación de un riesgo que no existe', riskId: 'cmriskinexistente00000001' })
    expect(missing.status).toBe(400)
    expect(harness.state.storedPlans).toHaveLength(1)
  })

  it('rechaza un riskId que no sea un id de cuid válido', async () => {
    const harness = makeMitigationDb()
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.post(`/api/diagnostics/${diagnosticId}/action-plans`).send({ title: 'Plan del riesgo', description: 'Mitigación del riesgo MIS-R1', riskId: 'not-a-cuid' })
    expect(response.status).toBe(400)
  })

  it('lista los planes de la empresa con su progreso y vínculo actual, y protege el proceso ajeno', async () => {
    const harness = makeMitigationDb({ items: [seedItem('cmactionitem000000000001', 'COMPLETED'), seedItem('cmactionitem000000000002', 'PENDING')] })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.get(`/api/processes/${processId}/action-plans`)
    expect(response.status).toBe(200)
    expect(response.body.actionPlans).toEqual([
      { id: defaultPlan.id, title: defaultPlan.title, riskId: defaultRisk.id, itemsTotal: 2, itemsCompleted: 1 },
    ])

    const foreign = await agent.get(`/api/processes/${foreignProcessId}/action-plans`)
    expect(foreign.status).toBe(404)
  })

  // Regresión del reporte real: el cierre del ticket desde la interfaz no avisaba porque el plan
  // todavía no estaba vinculado a ningún riesgo (ActionPlan.riskId null) y el detector salía en
  // silencio. Tras vincularlo por el mismo camino que ahora expone la UI, el siguiente cierre sí avisa.
  it('cerrar el ticket de un plan sin vincular no avisa; vinculado, el siguiente cierre sí', async () => {
    const harness = makeMitigationDb({
      plans: [{ ...defaultPlan, riskId: null }],
      items: [seedItem('cmactionitem000000000001', 'IN_PROGRESS')],
    })
    harness.state.storedTickets.push({ id: 'cmticketmitigacion001', status: 'IN_PROGRESS', actionItemId: 'cmactionitem000000000001' })
    const agent = await loggedIn(harness.db, admin.email)

    const firstClose = await agent.patch(patchTicketPath('cmticketmitigacion001')).send({ status: 'RESOLVED' })
    expect(firstClose.status).toBe(200)
    expect(harness.state.storedNotifications).toHaveLength(0)

    const linked = await agent.patch(`/api/action-plans/${defaultPlan.id}`).send({ riskId: defaultRisk.id })
    expect(linked.status).toBe(200)
    expect(harness.state.storedPlans[0]?.riskId).toBe(defaultRisk.id)

    await agent.patch(patchTicketPath('cmticketmitigacion001')).send({ status: 'IN_PROGRESS' })
    const secondClose = await agent.patch(patchTicketPath('cmticketmitigacion001')).send({ status: 'RESOLVED' })
    expect(secondClose.status).toBe(200)
    expect(harness.state.storedNotifications).toHaveLength(2)
  })
})
