import { PrismaClient, Role, TicketAssignmentApprovalStatus, TicketAuditEventType, TicketStatus } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { BUSINESS_TIME_ZONE, isCalendarDateOverdue } from './calendar-dates.js'
import { createNotificationIfAbsent, lockNotificationRecipients } from './notifications.js'

export type TicketNotificationClient = PrismaClient | Prisma.TransactionClient

type TicketNotificationTicket = {
  id: string
  title: string
  assignedToId: string | null
  dueDate: Date | null
  status: TicketStatus
  companyId: string | null
}

type OverdueAudience = 'CONFIRMED' | 'PENDING_ASSIGNMENT' | 'UNASSIGNED'

const notificationRecipientIds = (recipientIds: string[]): string[] => [...new Set(recipientIds)]

const ticketLink = (ticketId: string, kind: 'assignment' | 'assignment-request' | 'assignment-cancelled' | 'overdue', cycleKey: string, recipientId: string) =>
  `tickets/${ticketId}/${kind}/${cycleKey}/${recipientId}`

export const notifyTicketAssignment = async (
  client: TicketNotificationClient,
  input: { ticketId: string; title: string; assigneeId: string | null; actorId: string; cycleKey: string; companyId: string | null },
): Promise<void> => {
  if (!input.assigneeId) return
  const recipients = notificationRecipientIds([input.assigneeId, input.actorId])
  await lockNotificationRecipients(client, recipients)
  for (const recipientId of recipients) {
    await createNotificationIfAbsent(client, {
      userId: recipientId,
      title: `Ticket asignado: ${input.title}`,
      body: recipientId === input.actorId
        ? `Asignaste el ticket «${input.title}». Ábrelo para revisar el detalle y hacer seguimiento.`
        : `Se te asignó el ticket «${input.title}». Ábrelo para revisar el detalle y trabajar en él.`,
      link: ticketLink(input.ticketId, 'assignment', input.cycleKey, recipientId),
    }, { companyId: input.companyId })
  }
}

export const notifyTicketAssignmentRequest = async (
  client: TicketNotificationClient,
  input: { ticketId: string; title: string; proposedAssigneeId: string; requestedById: string; cycleKey: string; companyId: string | null },
): Promise<void> => {
  const recipients = notificationRecipientIds([input.proposedAssigneeId, input.requestedById])
  await lockNotificationRecipients(client, recipients)
  for (const recipientId of recipients) {
    await createNotificationIfAbsent(client, {
      userId: recipientId,
      title: `Solicitud de asignación: ${input.title}`,
      body: recipientId === input.proposedAssigneeId
        ? `Tienes una solicitud pendiente para asumir el ticket «${input.title}». Aún no está asignado a ti.`
        : `Enviaste una solicitud de asignación para «${input.title}». Sigue pendiente de aceptación.`,
      link: ticketLink(input.ticketId, 'assignment-request', input.cycleKey, recipientId),
    }, { companyId: input.companyId })
  }
}

export const notifyTicketAssignmentCancelled = async (
  client: TicketNotificationClient,
  input: { ticketId: string; title: string; requestedById: string; proposedAssigneeId: string; actorId: string; cycleKey: string; reason?: string; companyId: string | null },
): Promise<void> => {
  const recipients = notificationRecipientIds([input.proposedAssigneeId, input.requestedById])
  await lockNotificationRecipients(client, recipients)
  for (const recipientId of recipients) {
    await createNotificationIfAbsent(client, {
      userId: recipientId,
      title: `Solicitud de asignación cancelada: ${input.title}`,
      body: recipientId === input.actorId
        ? `Cancelaste la solicitud de asignación para «${input.title}».${input.reason ? ` ${input.reason}` : ''}`
        : `La solicitud de asignación para «${input.title}» fue cancelada.${input.reason ? ` ${input.reason}` : ''}`,
      link: ticketLink(input.ticketId, 'assignment-cancelled', input.cycleKey, recipientId),
    }, { companyId: input.companyId })
  }
}

