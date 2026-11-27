import type { Application, NextFunction, Request, RequestHandler, Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import {
  auditProgramAuditLinkSchema,
  auditProgramCodeQuerySchema,
  auditProgramCreateSchema,
  auditProgramQuerySchema,
  auditProgramStatusChangeSchema,
  auditProgramUpdateSchema,
  idReference,
} from './validation.js'

export const auditProgramStatuses = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const
export type AuditProgramStatus = typeof auditProgramStatuses[number]
type AuditStatus = 'PLANNED' | 'IN_PROGRESS' | 'CLOSED' | 'CANCELLED'

type AuditProgramPerson = { id: string; name: string; isActive: boolean }
type AuditProgramAudit = {
  id: string
  code: string
  title: string
  status: AuditStatus
  plannedDate: Date | null
  startDate: Date | null
  endDate: Date | null
}
type AuditProgramRecord = {
  id: string
  companyId: string
  code: string
  name: string
  objective: string
  scope: string
  startDate: Date
  endDate: Date
  responsibleId: string | null
  criteria: string
  resources: string | null
  risks: string | null
  notes: string | null
  status: AuditProgramStatus
  responsible: AuditProgramPerson | null
  audits: AuditProgramAudit[]
  createdAt: Date
  updatedAt: Date
}

type AuditProgramDelegate = {
  findMany: (args?: Record<string, unknown>) => Promise<AuditProgramRecord[]>
  findUnique: (args: Record<string, unknown>) => Promise<AuditProgramRecord | null>
  create: (args: Record<string, unknown>) => Promise<AuditProgramRecord>
  update: (args: Record<string, unknown>) => Promise<AuditProgramRecord>
  delete: (args: Record<string, unknown>) => Promise<unknown>
}

type AuditProgramAuditDelegate = {
  findMany: (args?: Record<string, unknown>) => Promise<AuditProgramAudit[]>
  findUnique: (args: Record<string, unknown>) => Promise<({ id: string; auditProgramId: string | null; status: AuditStatus; process: { companyId: string } } | null)>
  update: (args: Record<string, unknown>) => Promise<unknown>
}

type AuditProgramUserDelegate = {
  findUnique: (args: Record<string, unknown>) => Promise<AuditProgramPerson & { companyId: string | null } | null>
}

type AuditProgramCompanyDelegate = {
  findUnique: (args: Record<string, unknown>) => Promise<{ id: string } | null>
}

type AuditProgramDb = {
  auditProgram: AuditProgramDelegate
  audit: AuditProgramAuditDelegate
  user: AuditProgramUserDelegate
  company: AuditProgramCompanyDelegate
  $transaction?: <T>(operation: (client: AuditProgramDb) => Promise<T>) => Promise<T>
  $queryRaw?: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
}

type AuditProgramServiceArgs = {
  app: Application
  db: PrismaClient
  authMiddleware: RequestHandler
  adminMiddleware: RequestHandler
}

const auditProgramInclude = {
  responsible: { select: { id: true, name: true, isActive: true } },
  audits: {
    select: { id: true, code: true, title: true, status: true, plannedDate: true, startDate: true, endDate: true },
    orderBy: [{ plannedDate: 'asc' }, { code: 'asc' }],
  },
}

const auditProgramCodePattern = /^PA-(\d{3,})$/
const auditProgramCodeLocks = new Map<string, Promise<void>>()

export const nextAuditProgramCode = (codes: readonly (string | null | undefined)[]): string => {
  const usedNumbers = new Set(codes.flatMap((code) => {
    const match = code?.match(auditProgramCodePattern)
    return match ? [Number(match[1])] : []
  }))
  let nextNumber = 1
  while (usedNumbers.has(nextNumber)) nextNumber += 1
  return `PA-${String(nextNumber).padStart(3, '0')}`
}

class AuditProgramError extends Error {
  readonly status: 400 | 403 | 404 | 409

  constructor(status: 400 | 403 | 404 | 409, message: string) {
    super(message)
    this.status = status
    this.name = 'AuditProgramError'
  }
}

const asDb = (db: PrismaClient): AuditProgramDb => db as unknown as AuditProgramDb

const runInTransaction = async <T>(db: AuditProgramDb, operation: (client: AuditProgramDb) => Promise<T>): Promise<T> => {
  if (typeof db.$transaction === 'function') return db.$transaction(operation)
  return operation(db)
}

const withAuditProgramCodeLock = async <T>(companyId: string, work: () => Promise<T>): Promise<T> => {
  const previous = auditProgramCodeLocks.get(companyId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  auditProgramCodeLocks.set(companyId, current)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (auditProgramCodeLocks.get(companyId) === current) auditProgramCodeLocks.delete(companyId)
  }
}

const lockProgramForUpdate = async (tx: AuditProgramDb, programId: string) => {
  if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT "id" FROM "AuditProgram" WHERE "id" = ${programId} FOR UPDATE`
}

const lockAuditForUpdate = async (tx: AuditProgramDb, auditId: string) => {
  if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT "id" FROM "Audit" WHERE "id" = ${auditId} FOR UPDATE`
}

const lockAuditProgramCodeInDatabase = async (tx: AuditProgramDb, companyId: string) => {
  if (typeof tx.$queryRaw === 'function') {
    await tx.$queryRaw`
      WITH advisory_lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtext(${`audit-program-code:${companyId}`}))
      )
      SELECT true AS locked
      FROM advisory_lock
    `
  }
}

const isTerminalProgramStatus = (status: AuditProgramStatus): boolean => status === 'COMPLETED' || status === 'CANCELLED'
const isTerminalAuditStatus = (status: AuditStatus): boolean => status === 'CLOSED' || status === 'CANCELLED'

const auditProgramTransitions: Record<AuditProgramStatus, AuditProgramStatus[]> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

const auditProgramSummary = (audits: AuditProgramAudit[]) => {
  const byStatus = { PLANNED: 0, IN_PROGRESS: 0, CLOSED: 0, CANCELLED: 0 }
  audits.forEach((audit) => { byStatus[audit.status] += 1 })
  return {
    total: audits.length,
    byStatus,
    terminal: byStatus.CLOSED + byStatus.CANCELLED,
    nonTerminal: byStatus.PLANNED + byStatus.IN_PROGRESS,
  }
}

const auditProgramView = (program: AuditProgramRecord) => ({
  id: program.id,
  companyId: program.companyId,
  code: program.code,
  name: program.name,
  objective: program.objective,
  scope: program.scope,
  startDate: program.startDate,
  endDate: program.endDate,
  responsibleId: program.responsibleId,
  responsible: program.responsible,
  criteria: program.criteria,
  resources: program.resources,
  risks: program.risks,
  notes: program.notes,
  status: program.status,
  audits: program.audits,
  auditSummary: auditProgramSummary(program.audits),
  createdAt: program.createdAt,
  updatedAt: program.updatedAt,
})

const canAccessCompany = (request: Request, companyId: string): boolean =>
  request.user?.role === 'SUPERUSER' || request.user?.companyId === companyId

const companyForWrite = async (db: AuditProgramDb, request: Request, requestedCompanyId?: string): Promise<string> => {
  if (request.user?.role === 'SUPERUSER') {
    if (!requestedCompanyId) throw new AuditProgramError(400, 'companyId is required for a superuser')
    const company = await db.company.findUnique({ where: { id: requestedCompanyId }, select: { id: true } })
    if (!company) throw new AuditProgramError(404, 'Company not found')
    return company.id
  }
  const ownCompanyId = request.user?.companyId
  if (!ownCompanyId) throw new AuditProgramError(403, 'The user is not assigned to a company')
  if (requestedCompanyId && requestedCompanyId !== ownCompanyId) throw new AuditProgramError(403, 'You can only manage programs in your own company')
  return ownCompanyId
}

const assertResponsible = async (db: AuditProgramDb, responsibleId: string | null | undefined, companyId: string) => {
  if (!responsibleId) return
  const user = await db.user.findUnique({ where: { id: responsibleId }, select: { id: true, name: true, companyId: true, isActive: true } })
  if (!user) throw new AuditProgramError(400, 'Program responsible user not found')
  if (user.companyId !== companyId) throw new AuditProgramError(403, 'The program responsible must belong to the same company')
  if (!user.isActive) throw new AuditProgramError(409, 'The program responsible user is inactive')
}

const assertPeriod = (startDate: Date, endDate: Date) => {
  if (startDate > endDate) throw new AuditProgramError(400, 'Program end date must be on or after the start date')
}

const findProgram = async (db: AuditProgramDb, request: Request, programId: string): Promise<AuditProgramRecord> => {
  const parsedId = idReference.safeParse(programId)
  if (!parsedId.success) throw new AuditProgramError(400, 'Invalid audit program id')
  const program = await db.auditProgram.findUnique({ where: { id: parsedId.data }, include: auditProgramInclude })
  if (!program || !canAccessCompany(request, program.companyId)) throw new AuditProgramError(404, 'Audit program not found')
  return program
}

const createAuditProgram = async (db: AuditProgramDb, companyId: string, data: Record<string, unknown>) => withAuditProgramCodeLock(companyId, () => runInTransaction(db, async (tx) => {
  await assertResponsible(tx, data.responsibleId as string | null | undefined, companyId)
  await lockAuditProgramCodeInDatabase(tx, companyId)
  const existing = await tx.auditProgram.findMany({ where: { companyId }, select: { code: true } })
  const code = nextAuditProgramCode(existing.map((program) => program.code))
  return tx.auditProgram.create({
    data: { ...data, companyId, code, status: 'DRAFT' },
    include: auditProgramInclude,
  })
}))

const parseProgramStatus = (status: string): AuditProgramStatus => {
  if ((auditProgramStatuses as readonly string[]).includes(status)) return status as AuditProgramStatus
  throw new AuditProgramError(400, 'Invalid audit program status')
}

const route = (handler: (request: Request, response: Response) => Promise<void>): RequestHandler => (request, response, next: NextFunction) => {
  Promise.resolve(handler(request, response)).catch((error: unknown) => {
    if (error instanceof AuditProgramError) {
      response.status(error.status).json({ error: error.message })
      return
    }
    next(error)
  })
}

export const registerAuditProgramRoutes = ({ app, db: rawDb, authMiddleware, adminMiddleware }: AuditProgramServiceArgs) => {
  const db = asDb(rawDb)

  app.get('/api/audit-programs', authMiddleware, route(async (request, response) => {
    const parsed = auditProgramQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit program query', details: parsed.error.issues })
      return
    }
    const requestedCompanyId = parsed.data.companyId
    if (requestedCompanyId && request.user?.role !== 'SUPERUSER' && !canAccessCompany(request, requestedCompanyId)) {
      response.status(404).json({ error: 'Company not found' })
      return
    }
    const companyId = request.user?.role === 'SUPERUSER' ? requestedCompanyId : request.user?.companyId
    const programs = await db.auditProgram.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.search ? { OR: [{ code: { contains: parsed.data.search, mode: 'insensitive' } }, { name: { contains: parsed.data.search, mode: 'insensitive' } }] } : {}),
      },
      include: auditProgramInclude,
      orderBy: [{ startDate: 'desc' }, { code: 'asc' }],
    })
    response.json({ programs: programs.map(auditProgramView) })
  }))

  app.get('/api/audit-programs/next-code', authMiddleware, route(async (request, response) => {
    const parsed = auditProgramCodeQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit program code query', details: parsed.error.issues })
      return
    }
    const companyId = await companyForWrite(db, request, parsed.data.companyId)
    const programs = await db.auditProgram.findMany({ where: { companyId }, select: { code: true } })
    response.json({ code: nextAuditProgramCode(programs.map((program) => program.code)) })
  }))

  app.get('/api/audit-programs/:programId', authMiddleware, route(async (request, response) => {
    const program = await findProgram(db, request, String(request.params.programId))
    response.json({ program: auditProgramView(program) })
  }))

  app.post('/api/audit-programs', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditProgramCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit program data', details: parsed.error.issues })
      return
    }
    const companyId = await companyForWrite(db, request, parsed.data.companyId)
    const program = await createAuditProgram(db, companyId, {
      name: parsed.data.name,
      objective: parsed.data.objective,
      scope: parsed.data.scope,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      responsibleId: parsed.data.responsibleId ?? null,
      criteria: parsed.data.criteria,
      resources: parsed.data.resources ?? null,
      risks: parsed.data.risks ?? null,
      notes: parsed.data.notes ?? null,
    })
    response.status(201).json({ program: auditProgramView(program) })
  }))

  app.patch('/api/audit-programs/:programId', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditProgramUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit program data', details: parsed.error.issues })
      return
    }
    const existing = await findProgram(db, request, String(request.params.programId))
    if (isTerminalProgramStatus(existing.status)) throw new AuditProgramError(409, 'A completed or cancelled audit program cannot be edited')
    const startDate = parsed.data.startDate ?? existing.startDate
    const endDate = parsed.data.endDate ?? existing.endDate
    assertPeriod(startDate, endDate)
    await assertResponsible(db, parsed.data.responsibleId, existing.companyId)
    const program = await db.auditProgram.update({
      where: { id: existing.id },
      data: {
        ...parsed.data,
        ...(parsed.data.responsibleId !== undefined ? { responsibleId: parsed.data.responsibleId } : {}),
      },
      include: auditProgramInclude,
    })
    response.json({ program: auditProgramView(program) })
  }))

  app.delete('/api/audit-programs/:programId', authMiddleware, adminMiddleware, route(async (request, response) => {
    const existing = await findProgram(db, request, String(request.params.programId))
    if (existing.status !== 'DRAFT') throw new AuditProgramError(409, 'Only a draft audit program can be deleted')
    await runInTransaction(db, async (tx) => {
      await lockProgramForUpdate(tx, existing.id)
      const locked = await tx.auditProgram.findUnique({ where: { id: existing.id }, include: { audits: { select: { id: true } } } })
      if (!locked) throw new AuditProgramError(404, 'Audit program not found')
      if (locked.audits.length > 0) throw new AuditProgramError(409, 'An audit program with linked audits cannot be deleted')
      if (locked.status !== 'DRAFT') throw new AuditProgramError(409, 'Only a draft audit program can be deleted')
      await tx.auditProgram.delete({ where: { id: existing.id } })
    })
    response.status(204).send()
  }))

  app.post('/api/audit-programs/:programId/status', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditProgramStatusChangeSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit program status data', details: parsed.error.issues })
      return
    }
    const existing = await findProgram(db, request, String(request.params.programId))
    const nextStatus = parseProgramStatus(parsed.data.status)
    if (!auditProgramTransitions[existing.status].includes(nextStatus)) throw new AuditProgramError(409, 'Invalid audit program status transition')
    const program = await runInTransaction(db, async (tx) => {
      await lockProgramForUpdate(tx, existing.id)
      const locked = await tx.auditProgram.findUnique({ where: { id: existing.id }, include: auditProgramInclude })
      if (!locked) throw new AuditProgramError(404, 'Audit program not found')
      if (!auditProgramTransitions[locked.status].includes(nextStatus)) throw new AuditProgramError(409, 'Invalid audit program status transition')
      if (nextStatus === 'COMPLETED' && locked.audits.some((audit) => !isTerminalAuditStatus(audit.status))) {
        throw new AuditProgramError(409, 'An audit program cannot be completed while linked audits are not terminal')
      }
      return tx.auditProgram.update({ where: { id: locked.id }, data: { status: nextStatus }, include: auditProgramInclude })
    })
    response.json({ program: auditProgramView(program) })
  }))

  app.post('/api/audit-programs/:programId/audits', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditProgramAuditLinkSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit program link data', details: parsed.error.issues })
      return
    }
    const existing = await findProgram(db, request, String(request.params.programId))
    if (isTerminalProgramStatus(existing.status)) throw new AuditProgramError(409, 'A completed or cancelled audit program cannot change its linked audits')
    await runInTransaction(db, async (tx) => {
      await lockProgramForUpdate(tx, existing.id)
      await lockAuditForUpdate(tx, parsed.data.auditId)
      const program = await tx.auditProgram.findUnique({ where: { id: existing.id }, include: { audits: { select: { id: true } } } })
      const audit = await tx.audit.findUnique({ where: { id: parsed.data.auditId }, select: { id: true, auditProgramId: true, status: true, process: { select: { companyId: true } } } })
      if (!program) throw new AuditProgramError(404, 'Audit program not found')
      if (isTerminalProgramStatus(program.status)) throw new AuditProgramError(409, 'A completed or cancelled audit program cannot change its linked audits')
      if (!audit) throw new AuditProgramError(404, 'Audit not found')
      if (audit.process.companyId !== program.companyId) throw new AuditProgramError(404, 'Audit not found')
      if (audit.auditProgramId) throw new AuditProgramError(409, 'The audit is already linked to an audit program')
      await tx.audit.update({ where: { id: audit.id }, data: { auditProgramId: program.id } })
    })
    const program = await findProgram(db, request, existing.id)
    response.status(200).json({ program: auditProgramView(program) })
  }))

  app.delete('/api/audit-programs/:programId/audits/:auditId', authMiddleware, adminMiddleware, route(async (request, response) => {
    const existing = await findProgram(db, request, String(request.params.programId))
    if (isTerminalProgramStatus(existing.status)) throw new AuditProgramError(409, 'A completed or cancelled audit program cannot change its linked audits')
    const auditId = idReference.safeParse(String(request.params.auditId))
    if (!auditId.success) throw new AuditProgramError(400, 'Invalid audit id')
    await runInTransaction(db, async (tx) => {
      await lockProgramForUpdate(tx, existing.id)
      await lockAuditForUpdate(tx, auditId.data)
      const program = await tx.auditProgram.findUnique({ where: { id: existing.id }, include: { audits: { select: { id: true } } } })
      const audit = await tx.audit.findUnique({ where: { id: auditId.data }, select: { id: true, auditProgramId: true, status: true, process: { select: { companyId: true } } } })
      if (!program) throw new AuditProgramError(404, 'Audit program not found')
      if (isTerminalProgramStatus(program.status)) throw new AuditProgramError(409, 'A completed or cancelled audit program cannot change its linked audits')
      if (!audit || audit.process.companyId !== program.companyId || audit.auditProgramId !== program.id) throw new AuditProgramError(404, 'Audit not found in this audit program')
      await tx.audit.update({ where: { id: audit.id }, data: { auditProgramId: null } })
    })
    const program = await findProgram(db, request, existing.id)
    response.json({ program: auditProgramView(program) })
  }))
}
