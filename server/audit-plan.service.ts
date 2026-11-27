import type { Application, NextFunction, Request, RequestHandler, Response } from 'express'
import { AuditEventType, Prisma, type PrismaClient } from '@prisma/client'
import {
  auditPlanActivityCreateSchema,
  auditPlanActivityAuditorsSchema,
  auditActivityExecutionCancelSchema,
  auditActivityExecutionCompleteSchema,
  auditActivityExecutionStartSchema,
  auditActivityExecutionUpdateSchema,
  auditActivityResourceLinkSchema,
  auditPlanActivityUpdateSchema,
  auditPlanCreateSchema,
  auditPlanStatusChangeSchema,
  auditPlanUpdateSchema,
  idReference,
} from './validation.js'

const planInclude = {
  preparedBy: { select: { id: true, name: true, email: true, isActive: true } },
  approvedBy: { select: { id: true, name: true, email: true, isActive: true } },
  activities: {
    orderBy: [{ scheduledStart: 'asc' as const }, { position: 'asc' as const }, { createdAt: 'asc' as const }],
      include: {
        responsible: { select: { id: true, name: true, email: true, isActive: true } },
        process: { select: { id: true, name: true, code: true, companyId: true } },
        startedBy: { select: { id: true, name: true, email: true, isActive: true } },
        completedBy: { select: { id: true, name: true, email: true, isActive: true } },
        auditorAssignments: {
          where: { isActive: true },
          orderBy: { assignedAt: 'asc' as const },
          include: {
            auditTeamMember: {
              include: {
                auditor: { select: { id: true, name: true, email: true, type: true } },
              },
            },
          },
        },
        checklistItemLinks: {
          where: { isActive: true },
          orderBy: { linkedAt: 'asc' as const },
          include: { item: { select: { id: true, checklistId: true, description: true, result: true } } },
        },
        evidenceLinks: {
          where: { isActive: true },
          orderBy: { linkedAt: 'asc' as const },
          include: { evidence: { select: { id: true, auditId: true, findingId: true, name: true, description: true, url: true } } },
        },
        evidenceFileLinks: {
          where: { isActive: true },
          orderBy: { linkedAt: 'asc' as const },
          include: { evidenceFile: { select: { id: true, auditId: true, findingId: true, actionId: true, itemId: true, filename: true, mimeType: true, size: true, storageProvider: true, storageState: true } } },
        },
        findingLinks: {
          where: { isActive: true },
          orderBy: { linkedAt: 'asc' as const },
          include: { finding: { select: { id: true, auditId: true, title: true, type: true, severity: true, status: true } } },
        },
      },
  },
} satisfies Prisma.AuditPlanInclude

type PlanWithRelations = Prisma.AuditPlanGetPayload<{ include: typeof planInclude }>
type AuditPlanDb = PrismaClient | Prisma.TransactionClient
type AuditContext = {
  id: string
  processId: string
  status: 'PLANNED' | 'IN_PROGRESS' | 'CLOSED' | 'CANCELLED'
  companyId: string
}
type AuditPlanActor = { id: string; name: string; email: string } | null | undefined

class AuditPlanError extends Error {
  readonly status: 400 | 403 | 404 | 409

  constructor(status: 400 | 403 | 404 | 409, message: string) {
    super(message)
    this.status = status
    this.name = 'AuditPlanError'
  }
}

const runInTransaction = <T>(db: PrismaClient, operation: (client: Prisma.TransactionClient) => Promise<T>): Promise<T> => db.$transaction(operation)

const canAccessCompany = (request: Request, companyId: string): boolean =>
  request.user?.role === 'SUPERUSER' || request.user?.companyId === companyId

const actorFields = (actor: AuditPlanActor) => actor
  ? { actorId: actor.id, actorName: actor.name || null, actorEmail: actor.email || null }
  : { actorId: null, actorName: null, actorEmail: null }

const writeAuditEvent = (db: AuditPlanDb, data: {
  auditId: string
  eventType: AuditEventType
  summary: string
  actor: AuditPlanActor
  changes?: Array<Record<string, unknown>>
  metadata?: Record<string, unknown>
}) => db.auditEvent.create({
  data: {
    auditId: data.auditId,
    eventType: data.eventType,
    summary: data.summary,
    ...(data.changes?.length ? { changes: data.changes as unknown as Prisma.InputJsonValue } : {}),
    ...(data.metadata ? { metadata: data.metadata as unknown as Prisma.InputJsonValue } : {}),
    ...actorFields(data.actor),
  },
})

const lockAuditForUpdate = async (db: AuditPlanDb, auditId: string) => {
  if (typeof db.$queryRaw === 'function') await db.$queryRaw`SELECT "id" FROM "Audit" WHERE "id" = ${auditId} FOR UPDATE`
}

const lockPlanForUpdate = async (db: AuditPlanDb, planId: string) => {
  if (typeof db.$queryRaw === 'function') await db.$queryRaw`SELECT "id" FROM "AuditPlan" WHERE "id" = ${planId} FOR UPDATE`
}

const lockAndRefreshAudit = async (db: AuditPlanDb, request: Request, auditId: string): Promise<AuditContext> => {
  const initial = await findAudit(db, request, auditId)
  await lockAuditForUpdate(db, initial.id)
  return findAudit(db, request, auditId)
}

const findAudit = async (db: AuditPlanDb, request: Request, auditId: string): Promise<AuditContext> => {
  const parsedId = idReference.safeParse(auditId)
  if (!parsedId.success) throw new AuditPlanError(400, 'Invalid audit id')
  const audit = await db.audit.findUnique({
    where: { id: parsedId.data },
    select: { id: true, processId: true, status: true, process: { select: { companyId: true } } },
  })
  if (!audit || !canAccessCompany(request, audit.process.companyId)) throw new AuditPlanError(404, 'Audit not found')
  return { id: audit.id, processId: audit.processId, status: audit.status, companyId: audit.process.companyId }
}

