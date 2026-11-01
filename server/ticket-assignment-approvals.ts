import { PrismaClient, Prisma, Role, RiskApprovalStatus, TicketAssignmentApprovalSource, TicketAssignmentApprovalStatus, TicketAuditEventType } from '@prisma/client'
import { notifyTicketAssignment, notifyTicketAssignmentCancelled, notifyTicketAssignmentRequest } from './ticket-notifications.js'

export type TicketAssignmentApprovalClient = PrismaClient | Prisma.TransactionClient

export type TicketAssignmentActor = {
  id: string
  name: string
  email: string
  role: Role
  companyId: string | null
}

type TicketAssignmentAuditChange = {
  field: string
  label: string
  previousValue: string | null
  newValue: string | null
}

type TicketAssignmentTicket = {
  id: string
  title: string
  status: string
  priority: string
  assignedToId: string | null
  actionItemId: string | null
  createdBy: { id: string; name: string; email: string; companyId: string | null }
  assignedTo: { id: string; name: string; email: string; companyId: string | null } | null
  actionItem: { id: string; actionPlan: { id: string; strategySource: string | null; diagnostic?: { companyId: string } } } | null
}

const ticketAssignmentApprovalInclude = {
  requestedBy: { select: { id: true, name: true, email: true, role: true, companyId: true, isActive: true } },
  proposedAssignee: { select: { id: true, name: true, email: true, role: true, companyId: true, isActive: true } },
  previousAssignee: { select: { id: true, name: true, email: true, role: true, companyId: true } },
  decidedBy: { select: { id: true, name: true, email: true, role: true, companyId: true } },
  ticket: {
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      assignedToId: true,
      actionItemId: true,
      createdBy: { select: { id: true, name: true, email: true, companyId: true } },
      assignedTo: { select: { id: true, name: true, email: true, companyId: true } },
       actionItem: { select: { id: true, actionPlan: { select: { id: true, strategySource: true, diagnostic: { select: { companyId: true } } } } } },
    },
  },
  riskApproval: { select: { id: true, status: true, ticketId: true, requestedById: true } },
} as const

type TicketAssignmentApprovalRecord = Prisma.TicketAssignmentApprovalGetPayload<{ include: typeof ticketAssignmentApprovalInclude }>

export type TicketAssignmentApprovalView = {
  id: string
  ticketId: string | null
  status: TicketAssignmentApprovalStatus
  source: TicketAssignmentApprovalSource
  riskApprovalId: string | null
  comment: string | null
  createdAt: Date
  decidedAt: Date | null
  updatedAt: Date
  requestedBy: TicketAssignmentApprovalRecord['requestedBy']
  proposedAssignee: TicketAssignmentApprovalRecord['proposedAssignee']
  previousAssignee: TicketAssignmentApprovalRecord['previousAssignee']
  decidedBy: TicketAssignmentApprovalRecord['decidedBy']
  ticket: TicketAssignmentApprovalRecord['ticket']
}

export class TicketAssignmentApprovalError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 500

  constructor(status: 400 | 403 | 404 | 409 | 500, message: string) {
    super(message)
    this.status = status
    this.name = 'TicketAssignmentApprovalError'
  }
}

const runInTransaction = async <T>(client: TicketAssignmentApprovalClient, operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
  if (typeof (client as PrismaClient).$transaction === 'function') {
    return (client as PrismaClient).$transaction(operation)
  }
  return operation(client as Prisma.TransactionClient)
}

const lockTicket = async (client: Prisma.TransactionClient, ticketId: string): Promise<void> => {
  if (typeof client.$queryRaw !== 'function') return
  await client.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`
}

const lockUser = async (client: Prisma.TransactionClient, userId: string): Promise<void> => {
  if (typeof client.$queryRaw !== 'function') return
  await client.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`
}

const ticketCompanyId = (ticket: Pick<TicketAssignmentTicket, 'createdBy' | 'assignedTo' | 'actionItem'>, fallbackCompanyId: string | null = null): string | null => ticket.createdBy.companyId ?? ticket.assignedTo?.companyId ?? ticket.actionItem?.actionPlan.diagnostic?.companyId ?? fallbackCompanyId

const ticketSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  assignedToId: true,
  actionItemId: true,
  createdBy: { select: { id: true, name: true, email: true, companyId: true } },
  assignedTo: { select: { id: true, name: true, email: true, companyId: true } },
  actionItem: { select: { id: true, actionPlan: { select: { id: true, strategySource: true, diagnostic: { select: { companyId: true } } } } } },
} as const

const loadTicket = async (client: Prisma.TransactionClient, ticketId: string, shouldLock = true): Promise<TicketAssignmentTicket> => {
  if (shouldLock) await lockTicket(client, ticketId)
  const ticket = await client.ticket.findUnique({ where: { id: ticketId }, select: ticketSelect })
  if (!ticket) throw new TicketAssignmentApprovalError(404, 'Ticket not found')
  return ticket
}

const assignmentApprovalView = (approval: TicketAssignmentApprovalRecord): TicketAssignmentApprovalView => ({
  id: approval.id,
  ticketId: approval.ticketId,
  status: approval.status,
  source: approval.source,
  riskApprovalId: approval.riskApprovalId,
  comment: approval.comment,
  createdAt: approval.createdAt,
  decidedAt: approval.decidedAt,
  updatedAt: approval.updatedAt,
  requestedBy: approval.requestedBy,
  proposedAssignee: approval.proposedAssignee,
  previousAssignee: approval.previousAssignee,
  decidedBy: approval.decidedBy,
  ticket: approval.ticket,
})

const writeAssignmentAudit = async (
  client: Prisma.TransactionClient,
  ticket: TicketAssignmentTicket,
  actor: TicketAssignmentActor,
  eventType: TicketAuditEventType,
  summary: string,
  metadata: Record<string, unknown>,
  changes?: TicketAssignmentAuditChange[],
  companyId?: string | null,
): Promise<{ id: string }> => {
  const event = await client.ticketAuditEvent.create({
    data: {
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      companyId: companyId ?? ticketCompanyId(ticket),
      eventType,
      summary,
      ...(changes && changes.length > 0 ? { changes: changes as unknown as Prisma.InputJsonValue } : {}),
      metadata: metadata as Prisma.InputJsonValue,
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
    },
  })
  return { id: event.id }
}

const isUniqueConflict = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2002'
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'P2002')
}

const assertTicketCompanyAccess = (actor: TicketAssignmentActor, ticket: TicketAssignmentTicket, proposedAssigneeCompanyId: string | null, requestedByCompanyId: string | null): string => {
  const companyId = ticketCompanyId(ticket, proposedAssigneeCompanyId ?? requestedByCompanyId)
  if (!companyId || proposedAssigneeCompanyId !== companyId || (requestedByCompanyId && requestedByCompanyId !== companyId) || (ticket.assignedTo && ticket.assignedTo.companyId !== companyId)) {
    throw new TicketAssignmentApprovalError(403, 'The ticket and assignment users must belong to the same company')
  }
  if (actor.role !== Role.SUPERUSER && actor.companyId !== companyId) {
    throw new TicketAssignmentApprovalError(403, 'You cannot manage assignments outside your company')
  }
  return companyId
}

const assertAssignmentUsersActive = (requester: { isActive?: boolean }, proposedAssignee: { isActive?: boolean }): void => {
  if (requester.isActive === false) throw new TicketAssignmentApprovalError(409, 'The requesting user is inactive')
  if (proposedAssignee.isActive === false) throw new TicketAssignmentApprovalError(409, 'The proposed assignee is inactive')
}

