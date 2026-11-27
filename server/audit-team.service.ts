import type { Application, NextFunction, Request, RequestHandler, Response } from 'express'
import { AuditEventType, Prisma, type PrismaClient } from '@prisma/client'
import {
  auditTeamAssignmentCreateSchema,
  auditTeamAssignmentUpdateSchema,
  auditTeamIndependenceSchema,
  idReference,
} from './validation.js'

const teamMemberInclude = {
  auditor: {
    include: { competencies: { orderBy: [{ name: 'asc' }] } },
  },
  assignedBy: { select: { id: true, name: true, email: true, isActive: true } },
  removedBy: { select: { id: true, name: true, email: true, isActive: true } },
  independenceEvaluatedBy: { select: { id: true, name: true, email: true, isActive: true } },
} satisfies Prisma.AuditTeamMemberInclude

type AuditTeamMemberWithRelations = Prisma.AuditTeamMemberGetPayload<{ include: typeof teamMemberInclude }>
type AuditTeamAudit = Prisma.AuditGetPayload<{ select: { id: true; process: { select: { companyId: true } } } }>
type AuditTeamActor = { id: string; name: string; email: string } | null | undefined
type AuditIndependenceStatus = 'PENDING' | 'CLEAR' | 'CONFLICT' | 'MITIGATED'

type AuditTeamServiceArgs = {
  app: Application
  db: PrismaClient
  authMiddleware: RequestHandler
  adminMiddleware: RequestHandler
}

class AuditTeamError extends Error {
  readonly status: 400 | 403 | 404 | 409

  constructor(status: 400 | 403 | 404 | 409, message: string) {
    super(message)
    this.status = status
    this.name = 'AuditTeamError'
  }
}

type AuditTeamClient = PrismaClient | Prisma.TransactionClient

const canAccessCompany = (request: Request, companyId: string): boolean =>
  request.user?.role === 'SUPERUSER' || request.user?.companyId === companyId

const runInTransaction = <T>(db: PrismaClient, operation: (client: Prisma.TransactionClient) => Promise<T>): Promise<T> => db.$transaction(operation)

const isUniqueConflict = (error: unknown): boolean => Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002')

const actorFields = (actor: AuditTeamActor) => actor
  ? { actorId: actor.id, actorName: actor.name || null, actorEmail: actor.email || null }
  : { actorId: null, actorName: null, actorEmail: null }

const auditEventWrite = (db: AuditTeamClient, data: {
  auditId: string
  eventType: AuditEventType
  summary: string
  actor: AuditTeamActor
  changes?: Array<Record<string, unknown>>
  metadata?: Record<string, unknown>
}) => db.auditEvent.create({
  data: {
    auditId: data.auditId,
    eventType: data.eventType,
    summary: data.summary,
    ...(data.changes && data.changes.length > 0 ? { changes: data.changes as unknown as Prisma.InputJsonValue } : {}),
    ...(data.metadata ? { metadata: data.metadata as unknown as Prisma.InputJsonValue } : {}),
    ...actorFields(data.actor),
  },
})

const lockAuditForUpdate = async (db: AuditTeamClient, auditId: string) => {
  if (typeof db.$queryRaw === 'function') await db.$queryRaw`SELECT "id" FROM "Audit" WHERE "id" = ${auditId} FOR UPDATE`
}

const findAudit = async (db: AuditTeamClient, request: Request, auditId: string): Promise<AuditTeamAudit> => {
  const parsedId = idReference.safeParse(auditId)
  if (!parsedId.success) throw new AuditTeamError(400, 'Invalid audit id')
  const audit = await db.audit.findUnique({
    where: { id: parsedId.data },
    select: { id: true, process: { select: { companyId: true } } },
  })
  if (!audit || !canAccessCompany(request, audit.process.companyId)) throw new AuditTeamError(404, 'Audit not found')
  return audit
}

