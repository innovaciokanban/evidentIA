import bcrypt from 'bcryptjs'
import request from './test-request.js'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'
import { nextAuditProgramCode } from './audit-program.service.js'

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@audit-program.test', name: 'Program Admin', role: 'COMPANY_ADMIN' as Role, companyId, isActive: true }
const companyUser = { id: 'cmuser0000000000000000001', email: 'user@audit-program.test', name: 'Program User', role: 'COMPANY_USER' as Role, companyId, isActive: true }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@audit-program.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId, isActive: true }
const inactiveUser = { id: 'cminactive00000000000000001', email: 'inactive@audit-program.test', name: 'Inactive User', role: 'COMPANY_USER' as Role, companyId, isActive: false }
const payload = {
  name: 'Programa de auditorías 2026',
  objective: 'Verificar los procesos críticos de la organización.',
  scope: 'Procesos misionales y de apoyo.',
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: '2026-12-31T00:00:00.000Z',
  responsibleId: admin.id,
  criteria: 'ISO 9001 y manual interno de calidad.',
  resources: 'Equipo auditor y presupuesto de seguimiento.',
  risks: 'Disponibilidad limitada de auditados.',
  notes: 'Revisión semestral.',
}

function makeDb(role: Role = 'COMPANY_ADMIN', userCompanyId = companyId) {
  const users = [admin, companyUser, foreignAdmin, inactiveUser]
  const currentUser = users.find((user) => user.role === role && user.companyId === userCompanyId) ?? { ...admin, role, companyId: userCompanyId }
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  const storedPrograms: Array<Record<string, unknown>> = []
  const storedAudits: Array<Record<string, unknown>> = [
    { id: 'cmaudit000000000000000001', code: 'AUD-001', title: 'Auditoría sin programa', status: 'PLANNED', auditProgramId: null, process: { companyId } },
    { id: 'cmauditforeign000000000000001', code: 'AUD-901', title: 'Auditoría de otra empresa', status: 'PLANNED', auditProgramId: null, process: { companyId: otherCompanyId } },
  ]
  let programSequence = 0
  let sessionActive = false

  const programView = (program: Record<string, unknown>) => ({
    ...program,
    responsible: users.find((user) => user.id === program.responsibleId) ?? null,
    audits: storedAudits.filter((audit) => audit.auditProgramId === program.id).map((audit) => ({
      id: audit.id,
      code: audit.code,
      title: audit.title,
      status: audit.status,
      plannedDate: null,
      startDate: null,
      endDate: null,
    })),
  })

  const db: Record<string, unknown> = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id)
        return user ? { ...user, passwordHash } : null
      }),
    },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-program', expiresAt: new Date(Date.now() + 86400000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-program', expiresAt: new Date(Date.now() + 86400000), user: currentUser } : null),
      deleteMany: vi.fn(async () => { sessionActive = false; return { count: 1 } }),
    },
    company: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => [companyId, otherCompanyId].includes(where.id) ? { id: where.id } : null),
    },
    auditProgram: {
      findMany: vi.fn(async ({ where }: { where?: { companyId?: string; status?: string; OR?: Array<Record<string, unknown>> } } = {}) => storedPrograms
        .filter((program) => !where.companyId || program.companyId === where.companyId)
        .filter((program) => !where.status || program.status === where.status)
        .map(programView)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const program = storedPrograms.find((item) => item.id === where.id)
        return program ? programView(program) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        programSequence += 1
        const program = { id: `cmauditprogram${String(programSequence).padStart(19, '0')}`, createdAt: new Date(), updatedAt: new Date(), ...data }
        storedPrograms.push(program)
        return programView(program)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const program = storedPrograms.find((item) => item.id === where.id)
        if (!program) throw new Error('Audit program not found')
        Object.assign(program, data, { updatedAt: new Date() })
        return programView(program)
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedPrograms.findIndex((program) => program.id === where.id)
        if (index >= 0) storedPrograms.splice(index, 1)
        return { id: where.id }
      }),
    },
    audit: {
      findMany: vi.fn(async ({ where }: { where?: { auditProgramId?: string } } = {}) => storedAudits.filter((audit) => !where?.auditProgramId || audit.auditProgramId === where.auditProgramId)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const audit = storedAudits.find((item) => item.id === where.id)
        return audit ? { id: audit.id, auditProgramId: audit.auditProgramId, status: audit.status, process: audit.process } : null
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const audit = storedAudits.find((item) => item.id === where.id)
        if (!audit) throw new Error('Audit not found')
        Object.assign(audit, data)
        return audit
      }),
    },
  }
  const makeQueryRaw = () => vi.fn(async (strings: TemplateStringsArray) => {
    const sql = Array.from(strings).join('')
    if (sql.includes('pg_advisory_xact_lock') && !sql.includes('SELECT true AS locked')) {
      throw new Error("P2010: Failed to deserialize column of type 'void'")
    }
    return [{ locked: true }]
  })
  db.$queryRaw = makeQueryRaw()
  const transactionQueryRaw = makeQueryRaw()
  const transactionDb = { ...db, $queryRaw: transactionQueryRaw }
  db.$transaction = vi.fn(async (operation: (client: Record<string, unknown>) => Promise<unknown>) => operation(transactionDb))
  return { db: db as unknown as PrismaClient, storedPrograms, storedAudits, queryRaw: transactionQueryRaw }
}

async function loggedIn(db: PrismaClient, email = admin.email) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