const assertCurrentApprovalCompany = (approval: TicketAssignmentApprovalRecord, ticket: TicketAssignmentTicket, actor: TicketAssignmentActor): void => {
  const companyId = ticketCompanyId(ticket, approval.proposedAssignee.companyId ?? approval.requestedBy.companyId)
  const requesterIsGlobal = approval.requestedBy.role === Role.SUPERUSER && approval.requestedBy.companyId === null
  if (!companyId || (!requesterIsGlobal && approval.requestedBy.companyId !== companyId) || approval.proposedAssignee.companyId !== companyId || (ticket.assignedTo && ticket.assignedTo.companyId !== companyId)) {
    throw new TicketAssignmentApprovalError(404, 'Assignment approval not found')
  }
  if (actor.role !== Role.SUPERUSER && actor.companyId !== companyId) {
    throw new TicketAssignmentApprovalError(404, 'Assignment approval not found')
  }
}

const validateAssignmentSource = (ticket: TicketAssignmentTicket, source: TicketAssignmentApprovalSource): void => {
  if (source === TicketAssignmentApprovalSource.ACTION_ITEM || source === TicketAssignmentApprovalSource.STRATEGY_TASK) {
    if (!ticket.actionItemId) {
      throw new TicketAssignmentApprovalError(409, 'The assignment source is not linked to an action item')
    }
  }
  if (source === TicketAssignmentApprovalSource.STRATEGY_TASK && ticket.actionItem && !ticket.actionItem.actionPlan.strategySource) {
    throw new TicketAssignmentApprovalError(409, 'The assignment source is not linked to a strategic task')
  }
}

const assertCreationAuthorization = (actor: TicketAssignmentActor, requestedById: string, source: TicketAssignmentApprovalSource): void => {
  if (source === TicketAssignmentApprovalSource.RISK_APPROVAL) return
  if (actor.id !== requestedById || (actor.role !== Role.SUPERUSER && actor.role !== Role.COMPANY_ADMIN)) {
    throw new TicketAssignmentApprovalError(403, 'Only company admins and superusers can request this assignment')
  }
}

const validateRiskOrigin = async (
  client: Prisma.TransactionClient,
  ticketId: string,
  requestedById: string,
  proposedAssigneeId: string,
  actor: TicketAssignmentActor,
  riskApprovalId: string | null,
): Promise<void> => {
  if (!riskApprovalId) throw new TicketAssignmentApprovalError(400, 'riskApprovalId is required for a risk assignment')
  const riskApproval = await client.riskApproval.findUnique({
    where: { id: riskApprovalId },
    select: { id: true, status: true, ticketId: true, requestedById: true, decidedById: true, risk: { select: { riskOwnerId: true } } },
  })
  if (!riskApproval || riskApproval.status !== RiskApprovalStatus.APPROVED || riskApproval.ticketId !== ticketId || riskApproval.requestedById !== requestedById || riskApproval.risk.riskOwnerId !== proposedAssigneeId) {
    throw new TicketAssignmentApprovalError(409, 'The risk approval is not a valid origin for this assignment')
  }
  if (riskApproval.decidedById !== actor.id && actor.role !== Role.SUPERUSER && actor.role !== Role.COMPANY_ADMIN) {
    throw new TicketAssignmentApprovalError(403, 'Only the risk approver or an authorized administrator can create this assignment')
  }
}

export type CreateTicketAssignmentApprovalInput = {
  ticketId: string
  requestedById: string
  proposedAssigneeId: string
  source: TicketAssignmentApprovalSource
  riskApprovalId?: string | null
  replacePending?: boolean
  actor: TicketAssignmentActor
}

