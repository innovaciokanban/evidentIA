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
// title/assignedToId son opcionales: los tickets sembrados por los tests antiguos solo cargaban
// estado; los que nacen en un endpoint sí llevan el título que el aviso de asignación publica.
type StoredTicket = { id: string; status: string; actionItemId: string | null; title?: string; assignedToId?: string | null }
type SeedRisk = {
  id: string
  processId: string
  code: string | null
  name: string
  riskOwnerId: string | null
  createdById: string | null
  mitigationOwnerId?: string | null
  /** Paso 2 del flujo: el gate de etapas exige tratamiento y riesgo aceptado para escribir. */
  treatment: string | null
  acceptanceStatus: string
  inherentImpact: number
  inherentProbability: number
}

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const processId = 'cmprocess000000000000000001'
const diagnosticId = 'cmdiagnostic000000000001'

const admin = { id: 'cmadmin0000000000000000001', email: 'admin@mitigation.test', name: 'Ben Admin', role: 'COMPANY_ADMIN' as Role, companyId }
const creator = { id: 'cmcreator000000000000000001', email: 'creator@mitigation.test', name: 'Ana Creadora', role: 'COMPANY_USER' as Role, companyId }
const owner = { id: 'cmowner0000000000000000001', email: 'owner@mitigation.test', name: 'Cleo Dueña', role: 'COMPANY_USER' as Role, companyId }
const mitigator = { id: 'cmmigitator00000000000001', email: 'mitigator@mitigation.test', name: 'Maya Mitigadora', role: 'COMPANY_USER' as Role, companyId }
const outsider = { id: 'cmoutsider00000000000001', email: 'outsider@mitigation.test', name: 'Otto Ajeno', role: 'COMPANY_USER' as Role, companyId: otherCompanyId }
const users: StoredUser[] = [admin, creator, owner, mitigator, outsider]
const passwordHash = bcrypt.hashSync('Password123!', 4)

