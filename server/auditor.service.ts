import type { Application, NextFunction, Request, RequestHandler, Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import {
  auditorCompetencyCreateSchema,
  auditorCompetencyUpdateSchema,
  auditorCreateSchema,
  auditorQuerySchema,
  auditorUpdateSchema,
  idReference,
} from './validation.js'

type AuditorPerson = { id: string; name: string; email: string; isActive: boolean }
type AuditorCompetencyRecord = {
  id: string
  auditorId: string
  name: string
  nameKey: string
  level: number
  evidence: string | null
  createdAt: Date
  updatedAt: Date
}
type AuditorRecord = {
  id: string
  companyId: string
  name: string
  email: string
  phone: string | null
  type: 'INTERNAL' | 'EXTERNAL'
  position: string | null
  organization: string | null
  experience: string | null
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'INACTIVE'
  observations: string | null
  createdById: string | null
  createdBy: AuditorPerson | null
  competencies: AuditorCompetencyRecord[]
  createdAt: Date
  updatedAt: Date
}

type AuditorDelegate = {
  findMany: (args?: Record<string, unknown>) => Promise<AuditorRecord[]>
  findUnique: (args: Record<string, unknown>) => Promise<AuditorRecord | null>
  create: (args: Record<string, unknown>) => Promise<AuditorRecord>
  update: (args: Record<string, unknown>) => Promise<AuditorRecord>
}

type AuditorCompetencyDelegate = {
  findMany: (args?: Record<string, unknown>) => Promise<AuditorCompetencyRecord[]>
  findUnique: (args: Record<string, unknown>) => Promise<AuditorCompetencyRecord | null>
  create: (args: Record<string, unknown>) => Promise<AuditorCompetencyRecord>
  update: (args: Record<string, unknown>) => Promise<AuditorCompetencyRecord>
  delete: (args: Record<string, unknown>) => Promise<unknown>
}

type AuditorCompanyDelegate = {
  findUnique: (args: Record<string, unknown>) => Promise<{ id: string } | null>
}

type AuditorDb = {
  auditor: AuditorDelegate
  auditorCompetency: AuditorCompetencyDelegate
  company: AuditorCompanyDelegate
  $transaction?: <T>(operation: (client: AuditorDb) => Promise<T>) => Promise<T>
}

type AuditorServiceArgs = {
  app: Application
  db: PrismaClient
  authMiddleware: RequestHandler
  adminMiddleware: RequestHandler
}

const auditorInclude = {
  createdBy: { select: { id: true, name: true, email: true, isActive: true } },
  competencies: { orderBy: [{ name: 'asc' }] },
}

class AuditorError extends Error {
  readonly status: 400 | 403 | 404 | 409

  constructor(status: 400 | 403 | 404 | 409, message: string) {
    super(message)
    this.status = status
    this.name = 'AuditorError'
  }
}

const asDb = (db: PrismaClient): AuditorDb => db as unknown as AuditorDb
const isUniqueConflict = (error: unknown): boolean => Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002')
const normalizeCompetencyName = (name: string) => name.trim().toLowerCase()
const canAccessCompany = (request: Request, companyId: string): boolean => request.user?.role === 'SUPERUSER' || request.user?.companyId === companyId

const companyForWrite = async (db: AuditorDb, request: Request, requestedCompanyId?: string): Promise<string> => {
  if (request.user?.role === 'SUPERUSER') {
    if (!requestedCompanyId) throw new AuditorError(400, 'companyId is required for a superuser')
    const company = await db.company.findUnique({ where: { id: requestedCompanyId }, select: { id: true } })
    if (!company) throw new AuditorError(404, 'Company not found')
    return company.id
  }
  const ownCompanyId = request.user?.companyId
  if (!ownCompanyId) throw new AuditorError(403, 'The user is not assigned to a company')
  if (requestedCompanyId && requestedCompanyId !== ownCompanyId) throw new AuditorError(403, 'You can only manage auditors in your own company')
  return ownCompanyId
}

const companyForQuery = async (db: AuditorDb, request: Request, requestedCompanyId?: string): Promise<string | undefined> => {
  if (requestedCompanyId && request.user?.role !== 'SUPERUSER' && !canAccessCompany(request, requestedCompanyId)) {
    throw new AuditorError(404, 'Company not found')
  }
  if (requestedCompanyId) {
    const company = await db.company.findUnique({ where: { id: requestedCompanyId }, select: { id: true } })
    if (!company) throw new AuditorError(404, 'Company not found')
  }
  if (request.user?.role === 'SUPERUSER') return requestedCompanyId
  if (!request.user?.companyId) throw new AuditorError(403, 'The user is not assigned to a company')
  return request.user.companyId
}

const findAuditor = async (db: AuditorDb, request: Request, auditorId: string): Promise<AuditorRecord> => {
  const parsedId = idReference.safeParse(auditorId)
  if (!parsedId.success) throw new AuditorError(400, 'Invalid auditor id')
  const auditor = await db.auditor.findUnique({ where: { id: parsedId.data }, include: auditorInclude })
  if (!auditor || !canAccessCompany(request, auditor.companyId)) throw new AuditorError(404, 'Auditor not found')
  return auditor
}

const viewCompetency = (competency: AuditorCompetencyRecord) => ({
  id: competency.id,
  auditorId: competency.auditorId,
  name: competency.name,
  level: competency.level,
  evidence: competency.evidence,
  createdAt: competency.createdAt,
  updatedAt: competency.updatedAt,
})

const viewAuditor = (auditor: AuditorRecord) => ({
  id: auditor.id,
  companyId: auditor.companyId,
  name: auditor.name,
  email: auditor.email,
  phone: auditor.phone,
  type: auditor.type,
  position: auditor.position,
  organization: auditor.organization,
  experience: auditor.experience,
  status: auditor.status,
  observations: auditor.observations,
  createdById: auditor.createdById,
  createdBy: auditor.createdBy,
  competencies: (auditor.competencies ?? []).map(viewCompetency),
  createdAt: auditor.createdAt,
  updatedAt: auditor.updatedAt,
})

const route = (handler: (request: Request, response: Response) => Promise<void>): RequestHandler => (request, response, next: NextFunction) => {
  Promise.resolve(handler(request, response)).catch((error: unknown) => {
    if (error instanceof AuditorError) {
      response.status(error.status).json({ error: error.message })
      return
    }
    next(error)
  })
}

export const registerAuditorRoutes = ({ app, db: rawDb, authMiddleware, adminMiddleware }: AuditorServiceArgs): void => {
  const db = asDb(rawDb)

  app.get('/api/auditors', authMiddleware, route(async (request, response) => {
    const parsed = auditorQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid auditor query', details: parsed.error.issues })
      return
    }
    const companyId = await companyForQuery(db, request, parsed.data.companyId)
    const auditors = await db.auditor.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        ...(parsed.data.type ? { type: parsed.data.type } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.search ? { OR: [{ name: { contains: parsed.data.search, mode: 'insensitive' } }, { email: { contains: parsed.data.search, mode: 'insensitive' } }, { organization: { contains: parsed.data.search, mode: 'insensitive' } }] } : {}),
      },
      include: auditorInclude,
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    })
    response.json({ auditors: auditors.map(viewAuditor) })
  }))

  app.get('/api/auditors/:auditorId/competencies', authMiddleware, route(async (request, response) => {
    const auditor = await findAuditor(db, request, String(request.params.auditorId))
    const competencies = await db.auditorCompetency.findMany({ where: { auditorId: auditor.id }, orderBy: [{ name: 'asc' }] })
    response.json({ competencies: competencies.map(viewCompetency) })
  }))

  app.post('/api/auditors/:auditorId/competencies', authMiddleware, adminMiddleware, route(async (request, response) => {
    const auditor = await findAuditor(db, request, String(request.params.auditorId))
    const parsed = auditorCompetencyCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid auditor competency data', details: parsed.error.issues })
      return
    }
    const nameKey = normalizeCompetencyName(parsed.data.name)
    try {
      const competency = await db.auditorCompetency.create({ data: { auditorId: auditor.id, name: parsed.data.name, nameKey, level: parsed.data.level, evidence: parsed.data.evidence ?? null } })
      response.status(201).json({ competency: viewCompetency(competency) })
    } catch (error) {
      if (isUniqueConflict(error)) throw new AuditorError(409, 'This competency is already registered for the auditor')
      throw error
    }
  }))

  app.patch('/api/auditors/:auditorId/competencies/:competencyId', authMiddleware, adminMiddleware, route(async (request, response) => {
    const auditor = await findAuditor(db, request, String(request.params.auditorId))
    const parsed = auditorCompetencyUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid auditor competency data', details: parsed.error.issues })
      return
    }
    const competencyId = idReference.safeParse(String(request.params.competencyId))
    if (!competencyId.success) throw new AuditorError(400, 'Invalid auditor competency id')
    const existing = await db.auditorCompetency.findUnique({ where: { id: competencyId.data } })
    if (!existing || existing.auditorId !== auditor.id) throw new AuditorError(404, 'Auditor competency not found')
    const data: Record<string, unknown> = {}
    if (parsed.data.name !== undefined) {
      data.name = parsed.data.name
      data.nameKey = normalizeCompetencyName(parsed.data.name)
    }
    if (parsed.data.level !== undefined) data.level = parsed.data.level
    if (parsed.data.evidence !== undefined) data.evidence = parsed.data.evidence ?? null
    try {
      const competency = await db.auditorCompetency.update({ where: { id: existing.id }, data })
      response.json({ competency: viewCompetency(competency) })
    } catch (error) {
      if (isUniqueConflict(error)) throw new AuditorError(409, 'This competency is already registered for the auditor')
      throw error
    }
  }))

  app.delete('/api/auditors/:auditorId/competencies/:competencyId', authMiddleware, adminMiddleware, route(async (request, response) => {
    const auditor = await findAuditor(db, request, String(request.params.auditorId))
    const competencyId = idReference.safeParse(String(request.params.competencyId))
    if (!competencyId.success) throw new AuditorError(400, 'Invalid auditor competency id')
    const existing = await db.auditorCompetency.findUnique({ where: { id: competencyId.data } })
    if (!existing || existing.auditorId !== auditor.id) throw new AuditorError(404, 'Auditor competency not found')
    await db.auditorCompetency.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.get('/api/auditors/:auditorId', authMiddleware, route(async (request, response) => {
    const auditor = await findAuditor(db, request, String(request.params.auditorId))
    response.json({ auditor: viewAuditor(auditor) })
  }))

  app.post('/api/auditors', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditorCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid auditor data', details: parsed.error.issues })
      return
    }
    const companyId = await companyForWrite(db, request, parsed.data.companyId)
    try {
      const auditor = await db.auditor.create({
        data: {
          companyId,
          name: parsed.data.name,
          email: parsed.data.email,
          phone: parsed.data.phone ?? null,
          type: parsed.data.type,
          position: parsed.data.position ?? null,
          organization: parsed.data.organization ?? null,
          experience: parsed.data.experience ?? null,
          status: parsed.data.status ?? 'AVAILABLE',
          observations: parsed.data.observations ?? null,
          createdById: request.user!.id,
        },
        include: auditorInclude,
      })
      response.status(201).json({ auditor: viewAuditor(auditor) })
    } catch (error) {
      if (isUniqueConflict(error)) throw new AuditorError(409, 'An auditor with this email already exists in the company')
      throw error
    }
  }))

  app.patch('/api/auditors/:auditorId', authMiddleware, adminMiddleware, route(async (request, response) => {
    const auditor = await findAuditor(db, request, String(request.params.auditorId))
    const parsed = auditorUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid auditor data', details: parsed.error.issues })
      return
    }
    const data: Record<string, unknown> = {}
    for (const field of ['name', 'email', 'phone', 'type', 'position', 'organization', 'experience', 'status', 'observations'] as const) {
      if (parsed.data[field] !== undefined) data[field] = parsed.data[field] ?? null
    }
    try {
      const updated = await db.auditor.update({ where: { id: auditor.id }, data, include: auditorInclude })
      response.json({ auditor: viewAuditor(updated) })
    } catch (error) {
      if (isUniqueConflict(error)) throw new AuditorError(409, 'An auditor with this email already exists in the company')
      throw error
    }
  }))

  app.post('/api/auditors/:auditorId/deactivate', authMiddleware, adminMiddleware, route(async (request, response) => {
    const auditor = await findAuditor(db, request, String(request.params.auditorId))
    const updated = await db.auditor.update({ where: { id: auditor.id }, data: { status: 'INACTIVE' }, include: auditorInclude })
    response.json({ auditor: viewAuditor(updated) })
  }))
}
