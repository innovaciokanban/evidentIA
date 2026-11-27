import type { Application, NextFunction, Request, RequestHandler, Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import {
  auditProgramProcessPriorityCreateSchema,
  auditProgramProcessPriorityUpdateSchema,
  idReference,
} from './validation.js'

export const auditProgramProcessPriorityLevels = ['LOW', 'MEDIUM', 'HIGH'] as const
export type AuditProgramProcessPriorityLevel = typeof auditProgramProcessPriorityLevels[number]

type PriorityStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
type PriorityPerson = { id: string; name: string; email?: string }
type PriorityProcess = { id: string; companyId: string; code: string | null; name: string; type: string; status: string }
type PriorityRecord = {
  id: string
  auditProgramId: string
  processId: string
  criticality: number
  recentChanges: number
  previousUnfavorableResults: number
  score: number
  calculatedPriority: AuditProgramProcessPriorityLevel
  manualPriority: AuditProgramProcessPriorityLevel | null
  manualJustification: string | null
  observations: string | null
  evaluatedById: string
  createdAt: Date
  updatedAt: Date
  process: PriorityProcess
  evaluatedBy: PriorityPerson
}

type PriorityDelegate = {
  findMany: (args?: Record<string, unknown>) => Promise<PriorityRecord[]>
  findUnique: (args: Record<string, unknown>) => Promise<PriorityRecord | null>
  create: (args: Record<string, unknown>) => Promise<PriorityRecord>
  update: (args: Record<string, unknown>) => Promise<PriorityRecord>
  delete: (args: Record<string, unknown>) => Promise<unknown>
}

type ProgramDelegate = {
  findUnique: (args: Record<string, unknown>) => Promise<{ id: string; companyId: string; status: PriorityStatus } | null>
}

type ProcessDelegate = {
  findUnique: (args: Record<string, unknown>) => Promise<PriorityProcess | null>
}

type PriorityDb = {
  auditProgramProcessPriority: PriorityDelegate
  auditProgram: ProgramDelegate
  process: ProcessDelegate
}

type PriorityServiceArgs = {
  app: Application
  db: PrismaClient
  authMiddleware: RequestHandler
  adminMiddleware: RequestHandler
}

type PriorityCriteria = { criticality: number; recentChanges: number; previousUnfavorableResults: number }

export const calculateAuditProgramProcessPriority = ({ criticality, recentChanges, previousUnfavorableResults }: PriorityCriteria): { score: number; calculatedPriority: AuditProgramProcessPriorityLevel } => {
  const score = criticality + recentChanges + previousUnfavorableResults
  const calculatedPriority = score <= 4 ? 'LOW' : score <= 7 ? 'MEDIUM' : 'HIGH'
  return { score, calculatedPriority }
}

export const effectiveAuditProgramProcessPriority = (record: Pick<PriorityRecord, 'calculatedPriority' | 'manualPriority'>): AuditProgramProcessPriorityLevel => record.manualPriority ?? record.calculatedPriority

class AuditProgramProcessPriorityError extends Error {
  readonly status: 400 | 403 | 404 | 409

  constructor(status: 400 | 403 | 404 | 409, message: string) {
    super(message)
    this.status = status
    this.name = 'AuditProgramProcessPriorityError'
  }
}

const asDb = (db: PrismaClient): PriorityDb => db as unknown as PriorityDb

const priorityInclude = {
  process: { select: { id: true, companyId: true, code: true, name: true, type: true, status: true } },
  evaluatedBy: { select: { id: true, name: true, email: true } },
}

const priorityRank: Record<AuditProgramProcessPriorityLevel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 }

const isUniqueConflict = (error: unknown): boolean => Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002')

const canAccessCompany = (request: Request, companyId: string): boolean => request.user?.role === 'SUPERUSER' || request.user?.companyId === companyId

const findProgram = async (db: PriorityDb, request: Request, programId: string) => {
  const parsedId = idReference.safeParse(programId)
  if (!parsedId.success) throw new AuditProgramProcessPriorityError(400, 'Invalid audit program id')
  const program = await db.auditProgram.findUnique({ where: { id: parsedId.data }, select: { id: true, companyId: true, status: true } })
  if (!program || !canAccessCompany(request, program.companyId)) throw new AuditProgramProcessPriorityError(404, 'Audit program not found')
  return program
}

const assertWritableProgram = (program: { status: PriorityStatus }) => {
  if (program.status === 'COMPLETED' || program.status === 'CANCELLED') throw new AuditProgramProcessPriorityError(409, 'A completed or cancelled audit program is read-only')
}

const findProcess = async (db: PriorityDb, processId: string, companyId: string) => {
  const process = await db.process.findUnique({ where: { id: processId }, select: { id: true, companyId: true, code: true, name: true, type: true, status: true } })
  if (!process || process.companyId !== companyId) throw new AuditProgramProcessPriorityError(404, 'Process not found')
  return process
}

