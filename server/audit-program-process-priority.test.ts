import bcrypt from 'bcryptjs'
import request from './test-request.js'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'
import { calculateAuditProgramProcessPriority, effectiveAuditProgramProcessPriority } from './audit-program-process-priority.service.js'

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const programId = 'cmprogram00000000000000001'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@priority.test', name: 'Priority Admin', role: 'COMPANY_ADMIN' as Role, companyId, isActive: true }
const companyUser = { id: 'cmuser0000000000000000001', email: 'user@priority.test', name: 'Priority Reader', role: 'COMPANY_USER' as Role, companyId, isActive: true }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@priority.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId, isActive: true }
type StoredPriority = { id: string; auditProgramId: string; processId: string; criticality: number; recentChanges: number; previousUnfavorableResults: number; score: number; calculatedPriority: 'LOW' | 'MEDIUM' | 'HIGH'; manualPriority: 'LOW' | 'MEDIUM' | 'HIGH' | null; manualJustification: string | null; observations: string | null; evaluatedById: string; createdAt: Date; updatedAt: Date }

const processSeed = (id: string, name: string, processCompanyId = companyId) => ({ id, companyId: processCompanyId, code: id.slice(-3), name, type: 'MISSIONAL', status: 'ACTIVE' })

function makeDb(role: Role = 'COMPANY_ADMIN', userCompanyId = companyId) {
  const users = [admin, companyUser, foreignAdmin]
  const currentUser = users.find((user) => user.role === role && user.companyId === userCompanyId) ?? { ...admin, role, companyId: userCompanyId }
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  const programs = [{ id: programId, companyId, status: 'DRAFT' as const }]
  const processes = [
    processSeed('cmprocess00000000000000001', 'Proceso operativo'),
    processSeed('cmprocess00000000000000002', 'Proceso estratégico'),
    processSeed('cmprocess00000000000000003', 'Proceso de apoyo'),
    processSeed('cmprocess00000000000000004', 'Proceso manual'),
    processSeed('cmprocessforeign000000000001', 'Proceso externo', otherCompanyId),
  ]
  const priorities: StoredPriority[] = []
  let prioritySequence = 0
  let sessionActive = false
  const priorityView = (priority: StoredPriority) => ({ ...priority, process: processes.find((process) => process.id === priority.processId), evaluatedBy: users.find((user) => user.id === priority.evaluatedById) })
  const db: Record<string, unknown> = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id)
        return user ? { ...user, passwordHash } : null
      }),
    },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-priority', expiresAt: new Date(Date.now() + 86400000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-priority', expiresAt: new Date(Date.now() + 86400000), user: currentUser } : null),
      deleteMany: vi.fn(async () => { sessionActive = false; return { count: 1 } }),
    },
    auditProgram: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => programs.find((program) => program.id === where.id) ?? null),
    },
    process: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => processes.find((process) => process.id === where.id) ?? null),
    },
    auditProgramProcessPriority: {
      findMany: vi.fn(async () => priorities.map(priorityView)),
      findUnique: vi.fn(async ({ where }: { where: { id?: string; auditProgramId_processId?: { auditProgramId: string; processId: string } } }) => {
        const priority = where.id ? priorities.find((item) => item.id === where.id) : priorities.find((item) => item.auditProgramId === where.auditProgramId_processId?.auditProgramId && item.processId === where.auditProgramId_processId?.processId)
        return priority ? priorityView(priority) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        prioritySequence += 1
        const priority = { id: `cmpriority${String(prioritySequence).padStart(19, '0')}`, createdAt: new Date(), updatedAt: new Date(), ...data } as unknown as StoredPriority
        priorities.push(priority)
        return priorityView(priority)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const priority = priorities.find((item) => item.id === where.id)
        if (!priority) throw new Error('Priority not found')
        Object.assign(priority, data, { updatedAt: new Date() })
        return priorityView(priority)
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = priorities.findIndex((item) => item.id === where.id)
        if (index >= 0) priorities.splice(index, 1)
        return { id: where.id }
      }),
    },
  }
  return { db: db as unknown as PrismaClient, programs, processes, priorities }
}

async function loggedIn(db: PrismaClient, email = admin.email) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

const priorityPayload = (processId: string, overrides: Record<string, unknown> = {}) => ({ processId, criticality: 1, recentChanges: 1, previousUnfavorableResults: 1, ...overrides })