export const notifyTicketOverdue = async (
  client: TicketNotificationClient,
  input: { ticket: TicketNotificationTicket; cycleKey: string; recipientIds: string[]; audience?: OverdueAudience },
): Promise<void> => {
  if (input.ticket.status === TicketStatus.RESOLVED || input.ticket.status === TicketStatus.CLOSED) return
  const audience = input.audience ?? 'CONFIRMED'
  const copy = audience === 'PENDING_ASSIGNMENT'
    ? { title: `Ticket vencido con asignación pendiente: ${input.ticket.title}`, body: `El ticket «${input.ticket.title}» superó su fecha límite y tiene una solicitud de asignación pendiente. Aún no tiene responsable confirmado.` }
    : audience === 'UNASSIGNED'
      ? { title: `Ticket vencido sin responsable: ${input.ticket.title}`, body: `El ticket «${input.ticket.title}» superó su fecha límite y todavía no tiene responsable ni solicitud de asignación.` }
      : { title: `Ticket vencido: ${input.ticket.title}`, body: `El ticket «${input.ticket.title}» superó su fecha límite y continúa sin resolver.` }
  const recipients = notificationRecipientIds(input.recipientIds)
  await lockNotificationRecipients(client, recipients)
  for (const recipientId of recipients) {
    await createNotificationIfAbsent(client, {
      userId: recipientId,
      title: copy.title,
      body: copy.body,
      link: ticketLink(input.ticket.id, 'overdue', `${input.cycleKey}/${audience.toLowerCase()}`, recipientId),
    }, { companyId: input.ticket.companyId })
  }
}

type WorkerOptions = {
  intervalMs: number
  now?: () => Date
  timeZone?: string
}

const ticketOverdueSelect = {
  id: true,
  title: true,
  status: true,
  assignedToId: true,
  dueDate: true,
  createdBy: { select: { companyId: true } },
  assignedTo: { select: { companyId: true } },
} as const

const ticketOverdueAuditSelect = { id: true, actorId: true, occurredAt: true, changes: true, metadata: true } as const

type TicketOverdueAudit = { id: string; actorId: string | null; occurredAt?: Date; changes?: unknown; metadata?: unknown }

const statusChangeFromAudit = (event: TicketOverdueAudit | null): { previous: string; next: string } | null => {
  if (!event || !Array.isArray(event.changes)) return null
  const change = event.changes.find((item): item is { field?: unknown; previousValue?: unknown; newValue?: unknown } => Boolean(item && typeof item === 'object' && (item as { field?: unknown }).field === 'status'))
  if (!change || typeof change.previousValue !== 'string' || typeof change.newValue !== 'string') return null
  return { previous: change.previousValue, next: change.newValue }
}

const isReopenEvent = (event: TicketOverdueAudit | null): boolean => {
  const change = statusChangeFromAudit(event)
  if (!change) return false
  return ['Resuelto', 'Cerrado'].includes(change.previous) && ['Abierto', 'En curso'].includes(change.next)
}

const eventIsAfter = (left: TicketOverdueAudit | null, right: TicketOverdueAudit | null): boolean => Boolean(left?.occurredAt && (!right?.occurredAt || left.occurredAt > right.occurredAt))

const assignmentApprovalIdFromAudit = (event: TicketOverdueAudit | null): string | null => {
  if (!event?.metadata || typeof event.metadata !== 'object' || Array.isArray(event.metadata)) return null
  const value = (event.metadata as { assignmentApprovalId?: unknown }).assignmentApprovalId
  return typeof value === 'string' ? value : null
}

/**
 * Worker server-side de vencimientos. La fila del ticket se bloquea antes de releerla, de modo que
 * dos procesos o dos reinicios concurrentes solo pueden crear una alerta por usuario y ciclo.
 */
export class TicketNotificationWorker {
  private timer: NodeJS.Timeout | null = null
  private readonly now: () => Date
  private readonly db: PrismaClient
  private readonly options: WorkerOptions
  private readonly timeZone: string

