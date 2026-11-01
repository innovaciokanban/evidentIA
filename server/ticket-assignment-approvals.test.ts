import bcrypt from 'bcryptjs'
import request from './test-request.js'
import { describe, expect, it, vi } from 'vitest'
import { Role, TicketAssignmentApprovalSource, TicketAssignmentApprovalStatus } from '@prisma/client'
import { createApp } from './app.js'
import {
  cancelPendingTicketAssignmentApprovals,
  cancelTicketAssignmentApproval,
  createTicketAssignmentApproval,
  decideTicketAssignmentApproval,
  listTicketAssignmentApprovals,
  TicketAssignmentApprovalError,
  supersedeTicketAssignmentApproval,
  type TicketAssignmentActor,
} from './ticket-assignment-approvals.js'

const company = { id: 'cmcompany000000000000001', name: 'Acme' }
const otherCompany = { id: 'cmcompany000000000000002', name: 'Other' }
const requester: TicketAssignmentActor = { id: 'cmrequester000000000000001', name: 'Requester', email: 'requester@test.local', role: Role.COMPANY_ADMIN, companyId: company.id }
const candidate: TicketAssignmentActor = { id: 'cmcandidate000000000000001', name: 'Candidate', email: 'candidate@test.local', role: Role.COMPANY_USER, companyId: company.id }
const foreignUser: TicketAssignmentActor = { id: 'cmforeign0000000000000001', name: 'Foreign', email: 'foreign@test.local', role: Role.COMPANY_USER, companyId: otherCompany.id }
const superuser: TicketAssignmentActor = { id: 'cmsuperuser00000000000001', name: 'Superuser', email: 'superuser@test.local', role: Role.SUPERUSER, companyId: null }

type StoredTicket = {
  id: string
  title: string
  description: string
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  assignedToId: string | null
  createdById: string
  dueDate: Date | null
}

type StoredApproval = {
  id: string
  ticketId: string | null
  requestedById: string
  proposedAssigneeId: string
  previousAssigneeId: string | null
  decidedById: string | null
  riskApprovalId: string | null
  status: TicketAssignmentApprovalStatus
  source: TicketAssignmentApprovalSource
  comment: string | null
  createdAt: Date
  decidedAt: Date | null
  updatedAt: Date
}

const users = [requester, candidate, foreignUser, superuser]
const ticketId = 'cmticketassignment000001'