describe('audit program process priority service', () => {
  it('calculates score bands and distinguishes effective manual priority', () => {
    expect(calculateAuditProgramProcessPriority({ criticality: 1, recentChanges: 1, previousUnfavorableResults: 1 })).toEqual({ score: 3, calculatedPriority: 'LOW' })
    expect(calculateAuditProgramProcessPriority({ criticality: 2, recentChanges: 2, previousUnfavorableResults: 2 })).toEqual({ score: 6, calculatedPriority: 'MEDIUM' })
    expect(calculateAuditProgramProcessPriority({ criticality: 3, recentChanges: 3, previousUnfavorableResults: 2 })).toEqual({ score: 8, calculatedPriority: 'HIGH' })
    expect(effectiveAuditProgramProcessPriority({ calculatedPriority: 'LOW', manualPriority: 'HIGH' })).toBe('HIGH')
    expect(effectiveAuditProgramProcessPriority({ calculatedPriority: 'MEDIUM', manualPriority: null })).toBe('MEDIUM')
  })

  it('validates ranges, manual justification, duplicates, ordering and updates', async () => {
    const fixture = makeDb()
    const agent = await loggedIn(fixture.db)
    const low = await agent.post(`/api/audit-programs/${programId}/process-priorities`).send(priorityPayload(fixture.processes[0].id))
    expect(low.status).toBe(201)
    expect(low.body.processPriority).toMatchObject({ score: 3, calculatedPriority: 'LOW', effectivePriority: 'LOW', evaluatedBy: { id: admin.id } })

    const high = await agent.post(`/api/audit-programs/${programId}/process-priorities`).send(priorityPayload(fixture.processes[1].id, { criticality: 3, recentChanges: 3, previousUnfavorableResults: 2 }))
    expect(high.status).toBe(201)
    expect(high.body.processPriority.effectivePriority).toBe('HIGH')

    const invalidRange = await agent.post(`/api/audit-programs/${programId}/process-priorities`).send(priorityPayload(fixture.processes[2].id, { criticality: 4 }))
    expect(invalidRange.status).toBe(400)
    const missingJustification = await agent.post(`/api/audit-programs/${programId}/process-priorities`).send(priorityPayload(fixture.processes[3].id, { manualPriority: 'HIGH' }))
    expect(missingJustification.status).toBe(400)

    const duplicate = await agent.post(`/api/audit-programs/${programId}/process-priorities`).send(priorityPayload(fixture.processes[0].id))
    expect(duplicate.status).toBe(409)

    const manual = await agent.post(`/api/audit-programs/${programId}/process-priorities`).send(priorityPayload(fixture.processes[3].id, { manualPriority: 'HIGH', manualJustification: 'Cambio regulatorio reciente.' }))
    expect(manual.status).toBe(201)
    expect(manual.body.processPriority.effectivePriority).toBe('HIGH')

    const listed = await agent.get(`/api/audit-programs/${programId}/process-priorities`)
    expect(listed.status).toBe(200)
    expect(listed.body.processPriorities.map((item: { effectivePriority: string }) => item.effectivePriority)).toEqual(['HIGH', 'HIGH', 'LOW'])

    const updated = await agent.patch(`/api/audit-programs/${programId}/process-priorities/${low.body.processPriority.id}`).send({ criticality: 3, recentChanges: 3, previousUnfavorableResults: 3, manualPriority: 'MEDIUM', manualJustification: 'Prioridad definida por comité.' })
    expect(updated.status).toBe(200)
    expect(updated.body.processPriority).toMatchObject({ score: 9, calculatedPriority: 'HIGH', effectivePriority: 'MEDIUM' })

    const cleared = await agent.patch(`/api/audit-programs/${programId}/process-priorities/${updated.body.processPriority.id}`).send({ manualPriority: null, manualJustification: null })
    expect(cleared.status).toBe(200)
    expect(cleared.body.processPriority.effectivePriority).toBe('HIGH')
    expect((await agent.delete(`/api/audit-programs/${programId}/process-priorities/${cleared.body.processPriority.id}`)).status).toBe(204)
    expect(fixture.processes.find((process) => process.id === fixture.processes[0].id)).toBeDefined()
  })

  it('enforces company isolation, reader permissions and program lifecycle', async () => {
    const fixture = makeDb()
    const adminAgent = await loggedIn(fixture.db)
    const foreignProcess = fixture.processes.find((process) => process.companyId === otherCompanyId)!
    expect((await adminAgent.post(`/api/audit-programs/${programId}/process-priorities`).send(priorityPayload(foreignProcess.id))).status).toBe(404)

    fixture.programs[0].status = 'ACTIVE'
    expect((await adminAgent.post(`/api/audit-programs/${programId}/process-priorities`).send(priorityPayload(fixture.processes[0].id))).status).toBe(201)
    fixture.programs[0].status = 'COMPLETED'
    expect((await adminAgent.post(`/api/audit-programs/${programId}/process-priorities`).send(priorityPayload(fixture.processes[0].id))).status).toBe(409)
    fixture.programs[0].status = 'CANCELLED'
    expect((await adminAgent.post(`/api/audit-programs/${programId}/process-priorities`).send(priorityPayload(fixture.processes[1].id))).status).toBe(409)

    const readerFixture = makeDb('COMPANY_USER')
    const reader = await loggedIn(readerFixture.db, companyUser.email)
    expect((await reader.get(`/api/audit-programs/${programId}/process-priorities`)).status).toBe(200)
    expect((await reader.post(`/api/audit-programs/${programId}/process-priorities`).send(priorityPayload(readerFixture.processes[0].id))).status).toBe(403)

    const foreignFixture = makeDb('COMPANY_ADMIN', otherCompanyId)
    const foreign = await loggedIn(foreignFixture.db, foreignAdmin.email)
    expect((await foreign.get(`/api/audit-programs/${programId}/process-priorities`)).status).toBe(404)
  })
})
