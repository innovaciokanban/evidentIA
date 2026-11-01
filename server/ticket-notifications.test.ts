import { describe, expect, it, vi } from 'vitest'
import { Role, TicketAssignmentApprovalStatus, TicketAuditEventType, TicketStatus } from '@prisma/client'
import { TicketNotificationWorker } from './ticket-notifications.js'

const companyId = 'cmcompany000000000000001'
const otherCompanyId = 'cmcompany000000000000002'
const assignee = { id: 'cmassignee000000000000001', companyId }
const assigner = { id: 'cmassigner000000000000001', companyId }
const dateEditor = { id: 'cmdateeditor000000000000001', companyId }
const admin = { id: 'cmadmin0000000000000001', companyId }
const candidate = { id: 'cmcandidate000000000000001', companyId }

type WorkerOptions = {
  status?: TicketStatus
  dueDate?: Date
  dueCycleId?: string
  assignmentActorId?: string | null
  assignedToId?: string | null
  pendingRequesterId?: string | null
  acceptedRequesterId?: string | null
  adminIds?: string[]
  reopened?: boolean
  foreignAssignmentActor?: boolean
  inactiveUserIds?: string[]
  now?: Date
  timeZone?: string
}

const makeWorker = (overrides: WorkerOptions = {}) => {
  const notifications: Array<{ userId: string; link: string; title: string; body: string }> = []
  const lockOrder: string[] = []
  const now = overrides.now ?? new Date('2026-10-28T12:00:00.000Z')
  const ticket = {
    id: 'cmticket000000000000001',
    title: 'Revisar contrato',
    status: overrides.status ?? TicketStatus.IN_PROGRESS,
    assignedToId: overrides.assignedToId === undefined ? assignee.id : overrides.assignedToId,
    dueDate: overrides.dueDate ?? new Date('2026-10-27T12:00:00.000Z'),
    createdBy: { companyId },
    assignedTo: overrides.assignedToId === null ? null : { companyId },
  }
  let dueCycleId = overrides.dueCycleId ?? 'cmauditdue000000000000001'
  let assignmentActorId: string | null = overrides.assignmentActorId === undefined ? assigner.id : overrides.assignmentActorId
  const assignedAuditActor = overrides.foreignAssignmentActor ? 'cmforeignactor00000000001' : assignmentActorId
  const reopenEvent = overrides.reopened
    ? { id: 'cmauditreopen000000000001', actorId: dateEditor.id, occurredAt: new Date('2026-10-28T10:00:00.000Z'), changes: [{ field: 'status', previousValue: 'Resuelto', newValue: 'En curso' }], metadata: null }
    : null
  const ticketAuditEvent = {
    findFirst: vi.fn(async ({ where }: { where: { eventType: TicketAuditEventType | { in: TicketAuditEventType[] } } }) => {
      if (where.eventType === TicketAuditEventType.TICKET_ASSIGNED) return { id: 'cmauditassignment000001', actorId: assignedAuditActor, occurredAt: new Date('2026-10-27T08:00:00.000Z'), changes: null, metadata: null }
      if (where.eventType === TicketAuditEventType.TICKET_STATUS_CHANGED) return reopenEvent
      if (typeof where.eventType === 'object' && where.eventType.in.includes(TicketAuditEventType.TICKET_CREATED)) return { id: dueCycleId, actorId: dateEditor.id, occurredAt: new Date('2026-10-26T08:00:00.000Z'), changes: null, metadata: null }
      return { id: 'cmauditcreated000001', actorId: assigner.id, occurredAt: new Date('2026-10-20T08:00:00.000Z'), changes: null, metadata: null }
    }),
  }
  const inactiveUserIds = new Set(overrides.inactiveUserIds ?? [])
  const knownUsers = new Map([
    [assignee.id, { id: assignee.id, companyId, role: Role.COMPANY_USER, isActive: !inactiveUserIds.has(assignee.id) }],
    [assigner.id, { id: assigner.id, companyId, role: Role.COMPANY_ADMIN, isActive: !inactiveUserIds.has(assigner.id) }],
    [dateEditor.id, { id: dateEditor.id, companyId, role: Role.COMPANY_ADMIN, isActive: !inactiveUserIds.has(dateEditor.id) }],
    [admin.id, { id: admin.id, companyId, role: Role.COMPANY_ADMIN, isActive: !inactiveUserIds.has(admin.id) }],
    [candidate.id, { id: candidate.id, companyId, role: Role.COMPANY_USER, isActive: !inactiveUserIds.has(candidate.id) }],
    ['cmforeignactor00000000001', { id: 'cmforeignactor00000000001', companyId: otherCompanyId, role: Role.COMPANY_ADMIN, isActive: !inactiveUserIds.has('cmforeignactor00000000001') }],
  ])
  let transactionTail = Promise.resolve()
  const db = {
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, id: string) => { lockOrder.push(id); return [{ locked: true }] }),
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => {
      const result = transactionTail.then(() => operation(db))
      transactionTail = result.then(() => undefined, () => undefined)
      return result
    }),
    ticket: {
      findMany: vi.fn(async () => [{ id: ticket.id }]),
      findUnique: vi.fn(async () => ({ ...ticket, assignedTo: ticket.assignedToId ? { companyId } : null })),
    },
    ticketAuditEvent,
    ticketAssignmentApproval: {
      findFirst: vi.fn(async ({ where }: { where: { status?: TicketAssignmentApprovalStatus } }) => {
        if (where.status === TicketAssignmentApprovalStatus.ACCEPTED && overrides.acceptedRequesterId) return { requestedById: overrides.acceptedRequesterId }
        if (where.status === TicketAssignmentApprovalStatus.PENDING && overrides.pendingRequesterId) return { requestedById: overrides.pendingRequesterId }
        return null
      }),
    },
    user: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => knownUsers.get(where.id) ?? null),
      findMany: vi.fn(async () => (overrides.adminIds ?? [admin.id]).map((id) => ({ id }))),
    },
    notification: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; link: string } }) => notifications.find((item) => item.userId === where.userId && item.link === where.link) ?? null),
      create: vi.fn(async ({ data }: { data: typeof notifications[number] }) => { notifications.push(data); return data }),
    },
  }
  const worker = new TicketNotificationWorker(db as never, { intervalMs: 60_000, now: () => now, timeZone: overrides.timeZone })
  return { worker, db, ticket, notifications, lockOrder, setDueCycle: (value: string) => { dueCycleId = value }, setAssignmentActor: (value: string | null) => { assignmentActorId = value } }
}