  constructor(db: PrismaClient, options: WorkerOptions) {
    this.db = db
    this.options = options
    this.now = options.now ?? (() => new Date())
    this.timeZone = options.timeZone ?? BUSINESS_TIME_ZONE
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.runOnce().catch((error) => console.error('[ticket-notifications] reconciliation failed', error)) }, this.options.intervalMs)
    this.timer.unref()
    void this.runOnce().catch((error) => console.error('[ticket-notifications] initial reconciliation failed', error))
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  async runOnce(): Promise<number> {
    const now = this.now()
    const candidates = await this.db.ticket.findMany({
      where: { status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS] }, dueDate: { lt: now } },
      select: { id: true },
    })
    for (const candidate of candidates) await this.processTicket(candidate.id, now)
    return candidates.length
  }

  private async processTicket(ticketId: string, now: Date): Promise<void> {
    await this.db.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') {
        await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`
      }
      const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, select: ticketOverdueSelect })
       if (!ticket || !ticket.dueDate || !isCalendarDateOverdue(ticket.dueDate, now, this.timeZone) || ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.CLOSED) return

       const [dueCycle, reopenEvent, assignment, creationEvent] = await Promise.all([
         tx.ticketAuditEvent.findFirst({
          where: { ticketId, eventType: { in: [TicketAuditEventType.TICKET_CREATED, TicketAuditEventType.TICKET_DUE_DATE_CHANGED] } },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
           select: ticketOverdueAuditSelect,
         }),
         tx.ticketAuditEvent.findFirst({
           where: { ticketId, eventType: TicketAuditEventType.TICKET_STATUS_CHANGED },
           orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
           select: ticketOverdueAuditSelect,
         }),
         tx.ticketAuditEvent.findFirst({
          where: { ticketId, eventType: TicketAuditEventType.TICKET_ASSIGNED },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
           select: ticketOverdueAuditSelect,
         }),
        tx.ticketAuditEvent.findFirst({
          where: { ticketId, eventType: TicketAuditEventType.TICKET_CREATED },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: ticketOverdueAuditSelect,
         }),
       ])
       const dueCycleAudit = dueCycle as TicketOverdueAudit | null
       const reopenAudit = isReopenEvent(reopenEvent as TicketOverdueAudit | null) ? reopenEvent as TicketOverdueAudit : null
       const cycleAudit = eventIsAfter(reopenAudit, dueCycleAudit) ? reopenAudit : dueCycleAudit
       const creation = cycleAudit?.id ?? `due-${ticket.dueDate.toISOString()}`
        const companyId = ticket.createdBy.companyId ?? ticket.assignedTo?.companyId ?? null
        const authorizedUser = async (userId: string | null | undefined) => {
          if (!userId) return null
          const user = await tx.user.findFirst({ where: { id: userId }, select: { id: true, companyId: true, role: true, isActive: true } })
          if (!user || user.isActive === false || (user.role !== Role.SUPERUSER && user.companyId !== companyId)) return null
          return user
        }
       const admins = async () => {
         if (!companyId || typeof tx.user.findMany !== 'function') return []
          const users = await tx.user.findMany({ where: { companyId, role: Role.COMPANY_ADMIN, isActive: true }, select: { id: true } })
         return users.map((user) => user.id)
       }
        let audience: OverdueAudience = 'UNASSIGNED'
        let recipientIds: string[]
       if (ticket.assignedToId) {
         audience = 'CONFIRMED'
          const acceptedApprovalId = assignmentApprovalIdFromAudit(assignment as TicketOverdueAudit | null)
          const accepted = await tx.ticketAssignmentApproval.findFirst({
            where: {
              ...(acceptedApprovalId ? { id: acceptedApprovalId } : {}),
              ticketId,
              status: TicketAssignmentApprovalStatus.ACCEPTED,
              proposedAssigneeId: ticket.assignedToId,
            },
            orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
            select: { requestedById: true },
          })
          const confirmedResponsible = await authorizedUser(ticket.assignedToId)
          const acceptedRequester = await authorizedUser(accepted?.requestedById)
          const auditActor = await authorizedUser(assignment?.actorId ?? creationEvent?.actorId)
          recipientIds = [confirmedResponsible?.id, acceptedRequester?.id ?? auditActor?.id].filter((id): id is string => Boolean(id))
          if (recipientIds.length === 0) recipientIds = await admins()
       } else {
         const pending = await tx.ticketAssignmentApproval.findFirst({
           where: { ticketId, status: TicketAssignmentApprovalStatus.PENDING },
           orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
           select: { requestedById: true },
         })
         const requester = await authorizedUser(pending?.requestedById)
         if (requester) {
           audience = 'PENDING_ASSIGNMENT'
           recipientIds = [requester.id]
         } else {
           recipientIds = await admins()
         }
       }
       await notifyTicketOverdue(tx, {
        ticket: {
          id: ticket.id,
          title: ticket.title,
          assignedToId: ticket.assignedToId,
          dueDate: ticket.dueDate,
          status: ticket.status,
          companyId,
        },
         cycleKey: creation,
         recipientIds,
         audience,
       })
    })
  }
}