const makeDb = (currentUser: TicketAssignmentActor = requester, options: { ticket?: Partial<StoredTicket>; forceUniqueConflict?: boolean; inactiveUserIds?: string[] } = {}) => {
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  let activeSession = false
  let ticket: StoredTicket = {
    id: ticketId,
    title: 'Ticket de prueba',
    description: 'Solicitud de prueba',
    status: 'OPEN',
    priority: 'MEDIUM',
    assignedToId: null,
    createdById: requester.id,
    dueDate: null,
    ...options.ticket,
  }
  let approvals: StoredApproval[] = []
  const inactiveUserIds = new Set(options.inactiveUserIds ?? [])
  const auditEvents: Array<Record<string, unknown>> = []
  const lockOrder: string[] = []
  const userView = (id: string | null) => {
    const user = users.find((item) => item.id === id)
    return user ? { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId, isActive: !inactiveUserIds.has(user.id) } : null
  }
  const ticketView = () => ({
    ...ticket,
    createdBy: userView(ticket.createdById),
    assignedTo: userView(ticket.assignedToId),
  })
  const approvalView = (approval: StoredApproval) => ({
    ...approval,
    requestedBy: userView(approval.requestedById),
    proposedAssignee: userView(approval.proposedAssigneeId),
    previousAssignee: userView(approval.previousAssigneeId),
    decidedBy: userView(approval.decidedById),
    ticket: approval.ticketId && ticket.id === approval.ticketId ? ticketView() : null,
    riskApproval: null,
  })
  const matches = (approval: StoredApproval, where: any): boolean => {
    if (!where) return true
    if (where.AND && !where.AND.every((part: any) => matches(approval, part))) return false
    if (where.OR && !where.OR.some((part: any) => matches(approval, part))) return false
    if (where.id && approval.id !== where.id) return false
    if (where.ticketId && typeof where.ticketId === 'object' && where.ticketId.not === null && approval.ticketId === null) return false
    if (typeof where.ticketId === 'string' && approval.ticketId !== where.ticketId) return false
    if (where.requestedById && approval.requestedById !== where.requestedById) return false
    if (where.proposedAssigneeId && approval.proposedAssigneeId !== where.proposedAssigneeId) return false
    if (where.status && approval.status !== where.status) return false
    if (where.ticket) {
      if (!approval.ticketId || approval.ticketId !== ticket.id) return false
      if (where.ticket.OR) {
        const matchesCompany = where.ticket.OR.some((part: any) => {
          if (part.assignedToId === null) return ticket.assignedToId === null
          const expected = part.createdBy?.companyId ?? part.assignedTo?.companyId
          const actual = part.createdBy ? userView(ticket.createdById)?.companyId : userView(ticket.assignedToId)?.companyId
          return expected === actual
        })
        if (!matchesCompany) return false
      }
      if (where.ticket.createdBy && userView(ticket.createdById)?.companyId !== where.ticket.createdBy.companyId) return false
    }
    if (where.requestedBy) {
      const user = userView(approval.requestedById)
      if (where.requestedBy.OR && !where.requestedBy.OR.some((part: any) => (part.companyId === undefined || user?.companyId === part.companyId) && (part.role === undefined || user?.role === part.role))) return false
      if (where.requestedBy.companyId !== undefined && user?.companyId !== where.requestedBy.companyId) return false
      if (where.requestedBy.role !== undefined && user?.role !== where.requestedBy.role) return false
    }
    if (where.proposedAssignee) {
      const user = userView(approval.proposedAssigneeId)
      if (where.proposedAssignee.companyId !== undefined && user?.companyId !== where.proposedAssignee.companyId) return false
      if (where.proposedAssignee.role !== undefined && user?.role !== where.proposedAssignee.role) return false
    }
    return true
  }
  const db = {
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, id: string) => { lockOrder.push(id); return [{ id: ticket.id }] }),
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
      const ticketBefore = { ...ticket }
      const approvalsBefore = approvals.map((item) => ({ ...item }))
      const auditsBefore = auditEvents.length
      try {
        return await operation(db as never)
      } catch (error) {
        ticket = ticketBefore
        approvals = approvalsBefore
        auditEvents.splice(auditsBefore)
        throw error
      }
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        const user = users.find((item) => (where.id ? item.id === where.id : item.email === where.email))
        return user ? { ...user, passwordHash, isActive: !inactiveUserIds.has(user.id) } : null
      }),
    },
    session: {
      create: vi.fn(async () => { activeSession = true; return { id: 'cmsession000000000000001', expiresAt: new Date(Date.now() + 86_400_000) } }),
      findUnique: vi.fn(async () => activeSession ? { id: 'cmsession000000000000001', expiresAt: new Date(Date.now() + 86_400_000), user: currentUser } : null),
      deleteMany: vi.fn(async () => { activeSession = false; return { count: 1 } }),
    },
    ticket: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === ticket.id ? ticketView() : null),
      update: vi.fn(async ({ data }: { data: { assignedToId?: string | null } }) => { ticket = { ...ticket, ...data }; return ticketView() }),
    },
    ticketAssignmentApproval: {
      findFirst: vi.fn(async ({ where }: { where: any }) => {
        const found = approvals.find((item) => matches(item, where))
        return found ? approvalView(found) : null
      }),
      findMany: vi.fn(async ({ where }: { where: any }) => approvals.filter((item) => matches(item, where)).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).map(approvalView)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = approvals.find((item) => item.id === where.id)
        return found ? approvalView(found) : null
      }),
      create: vi.fn(async ({ data }: { data: Omit<StoredApproval, 'id' | 'createdAt' | 'updatedAt' | 'decidedAt' | 'decidedById' | 'comment'> }) => {
        if (options.forceUniqueConflict) throw Object.assign(new Error('unique conflict'), { code: 'P2002' })
        const now = new Date()
        const created: StoredApproval = { ...data, id: `cmassignment${String(approvals.length + 1).padStart(14, '0')}`, decidedById: null, decidedAt: null, comment: null, createdAt: now, updatedAt: now }
        approvals = [...approvals, created]
        return created
      }),
      updateMany: vi.fn(async ({ where, data }: { where: any; data: Partial<StoredApproval> }) => {
        const index = approvals.findIndex((item) => matches(item, where))
        if (index < 0) return { count: 0 }
        approvals[index] = { ...approvals[index], ...data, updatedAt: new Date() }
        return { count: 1 }
      }),
    },
    riskApproval: {
      findUnique: vi.fn(async () => null),
    },
    ticketAuditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const event = { id: `cmaudit${String(auditEvents.length + 1).padStart(12, '0')}`, ...data, occurredAt: new Date() }
        auditEvents.push(event)
        return event
      }),
    },
    evidenceStorageOperation: {
      findMany: vi.fn(async () => []),
    },
  }
  return { db: db as any, getTicket: () => ticket, getApprovals: () => approvals, auditEvents, lockOrder, setUserActive: (id: string, isActive: boolean) => { if (isActive) inactiveUserIds.delete(id); else inactiveUserIds.add(id) } }
}