const findMember = async (db: AuditTeamClient, audit: AuditTeamAudit, memberId: string, activeOnly = false): Promise<AuditTeamMemberWithRelations> => {
  const parsedId = idReference.safeParse(memberId)
  if (!parsedId.success) throw new AuditTeamError(400, 'Invalid team member id')
  const member = await db.auditTeamMember.findUnique({ where: { id: parsedId.data }, include: teamMemberInclude })
  if (!member || member.auditId !== audit.id || member.companyId !== audit.process.companyId || (activeOnly && !member.isActive)) {
    throw new AuditTeamError(404, 'Audit team member not found')
  }
  return member
}

const findAvailableAuditor = async (db: AuditTeamClient, request: Request, audit: AuditTeamAudit, auditorId: string) => {
  const parsedId = idReference.safeParse(auditorId)
  if (!parsedId.success) throw new AuditTeamError(400, 'Invalid auditor id')
  const auditor = await db.auditor.findUnique({
    where: { id: parsedId.data },
    include: { competencies: { orderBy: [{ name: 'asc' }] } },
  })
  if (!auditor || auditor.companyId !== audit.process.companyId || !canAccessCompany(request, auditor.companyId)) {
    throw new AuditTeamError(404, 'Auditor not found')
  }
  if (auditor.status !== 'AVAILABLE') throw new AuditTeamError(409, 'Only available auditors can be assigned')
  return auditor
}

const memberView = (member: AuditTeamMemberWithRelations) => ({
  id: member.id,
  auditId: member.auditId,
  auditorId: member.auditorId,
  companyId: member.companyId,
  role: member.role,
  assignedAt: member.assignedAt,
  assignedBy: member.assignedBy,
  observations: member.observations,
  isActive: member.isActive,
  removedAt: member.removedAt,
  removedBy: member.removedBy,
  independenceStatus: member.independenceStatus,
  independenceDeclaration: member.independenceDeclaration,
  conflictDescription: member.conflictDescription,
  mitigationMeasures: member.mitigationMeasures,
  independenceEvaluatedAt: member.independenceEvaluatedAt,
  independenceEvaluatedBy: member.independenceEvaluatedBy,
  createdAt: member.createdAt,
  updatedAt: member.updatedAt,
  auditor: {
    id: member.auditor.id,
    companyId: member.auditor.companyId,
    name: member.auditor.name,
    email: member.auditor.email,
    phone: member.auditor.phone,
    type: member.auditor.type,
    position: member.auditor.position,
    organization: member.auditor.organization,
    experience: member.auditor.experience,
    status: member.auditor.status,
    observations: member.auditor.observations,
    competencies: member.auditor.competencies.map((competency) => ({
      id: competency.id,
      auditorId: competency.auditorId,
      name: competency.name,
      level: competency.level,
      evidence: competency.evidence,
      createdAt: competency.createdAt,
      updatedAt: competency.updatedAt,
    })),
  },
})

const route = (handler: (request: Request, response: Response) => Promise<void>): RequestHandler => (request, response, next: NextFunction) => {
  Promise.resolve(handler(request, response)).catch((error: unknown) => {
    if (error instanceof AuditTeamError) {
      response.status(error.status).json({ error: error.message })
      return
    }
    next(error)
  })
}