const findPlan = async (db: AuditPlanDb, audit: AuditContext): Promise<PlanWithRelations> => {
  const plan = await db.auditPlan.findUnique({ where: { auditId: audit.id }, include: planInclude })
  if (!plan) throw new AuditPlanError(404, 'Audit plan not found')
  return plan
}

const assertAuditIsEditable = (audit: AuditContext) => {
  if (audit.status === 'CLOSED' || audit.status === 'CANCELLED') throw new AuditPlanError(409, 'A closed or cancelled audit cannot change its plan')
}

const assertPlanIsDraft = (plan: PlanWithRelations) => {
  if (plan.status !== 'DRAFT') throw new AuditPlanError(409, 'Only a draft audit plan can be edited')
}

const assertResponsible = async (db: AuditPlanDb, responsibleId: string | null | undefined, companyId: string) => {
  if (!responsibleId) return
  const responsible = await db.user.findUnique({ where: { id: responsibleId }, select: { id: true, companyId: true, isActive: true } })
  if (!responsible) throw new AuditPlanError(404, 'Activity responsible user not found')
  if (responsible.companyId !== companyId) throw new AuditPlanError(404, 'Activity responsible user not found')
  if (!responsible.isActive) throw new AuditPlanError(409, 'Activity responsible user is inactive')
}

const findActivityForPlan = async (db: AuditPlanDb, plan: PlanWithRelations, activityId: string): Promise<{ id: string; auditPlanId: string }> => {
  const parsedId = idReference.safeParse(activityId)
  if (!parsedId.success) throw new AuditPlanError(400, 'Invalid activity id')
  const activity = await db.auditPlanActivity.findUnique({ where: { id: parsedId.data }, select: { id: true, auditPlanId: true } })
  if (!activity || activity.auditPlanId !== plan.id) throw new AuditPlanError(404, 'Audit plan activity not found')
  return activity
}

const findActiveAuditTeamMembers = async (db: AuditPlanDb, audit: AuditContext, ids: string[]) => {
  if (ids.length === 0) return []
  const members = await db.auditTeamMember.findMany({
    where: { id: { in: ids }, auditId: audit.id, companyId: audit.companyId },
    include: { auditor: { select: { id: true, name: true, email: true, type: true } } },
  })
  if (members.length !== ids.length) throw new AuditPlanError(404, 'One or more audit team members do not belong to this audit')
  if (members.some((member) => !member.isActive)) throw new AuditPlanError(409, 'Only active audit team members can be assigned to activities')
  return members
}

const assertActivityProcess = async (db: AuditPlanDb, audit: AuditContext, processId: string | null | undefined) => {
  if (!processId) return
  const process = await db.process.findUnique({ where: { id: processId }, select: { id: true, companyId: true } })
  if (!process || process.companyId !== audit.companyId) throw new AuditPlanError(404, 'Activity process not found')
  if (process.id !== audit.processId) {
    const relation = await db.auditProcess.findFirst({ where: { auditId: audit.id, processId: process.id }, select: { auditId: true } })
    if (!relation) throw new AuditPlanError(409, 'Activity process is not related to this audit')
  }
}

const assertNoActivityOverlap = async (db: AuditPlanDb, planId: string, start: Date, end: Date, excludedId?: string) => {
  const overlap = await db.auditPlanActivity.findFirst({
    where: {
      auditPlanId: planId,
      status: { not: 'CANCELLED' },
      ...(excludedId ? { id: { not: excludedId } } : {}),
      scheduledStart: { lt: end },
      scheduledEnd: { gt: start },
    },
    select: { id: true, title: true },
  })
  if (overlap) throw new AuditPlanError(409, `Activity overlaps with "${overlap.title}"`)
}

const assertPlanReady = async (db: AuditPlanDb, audit: AuditContext, plan: PlanWithRelations) => {
  const activities = plan.activities.filter((activity) => activity.status !== 'CANCELLED')
  if (activities.length === 0) throw new AuditPlanError(409, 'An audit plan needs at least one active agenda activity')
  const warnings: string[] = []
  for (const activity of activities) {
    const assignments = activity.auditorAssignments ?? []
    if (assignments.length === 0) throw new AuditPlanError(409, `Activity "${activity.title}" needs at least one active audit team member`)
    for (const assignment of assignments) {
      const member = assignment.auditTeamMember
      if (!member.isActive) throw new AuditPlanError(409, `Activity "${activity.title}" has a retired audit team member assigned`)
      if (member.independenceStatus === 'PENDING' || member.independenceStatus === 'CONFLICT') {
        throw new AuditPlanError(409, `Activity "${activity.title}" has an audit team member with unresolved independence`)
      }
      if (member.independenceStatus === 'MITIGATED') {
        warnings.push(`Actividad "${activity.title}": ${member.auditor.name} está Mitigado. Medidas: ${member.mitigationMeasures?.trim() || 'sin medidas registradas'}. Requiere revisión profesional.`)
      }
    }
  }
  const team = await db.auditTeamMember.findMany({
    where: { auditId: audit.id, companyId: audit.companyId, isActive: true },
    select: { role: true, independenceStatus: true },
  })
  if (team.length === 0) throw new AuditPlanError(409, 'An audit plan needs an active audit team')
  if (!team.some((member) => member.role === 'LEAD')) throw new AuditPlanError(409, 'An audit plan needs an active lead auditor')
  if (team.some((member) => member.independenceStatus === 'PENDING' || member.independenceStatus === 'CONFLICT')) {
    throw new AuditPlanError(409, 'All active team members must have clear or mitigated independence')
  }
  return warnings
}