describe('TicketNotificationWorker', () => {
  it('notifies the confirmed responsible and accepted requester once per overdue cycle', async () => {
    const harness = makeWorker({ acceptedRequesterId: assigner.id })
    await harness.worker.runOnce()
    await harness.worker.runOnce()
    expect(harness.notifications).toHaveLength(2)
    expect(harness.notifications.map((item) => item.userId).sort()).toEqual([assignee.id, assigner.id].sort())
    expect(harness.notifications.every((item) => item.title === `Ticket vencido: ${harness.ticket.title}`)).toBe(true)
    expect(harness.notifications.every((item) => item.link.startsWith(`tickets/${harness.ticket.id}/overdue/cmauditdue000000000000001/confirmed/`))).toBe(true)
  })

  it('falls back to the historical assignment audit for tickets without an accepted approval', async () => {
    const harness = makeWorker()
    await harness.worker.runOnce()
    expect(harness.notifications.map((item) => item.userId).sort()).toEqual([assignee.id, assigner.id].sort())
  })

  it('locks overdue notification recipients in lexicographic order', async () => {
    const harness = makeWorker({ assignedToId: assigner.id, acceptedRequesterId: assignee.id })
    await harness.worker.runOnce()

    expect(harness.lockOrder.slice(0, 3)).toEqual([harness.ticket.id, assignee.id, assigner.id])
  })

  it('notifies only the requester when an unassigned ticket has a pending request', async () => {
    const harness = makeWorker({ assignedToId: null, pendingRequesterId: assigner.id })
    await harness.worker.runOnce()
    expect(harness.notifications).toHaveLength(1)
    expect(harness.notifications[0]).toMatchObject({ userId: assigner.id, title: `Ticket vencido con asignación pendiente: ${harness.ticket.title}` })
    expect(harness.notifications[0].body).toContain('Aún no tiene responsable confirmado')
    expect(harness.notifications.some((item) => item.userId === candidate.id)).toBe(false)
  })

  it('keeps the confirmed responsible active during a pending reassignment', async () => {
    const harness = makeWorker({ acceptedRequesterId: assigner.id, pendingRequesterId: candidate.id })
    await harness.worker.runOnce()
    expect(harness.notifications.map((item) => item.userId).sort()).toEqual([assignee.id, assigner.id].sort())
    expect(harness.notifications.some((item) => item.userId === candidate.id)).toBe(false)
  })

  it('uses company administrators when no requester is valid', async () => {
    const harness = makeWorker({ assignedToId: null, pendingRequesterId: 'cmforeignactor00000000001', adminIds: [admin.id] })
    await harness.worker.runOnce()
    expect(harness.notifications.map((item) => item.userId)).toEqual([admin.id])
    expect(harness.notifications[0].title).toContain('sin responsable')
  })

  it('uses administrators for an overdue ticket with no responsible or request', async () => {
    const harness = makeWorker({ assignedToId: null, adminIds: [admin.id] })
    await harness.worker.runOnce()
    expect(harness.notifications.map((item) => item.userId)).toEqual([admin.id])
    expect(harness.notifications[0].body).toContain('no tiene responsable ni solicitud')
  })

  it('deduplicates when requester and confirmed responsible are the same user', async () => {
    const harness = makeWorker({ assignedToId: assignee.id, acceptedRequesterId: assignee.id })
    await harness.worker.runOnce()
    expect(harness.notifications).toHaveLength(1)
    expect(harness.notifications[0].userId).toBe(assignee.id)
  })

  it('starts a new cycle when the due date changes or the ticket is reopened', async () => {
    const harness = makeWorker({ acceptedRequesterId: assigner.id })
    await harness.worker.runOnce()
    harness.setDueCycle('cmauditdue000000000000002')
    harness.ticket.dueDate = new Date('2026-10-26T12:00:00.000Z')
    await harness.worker.runOnce()
    expect(harness.notifications).toHaveLength(4)

    const reopened = makeWorker({ acceptedRequesterId: assigner.id, reopened: true })
    await reopened.worker.runOnce()
    expect(reopened.notifications.every((item) => item.link.includes('cmauditreopen000000000001'))).toBe(true)
  })

  it('does not notify during the due date in the business timezone, but does at the next local midnight', async () => {
    const dueDay = makeWorker({ dueDate: new Date('2026-10-30T00:00:00.000Z'), now: new Date('2026-10-30T23:59:59.999Z') })
    await dueDay.worker.runOnce()
    expect(dueDay.notifications).toHaveLength(0)

    const nextBusinessDay = makeWorker({ dueDate: new Date('2026-10-30T00:00:00.000Z'), now: new Date('2026-10-31T05:00:00.000Z') })
    await nextBusinessDay.worker.runOnce()
    expect(nextBusinessDay.notifications).toHaveLength(2)
  })

  it.each([TicketStatus.RESOLVED, TicketStatus.CLOSED])('does not notify a %s ticket', async (status) => {
    const harness = makeWorker({ status })
    await harness.worker.runOnce()
    expect(harness.notifications).toHaveLength(0)
  })

  it('does not send a foreign-company accepted requester an alert', async () => {
    const harness = makeWorker({ acceptedRequesterId: 'cmforeignactor00000000001', foreignAssignmentActor: true })
    await harness.worker.runOnce()
    expect(harness.notifications.map((item) => item.userId)).toEqual([assignee.id])
  })

  it('skips inactive recipients and falls back to active administrators', async () => {
    const inactiveResponsible = makeWorker({ inactiveUserIds: [assignee.id, assigner.id], adminIds: [admin.id] })
    await inactiveResponsible.worker.runOnce()
    expect(inactiveResponsible.notifications.map((item) => item.userId)).toEqual([admin.id])

    const inactiveAdmins = makeWorker({ assignedToId: null, inactiveUserIds: [admin.id], adminIds: [admin.id] })
    await inactiveAdmins.worker.runOnce()
    expect(inactiveAdmins.notifications).toHaveLength(0)
  })

  it('serializes concurrent runs and keeps one notification per recipient and cycle', async () => {
    const harness = makeWorker({ acceptedRequesterId: assigner.id })
    await Promise.all([harness.worker.runOnce(), harness.worker.runOnce()])
    expect(harness.notifications).toHaveLength(2)
  })
})