export const createTicketAssignmentApproval = async (client: TicketAssignmentApprovalClient, input: CreateTicketAssignmentApprovalInput): Promise<TicketAssignmentApprovalView> => {
  try {
    return await runInTransaction(client, async (transaction) => {
      const ticket = await loadTicket(transaction, input.ticketId)
      const [initialRequester, initialProposedAssignee] = await Promise.all([
        transaction.user.findUnique({ where: { id: input.requestedById }, select: { id: true, companyId: true, isActive: true } }),
        transaction.user.findUnique({ where: { id: input.proposedAssigneeId }, select: { id: true, companyId: true, isActive: true } }),
      ])
      if (!initialRequester || !initialProposedAssignee) throw new TicketAssignmentApprovalError(400, 'Assignment user not found')
      for (const userId of [...new Set([input.requestedById, input.proposedAssigneeId])].sort()) await lockUser(transaction, userId)
      const [requester, proposedAssignee] = await Promise.all([
        transaction.user.findUnique({ where: { id: input.requestedById }, select: { id: true, companyId: true, isActive: true } }),
        transaction.user.findUnique({ where: { id: input.proposedAssigneeId }, select: { id: true, companyId: true, isActive: true } }),
      ])
      if (!requester || !proposedAssignee) throw new TicketAssignmentApprovalError(400, 'Assignment user not found')
      assertAssignmentUsersActive(requester, proposedAssignee)
      assertTicketCompanyAccess(input.actor, ticket, proposedAssignee.companyId, requester.companyId)
      assertCreationAuthorization(input.actor, input.requestedById, input.source)
      if (input.source === TicketAssignmentApprovalSource.RISK_APPROVAL) {
        await validateRiskOrigin(transaction, input.ticketId, input.requestedById, input.proposedAssigneeId, input.actor, input.riskApprovalId ?? null)
      } else if (input.riskApprovalId) {
        throw new TicketAssignmentApprovalError(400, 'riskApprovalId is only valid for risk assignments')
      }
      validateAssignmentSource(ticket, input.source)
      const existing = await transaction.ticketAssignmentApproval.findFirst({ where: { ticketId: input.ticketId, status: TicketAssignmentApprovalStatus.PENDING }, select: { id: true } })
      if (existing) {
        const existingWithView = await transaction.ticketAssignmentApproval.findUnique({ where: { id: existing.id }, include: ticketAssignmentApprovalInclude })
        if (existingWithView?.proposedAssigneeId === input.proposedAssigneeId) return assignmentApprovalView(existingWithView)
        if (!input.replacePending) throw new TicketAssignmentApprovalError(409, 'This ticket already has a pending assignment request')
        await supersedeTicketAssignmentApproval(transaction, { id: existing.id, actor: input.actor, comment: 'Solicitud reemplazada por una nueva propuesta.' })
      }
      const created = await transaction.ticketAssignmentApproval.create({
        data: {
          ticketId: input.ticketId,
          requestedById: input.requestedById,
          proposedAssigneeId: input.proposedAssigneeId,
          previousAssigneeId: ticket.assignedToId,
          status: TicketAssignmentApprovalStatus.PENDING,
          source: input.source,
          riskApprovalId: input.riskApprovalId ?? null,
        },
      })
      const requestAudit = await writeAssignmentAudit(transaction, ticket, input.actor, TicketAuditEventType.TICKET_ASSIGNMENT_REQUESTED, 'Solicitud de asignacion creada', {
        assignmentApprovalId: created.id,
        source: input.source,
        requestedById: input.requestedById,
        proposedAssigneeId: input.proposedAssigneeId,
        previousAssigneeId: ticket.assignedToId,
        ...(input.riskApprovalId ? { riskApprovalId: input.riskApprovalId } : {}),
      }, undefined, ticketCompanyId(ticket, proposedAssignee.companyId ?? requester.companyId))
      await notifyTicketAssignmentRequest(transaction, {
        ticketId: ticket.id,
        title: ticket.title,
        proposedAssigneeId: input.proposedAssigneeId,
        requestedById: input.requestedById,
        cycleKey: requestAudit.id,
        companyId: ticketCompanyId(ticket, proposedAssignee.companyId ?? requester.companyId),
      })
      const result = await transaction.ticketAssignmentApproval.findUnique({ where: { id: created.id }, include: ticketAssignmentApprovalInclude })
      if (!result) throw new TicketAssignmentApprovalError(500, 'The assignment request could not be loaded')
      return assignmentApprovalView(result)
    })
  } catch (error) {
    if (isUniqueConflict(error)) throw new TicketAssignmentApprovalError(409, 'This ticket already has a pending assignment request')
    throw error
  }
}