export const registerAuditTeamRoutes = ({ app, db, authMiddleware, adminMiddleware }: AuditTeamServiceArgs): void => {
  app.get('/api/audits/:auditId/team', authMiddleware, route(async (request, response) => {
    const audit = await findAudit(db, request, String(request.params.auditId))
    const history = await db.auditTeamMember.findMany({
      where: { auditId: audit.id, companyId: audit.process.companyId },
      include: teamMemberInclude,
      orderBy: [{ assignedAt: 'asc' }],
    })
    response.json({
      members: history.filter((member) => member.isActive).map(memberView),
      history: history.map(memberView),
    })
  }))

  app.post('/api/audits/:auditId/team', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditTeamAssignmentCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit team member data', details: parsed.error.issues })
      return
    }
    try {
      const member = await runInTransaction(db, async (tx) => {
        const audit = await findAudit(tx, request, String(request.params.auditId))
        await lockAuditForUpdate(tx, audit.id)
        const auditor = await findAvailableAuditor(tx, request, audit, parsed.data.auditorId)
        const duplicate = await tx.auditTeamMember.findFirst({ where: { auditId: audit.id, auditorId: auditor.id, isActive: true } })
        if (duplicate) throw new AuditTeamError(409, 'The auditor is already assigned to this audit')
        if (parsed.data.role === 'LEAD') {
          const previousLead = await tx.auditTeamMember.findFirst({ where: { auditId: audit.id, role: 'LEAD', isActive: true } })
          if (previousLead) {
            await tx.auditTeamMember.update({ where: { id: previousLead.id }, data: { role: 'MEMBER' } })
            await auditEventWrite(tx, {
              auditId: audit.id,
              eventType: AuditEventType.TEAM_MEMBER_UPDATED,
              summary: 'Auditor líder reemplazado',
              actor: request.user,
              changes: [{ field: 'role', previousValue: 'LEAD', newValue: 'MEMBER', memberId: previousLead.id }],
            })
          }
        }
        const created = await tx.auditTeamMember.create({
          data: {
            auditId: audit.id,
            auditorId: auditor.id,
            companyId: audit.process.companyId,
            role: parsed.data.role,
            observations: parsed.data.observations ?? null,
            assignedById: request.user?.id ?? null,
            independenceStatus: 'PENDING',
          },
          include: teamMemberInclude,
        })
        await auditEventWrite(tx, {
          auditId: audit.id,
          eventType: AuditEventType.TEAM_MEMBER_ASSIGNED,
          summary: `Auditor ${auditor.name} asignado al equipo`,
          actor: request.user,
          metadata: { memberId: created.id, auditorId: auditor.id, role: parsed.data.role },
        })
        return created
      })
      response.status(201).json({ member: memberView(member) })
    } catch (error) {
      if (error instanceof AuditTeamError) throw error
      if (isUniqueConflict(error)) throw new AuditTeamError(409, 'The auditor or leader is already assigned to this audit')
      throw error
    }
  }))

  app.patch('/api/audits/:auditId/team/:memberId', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditTeamAssignmentUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit team member data', details: parsed.error.issues })
      return
    }
    try {
      const member = await runInTransaction(db, async (tx) => {
        const audit = await findAudit(tx, request, String(request.params.auditId))
        await lockAuditForUpdate(tx, audit.id)
        const existing = await findMember(tx, audit, String(request.params.memberId), true)
        const changes: Array<Record<string, unknown>> = []
        if (parsed.data.role !== undefined && parsed.data.role !== existing.role) {
          if (parsed.data.role === 'LEAD') {
            const previousLead = await tx.auditTeamMember.findFirst({ where: { auditId: audit.id, role: 'LEAD', isActive: true } })
            if (previousLead && previousLead.id !== existing.id) {
              await tx.auditTeamMember.update({ where: { id: previousLead.id }, data: { role: 'MEMBER' } })
              await auditEventWrite(tx, {
                auditId: audit.id,
                eventType: AuditEventType.TEAM_MEMBER_UPDATED,
                summary: 'Auditor líder reemplazado',
                actor: request.user,
                changes: [{ field: 'role', previousValue: 'LEAD', newValue: 'MEMBER', memberId: previousLead.id }],
              })
            }
          }
          changes.push({ field: 'role', previousValue: existing.role, newValue: parsed.data.role })
        }
        if (parsed.data.observations !== undefined && parsed.data.observations !== existing.observations) {
          changes.push({ field: 'observations', previousValue: existing.observations, newValue: parsed.data.observations })
        }
        const updated = await tx.auditTeamMember.update({
          where: { id: existing.id },
          data: {
            ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
            ...(parsed.data.observations !== undefined ? { observations: parsed.data.observations } : {}),
          },
          include: teamMemberInclude,
        })
        await auditEventWrite(tx, {
          auditId: audit.id,
          eventType: AuditEventType.TEAM_MEMBER_UPDATED,
          summary: 'Integrante del equipo actualizado',
          actor: request.user,
          changes,
          metadata: { memberId: existing.id, auditorId: existing.auditorId },
        })
        return updated
      })
      response.json({ member: memberView(member) })
    } catch (error) {
      if (error instanceof AuditTeamError) throw error
      if (isUniqueConflict(error)) throw new AuditTeamError(409, 'The auditor or leader is already assigned to this audit')
      throw error
    }
  }))

  app.delete('/api/audits/:auditId/team/:memberId', authMiddleware, adminMiddleware, route(async (request, response) => {
    const member = await runInTransaction(db, async (tx) => {
      const audit = await findAudit(tx, request, String(request.params.auditId))
      await lockAuditForUpdate(tx, audit.id)
      const existing = await findMember(tx, audit, String(request.params.memberId), true)
      const removed = await tx.auditTeamMember.update({
        where: { id: existing.id },
        data: { isActive: false, removedAt: new Date(), removedById: request.user?.id ?? null },
        include: teamMemberInclude,
      })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: AuditEventType.TEAM_MEMBER_REMOVED,
        summary: 'Integrante retirado del equipo de auditoría',
        actor: request.user,
        metadata: { memberId: existing.id, auditorId: existing.auditorId, role: existing.role },
      })
      return removed
    })
    response.json({ member: memberView(member) })
  }))

  app.patch('/api/audits/:auditId/team/:memberId/independence', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditTeamIndependenceSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid independence evaluation data', details: parsed.error.issues })
      return
    }
    const member = await runInTransaction(db, async (tx) => {
      const audit = await findAudit(tx, request, String(request.params.auditId))
      await lockAuditForUpdate(tx, audit.id)
      const existing = await findMember(tx, audit, String(request.params.memberId), true)
      const declaration = parsed.data.declaration !== undefined ? parsed.data.declaration : existing.independenceDeclaration
      const conflictDescription = parsed.data.conflictDescription !== undefined ? parsed.data.conflictDescription : existing.conflictDescription
      const mitigationMeasures = parsed.data.mitigationMeasures !== undefined ? parsed.data.mitigationMeasures : existing.mitigationMeasures
      const status = parsed.data.status as AuditIndependenceStatus
      if (status !== 'PENDING' && !declaration?.trim()) throw new AuditTeamError(400, 'An independence declaration is required')
      if ((status === 'CONFLICT' || status === 'MITIGATED') && !conflictDescription?.trim()) throw new AuditTeamError(400, 'A conflict description is required')
      if (status === 'MITIGATED' && !mitigationMeasures?.trim()) throw new AuditTeamError(400, 'Mitigation measures are required')
      const changes: Array<Record<string, unknown>> = [{ field: 'independenceStatus', previousValue: existing.independenceStatus, newValue: status }]
      if (parsed.data.declaration !== undefined && parsed.data.declaration !== existing.independenceDeclaration) changes.push({ field: 'independenceDeclaration', previousValue: existing.independenceDeclaration, newValue: parsed.data.declaration })
      if (parsed.data.conflictDescription !== undefined && parsed.data.conflictDescription !== existing.conflictDescription) changes.push({ field: 'conflictDescription', previousValue: existing.conflictDescription, newValue: parsed.data.conflictDescription })
      if (parsed.data.mitigationMeasures !== undefined && parsed.data.mitigationMeasures !== existing.mitigationMeasures) changes.push({ field: 'mitigationMeasures', previousValue: existing.mitigationMeasures, newValue: parsed.data.mitigationMeasures })
      const updated = await tx.auditTeamMember.update({
        where: { id: existing.id },
        data: {
          independenceStatus: status,
          ...(parsed.data.declaration !== undefined ? { independenceDeclaration: parsed.data.declaration } : {}),
          ...(parsed.data.conflictDescription !== undefined ? { conflictDescription: parsed.data.conflictDescription } : {}),
          ...(parsed.data.mitigationMeasures !== undefined ? { mitigationMeasures: parsed.data.mitigationMeasures } : {}),
          independenceEvaluatedAt: new Date(),
          independenceEvaluatedById: request.user?.id ?? null,
        },
        include: teamMemberInclude,
      })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: AuditEventType.INDEPENDENCE_EVALUATED,
        summary: `Independencia evaluada: ${status}`,
        actor: request.user,
        changes,
        metadata: { memberId: existing.id, auditorId: existing.auditorId, status },
      })
      return updated
    })
    response.json({ member: memberView(member) })
  }))
}