const planView = (plan: PlanWithRelations) => ({
  id: plan.id,
  auditId: plan.auditId,
  methodology: plan.methodology,
  samplingMethod: plan.samplingMethod,
  resources: plan.resources,
  notes: plan.notes,
  status: plan.status,
  preparedBy: plan.preparedBy,
  approvedBy: plan.approvedBy,
  approvedAt: plan.approvedAt,
  activities: plan.activities.map((activity) => ({
    id: activity.id,
    auditPlanId: activity.auditPlanId,
    position: activity.position,
    type: activity.type,
    title: activity.title,
    description: activity.description,
    scheduledStart: activity.scheduledStart,
    scheduledEnd: activity.scheduledEnd,
    location: activity.location,
    responsible: activity.responsible,
     process: activity.process,
      execution: {
        actualStart: activity.actualStart,
        actualEnd: activity.actualEnd,
        result: activity.executionResult,
        observations: activity.executionObservations,
        startedBy: activity.startedBy ?? null,
        completedBy: activity.completedBy ?? null,
      },
      resources: {
        checklistItems: (activity.checklistItemLinks ?? []).map((link) => link.item),
        evidences: (activity.evidenceLinks ?? []).map((link) => link.evidence),
        evidenceFiles: (activity.evidenceFileLinks ?? []).map((link) => link.evidenceFile),
        findings: (activity.findingLinks ?? []).map((link) => link.finding),
      },
      auditors: (activity.auditorAssignments ?? []).map((assignment) => ({
       id: assignment.auditTeamMember.id,
       teamMemberId: assignment.auditTeamMember.id,
       auditorId: assignment.auditTeamMember.auditorId,
       name: assignment.auditTeamMember.auditor.name,
       email: assignment.auditTeamMember.auditor.email,
       role: assignment.auditTeamMember.role,
       type: assignment.auditTeamMember.auditor.type,
       independenceStatus: assignment.auditTeamMember.independenceStatus,
       mitigationMeasures: assignment.auditTeamMember.mitigationMeasures,
     })),
     status: activity.status,
    notes: activity.notes,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
  })),
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
})