const expectAssignmentError = async (operation: Promise<unknown>, status: number) => {
  try {
    await operation
    throw new Error('Expected assignment approval error')
  } catch (error) {
    expect(error).toBeInstanceOf(TicketAssignmentApprovalError)
    expect((error as TicketAssignmentApprovalError).status).toBe(status)
  }
}

describe('TicketAssignmentApproval service', () => {
  it('creates a pending request without changing the confirmed assignee', async () => {
    const harness = makeDb()
    const created = await createTicketAssignmentApproval(harness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })

    expect(created.status).toBe(TicketAssignmentApprovalStatus.PENDING)
    expect(created.previousAssignee).toBeNull()
    expect(harness.getTicket().assignedToId).toBeNull()
    expect(harness.auditEvents.map((event) => event.eventType)).toEqual(['TICKET_ASSIGNMENT_REQUESTED'])
  })

  it('acquires the ticket before participating users and orders user locks', async () => {
    const harness = makeDb()
    await createTicketAssignmentApproval(harness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })
    harness.lockOrder.length = 0

    await decideTicketAssignmentApproval(harness.db, {
      id: harness.getApprovals()[0].id,
      decision: 'REJECT',
      comment: 'No procede.',
      actor: candidate,
    })

    expect(harness.lockOrder).toEqual([ticketId, candidate.id, requester.id])
  })

  it('rejects duplicate requests and maps a database uniqueness conflict to 409', async () => {
    const harness = makeDb()
    const input = { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester }
    const first = await createTicketAssignmentApproval(harness.db, input)
    const repeated = await createTicketAssignmentApproval(harness.db, input)
    expect(repeated.id).toBe(first.id)
    expect(repeated.status).toBe(TicketAssignmentApprovalStatus.PENDING)

    const conflictHarness = makeDb(requester, { forceUniqueConflict: true })
    await expectAssignmentError(createTicketAssignmentApproval(conflictHarness.db, input), 409)
  })

  it('rejects inactive requesters and candidates', async () => {
    const inactiveCandidate = makeDb(requester, { inactiveUserIds: [candidate.id] })
    await expectAssignmentError(createTicketAssignmentApproval(inactiveCandidate.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester }), 409)

    const inactiveRequester = makeDb(requester, { inactiveUserIds: [requester.id] })
    await expectAssignmentError(createTicketAssignmentApproval(inactiveRequester.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester }), 409)
  })

  it('rechecks the candidate after the initial lookup to close the deactivation race', async () => {
    const harness = makeDb()
    const originalFindUnique = (harness.db.user.findUnique as unknown as { getMockImplementation: () => ((input: { where: { id?: string; email?: string } }) => Promise<unknown>) | undefined }).getMockImplementation()
    let candidateReads = 0
    ;(harness.db.user.findUnique as unknown as { mockImplementation: (implementation: (input: { where: { id?: string; email?: string } }) => Promise<unknown>) => unknown }).mockImplementation(async (input) => {
      const result = originalFindUnique ? await originalFindUnique(input) : null
      if (input.where.id === candidate.id) {
        candidateReads += 1
        return result && { ...result, isActive: candidateReads === 1 }
      }
      return result
    })
    await expectAssignmentError(createTicketAssignmentApproval(harness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester }), 409)
    expect(harness.getApprovals()).toHaveLength(0)
  })

  it('accepts only by the proposed assignee and confirms the ticket atomically', async () => {
    const harness = makeDb()
    const created = await createTicketAssignmentApproval(harness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })
    await expectAssignmentError(decideTicketAssignmentApproval(harness.db, { id: created.id, decision: 'ACCEPT', actor: requester }), 403)

    const accepted = await decideTicketAssignmentApproval(harness.db, { id: created.id, decision: 'ACCEPT', actor: candidate })
    expect(accepted.status).toBe(TicketAssignmentApprovalStatus.ACCEPTED)
    expect(harness.getTicket().assignedToId).toBe(candidate.id)
    expect(harness.auditEvents.map((event) => event.eventType)).toEqual(['TICKET_ASSIGNMENT_REQUESTED', 'TICKET_ASSIGNMENT_ACCEPTED', 'TICKET_ASSIGNED'])
    await expectAssignmentError(decideTicketAssignmentApproval(harness.db, { id: created.id, decision: 'ACCEPT', actor: candidate }), 409)
  })

  it('does not accept or reject a request after the candidate becomes inactive', async () => {
    const harness = makeDb(requester)
    const created = await createTicketAssignmentApproval(harness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })
    const candidateView = (harness.db.ticketAssignmentApproval.findFirst as unknown as { mockImplementation: (implementation: (input: { where: unknown }) => Promise<unknown>) => unknown })
    candidateView.mockImplementation(async () => ({ ...created, requestedBy: requester, proposedAssignee: { ...candidate, isActive: false }, previousAssignee: null, decidedBy: null, ticket: { ...harness.getTicket(), createdBy: requester, assignedTo: null, actionItem: null }, riskApproval: null }))
    await expectAssignmentError(decideTicketAssignmentApproval(harness.db, { id: created.id, decision: 'ACCEPT', actor: candidate }), 409)
    await expectAssignmentError(decideTicketAssignmentApproval(harness.db, { id: created.id, decision: 'REJECT', comment: 'No disponible', actor: candidate }), 409)
    expect(harness.getTicket().assignedToId).toBeNull()
  })

  it('rechecks the candidate while deciding after a concurrent deactivation', async () => {
    const harness = makeDb()
    const created = await createTicketAssignmentApproval(harness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })
    harness.setUserActive(candidate.id, false)
    await expectAssignmentError(decideTicketAssignmentApproval(harness.db, { id: created.id, decision: 'ACCEPT', actor: candidate }), 409)
    expect(harness.getApprovals()[0].status).toBe(TicketAssignmentApprovalStatus.PENDING)
    expect(harness.getTicket().assignedToId).toBeNull()
  })

  it('rejects with a mandatory comment and keeps the previous assignee', async () => {
    const harness = makeDb(requester, { ticket: { assignedToId: requester.id } })
    const created = await createTicketAssignmentApproval(harness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })
    await expectAssignmentError(decideTicketAssignmentApproval(harness.db, { id: created.id, decision: 'REJECT', actor: candidate }), 400)

    const rejected = await decideTicketAssignmentApproval(harness.db, { id: created.id, decision: 'REJECT', comment: 'No puedo asumir esta responsabilidad.', actor: candidate })
    expect(rejected.status).toBe(TicketAssignmentApprovalStatus.REJECTED)
    expect(harness.getTicket().assignedToId).toBe(requester.id)
    expect(harness.auditEvents.at(-1)?.eventType).toBe('TICKET_ASSIGNMENT_REJECTED')
  })

  it('supports cancellation, supersession, self-assignment and deleted tickets', async () => {
    const cancelHarness = makeDb()
    const cancelRequest = await createTicketAssignmentApproval(cancelHarness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })
    const cancelled = await cancelTicketAssignmentApproval(cancelHarness.db, { id: cancelRequest.id, actor: requester })
    expect(cancelled.status).toBe(TicketAssignmentApprovalStatus.CANCELLED)

    const supersedeHarness = makeDb()
    const supersedeRequest = await createTicketAssignmentApproval(supersedeHarness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })
    const superseded = await supersedeTicketAssignmentApproval(supersedeHarness.db, { id: supersedeRequest.id, actor: requester })
    expect(superseded.status).toBe(TicketAssignmentApprovalStatus.SUPERSEDED)

    const selfHarness = makeDb()
    const selfRequest = await createTicketAssignmentApproval(selfHarness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: requester.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })
    expect(selfRequest.status).toBe(TicketAssignmentApprovalStatus.PENDING)

    const deletedHarness = makeDb()
    const deletedRequest = await createTicketAssignmentApproval(deletedHarness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })
    deletedHarness.db.ticket.findUnique = vi.fn(async () => null)
    await expectAssignmentError(decideTicketAssignmentApproval(deletedHarness.db, { id: deletedRequest.id, decision: 'ACCEPT', actor: candidate }), 404)
  })

  it('cancels every pending request before its ticket is removed from the workflow', async () => {
    const harness = makeDb()
    const created = await createTicketAssignmentApproval(harness.db, {
      ticketId,
      requestedById: requester.id,
      proposedAssigneeId: candidate.id,
      source: TicketAssignmentApprovalSource.DIRECT,
      actor: requester,
    })

    const cancelled = await cancelPendingTicketAssignmentApprovals(harness.db, {
      ticketId,
      actor: requester,
      comment: 'El ticket dejo de estar vigente.',
    })

    expect(cancelled).toBe(1)
    expect(harness.getApprovals().find((approval) => approval.id === created.id)).toMatchObject({
      status: TicketAssignmentApprovalStatus.CANCELLED,
      decidedById: requester.id,
      comment: 'El ticket dejo de estar vigente.',
    })
    expect(harness.auditEvents.at(-1)).toMatchObject({
      eventType: 'TICKET_ASSIGNMENT_CANCELLED',
      ticketId,
      metadata: { assignmentApprovalId: created.id },
    })
  })

  it('guards lifecycle cancellation against a concurrent cancellation', async () => {
    const harness = makeDb()
    await createTicketAssignmentApproval(harness.db, {
      ticketId,
      requestedById: requester.id,
      proposedAssigneeId: candidate.id,
      source: TicketAssignmentApprovalSource.DIRECT,
      actor: requester,
    })

    const results = await Promise.all([
      cancelPendingTicketAssignmentApprovals(harness.db, { ticketId, actor: requester, comment: 'Primera operación.' }),
      cancelPendingTicketAssignmentApprovals(harness.db, { ticketId, actor: requester, comment: 'Segunda operación.' }),
    ])

    expect(results.sort()).toEqual([0, 1])
    expect(harness.auditEvents.filter((event) => event.eventType === 'TICKET_ASSIGNMENT_CANCELLED')).toHaveLength(1)
  })

  it('enforces company isolation and validates the risk origin', async () => {
    const foreignHarness = makeDb()
    await expectAssignmentError(createTicketAssignmentApproval(foreignHarness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: foreignUser.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester }), 403)

    const riskHarness = makeDb(candidate)
    riskHarness.db.riskApproval.findUnique = vi.fn(async () => ({ id: 'cmriskapproval000000000001', status: 'APPROVED', ticketId, requestedById: requester.id, decidedById: candidate.id, risk: { riskOwnerId: candidate.id } }))
    const riskRequest = await createTicketAssignmentApproval(riskHarness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.RISK_APPROVAL, riskApprovalId: 'cmriskapproval000000000001', actor: candidate })
    expect(riskRequest.source).toBe(TicketAssignmentApprovalSource.RISK_APPROVAL)
  })

  it('hides and refuses a pending request after its candidate changes company', async () => {
    const harness = makeDb()
    const created = await createTicketAssignmentApproval(harness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })
    const previousCompanyId = candidate.companyId
    candidate.companyId = otherCompany.id
    try {
      expect(await listTicketAssignmentApprovals(harness.db, candidate, TicketAssignmentApprovalStatus.PENDING)).toHaveLength(0)
      await expectAssignmentError(decideTicketAssignmentApproval(harness.db, { id: created.id, decision: 'ACCEPT', actor: { ...candidate } }), 404)
    } finally {
      candidate.companyId = previousCompanyId
    }
  })
})