export const ticketAssignmentApprovalWhere = (actor: Pick<TicketAssignmentActor, 'id' | 'role' | 'companyId'>, status?: TicketAssignmentApprovalStatus): Prisma.TicketAssignmentApprovalWhereInput => {
  const companyScope: Prisma.TicketAssignmentApprovalWhereInput = actor.role === Role.SUPERUSER
    ? {}
    : { AND: [
      { ticket: { OR: [
        { createdBy: { companyId: actor.companyId ?? 'none' } },
        { assignedTo: { companyId: actor.companyId ?? 'none' } },
        { actionItem: { actionPlan: { diagnostic: { companyId: actor.companyId ?? 'none' } } } },
        { createdBy: { role: Role.SUPERUSER, companyId: null }, actionItem: null },
      ] } },
      { OR: [{ requestedBy: { companyId: actor.companyId ?? 'none' } }, { requestedBy: { role: Role.SUPERUSER, companyId: null } }] },
      { proposedAssignee: { companyId: actor.companyId ?? 'none' } },
      { OR: [{ ticket: { assignedToId: null } }, { ticket: { assignedTo: { companyId: actor.companyId ?? 'none' } } }] },
    ] }
  const participantScope: Prisma.TicketAssignmentApprovalWhereInput = actor.role === Role.SUPERUSER || actor.role === Role.COMPANY_ADMIN
    ? {}
    : { OR: [{ requestedById: actor.id }, { proposedAssigneeId: actor.id }] }
  return { AND: [{ ticketId: { not: null } }, companyScope, participantScope, ...(status ? [{ status }] : [])] }
}