describe('audit program service', () => {
  it('generates the next company program code and skips occupied values', () => {
    expect(nextAuditProgramCode([])).toBe('PA-001')
    expect(nextAuditProgramCode(['PA-001', 'PA-003', 'AUD-001'])).toBe('PA-002')
  })

  it('creates, lists and updates programs with calculated audit summaries', async () => {
    const { db, storedPrograms, storedAudits, queryRaw } = makeDb()
    const agent = await loggedIn(db)
    const created = await agent.post('/api/audit-programs').send(payload)
    expect(created.status).toBe(201)
    expect(created.body.program).toMatchObject({ code: 'PA-001', status: 'DRAFT', auditSummary: { total: 0, nonTerminal: 0 } })
    expect(queryRaw).toHaveBeenCalled()

    storedAudits[0].auditProgramId = created.body.program.id
    const listed = await agent.get('/api/audit-programs?search=2026')
    expect(listed.status).toBe(200)
    expect(listed.body.programs[0].auditSummary).toMatchObject({ total: 1, byStatus: { PLANNED: 1 }, nonTerminal: 1 })

    const updated = await agent.patch(`/api/audit-programs/${created.body.program.id}`).send({ notes: 'Notas actualizadas.' })
    expect(updated.status).toBe(200)
    expect(updated.body.program.notes).toBe('Notas actualizadas.')
    expect(storedPrograms[0].code).toBe('PA-001')
  })

  it('serializes concurrent program creation and keeps codes immutable', async () => {
    const { db } = makeDb()
    const agent = await loggedIn(db)
    const [first, second] = await Promise.all([
      agent.post('/api/audit-programs').send(payload),
      agent.post('/api/audit-programs').send({ ...payload, name: 'Programa de auditorías alterno' }),
    ])
    expect([first.status, second.status]).toEqual([201, 201])
    expect([first.body.program.code, second.body.program.code].sort()).toEqual(['PA-001', 'PA-002'])

    const attemptedCodeChange = await agent.patch(`/api/audit-programs/${first.body.program.id}`).send({ code: 'PA-999' })
    expect(attemptedCodeChange.status).toBe(400)
  })

  it('validates periods and active responsible users within the tenant', async () => {
    const { db } = makeDb()
    const agent = await loggedIn(db)
    const invalidPeriod = await agent.post('/api/audit-programs').send({ ...payload, endDate: '2025-12-31T00:00:00.000Z' })
    expect(invalidPeriod.status).toBe(400)

    const inactive = await agent.post('/api/audit-programs').send({ ...payload, responsibleId: inactiveUser.id })
    expect(inactive.status).toBe(409)

    const foreign = await agent.post('/api/audit-programs').send({ ...payload, responsibleId: foreignAdmin.id })
    expect(foreign.status).toBe(403)
  })

  it('links and unlinks existing audits explicitly without affecting legacy unlinked audits', async () => {
    const { db, storedAudits } = makeDb()
    const agent = await loggedIn(db)
    const created = await agent.post('/api/audit-programs').send(payload)
    const programId = created.body.program.id as string

    const linked = await agent.post(`/api/audit-programs/${programId}/audits`).send({ auditId: storedAudits[0].id })
    expect(linked.status).toBe(200)
    expect(linked.body.program.auditSummary).toMatchObject({ total: 1, byStatus: { PLANNED: 1 } })
    expect(storedAudits[0].auditProgramId).toBe(programId)

    const duplicate = await agent.post(`/api/audit-programs/${programId}/audits`).send({ auditId: storedAudits[0].id })
    expect(duplicate.status).toBe(409)

    const unlinked = await agent.delete(`/api/audit-programs/${programId}/audits/${storedAudits[0].id}`)
    expect(unlinked.status).toBe(200)
    expect(storedAudits[0].auditProgramId).toBeNull()
    expect(storedAudits[0].status).toBe('PLANNED')
  })

  it('enforces lifecycle gates, safe deletion and cross-company isolation', async () => {
    const { db, storedAudits } = makeDb()
    const agent = await loggedIn(db)
    const created = await agent.post('/api/audit-programs').send(payload)
    const programId = created.body.program.id as string
    await agent.post(`/api/audit-programs/${programId}/audits`).send({ auditId: storedAudits[0].id })

    const active = await agent.post(`/api/audit-programs/${programId}/status`).send({ status: 'ACTIVE' })
    expect(active.status).toBe(200)
    const blockedComplete = await agent.post(`/api/audit-programs/${programId}/status`).send({ status: 'COMPLETED' })
    expect(blockedComplete.status).toBe(409)
    const blockedDelete = await agent.delete(`/api/audit-programs/${programId}`)
    expect(blockedDelete.status).toBe(409)

    storedAudits[0].status = 'CLOSED'
    const completed = await agent.post(`/api/audit-programs/${programId}/status`).send({ status: 'COMPLETED' })
    expect(completed.status).toBe(200)
    expect(completed.body.program.status).toBe('COMPLETED')

    const foreign = makeDb('COMPANY_ADMIN', otherCompanyId)
    const foreignAgent = await loggedIn(foreign.db, foreignAdmin.email)
    expect((await foreignAgent.get(`/api/audit-programs/${programId}`)).status).toBe(404)
    expect((await foreignAgent.get(`/api/audit-programs?companyId=${companyId}`)).status).toBe(404)
  })

  it('allows company users to read programs but not manage them', async () => {
    const adminDb = makeDb()
    const adminAgent = await loggedIn(adminDb.db)
    const created = await adminAgent.post('/api/audit-programs').send(payload)

    const readerDb = makeDb('COMPANY_USER')
    readerDb.storedPrograms.push({ ...adminDb.storedPrograms[0], id: created.body.program.id })
    const reader = await loggedIn(readerDb.db, companyUser.email)
    expect((await reader.get('/api/audit-programs')).status).toBe(200)
    expect((await reader.get(`/api/audit-programs/${created.body.program.id}`)).status).toBe(200)
    expect((await reader.post('/api/audit-programs').send(payload)).status).toBe(403)
  })
})