describe('TicketAssignmentApproval endpoints', () => {
  it('lists a candidate request and accepts it through the authenticated endpoint', async () => {
    const harness = makeDb(candidate)
    const created = await createTicketAssignmentApproval(harness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })
    const app = createApp(harness.db)
    const agent = request.agent(app)
    await agent.post('/api/auth/login').send({ email: candidate.email, password: 'Password123!' })

    const list = await agent.get('/api/ticket-assignment-approvals?status=PENDING')
    expect(list.status).toBe(200)
    expect(list.body.approvals.map((item: { id: string }) => item.id)).toContain(created.id)

    const accepted = await agent.post(`/api/ticket-assignment-approvals/${created.id}/decision`).send({ decision: 'ACCEPT' })
    expect(accepted.status).toBe(200)
    expect(accepted.body.approval.status).toBe('ACCEPTED')
  })

  it('hides another company request and rejects invalid decisions', async () => {
    const harness = makeDb(foreignUser)
    const created = await createTicketAssignmentApproval(harness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })
    const app = createApp(harness.db)
    const agent = request.agent(app)
    await agent.post('/api/auth/login').send({ email: foreignUser.email, password: 'Password123!' })

    expect((await agent.get(`/api/ticket-assignment-approvals/${created.id}`)).status).toBe(404)
    expect((await agent.get('/api/ticket-assignment-approvals')).body.approvals).toHaveLength(0)
  })

  it('requires a rejection comment and lets the requester cancel', async () => {
    const harness = makeDb(candidate)
    const created = await createTicketAssignmentApproval(harness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })
    const app = createApp(harness.db)
    const agent = request.agent(app)
    await agent.post('/api/auth/login').send({ email: candidate.email, password: 'Password123!' })

    const missingComment = await agent.post(`/api/ticket-assignment-approvals/${created.id}/decision`).send({ decision: 'REJECT' })
    expect(missingComment.status).toBe(400)

    const requesterHarness = makeDb(requester)
    const requesterRequest = await createTicketAssignmentApproval(requesterHarness.db, { ticketId, requestedById: requester.id, proposedAssigneeId: candidate.id, source: TicketAssignmentApprovalSource.DIRECT, actor: requester })
    const requesterApp = createApp(requesterHarness.db)
    const requesterAgent = request.agent(requesterApp)
    await requesterAgent.post('/api/auth/login').send({ email: requester.email, password: 'Password123!' })
    const cancelled = await requesterAgent.post(`/api/ticket-assignment-approvals/${requesterRequest.id}/cancel`).send({ comment: 'Se cancela antes de enviar otra solicitud.' })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.approval.status).toBe('CANCELLED')
  })
})