export const listTicketAssignmentApprovals = async (client: TicketAssignmentApprovalClient, actor: Pick<TicketAssignmentActor, 'id' | 'role' | 'companyId'>, status?: TicketAssignmentApprovalStatus): Promise<TicketAssignmentApprovalView[]> => {
  const approvals = await client.ticketAssignmentApproval.findMany({ where: ticketAssignmentApprovalWhere(actor, status), include: ticketAssignmentApprovalInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  return approvals.map(assignmentApprovalView)
}

export const getTicketAssignmentApproval = async (client: TicketAssignmentApprovalClient, id: string, actor: Pick<TicketAssignmentActor, 'id' | 'role' | 'companyId'>): Promise<TicketAssignmentApprovalView> => {
  const approval = await client.ticketAssignmentApproval.findFirst({ where: { AND: [{ id }, ticketAssignmentApprovalWhere(actor)] }, include: ticketAssignmentApprovalInclude })
  if (!approval || !approval.ticketId || !approval.ticket) throw new TicketAssignmentApprovalError(404, 'Assignment approval not found')
  return assignmentApprovalView(approval)
}

const loadVisibleApprovalForMutation = async (client: Prisma.TransactionClient, id: string, actor: TicketAssignmentActor): Promise<{ approval: TicketAssignmentApprovalRecord; ticket: TicketAssignmentTicket }> => {
  const visible = await client.ticketAssignmentApproval.findFirst({ where: { AND: [{ id }, ticketAssignmentApprovalWhere(actor)] }, include: ticketAssignmentApprovalInclude })
  if (!visible || !visible.ticketId || !visible.ticket) throw new TicketAssignmentApprovalError(404, 'Assignment approval not found')

  // Lock the ticket first, then all users participating in the approval. A company transfer uses
  // the user lock before cancelling pending approvals, so the second read observes either side of
  // that race instead of deciding with stale tenant memberships.
  const ticket = await loadTicket(client, visible.ticketId)
  const userIds = [...new Set([visible.requestedById, visible.proposedAssigneeId, ticket.createdBy.id, ...(ticket.assignedTo ? [ticket.assignedTo.id] : [])])].sort()
  for (const userId of userIds) await lockUser(client, userId)
  const approval = await client.ticketAssignmentApproval.findFirst({ where: { AND: [{ id }, ticketAssignmentApprovalWhere(actor)] }, include: ticketAssignmentApprovalInclude })
  if (!approval || !approval.ticketId || !approval.ticket) throw new TicketAssignmentApprovalError(404, 'Assignment approval not found')
  assertCurrentApprovalCompany(approval, ticket, actor)
  if (approval.proposedAssignee.isActive === false) throw new TicketAssignmentApprovalError(409, 'The proposed assignee is inactive')
  return { approval, ticket }
}

export type DecideTicketAssignmentApprovalInput = {
  id: string
  decision: 'ACCEPT' | 'REJECT'
  comment?: string
  actor: TicketAssignmentActor
}

export const decideTicketAssignmentApproval = async (client: TicketAssignmentApprovalClient, input: DecideTicketAssignmentApprovalInput): Promise<TicketAssignmentApprovalView> => runInTransaction(client, async (transaction) => {
  const { approval, ticket } = await loadVisibleApprovalForMutation(transaction, input.id, input.actor)
  if (approval.proposedAssigneeId !== input.actor.id) throw new TicketAssignmentApprovalError(403, 'Only the proposed assignee can decide this request')
  if (approval.status !== TicketAssignmentApprovalStatus.PENDING) throw new TicketAssignmentApprovalError(409, 'This assignment request was already decided')
  if (input.decision === 'REJECT' && !input.comment?.trim()) throw new TicketAssignmentApprovalError(400, 'A rejection requires a mandatory reason')
  const decidedAt = new Date()
  const guarded = await transaction.ticketAssignmentApproval.updateMany({
    where: { id: approval.id, status: TicketAssignmentApprovalStatus.PENDING, proposedAssigneeId: input.actor.id },
    data: { status: input.decision === 'ACCEPT' ? TicketAssignmentApprovalStatus.ACCEPTED : TicketAssignmentApprovalStatus.REJECTED, decidedById: input.actor.id, decidedAt, comment: input.comment?.trim() ?? null },
  })
  if (guarded.count === 0) throw new TicketAssignmentApprovalError(409, 'This assignment request was already decided')
  if (input.decision === 'ACCEPT') {
    await transaction.ticket.update({ where: { id: ticket.id }, data: { assignedToId: input.actor.id } })
    await writeAssignmentAudit(transaction, ticket, input.actor, TicketAuditEventType.TICKET_ASSIGNMENT_ACCEPTED, 'Solicitud de asignacion aceptada', { assignmentApprovalId: approval.id, previousAssigneeId: ticket.assignedToId, proposedAssigneeId: input.actor.id })
    if (ticket.actionItemId) {
      await transaction.actionItem.update({ where: { id: ticket.actionItemId }, data: { responsibleId: input.actor.id } })
    }
    const assignedAudit = await writeAssignmentAudit(transaction, { ...ticket, assignedToId: input.actor.id, assignedTo: input.actor }, input.actor, TicketAuditEventType.TICKET_ASSIGNED, 'Ticket asignado', { assignmentApprovalId: approval.id, previousAssigneeId: ticket.assignedToId, assignedToId: input.actor.id }, [{ field: 'assignedToId', label: 'Responsable', previousValue: ticket.assignedToId, newValue: input.actor.id }], input.actor.companyId ?? ticketCompanyId(ticket))
    await notifyTicketAssignment(transaction, { ticketId: ticket.id, title: ticket.title, assigneeId: input.actor.id, actorId: approval.requestedById, cycleKey: assignedAudit.id, companyId: ticketCompanyId(ticket, input.actor.companyId) })
  } else {
    await writeAssignmentAudit(transaction, ticket, input.actor, TicketAuditEventType.TICKET_ASSIGNMENT_REJECTED, 'Solicitud de asignacion rechazada', { assignmentApprovalId: approval.id, previousAssigneeId: ticket.assignedToId, proposedAssigneeId: input.actor.id, comment: input.comment!.trim() })
  }
  const updated = await transaction.ticketAssignmentApproval.findUnique({ where: { id: approval.id }, include: ticketAssignmentApprovalInclude })
  if (!updated) throw new TicketAssignmentApprovalError(500, 'The assignment decision could not be loaded')
  return assignmentApprovalView(updated)
})

const assertCanCancel = (actor: TicketAssignmentActor, approval: TicketAssignmentApprovalRecord, ticket: TicketAssignmentTicket): void => {
  const companyId = ticketCompanyId(ticket) ?? approval.proposedAssignee.companyId ?? approval.requestedBy.companyId
  const privileged = actor.role === Role.SUPERUSER || (actor.role === Role.COMPANY_ADMIN && actor.companyId === companyId)
  if (!privileged && approval.requestedById !== actor.id) throw new TicketAssignmentApprovalError(403, 'You cannot cancel this assignment request')
}

export const cancelTicketAssignmentApproval = async (client: TicketAssignmentApprovalClient, input: { id: string; comment?: string; actor: TicketAssignmentActor }): Promise<TicketAssignmentApprovalView> => runInTransaction(client, async (transaction) => {
  const { approval, ticket } = await loadVisibleApprovalForMutation(transaction, input.id, input.actor)
  assertCanCancel(input.actor, approval, ticket)
  if (approval.status !== TicketAssignmentApprovalStatus.PENDING) throw new TicketAssignmentApprovalError(409, 'This assignment request was already decided')
  const decidedAt = new Date()
  const guarded = await transaction.ticketAssignmentApproval.updateMany({ where: { id: approval.id, status: TicketAssignmentApprovalStatus.PENDING }, data: { status: TicketAssignmentApprovalStatus.CANCELLED, decidedById: input.actor.id, decidedAt, comment: input.comment?.trim() ?? null } })
  if (guarded.count === 0) throw new TicketAssignmentApprovalError(409, 'This assignment request was already decided')
  await writeAssignmentAudit(transaction, ticket, input.actor, TicketAuditEventType.TICKET_ASSIGNMENT_CANCELLED, 'Solicitud de asignacion cancelada', { assignmentApprovalId: approval.id, proposedAssigneeId: approval.proposedAssigneeId, ...(input.comment?.trim() ? { comment: input.comment.trim() } : {}) })
  const updated = await transaction.ticketAssignmentApproval.findUnique({ where: { id: approval.id }, include: ticketAssignmentApprovalInclude })
  if (!updated) throw new TicketAssignmentApprovalError(500, 'The assignment cancellation could not be loaded')
  return assignmentApprovalView(updated)
})

export const supersedeTicketAssignmentApproval = async (client: TicketAssignmentApprovalClient, input: { id: string; actor: TicketAssignmentActor; comment?: string }): Promise<TicketAssignmentApprovalView> => runInTransaction(client, async (transaction) => {
  const { approval, ticket } = await loadVisibleApprovalForMutation(transaction, input.id, input.actor)
  assertCanCancel(input.actor, approval, ticket)
  if (approval.status !== TicketAssignmentApprovalStatus.PENDING) throw new TicketAssignmentApprovalError(409, 'This assignment request was already decided')
  const decidedAt = new Date()
  const guarded = await transaction.ticketAssignmentApproval.updateMany({ where: { id: approval.id, status: TicketAssignmentApprovalStatus.PENDING }, data: { status: TicketAssignmentApprovalStatus.SUPERSEDED, decidedById: input.actor.id, decidedAt, comment: input.comment?.trim() ?? null } })
  if (guarded.count === 0) throw new TicketAssignmentApprovalError(409, 'This assignment request was already decided')
  await writeAssignmentAudit(transaction, ticket, input.actor, TicketAuditEventType.TICKET_ASSIGNMENT_SUPERSEDED, 'Solicitud de asignacion reemplazada', { assignmentApprovalId: approval.id, proposedAssigneeId: approval.proposedAssigneeId, ...(input.comment?.trim() ? { comment: input.comment.trim() } : {}) })
  const updated = await transaction.ticketAssignmentApproval.findUnique({ where: { id: approval.id }, include: ticketAssignmentApprovalInclude })
  if (!updated) throw new TicketAssignmentApprovalError(500, 'The superseded assignment request could not be loaded')
  return assignmentApprovalView(updated)
})

/**
 * Cancela las solicitudes pendientes cuando el objeto de negocio que las originó deja de existir
 * o pierde su responsable. Se ejecuta dentro de la transacción del llamador para que ningún
 * proceso pueda aceptar la solicitud entre la desasignación/eliminación y su cancelación.
 */
export const cancelPendingTicketAssignmentApprovals = async (
  client: Prisma.TransactionClient,
  input: { ticketId: string; actor: TicketAssignmentActor; comment: string; lockTicket?: boolean },
): Promise<number> => {
  const ticket = await loadTicket(client, input.ticketId, input.lockTicket !== false)
  const pending = await client.ticketAssignmentApproval.findMany({
    where: { ticketId: input.ticketId, status: TicketAssignmentApprovalStatus.PENDING },
    select: { id: true, requestedById: true, proposedAssigneeId: true },
  })
  let cancelled = 0
  for (const approval of pending) {
    const decidedAt = new Date()
    const guarded = await client.ticketAssignmentApproval.updateMany({
      where: { id: approval.id, ticketId: input.ticketId, status: TicketAssignmentApprovalStatus.PENDING },
      data: {
        status: TicketAssignmentApprovalStatus.CANCELLED,
        decidedById: input.actor.id,
        decidedAt,
        comment: input.comment,
      },
    })
    if (guarded.count === 0) continue
    const cancellationAudit = await writeAssignmentAudit(
      client,
      ticket,
      input.actor,
      TicketAuditEventType.TICKET_ASSIGNMENT_CANCELLED,
      'Solicitud de asignacion cancelada',
      { assignmentApprovalId: approval.id, proposedAssigneeId: approval.proposedAssigneeId, comment: input.comment },
    )
    await notifyTicketAssignmentCancelled(client, {
      ticketId: ticket.id,
      title: ticket.title,
      requestedById: approval.requestedById,
      proposedAssigneeId: approval.proposedAssigneeId,
      actorId: input.actor.id,
      cycleKey: cancellationAudit.id,
      reason: input.comment,
      companyId: ticketCompanyId(ticket, input.actor.companyId),
    })
    cancelled += 1
  }
  return cancelled
}

export const cancelPendingTicketAssignmentApprovalsForUser = async (
  client: Prisma.TransactionClient,
  input: { proposedAssigneeId: string; actor: TicketAssignmentActor; comment: string; lockTickets?: boolean },
): Promise<number> => {
  const pending = await client.ticketAssignmentApproval.findMany({
    where: { proposedAssigneeId: input.proposedAssigneeId, status: TicketAssignmentApprovalStatus.PENDING, ticketId: { not: null } },
    select: { ticketId: true },
  })
  const ticketIds = [...new Set(pending.flatMap((approval) => approval.ticketId ? [approval.ticketId] : []))].sort()
  if (input.lockTickets !== false) for (const ticketId of ticketIds) await lockTicket(client, ticketId)
  let cancelled = 0
  for (const ticketId of ticketIds) {
    cancelled += await cancelPendingTicketAssignmentApprovals(client, {
      ticketId,
      actor: input.actor,
      comment: input.comment,
      lockTicket: false,
    })
  }
  return cancelled
}

export const cancelPendingTicketAssignmentApprovalsForTickets = async (
  client: Prisma.TransactionClient,
  input: { ticketIds: string[]; actor: TicketAssignmentActor; comment: string },
): Promise<number> => {
  const ticketIds = [...new Set(input.ticketIds)].sort()
  for (const ticketId of ticketIds) await lockTicket(client, ticketId)
  let cancelled = 0
  for (const ticketId of ticketIds) {
    cancelled += await cancelPendingTicketAssignmentApprovals(client, {
      ticketId,
      actor: input.actor,
      comment: input.comment,
      lockTicket: false,
    })
  }
  return cancelled
}