const defaultRisk: SeedRisk = { id: 'cmrisk000000000000000001', processId, code: 'MIS-R1', name: 'Entrega tardía de información', riskOwnerId: owner.id, createdById: creator.id, treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED', inherentImpact: 3, inherentProbability: 4 }
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
  /** El gate de evidencia exige al menos un PDF: por defecto el arnés da por hecho que lo hay. */
  withoutEvidence?: boolean
  /** Sin diagnóstico la empresa no tiene dónde anclar un plan de mitigación nuevo (400). */
  withoutDiagnostic?: boolean
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
    responsible: item.responsibleId
      ? (() => { const user = users.find((entry) => entry.id === item.responsibleId); return user ? { id: user.id, name: user.name, email: user.email } : null })()
      : null,
    ticket: storedTickets.find((ticket) => ticket.actionItemId === item.id) ? { id: storedTickets.find((ticket) => ticket.actionItemId === item.id)!.id } : null,
  })
  // Misma inclusión que pide GET .../plan-activities: el ticket además lleva su estado.
  const itemWithActivityInclude = (item: StoredItem) => ({
    ...itemWithInclude(item),
    ticket: (() => { const ticket = storedTickets.find((entry) => entry.actionItemId === item.id); return ticket ? { id: ticket.id, status: ticket.status } : null })(),
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
      // Diagnóstico más reciente de la empresa, para anclar el plan que se crea al agregar la
      // primera actividad de un riesgo todavía sin plan.
      findFirst: vi.fn(async () => (options.withoutDiagnostic ? null : { id: diagnosticId })),
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
          mitigationOwnerId: risk.mitigationOwnerId ?? null,
          // Datos del gate de etapas (POST/PUT del paso 3): el arnés devuelve lo que el select real
          // pida, incluida la aceptación del riesgo.
          treatment: risk.treatment,
          acceptanceStatus: risk.acceptanceStatus,
          inherentImpact: risk.inherentImpact,
          inherentProbability: risk.inherentProbability,
          process: { companyId: processForCompanyId(risk.processId) },
          auditEvents: creatorEvent,
          mitigationPlans: storedPlans
            .filter((plan) => plan.riskId === risk.id)
            .map((plan) => ({
              id: plan.id,
              items: storedItems
                .filter((item) => item.actionPlanId === plan.id)
                .map((item) => ({
                  status: item.status,
                  // El select real de notifyMitigationPlanCompleted trae el ticket de la actividad
                  // para corroborar que su estado real también está cerrado.
                  ticket: (() => { const ticket = storedTickets.find((entry) => entry.actionItemId === item.id); return ticket ? { status: ticket.status } : null })(),
                })),
            })),
        }
      }),
    },
    actionPlan: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const plan = planFor(where.id); return plan ? planWithInclude(plan) : null }),
      // Plan primario del riesgo (POST .../plan-activities): el más antiguo con riskId; el arnés
      // no tiene createdAt, así que devuelve el primero en orden de inserción.
      findFirst: vi.fn(async ({ where }: { where: { riskId?: string | null } }) => {
        const plan = storedPlans.find((item) => item.riskId === where.riskId)
        return plan ? planWithInclude(plan) : null
      }),
      // Listado de candidatos a vincular (GET /processes/:id/action-plans): solo planes de la
      // empresa de la sesión, con su progreso y el riesgo al que apuntan hoy. La otra forma de
      // llamada (where.riskId) es GET .../plan-activities, que devuelve los ítems completos.
      findMany: vi.fn(async ({ where }: { where?: { diagnostic?: { companyId?: string }; riskId?: string } } = {}) => {
        if (where?.diagnostic?.companyId !== undefined) {
          if (where.diagnostic.companyId !== companyId) return []
          return storedPlans.map((plan) => ({
            id: plan.id,
            title: plan.title,
            riskId: plan.riskId,
            items: storedItems.filter((item) => item.actionPlanId === plan.id).map((item) => ({ status: item.status })),
          }))
        }
        return storedPlans
          .filter((plan) => plan.riskId === where?.riskId)
          .map((plan) => ({
            id: plan.id,
            items: storedItems.filter((item) => item.actionPlanId === plan.id).map(itemWithActivityInclude),
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
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const item = itemFor(where.id); return item ? itemWithActivityInclude(item) : null }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created: StoredItem = {
          id: `cmactionitemcreated${String(storedItems.length + 1).padStart(10, '0')}`,
          actionPlanId: String(data.actionPlanId),
          title: String(data.title),
          description: String(data.description),
          priority: String(data.priority ?? 'MEDIUM'),
          status: String(data.status ?? 'PENDING'),
          responsibleId: (data.responsibleId as string | null) ?? null,
          dueDate: (data.dueDate as Date | null) ?? null,
        }
        storedItems.push(created)
        return itemWithActivityInclude(created)
      }),
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
        const ticket: StoredTicket = { id: `cmticketmitigation${String(nextTicket).padStart(4, '0')}`, status: String(data.status ?? 'OPEN'), actionItemId: (data.actionItemId as string | null) ?? null, title: String(data.title ?? 'Ticket'), assignedToId: (data.assignedToId as string | null) ?? null }
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
    // Conteo de evidencias PDF del ticket, único dato que el gate 409 lee del modelo.
    ticketEvidenceFile: {
      count: vi.fn(async () => (options.withoutEvidence ? 0 : 1)),
      findMany: vi.fn(async () => []),
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
const planActivitiesPath = `/api/processes/${processId}/risks/${defaultRisk.id}/plan-activities`
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

  it('corrobora el estado real del ticket: COMPLETED con el ticket abierto no es terminado', () => {
    // La actividad sin ticket (null o campo ausente) no tiene estado que corroborar.
    expect(mitigationPlansCompleted([{ id: 'plan', items: [{ status: 'COMPLETED', ticketStatus: null }] }])).toBe(true)
    expect(mitigationPlansCompleted([{ id: 'plan', items: [{ status: 'COMPLETED' }] }])).toBe(true)
    // Con ticket, el estado del ticket manda: RESOLVED/CLOSED confirman, OPEN/IN_PROGRESS bloquean.
    expect(mitigationPlansCompleted([{ id: 'plan', items: [{ status: 'COMPLETED', ticketStatus: 'RESOLVED' }] }])).toBe(true)
    expect(mitigationPlansCompleted([{ id: 'plan', items: [{ status: 'COMPLETED', ticketStatus: 'CLOSED' }] }])).toBe(true)
    expect(mitigationPlansCompleted([{ id: 'plan', items: [{ status: 'COMPLETED', ticketStatus: 'OPEN' }] }])).toBe(false)
    expect(mitigationPlansCompleted([{ id: 'plan', items: [{ status: 'COMPLETED', ticketStatus: 'IN_PROGRESS' }] }])).toBe(false)
    expect(mitigationPlansCompleted([{
      id: 'plan',
      items: [
        { status: 'COMPLETED', ticketStatus: 'RESOLVED' },
        { status: 'COMPLETED', ticketStatus: 'OPEN' },
      ],
    }])).toBe(false)
  })

  it('arma el enlace de la sección residual y los destinatarios sin duplicar ni inventar', () => {
    expect(riskResidualSectionLink(processId, defaultRisk.id)).toBe(expectedLink)
    // Sin responsable de mitigación se conserva el destinatario de siempre: creador y dueño.
    expect(mitigationNotificationRecipients(null, owner.id, creator.id)).toEqual([creator.id, owner.id])
    expect(mitigationNotificationRecipients(null, creator.id, creator.id)).toEqual([creator.id])
    expect(mitigationNotificationRecipients(undefined, owner.id, null)).toEqual([owner.id])
    expect(mitigationNotificationRecipients(null, undefined, undefined)).toEqual([])
    // Con responsable de mitigación el aviso es solo para él, aunque tenga dueño y creador.
    expect(mitigationNotificationRecipients('cmitigationowner0000001', owner.id, creator.id)).toEqual(['cmitigationowner0000001'])
    expect(mitigationNotificationRecipients('cmitigationowner0000001', 'cmitigationowner0000001', 'cmitigationowner0000001')).toEqual(['cmitigationowner0000001'])
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

  it('con responsable de mitigación el aviso es solo para él, no para el creador ni el dueño', async () => {
    const harness = makeMitigationDb({
      risk: { ...defaultRisk, mitigationOwnerId: mitigator.id },
      items: [seedItem('cmactionitem000000000001', 'PENDING')],
    })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'COMPLETED' })
    expect(response.status).toBe(200)
    expect(harness.state.storedNotifications).toHaveLength(1)
    expect(harness.state.storedNotifications[0]?.userId).toBe(mitigator.id)
    expect(harness.state.storedNotifications[0]?.link).toBe(expectedLink)
  })
})

describe('gate de evidencia al cerrar una actividad de mitigación', () => {
  it('responde 409 al cerrar el ticket sin evidencia y no cambia ni el ticket ni la actividad', async () => {
    const harness = makeMitigationDb({ items: [seedItem('cmactionitem000000000001', 'IN_PROGRESS')], withoutEvidence: true })
    harness.state.storedTickets.push({ id: 'cmticketmitigacion001', status: 'IN_PROGRESS', actionItemId: 'cmactionitem000000000001' })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.patch(patchTicketPath('cmticketmitigacion001')).send({ status: 'RESOLVED' })
    expect(response.status).toBe(409)
    expect(response.body.reason).toBe('MITIGATION_EVIDENCE_REQUIRED')
    expect(response.body.error).toContain('PDF')
    // Rollback completo: ni el estado del ticket ni el de la actividad avanzan sin evidencia.
    expect(harness.state.storedTickets[0]?.status).toBe('IN_PROGRESS')
    expect(harness.state.storedItems[0]?.status).toBe('IN_PROGRESS')
    expect(harness.state.storedNotifications).toHaveLength(0)
  })

  it('responde 409 al completar la actividad cuando su ticket no tiene evidencia', async () => {
    const harness = makeMitigationDb({ items: [seedItem('cmactionitem000000000001', 'PENDING')], withoutEvidence: true })
    harness.state.storedTickets.push({ id: 'cmticketmitigacion001', status: 'OPEN', actionItemId: 'cmactionitem000000000001' })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'COMPLETED' })
    expect(response.status).toBe(409)
    expect(response.body.reason).toBe('MITIGATION_EVIDENCE_REQUIRED')
    expect(harness.state.storedItems[0]?.status).toBe('PENDING')
    expect(harness.state.storedNotifications).toHaveLength(0)
  })

  it('cancelar la actividad no exige evidencia (no afirma que la mitigación se ejecutara)', async () => {
    const harness = makeMitigationDb({ items: [seedItem('cmactionitem000000000001', 'IN_PROGRESS')], withoutEvidence: true })
    harness.state.storedTickets.push({ id: 'cmticketmitigacion001', status: 'IN_PROGRESS', actionItemId: 'cmactionitem000000000001' })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'CANCELLED' })
    expect(response.status).toBe(200)
    expect(harness.state.storedItems[0]?.status).toBe('CANCELLED')
  })

  it('un ticket manual (sin actividad) y un plan sin riesgo se cierran sin evidencia', async () => {
    const harness = makeMitigationDb({ items: [seedItem('cmactionitem000000000001', 'IN_PROGRESS')], withoutEvidence: true })
    harness.state.storedTickets.push({ id: 'cmticketmanual000001', status: 'OPEN', actionItemId: null })
    const agent = await loggedIn(harness.db, admin.email)

    const manual = await agent.patch(patchTicketPath('cmticketmanual000001')).send({ status: 'CLOSED' })
    expect(manual.status).toBe(200)

    // Plan sin riesgo asociado: la actividad no forma parte de ninguna mitigación.
    const harnessWithoutRisk = makeMitigationDb({ plans: [{ ...defaultPlan, riskId: null }], items: [seedItem('cmactionitem000000000001', 'PENDING')], withoutEvidence: true })
    harnessWithoutRisk.state.storedTickets.push({ id: 'cmticketmitigacion002', status: 'OPEN', actionItemId: 'cmactionitem000000000001' })
    const otherAgent = await loggedIn(harnessWithoutRisk.db, admin.email)
    const unlinked = await otherAgent.patch(patchTicketPath('cmticketmitigacion002')).send({ status: 'RESOLVED' })
    expect(unlinked.status).toBe(200)
  })

  it('con evidencia registrada el cierre pasa sin bloquear', async () => {
    const harness = makeMitigationDb({ items: [seedItem('cmactionitem000000000001', 'IN_PROGRESS')] })
    harness.state.storedTickets.push({ id: 'cmticketmitigacion001', status: 'IN_PROGRESS', actionItemId: 'cmactionitem000000000001' })
    const agent = await loggedIn(harness.db, admin.email)

    const closed = await agent.patch(patchTicketPath('cmticketmitigacion001')).send({ status: 'RESOLVED' })
    expect(closed.status).toBe(200)
    expect(harness.state.storedItems[0]?.status).toBe('COMPLETED')
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

describe('actividades de mitigación desde el panel del riesgo', () => {
  it('agrega una actividad al plan vinculado, crea su ticket y avisa al responsable', async () => {
    const harness = makeMitigationDb()
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.post(planActivitiesPath).send({
      title: 'Actualizar procedimiento de entrega',
      description: 'Revisar y actualizar el procedimiento de entrega de información',
      responsibleId: mitigator.id,
      dueDate: '2026-11-01',
    })
    expect(response.status).toBe(201)
    expect(response.body.activity).toMatchObject({
      title: 'Actualizar procedimiento de entrega',
      description: 'Revisar y actualizar el procedimiento de entrega de información',
      status: 'PENDING',
      responsible: { id: mitigator.id, name: mitigator.name },
    })
    expect(response.body.activity.ticket).toMatchObject({ status: 'OPEN' })

    // La actividad entra al plan ya vinculado: no se crea un plan duplicado.
    expect(harness.state.storedPlans).toHaveLength(1)
    expect(harness.state.storedItems).toHaveLength(2)
    const created = harness.state.storedItems[1]!
    expect(created.actionPlanId).toBe(defaultPlan.id)
    expect(created.responsibleId).toBe(mitigator.id)

    // El ticket nace en la misma transacción y el responsable recibe el aviso con su link.
    expect(harness.state.storedTickets).toHaveLength(1)
    expect(harness.state.storedTickets[0]).toMatchObject({ actionItemId: created.id, status: 'OPEN', assignedToId: mitigator.id })
    expect(harness.state.storedNotifications).toHaveLength(1)
    expect(harness.state.storedNotifications[0]).toMatchObject({ userId: mitigator.id, link: `tickets/${harness.state.storedTickets[0]!.id}` })
  })

  it('crea el plan del riesgo cuando todavía no tiene uno, y usa el título como descripción por defecto', async () => {
    const harness = makeMitigationDb({ plans: [{ ...defaultPlan, riskId: null }], items: [] })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.post(planActivitiesPath).send({ title: 'Capacitar al equipo en el nuevo procedimiento', responsibleId: owner.id, dueDate: '2026-11-15' })
    expect(response.status).toBe(201)
    expect(response.body.activity.description).toBe('Capacitar al equipo en el nuevo procedimiento')

    expect(harness.state.storedPlans).toHaveLength(2)
    const createdPlan = harness.state.storedPlans[1]!
    expect(createdPlan.riskId).toBe(defaultRisk.id)
    expect(createdPlan.diagnosticId).toBe(diagnosticId)
    expect(createdPlan.title).toContain(defaultRisk.code!)
    expect(harness.state.storedItems).toHaveLength(1)
    expect(harness.state.storedItems[0]?.actionPlanId).toBe(createdPlan.id)
  })

  it('responde 400 si la empresa no tiene diagnóstico donde anclar el plan nuevo', async () => {
    const harness = makeMitigationDb({ plans: [], items: [], withoutDiagnostic: true })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.post(planActivitiesPath).send({ title: 'Actividad sin dónde anclarse', responsibleId: mitigator.id, dueDate: '2026-11-01' })
    expect(response.status).toBe(400)
    expect(harness.state.storedPlans).toHaveLength(0)
    expect(harness.state.storedItems).toHaveLength(0)
    expect(harness.state.storedTickets).toHaveLength(0)
  })

  it('lista las actividades con responsable, vencimiento y ticket, y devuelve vacío sin plan', async () => {
    const harness = makeMitigationDb({
      items: [{ ...seedItem('cmactionitem000000000001', 'PENDING'), responsibleId: mitigator.id, dueDate: new Date('2026-11-01T00:00:00.000Z') }],
    })
    harness.state.storedTickets.push({ id: 'cmticketmitigacion001', status: 'OPEN', actionItemId: 'cmactionitem000000000001' })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.get(planActivitiesPath)
    expect(response.status).toBe(200)
    expect(response.body.activities).toHaveLength(1)
    expect(response.body.activities[0]).toMatchObject({
      id: 'cmactionitem000000000001',
      title: 'Actividad cmactionitem000000000001',
      status: 'PENDING',
      responsible: { id: mitigator.id, name: mitigator.name },
      ticket: { id: 'cmticketmitigacion001', status: 'OPEN' },
    })
    expect(response.body.activities[0].dueDate).toBeTruthy()

    // Un riesgo cuyo plan no está vinculado no tiene actividades que mostrar.
    const harnessWithoutLink = makeMitigationDb({ plans: [{ ...defaultPlan, riskId: null }], items: [seedItem('cmactionitem000000000001', 'PENDING')] })
    const otherAgent = await loggedIn(harnessWithoutLink.db, admin.email)
    const empty = await otherAgent.get(planActivitiesPath)
    expect(empty.status).toBe(200)
    expect(empty.body.activities).toEqual([])
  })

  it('rechaza procesos y riesgos ajenos en el listado y el alta', async () => {
    const harness = makeMitigationDb({ risk: { ...defaultRisk, processId: foreignProcessId } })
    const agent = await loggedIn(harness.db, admin.email)

    const foreignProcess = await agent.get(`/api/processes/${foreignProcessId}/risks/${defaultRisk.id}/plan-activities`)
    expect(foreignProcess.status).toBe(404)

    // El proceso es visible, pero el riesgo no pertenece a ese proceso.
    const wrongRisk = await agent.get(planActivitiesPath)
    expect(wrongRisk.status).toBe(404)

    const post = await agent.post(planActivitiesPath).send({ title: 'Actividad de un riesgo ajeno', responsibleId: mitigator.id, dueDate: '2026-11-01' })
    expect(post.status).toBe(404)
    expect(harness.state.storedItems).toHaveLength(1)
  })

  it('rechaza un responsable de otra empresa y no escribe la actividad', async () => {
    const harness = makeMitigationDb()
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.post(planActivitiesPath).send({ title: 'Actividad con responsable ajeno', responsibleId: outsider.id, dueDate: '2026-11-01' })
    expect(response.status).toBe(403)
    expect(harness.state.storedItems).toHaveLength(1)
    expect(harness.state.storedTickets).toHaveLength(0)
  })

  it('un usuario sin rol de escritura no puede agregar actividades', async () => {
    const harness = makeMitigationDb()
    const agent = await loggedIn(harness.db, creator.email)

    const response = await agent.post(planActivitiesPath).send({ title: 'Actividad sin permiso de escritura', responsibleId: creator.id, dueDate: '2026-11-01' })
    expect(response.status).toBe(403)
    expect(harness.state.storedItems).toHaveLength(1)
  })

  it('valida los datos de la actividad (título, responsable y fecha son obligatorios)', async () => {
    const harness = makeMitigationDb()
    const agent = await loggedIn(harness.db, admin.email)

    expect((await agent.post(planActivitiesPath).send({ title: 'x', responsibleId: mitigator.id, dueDate: '2026-11-01' })).status).toBe(400)
    expect((await agent.post(planActivitiesPath).send({ title: 'Título válido de actividad', responsibleId: mitigator.id })).status).toBe(400)
    expect((await agent.post(planActivitiesPath).send({ title: 'Título válido de actividad', dueDate: '2026-11-01' })).status).toBe(400)
    expect(harness.state.storedItems).toHaveLength(1)
  })

  it('bloquea el alta y el contenido del plan mientras el riesgo no esté aceptado, y deja cerrar', async () => {
    const stage = (acceptanceStatus: string) => ({ ...defaultRisk, acceptanceStatus })
    // PENDING (sin decisión autorizada): el paso 3 no escribe nada, ni altas ni contenido.
    const pendingHarness = makeMitigationDb({ risk: stage('PENDING') })
    const pendingAgent = await loggedIn(pendingHarness.db, admin.email)
    const blockedActivity = await pendingAgent.post(planActivitiesPath).send({ title: 'Actividad bloqueada', responsibleId: mitigator.id, dueDate: '2026-11-01' })
    expect(blockedActivity.status).toBe(409)
    expect(blockedActivity.body.error).toBe('Controls and mitigation management unlock once the risk owner accepts the risk')
    expect(pendingHarness.state.storedItems).toHaveLength(1)
    expect(pendingHarness.state.storedTickets).toHaveLength(0)
    const blockedEdit = await pendingAgent.patch(patchItemPath('cmactionitem000000000001')).send({ title: 'Título cambiado sin aceptar', dueDate: new Date('2026-11-05') })
    expect(blockedEdit.status).toBe(409)
    // La finalización sigue permitida: es cerrar trabajo ya asignado, con la compuerta de
    // evidencia PDF de siempre, y no depende de la aceptación.
    const completed = await pendingAgent.patch(patchItemPath('cmactionitem000000000001')).send({ status: 'COMPLETED' })
    expect(completed.status).toBe(200)
    expect(pendingHarness.state.storedItems[0]?.status).toBe('COMPLETED')
    // REJECTED tampoco desbloquea el paso 3: hace falta una nueva decisión autorizada.
    const rejectedHarness = makeMitigationDb({ risk: stage('REJECTED') })
    const rejectedAgent = await loggedIn(rejectedHarness.db, admin.email)
    const rejectedActivity = await rejectedAgent.post(planActivitiesPath).send({ title: 'Otra actividad bloqueada', responsibleId: mitigator.id, dueDate: '2026-11-01' })
    expect(rejectedActivity.status).toBe(409)
    expect(rejectedActivity.body.error).toBe('The risk was rejected; a new authorized decision is required before managing controls, the mitigation plan and the residual risk')
    expect(rejectedHarness.state.storedItems).toHaveLength(1)
    // Con el riesgo aceptado (la semilla por defecto) el paso 3 vuelve a escribir.
    const acceptedHarness = makeMitigationDb()
    const acceptedAgent = await loggedIn(acceptedHarness.db, admin.email)
    expect((await acceptedAgent.post(planActivitiesPath).send({ title: 'Actividad habilitada', responsibleId: mitigator.id, dueDate: '2026-11-01' })).status).toBe(201)
    expect(acceptedHarness.state.storedItems).toHaveLength(2)
  })

  it('si el aviso de asignación falla, no quedan ni actividad ni ticket', async () => {
    const harness = makeMitigationDb({ failNotifications: true })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.post(planActivitiesPath).send({ title: 'Actividad que no debe quedar', responsibleId: mitigator.id, dueDate: '2026-11-01' })
    expect(response.status).toBe(500)
    expect(harness.state.storedItems).toHaveLength(1)
    expect(harness.state.storedTickets).toHaveLength(0)
    expect(harness.state.storedNotifications).toHaveLength(0)
  })

  it('no avisa del plan completo si una actividad COMPLETED conserva su ticket abierto', async () => {
    const harness = makeMitigationDb({ items: [seedItem('cmactionitem000000000001', 'COMPLETED'), seedItem('cmactionitem000000000002', 'PENDING')] })
    harness.state.storedTickets.push({ id: 'cmticketmitigacion001', status: 'OPEN', actionItemId: 'cmactionitem000000000001' })
    const agent = await loggedIn(harness.db, admin.email)

    const response = await agent.patch(patchItemPath('cmactionitem000000000002')).send({ status: 'COMPLETED' })
    expect(response.status).toBe(200)
    // Las dos actividades están COMPLETED, pero el ticket de la primera sigue OPEN.
    expect(harness.state.storedNotifications).toHaveLength(0)
  })
})