const activityTransitions: Record<'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED', string[]> = {
  PLANNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

const route = (handler: (request: Request, response: Response) => Promise<void>): RequestHandler => (request, response, next: NextFunction) => {
  Promise.resolve(handler(request, response)).catch((error: unknown) => {
    if (error instanceof AuditPlanError) {
      response.status(error.status).json({ error: error.message })
      return
    }
    next(error)
  })
}

const writeResourceLinkEvents = async (
  db: AuditPlanDb,
  auditId: string,
  planId: string,
  activity: { id: string; title: string },
  request: Request,
  resource: string,
  changes: { addedIds: string[]; removedIds: string[] },
) => {
  if (changes.addedIds.length > 0) {
    await writeAuditEvent(db, {
      auditId,
      eventType: AuditEventType.AUDIT_PLAN_ACTIVITY_RESOURCE_LINKED,
      summary: `Recursos vinculados a la actividad: ${activity.title}`,
      actor: request.user,
      changes: [{ field: resource, previousValue: null, newValue: changes.addedIds }],
      metadata: { planId, activityId: activity.id, resource, resourceIds: changes.addedIds },
    })
  }
  if (changes.removedIds.length > 0) {
    await writeAuditEvent(db, {
      auditId,
      eventType: AuditEventType.AUDIT_PLAN_ACTIVITY_RESOURCE_UNLINKED,
      summary: `Recursos desvinculados de la actividad: ${activity.title}`,
      actor: request.user,
      changes: [{ field: resource, previousValue: changes.removedIds, newValue: null }],
      metadata: { planId, activityId: activity.id, resource, resourceIds: changes.removedIds },
    })
  }
}

type PlanActivity = PlanWithRelations['activities'][number]

const findActivityForExecution = (plan: PlanWithRelations, activityId: string): PlanActivity => {
  const parsedId = idReference.safeParse(activityId)
  if (!parsedId.success) throw new AuditPlanError(400, 'Invalid activity id')
  const activity = plan.activities.find((candidate) => candidate.id === parsedId.data)
  if (!activity) throw new AuditPlanError(404, 'Audit plan activity not found')
  return activity
}

const assertExecutionContext = (audit: AuditContext, plan: PlanWithRelations) => {
  if (audit.status === 'CLOSED' || audit.status === 'CANCELLED') throw new AuditPlanError(409, 'A closed or cancelled audit cannot execute activities')
  if (plan.status !== 'APPROVED') throw new AuditPlanError(409, 'Only an approved audit plan can execute activities')
}

const assertExecutionTeam = (audit: AuditContext, activity: PlanActivity): string[] => {
  const assignments = activity.auditorAssignments ?? []
  if (assignments.length === 0) throw new AuditPlanError(409, 'The activity needs at least one active audit team member')
  const warnings: string[] = []
  for (const assignment of assignments) {
    const member = assignment.auditTeamMember
    if (member.auditId !== audit.id || member.companyId !== audit.companyId) throw new AuditPlanError(404, 'Activity auditor does not belong to this audit')
    if (!member.isActive) throw new AuditPlanError(409, 'Only active audit team members can execute an activity')
    if (member.independenceStatus === 'PENDING' || member.independenceStatus === 'CONFLICT') {
      throw new AuditPlanError(409, 'Activity execution requires resolved auditor independence')
    }
    if (member.independenceStatus === 'MITIGATED') {
      warnings.push(`Auditor ${member.auditor.name} has mitigated independence. Measures: ${member.mitigationMeasures?.trim() || 'none documented'}. Human review remains required.`)
    }
  }
  return warnings
}

const assertActivityCanLinkResources = (activity: PlanActivity) => {
  if (activity.status !== 'IN_PROGRESS') throw new AuditPlanError(409, 'Resources can only be linked while the activity is in progress')
}

type ActivityLinkRecord = { id: string; resourceId: string; isActive: boolean }

const syncActivityLinks = async (args: {
  current: ActivityLinkRecord[]
  requestedIds: string[]
  now: Date
  deactivate: (id: string, now: Date) => Promise<unknown>
  reactivate: (id: string, now: Date) => Promise<unknown>
  create: (resourceId: string, now: Date) => Promise<unknown>
}) => {
  const requested = new Set(args.requestedIds)
  const active = new Map(args.current.filter((link) => link.isActive).map((link) => [link.resourceId, link]))
  const addedIds = args.requestedIds.filter((id) => !active.has(id))
  const removedIds = [...active.keys()].filter((id) => !requested.has(id))

  for (const link of active.values()) {
    if (!requested.has(link.resourceId)) await args.deactivate(link.id, args.now)
  }
  for (const resourceId of args.requestedIds) {
    const existing = args.current.find((link) => link.resourceId === resourceId)
    if (existing) {
      if (!existing.isActive) await args.reactivate(existing.id, args.now)
    } else {
      await args.create(resourceId, args.now)
    }
  }
  return { addedIds, removedIds }
}

type AuditPlanServiceArgs = {
  app: Application
  db: PrismaClient
  authMiddleware: RequestHandler
  adminMiddleware: RequestHandler
}

export const registerAuditPlanRoutes = ({ app, db, authMiddleware, adminMiddleware }: AuditPlanServiceArgs): void => {
  app.get('/api/audits/:auditId/plan', authMiddleware, route(async (request, response) => {
    const audit = await findAudit(db, request, String(request.params.auditId))
    const plan = await db.auditPlan.findUnique({ where: { auditId: audit.id }, include: planInclude })
    response.json({ plan: plan ? planView(plan) : null })
  }))

  app.post('/api/audits/:auditId/plan', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditPlanCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit plan data', details: parsed.error.issues })
      return
    }
    try {
      const plan = await runInTransaction(db, async (tx) => {
        const audit = await findAudit(tx, request, String(request.params.auditId))
        assertAuditIsEditable(audit)
        await lockAuditForUpdate(tx, audit.id)
        const existing = await tx.auditPlan.findUnique({ where: { auditId: audit.id }, select: { id: true } })
        if (existing) throw new AuditPlanError(409, 'This audit already has an audit plan')
        const created = await tx.auditPlan.create({
          data: {
            auditId: audit.id,
            methodology: parsed.data.methodology,
            samplingMethod: parsed.data.samplingMethod ?? null,
            resources: parsed.data.resources ?? null,
            notes: parsed.data.notes ?? null,
            preparedById: request.user?.id ?? null,
          },
          include: planInclude,
        })
        await writeAuditEvent(tx, {
          auditId: audit.id,
          eventType: AuditEventType.AUDIT_PLAN_CREATED,
          summary: 'Plan de auditoría creado',
          actor: request.user,
          metadata: { planId: created.id },
        })
        return created
      })
      response.status(201).json({ plan: planView(plan) })
    } catch (error) {
      if (error instanceof AuditPlanError) throw error
      if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002') throw new AuditPlanError(409, 'This audit already has an audit plan')
      throw error
    }
  }))

  app.patch('/api/audits/:auditId/plan', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditPlanUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit plan data', details: parsed.error.issues })
      return
    }
    const plan = await runInTransaction(db, async (tx) => {
      const audit = await findAudit(tx, request, String(request.params.auditId))
      assertAuditIsEditable(audit)
      const existing = await findPlan(tx, audit)
      assertPlanIsDraft(existing)
      await lockPlanForUpdate(tx, existing.id)
      const updated = await tx.auditPlan.update({ where: { id: existing.id }, data: parsed.data, include: planInclude })
      await writeAuditEvent(tx, {
        auditId: audit.id,
        eventType: AuditEventType.AUDIT_PLAN_UPDATED,
        summary: 'Plan de auditoría actualizado',
        actor: request.user,
        changes: Object.keys(parsed.data).map((field) => ({ field })),
        metadata: { planId: existing.id },
      })
      return updated
    })
    response.json({ plan: planView(plan) })
  }))

  app.post('/api/audits/:auditId/plan/status', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditPlanStatusChangeSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit plan status data', details: parsed.error.issues })
      return
    }
    let warnings: string[] = []
    const plan = await runInTransaction(db, async (tx) => {
      const audit = await findAudit(tx, request, String(request.params.auditId))
      assertAuditIsEditable(audit)
      await lockAuditForUpdate(tx, audit.id)
      const existing = await findPlan(tx, audit)
      const allowed: Record<string, string[]> = { DRAFT: ['READY', 'CANCELLED'], READY: ['APPROVED', 'CANCELLED'], APPROVED: [], CANCELLED: [] }
      if (!allowed[existing.status].includes(parsed.data.status)) throw new AuditPlanError(409, 'Invalid audit plan status transition')
      if (parsed.data.status === 'READY' || parsed.data.status === 'APPROVED') warnings = await assertPlanReady(tx, audit, existing)
      const updated = await tx.auditPlan.update({
        where: { id: existing.id },
        data: {
          status: parsed.data.status,
          ...(parsed.data.status === 'APPROVED' ? { approvedById: request.user?.id ?? null, approvedAt: new Date() } : {}),
        },
        include: planInclude,
      })
      await writeAuditEvent(tx, {
        auditId: audit.id,
        eventType: AuditEventType.AUDIT_PLAN_STATUS_CHANGED,
        summary: `Estado del plan cambiado a ${parsed.data.status}`,
        actor: request.user,
        changes: [{ field: 'status', previousValue: existing.status, newValue: parsed.data.status }],
        metadata: { planId: existing.id },
      })
      return updated
    })
    response.json({ plan: planView(plan), ...(warnings.length > 0 ? { warnings } : {}) })
  }))

  app.post('/api/audits/:auditId/plan/activities', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditPlanActivityCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit plan activity data', details: parsed.error.issues })
      return
    }
    const plan = await runInTransaction(db, async (tx) => {
      const audit = await findAudit(tx, request, String(request.params.auditId))
      assertAuditIsEditable(audit)
      const existingPlan = await findPlan(tx, audit)
      assertPlanIsDraft(existingPlan)
      await lockPlanForUpdate(tx, existingPlan.id)
      await assertResponsible(tx, parsed.data.responsibleId, audit.companyId)
      await assertActivityProcess(tx, audit, parsed.data.processId)
      await assertNoActivityOverlap(tx, existingPlan.id, parsed.data.scheduledStart, parsed.data.scheduledEnd)
      const position = parsed.data.position ?? (existingPlan.activities.reduce((max, activity) => Math.max(max, activity.position), -1) + 1)
      const createdActivity = await tx.auditPlanActivity.create({
        data: { ...parsed.data, position, auditPlanId: existingPlan.id },
      })
      const updatedPlan = await tx.auditPlan.findUniqueOrThrow({ where: { id: existingPlan.id }, include: planInclude })
      await writeAuditEvent(tx, {
        auditId: audit.id,
        eventType: AuditEventType.AUDIT_PLAN_ACTIVITY_CREATED,
        summary: `Actividad de agenda creada: ${parsed.data.title}`,
        actor: request.user,
        metadata: { planId: existingPlan.id, activityId: createdActivity.id },
      })
      return updatedPlan
    })
    response.status(201).json({ plan: planView(plan) })
  }))

  app.patch('/api/audits/:auditId/plan/activities/:activityId', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditPlanActivityUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit plan activity data', details: parsed.error.issues })
      return
    }
    const plan = await runInTransaction(db, async (tx) => {
      const audit = await findAudit(tx, request, String(request.params.auditId))
      assertAuditIsEditable(audit)
      const existingPlan = await findPlan(tx, audit)
      assertPlanIsDraft(existingPlan)
      await lockPlanForUpdate(tx, existingPlan.id)
      const activityId = idReference.safeParse(String(request.params.activityId))
      if (!activityId.success) throw new AuditPlanError(400, 'Invalid activity id')
      const existing = await tx.auditPlanActivity.findUnique({ where: { id: activityId.data } })
      if (!existing || existing.auditPlanId !== existingPlan.id) throw new AuditPlanError(404, 'Audit plan activity not found')
      const nextStart = parsed.data.scheduledStart ?? existing.scheduledStart
      const nextEnd = parsed.data.scheduledEnd ?? existing.scheduledEnd
      const nextStatus = parsed.data.status ?? existing.status
      if (parsed.data.status !== undefined && parsed.data.status !== existing.status && !activityTransitions[existing.status].includes(nextStatus)) throw new AuditPlanError(409, 'Invalid audit plan activity status transition')
      await assertResponsible(tx, parsed.data.responsibleId === undefined ? existing.responsibleId : parsed.data.responsibleId, audit.companyId)
      await assertActivityProcess(tx, audit, parsed.data.processId === undefined ? existing.processId : parsed.data.processId)
      if (nextStatus !== 'CANCELLED') await assertNoActivityOverlap(tx, existingPlan.id, nextStart, nextEnd, existing.id)
      const updatedActivity = await tx.auditPlanActivity.update({
        where: { id: existing.id },
        data: { ...parsed.data, scheduledStart: nextStart, scheduledEnd: nextEnd },
      })
      const updatedPlan = await tx.auditPlan.findUniqueOrThrow({ where: { id: existingPlan.id }, include: planInclude })
      await writeAuditEvent(tx, {
        auditId: audit.id,
        eventType: AuditEventType.AUDIT_PLAN_ACTIVITY_UPDATED,
        summary: `Actividad de agenda actualizada: ${updatedActivity.title}`,
        actor: request.user,
        changes: Object.keys(parsed.data).map((field) => ({ field })),
        metadata: { planId: existingPlan.id, activityId: existing.id },
      })
      return updatedPlan
    })
    response.json({ plan: planView(plan) })
  }))

  app.put('/api/audits/:auditId/plan/activities/:activityId/auditors', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditPlanActivityAuditorsSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit plan activity auditors data', details: parsed.error.issues })
      return
    }
    const plan = await runInTransaction(db, async (tx) => {
      const audit = await findAudit(tx, request, String(request.params.auditId))
      assertAuditIsEditable(audit)
      const existingPlan = await findPlan(tx, audit)
      assertPlanIsDraft(existingPlan)
      await lockPlanForUpdate(tx, existingPlan.id)
      const activity = await findActivityForPlan(tx, existingPlan, String(request.params.activityId))
      await findActiveAuditTeamMembers(tx, audit, parsed.data.auditTeamMemberIds)

      const existingAssignments = await tx.auditPlanActivityAuditor.findMany({ where: { activityId: activity.id } })
      const requestedIds = new Set(parsed.data.auditTeamMemberIds)
      const activeExistingIds = new Set(existingAssignments.filter((assignment) => assignment.isActive).map((assignment) => assignment.auditTeamMemberId))
      const addedIds = parsed.data.auditTeamMemberIds.filter((id) => !activeExistingIds.has(id))
      const removedIds = [...activeExistingIds].filter((id) => !requestedIds.has(id))
      const now = new Date()

      for (const assignment of existingAssignments) {
        if (assignment.isActive && !requestedIds.has(assignment.auditTeamMemberId)) {
          await tx.auditPlanActivityAuditor.update({
            where: { id: assignment.id },
            data: { isActive: false, removedAt: now, removedById: request.user?.id ?? null },
          })
        }
      }

      for (const teamMemberId of parsed.data.auditTeamMemberIds) {
        const existing = existingAssignments.find((assignment) => assignment.auditTeamMemberId === teamMemberId)
        if (existing) {
          if (!existing.isActive) {
            await tx.auditPlanActivityAuditor.update({
              where: { id: existing.id },
              data: { isActive: true, assignedAt: now, assignedById: request.user?.id ?? null, removedAt: null, removedById: null },
            })
          }
        } else {
          await tx.auditPlanActivityAuditor.create({
            data: { activityId: activity.id, auditTeamMemberId: teamMemberId, assignedById: request.user?.id ?? null },
          })
        }
      }

      if (addedIds.length > 0 || removedIds.length > 0) {
        await writeAuditEvent(tx, {
          auditId: audit.id,
          eventType: AuditEventType.AUDIT_PLAN_ACTIVITY_UPDATED,
          summary: `Auditores de actividad actualizados: ${String(request.params.activityId)}`,
          actor: request.user,
          changes: [{ field: 'auditors', previousValue: [...activeExistingIds], newValue: parsed.data.auditTeamMemberIds }],
          metadata: { planId: existingPlan.id, activityId: activity.id, addedTeamMemberIds: addedIds, removedTeamMemberIds: removedIds },
        })
      }

      return tx.auditPlan.findUniqueOrThrow({ where: { id: existingPlan.id }, include: planInclude })
    })
    response.json({ plan: planView(plan) })
  }))

  app.delete('/api/audits/:auditId/plan/activities/:activityId', authMiddleware, adminMiddleware, route(async (request, response) => {
    await runInTransaction(db, async (tx) => {
      const audit = await findAudit(tx, request, String(request.params.auditId))
      assertAuditIsEditable(audit)
      const existingPlan = await findPlan(tx, audit)
      assertPlanIsDraft(existingPlan)
      await lockPlanForUpdate(tx, existingPlan.id)
      const activityId = idReference.safeParse(String(request.params.activityId))
      if (!activityId.success) throw new AuditPlanError(400, 'Invalid activity id')
      const activity = await tx.auditPlanActivity.findUnique({ where: { id: activityId.data } })
      if (!activity || activity.auditPlanId !== existingPlan.id) throw new AuditPlanError(404, 'Audit plan activity not found')
      await tx.auditPlanActivity.delete({ where: { id: activity.id } })
      await writeAuditEvent(tx, {
        auditId: audit.id,
        eventType: AuditEventType.AUDIT_PLAN_ACTIVITY_DELETED,
        summary: `Actividad de agenda eliminada: ${activity.title}`,
        actor: request.user,
        metadata: { planId: existingPlan.id, activityId: activity.id },
      })
    })
    response.status(204).send()
  }))

  app.post('/api/audits/:auditId/plan/activities/:activityId/execution/start', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditActivityExecutionStartSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid activity execution start data', details: parsed.error.issues })
      return
    }
    let warnings: string[] = []
    const plan = await runInTransaction(db, async (tx) => {
      const audit = await lockAndRefreshAudit(tx, request, String(request.params.auditId))
      const existingPlan = await findPlan(tx, audit)
      assertExecutionContext(audit, existingPlan)
      const activity = findActivityForExecution(existingPlan, String(request.params.activityId))
      if (activity.status !== 'PLANNED') throw new AuditPlanError(409, 'Only a planned activity can be started')
      warnings = assertExecutionTeam(audit, activity)
      const actualStart = new Date()
      await tx.auditPlanActivity.update({
        where: { id: activity.id },
        data: { status: 'IN_PROGRESS', actualStart, startedById: request.user?.id ?? null },
      })
      await writeAuditEvent(tx, {
        auditId: audit.id,
        eventType: AuditEventType.AUDIT_PLAN_ACTIVITY_EXECUTION_STARTED,
        summary: `Ejecución iniciada: ${activity.title}`,
        actor: request.user,
        changes: [
          { field: 'status', previousValue: activity.status, newValue: 'IN_PROGRESS' },
          { field: 'actualStart', previousValue: null, newValue: actualStart.toISOString() },
        ],
        metadata: { planId: existingPlan.id, activityId: activity.id, warnings },
      })
      return tx.auditPlan.findUniqueOrThrow({ where: { id: existingPlan.id }, include: planInclude })
    })
    response.json({ plan: planView(plan), ...(warnings.length > 0 ? { warnings } : {}) })
  }))

  app.patch('/api/audits/:auditId/plan/activities/:activityId/execution', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditActivityExecutionUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid activity execution data', details: parsed.error.issues })
      return
    }
    const plan = await runInTransaction(db, async (tx) => {
      const audit = await lockAndRefreshAudit(tx, request, String(request.params.auditId))
      const existingPlan = await findPlan(tx, audit)
      assertExecutionContext(audit, existingPlan)
      const activity = findActivityForExecution(existingPlan, String(request.params.activityId))
      if (activity.status !== 'IN_PROGRESS') throw new AuditPlanError(409, 'Only an in-progress activity can be updated')
      const changes: Array<Record<string, unknown>> = []
      if (parsed.data.executionResult !== undefined && parsed.data.executionResult !== activity.executionResult) {
        changes.push({ field: 'executionResult', previousValue: activity.executionResult, newValue: parsed.data.executionResult })
      }
      if (parsed.data.executionObservations !== undefined && parsed.data.executionObservations !== activity.executionObservations) {
        changes.push({ field: 'executionObservations', previousValue: activity.executionObservations, newValue: parsed.data.executionObservations })
      }
      if (changes.length > 0) {
        await tx.auditPlanActivity.update({ where: { id: activity.id }, data: parsed.data })
        await writeAuditEvent(tx, {
          auditId: audit.id,
          eventType: AuditEventType.AUDIT_PLAN_ACTIVITY_EXECUTION_UPDATED,
          summary: `Ejecución actualizada: ${activity.title}`,
          actor: request.user,
          changes,
          metadata: { planId: existingPlan.id, activityId: activity.id },
        })
      }
      return tx.auditPlan.findUniqueOrThrow({ where: { id: existingPlan.id }, include: planInclude })
    })
    response.json({ plan: planView(plan) })
  }))

  app.post('/api/audits/:auditId/plan/activities/:activityId/execution/complete', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditActivityExecutionCompleteSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid activity execution completion data', details: parsed.error.issues })
      return
    }
    let warnings: string[] = []
    const plan = await runInTransaction(db, async (tx) => {
      const audit = await lockAndRefreshAudit(tx, request, String(request.params.auditId))
      const existingPlan = await findPlan(tx, audit)
      assertExecutionContext(audit, existingPlan)
      const activity = findActivityForExecution(existingPlan, String(request.params.activityId))
      if (activity.status !== 'IN_PROGRESS') throw new AuditPlanError(409, 'Only an in-progress activity can be completed')
      if (!activity.actualStart) throw new AuditPlanError(409, 'An activity must have an actual start before it can be completed')
      warnings = assertExecutionTeam(audit, activity)
      const actualEnd = new Date()
      if (actualEnd <= activity.actualStart) throw new AuditPlanError(409, 'Activity end must be after its actual start')
      await tx.auditPlanActivity.update({
        where: { id: activity.id },
        data: {
          status: 'COMPLETED',
          actualEnd,
          executionResult: parsed.data.executionResult,
          ...(parsed.data.executionObservations !== undefined ? { executionObservations: parsed.data.executionObservations } : {}),
          completedById: request.user?.id ?? null,
        },
      })
      await writeAuditEvent(tx, {
        auditId: audit.id,
        eventType: AuditEventType.AUDIT_PLAN_ACTIVITY_EXECUTION_COMPLETED,
        summary: `Ejecución completada: ${activity.title}`,
        actor: request.user,
        changes: [
          { field: 'status', previousValue: activity.status, newValue: 'COMPLETED' },
          { field: 'executionResult', previousValue: activity.executionResult, newValue: parsed.data.executionResult },
          ...(parsed.data.executionObservations !== undefined ? [{ field: 'executionObservations', previousValue: activity.executionObservations, newValue: parsed.data.executionObservations }] : []),
          { field: 'actualEnd', previousValue: null, newValue: actualEnd.toISOString() },
        ],
        metadata: { planId: existingPlan.id, activityId: activity.id, warnings },
      })
      return tx.auditPlan.findUniqueOrThrow({ where: { id: existingPlan.id }, include: planInclude })
    })
    response.json({ plan: planView(plan), ...(warnings.length > 0 ? { warnings } : {}) })
  }))

  app.post('/api/audits/:auditId/plan/activities/:activityId/execution/cancel', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditActivityExecutionCancelSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid activity execution cancellation data', details: parsed.error.issues })
      return
    }
    const plan = await runInTransaction(db, async (tx) => {
      const audit = await lockAndRefreshAudit(tx, request, String(request.params.auditId))
      const existingPlan = await findPlan(tx, audit)
      assertExecutionContext(audit, existingPlan)
      const activity = findActivityForExecution(existingPlan, String(request.params.activityId))
      if (activity.status !== 'PLANNED' && activity.status !== 'IN_PROGRESS') throw new AuditPlanError(409, 'Only a planned or in-progress activity can be cancelled')
      await tx.auditPlanActivity.update({
        where: { id: activity.id },
        data: { status: 'CANCELLED', ...(parsed.data.executionObservations !== undefined ? { executionObservations: parsed.data.executionObservations } : {}) },
      })
      await writeAuditEvent(tx, {
        auditId: audit.id,
        eventType: AuditEventType.AUDIT_PLAN_ACTIVITY_EXECUTION_CANCELLED,
        summary: `Ejecución cancelada: ${activity.title}`,
        actor: request.user,
        changes: [
          { field: 'status', previousValue: activity.status, newValue: 'CANCELLED' },
          ...(parsed.data.executionObservations !== undefined ? [{ field: 'executionObservations', previousValue: activity.executionObservations, newValue: parsed.data.executionObservations }] : []),
        ],
        metadata: { planId: existingPlan.id, activityId: activity.id },
      })
      return tx.auditPlan.findUniqueOrThrow({ where: { id: existingPlan.id }, include: planInclude })
    })
    response.json({ plan: planView(plan) })
  }))

  const replaceActivityLinks = (resource: 'checklistItems' | 'evidences' | 'evidenceFiles' | 'findings') =>
    route(async (request, response) => {
      const field = resource === 'checklistItems' ? 'itemIds' : resource === 'evidences' ? 'evidenceIds' : resource === 'evidenceFiles' ? 'evidenceFileIds' : 'findingIds'
      const parsed = auditActivityResourceLinkSchema(field).safeParse(request.body)
      if (!parsed.success) {
        response.status(400).json({ error: 'Invalid activity resource links', details: parsed.error.issues })
        return
      }
      const ids = (parsed.data as Record<string, string[]>)[field]
      const plan = await runInTransaction(db, async (tx) => {
        const audit = await lockAndRefreshAudit(tx, request, String(request.params.auditId))
        const existingPlan = await findPlan(tx, audit)
        assertExecutionContext(audit, existingPlan)
        const activity = findActivityForExecution(existingPlan, String(request.params.activityId))
        assertActivityCanLinkResources(activity)
        const now = new Date()

        if (resource === 'checklistItems') {
          const targets = await tx.auditChecklistItem.findMany({ where: { id: { in: ids }, checklist: { auditId: audit.id } }, select: { id: true } })
          if (targets.length !== ids.length) throw new AuditPlanError(404, 'One or more checklist items do not belong to this audit')
          const current = await tx.auditPlanActivityChecklistItem.findMany({ where: { activityId: activity.id } })
          const changes = await syncActivityLinks({
            current: current.map((link) => ({ id: link.id, resourceId: link.itemId, isActive: link.isActive })),
            requestedIds: ids,
            now,
            deactivate: (id, date) => tx.auditPlanActivityChecklistItem.update({ where: { id }, data: { isActive: false, removedAt: date } }),
            reactivate: (id, date) => tx.auditPlanActivityChecklistItem.update({ where: { id }, data: { isActive: true, linkedAt: date, removedAt: null } }),
            create: (itemId, date) => tx.auditPlanActivityChecklistItem.create({ data: { activityId: activity.id, itemId, linkedAt: date } }),
          })
          await writeResourceLinkEvents(tx, audit.id, existingPlan.id, activity, request, resource, changes)
        } else if (resource === 'evidences') {
          const targets = await tx.auditEvidence.findMany({ where: { id: { in: ids }, auditId: audit.id }, select: { id: true } })
          if (targets.length !== ids.length) throw new AuditPlanError(404, 'One or more evidences do not belong to this audit')
          const current = await tx.auditPlanActivityEvidence.findMany({ where: { activityId: activity.id } })
          const changes = await syncActivityLinks({
            current: current.map((link) => ({ id: link.id, resourceId: link.evidenceId, isActive: link.isActive })),
            requestedIds: ids,
            now,
            deactivate: (id, date) => tx.auditPlanActivityEvidence.update({ where: { id }, data: { isActive: false, removedAt: date } }),
            reactivate: (id, date) => tx.auditPlanActivityEvidence.update({ where: { id }, data: { isActive: true, linkedAt: date, removedAt: null } }),
            create: (evidenceId, date) => tx.auditPlanActivityEvidence.create({ data: { activityId: activity.id, evidenceId, linkedAt: date } }),
          })
          await writeResourceLinkEvents(tx, audit.id, existingPlan.id, activity, request, resource, changes)
        } else if (resource === 'evidenceFiles') {
          const targets = await tx.auditEvidenceFile.findMany({ where: { id: { in: ids }, auditId: audit.id }, select: { id: true } })
          if (targets.length !== ids.length) throw new AuditPlanError(404, 'One or more evidence files do not belong to this audit')
          const current = await tx.auditPlanActivityEvidenceFile.findMany({ where: { activityId: activity.id } })
          const changes = await syncActivityLinks({
            current: current.map((link) => ({ id: link.id, resourceId: link.evidenceFileId, isActive: link.isActive })),
            requestedIds: ids,
            now,
            deactivate: (id, date) => tx.auditPlanActivityEvidenceFile.update({ where: { id }, data: { isActive: false, removedAt: date } }),
            reactivate: (id, date) => tx.auditPlanActivityEvidenceFile.update({ where: { id }, data: { isActive: true, linkedAt: date, removedAt: null } }),
            create: (evidenceFileId, date) => tx.auditPlanActivityEvidenceFile.create({ data: { activityId: activity.id, evidenceFileId, linkedAt: date } }),
          })
          await writeResourceLinkEvents(tx, audit.id, existingPlan.id, activity, request, resource, changes)
        } else {
          const targets = await tx.auditFinding.findMany({ where: { id: { in: ids }, auditId: audit.id }, select: { id: true } })
          if (targets.length !== ids.length) throw new AuditPlanError(404, 'One or more findings do not belong to this audit')
          const current = await tx.auditPlanActivityFinding.findMany({ where: { activityId: activity.id } })
          const changes = await syncActivityLinks({
            current: current.map((link) => ({ id: link.id, resourceId: link.findingId, isActive: link.isActive })),
            requestedIds: ids,
            now,
            deactivate: (id, date) => tx.auditPlanActivityFinding.update({ where: { id }, data: { isActive: false, removedAt: date } }),
            reactivate: (id, date) => tx.auditPlanActivityFinding.update({ where: { id }, data: { isActive: true, linkedAt: date, removedAt: null } }),
            create: (findingId, date) => tx.auditPlanActivityFinding.create({ data: { activityId: activity.id, findingId, linkedAt: date } }),
          })
          await writeResourceLinkEvents(tx, audit.id, existingPlan.id, activity, request, resource, changes)
        }
        return tx.auditPlan.findUniqueOrThrow({ where: { id: existingPlan.id }, include: planInclude })
      })
      response.json({ plan: planView(plan) })
    })

  app.put('/api/audits/:auditId/plan/activities/:activityId/execution/checklist-items', authMiddleware, adminMiddleware, replaceActivityLinks('checklistItems'))
  app.put('/api/audits/:auditId/plan/activities/:activityId/execution/evidences', authMiddleware, adminMiddleware, replaceActivityLinks('evidences'))
  app.put('/api/audits/:auditId/plan/activities/:activityId/execution/evidence-files', authMiddleware, adminMiddleware, replaceActivityLinks('evidenceFiles'))
  app.put('/api/audits/:auditId/plan/activities/:activityId/execution/findings', authMiddleware, adminMiddleware, replaceActivityLinks('findings'))
}