const viewPriority = (record: PriorityRecord) => ({
  id: record.id,
  auditProgramId: record.auditProgramId,
  processId: record.processId,
  process: record.process,
  criticality: record.criticality,
  recentChanges: record.recentChanges,
  previousUnfavorableResults: record.previousUnfavorableResults,
  score: record.score,
  calculatedPriority: record.calculatedPriority,
  manualPriority: record.manualPriority,
  effectivePriority: effectiveAuditProgramProcessPriority(record),
  manualJustification: record.manualJustification,
  observations: record.observations,
  evaluatedBy: record.evaluatedBy,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const sortPriorities = (records: PriorityRecord[]) => records.sort((left, right) => {
  const effectiveDifference = priorityRank[effectiveAuditProgramProcessPriority(right)] - priorityRank[effectiveAuditProgramProcessPriority(left)]
  return effectiveDifference || right.score - left.score || left.process.name.localeCompare(right.process.name)
})

const route = (handler: (request: Request, response: Response) => Promise<void>): RequestHandler => (request, response, next: NextFunction) => {
  Promise.resolve(handler(request, response)).catch((error: unknown) => {
    if (error instanceof AuditProgramProcessPriorityError) {
      response.status(error.status).json({ error: error.message })
      return
    }
    next(error)
  })
}

export const registerAuditProgramProcessPriorityRoutes = ({ app, db: rawDb, authMiddleware, adminMiddleware }: PriorityServiceArgs) => {
  const db = asDb(rawDb)

  app.get('/api/audit-programs/:programId/process-priorities', authMiddleware, route(async (request, response) => {
    const program = await findProgram(db, request, String(request.params.programId))
    const records = await db.auditProgramProcessPriority.findMany({ where: { auditProgramId: program.id }, include: priorityInclude })
    response.json({ processPriorities: sortPriorities(records).map(viewPriority) })
  }))

  app.post('/api/audit-programs/:programId/process-priorities', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditProgramProcessPriorityCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid process priority data', details: parsed.error.issues })
      return
    }
    const program = await findProgram(db, request, String(request.params.programId))
    assertWritableProgram(program)
    const process = await findProcess(db, parsed.data.processId, program.companyId)
    const existing = await db.auditProgramProcessPriority.findUnique({ where: { auditProgramId_processId: { auditProgramId: program.id, processId: process.id } } })
    if (existing) throw new AuditProgramProcessPriorityError(409, 'This process already has a priority evaluation in the audit program')
    const calculated = calculateAuditProgramProcessPriority(parsed.data)
    try {
      const created = await db.auditProgramProcessPriority.create({
        data: {
          auditProgramId: program.id,
          ...parsed.data,
          ...calculated,
          manualPriority: parsed.data.manualPriority ?? null,
          manualJustification: parsed.data.manualJustification ?? null,
          observations: parsed.data.observations ?? null,
          evaluatedById: request.user!.id,
        },
        include: priorityInclude,
      })
      response.status(201).json({ processPriority: viewPriority(created) })
    } catch (error) {
      if (isUniqueConflict(error)) throw new AuditProgramProcessPriorityError(409, 'This process already has a priority evaluation in the audit program')
      throw error
    }
  }))

  app.patch('/api/audit-programs/:programId/process-priorities/:priorityId', authMiddleware, adminMiddleware, route(async (request, response) => {
    const parsed = auditProgramProcessPriorityUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid process priority data', details: parsed.error.issues })
      return
    }
    const program = await findProgram(db, request, String(request.params.programId))
    assertWritableProgram(program)
    const priorityId = idReference.safeParse(String(request.params.priorityId))
    if (!priorityId.success) throw new AuditProgramProcessPriorityError(400, 'Invalid process priority id')
    const existing = await db.auditProgramProcessPriority.findUnique({ where: { id: priorityId.data }, include: priorityInclude })
    if (!existing || existing.auditProgramId !== program.id) throw new AuditProgramProcessPriorityError(404, 'Process priority not found')
    const criticality = parsed.data.criticality ?? existing.criticality
    const recentChanges = parsed.data.recentChanges ?? existing.recentChanges
    const previousUnfavorableResults = parsed.data.previousUnfavorableResults ?? existing.previousUnfavorableResults
    const manualPriority = parsed.data.manualPriority !== undefined ? parsed.data.manualPriority : existing.manualPriority
    const manualJustification = parsed.data.manualJustification !== undefined ? parsed.data.manualJustification : existing.manualJustification
    if (manualPriority && !manualJustification?.trim()) throw new AuditProgramProcessPriorityError(400, 'A justification is required for a manual priority')
    if (!manualPriority && manualJustification?.trim()) throw new AuditProgramProcessPriorityError(400, 'Manual justification requires a manual priority')
    const calculated = calculateAuditProgramProcessPriority({ criticality, recentChanges, previousUnfavorableResults })
    const updated = await db.auditProgramProcessPriority.update({
      where: { id: existing.id },
      data: {
        ...parsed.data,
        criticality,
        recentChanges,
        previousUnfavorableResults,
        ...calculated,
        manualPriority: manualPriority ?? null,
        manualJustification: manualPriority ? manualJustification!.trim() : null,
        evaluatedById: request.user!.id,
      },
      include: priorityInclude,
    })
    response.json({ processPriority: viewPriority(updated) })
  }))

  app.delete('/api/audit-programs/:programId/process-priorities/:priorityId', authMiddleware, adminMiddleware, route(async (request, response) => {
    const program = await findProgram(db, request, String(request.params.programId))
    assertWritableProgram(program)
    const priorityId = idReference.safeParse(String(request.params.priorityId))
    if (!priorityId.success) throw new AuditProgramProcessPriorityError(400, 'Invalid process priority id')
    const existing = await db.auditProgramProcessPriority.findUnique({ where: { id: priorityId.data } })
    if (!existing || existing.auditProgramId !== program.id) throw new AuditProgramProcessPriorityError(404, 'Process priority not found')
    await db.auditProgramProcessPriority.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))
}
