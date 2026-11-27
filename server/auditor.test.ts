import bcrypt from 'bcryptjs'
import request from './test-request.js'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@auditor.test', name: 'Auditor Admin', role: 'COMPANY_ADMIN' as Role, companyId, isActive: true }
const reader = { id: 'cmreader00000000000000001', email: 'reader@auditor.test', name: 'Auditor Reader', role: 'COMPANY_USER' as Role, companyId, isActive: true }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@auditor.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId, isActive: true }
const superuser = { id: 'cmsuperuser000000000000001', email: 'super@auditor.test', name: 'Global Admin', role: 'SUPERUSER' as Role, companyId: null, isActive: true }

type State = {
  auditors: Array<Record<string, unknown>>
  competencies: Array<Record<string, unknown>>
  sequence: number
  competencySequence: number
}

const newState = (): State => ({ auditors: [], competencies: [], sequence: 0, competencySequence: 0 })

function makeDb(currentUser: typeof admin | typeof reader | typeof foreignAdmin | typeof superuser, state = newState()) {
  const users = [admin, reader, foreignAdmin, superuser]
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  let sessionActive = false
  const createdBy = (createdById: unknown) => users.find((user) => user.id === createdById) ?? null
  const auditorRecord = (auditor: Record<string, unknown>) => ({
    ...auditor,
    createdBy: createdBy(auditor.createdById),
    competencies: state.competencies.filter((competency) => competency.auditorId === auditor.id).map((competency) => ({ ...competency })),
  })
  const db: Record<string, unknown> = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id)
        return user ? { ...user, passwordHash } : null
      }),
    },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-auditor', expiresAt: new Date(Date.now() + 86400000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-auditor', expiresAt: new Date(Date.now() + 86400000), user: currentUser } : null),
      deleteMany: vi.fn(async () => { sessionActive = false; return { count: 1 } }),
    },
    company: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => [companyId, otherCompanyId].includes(where.id) ? { id: where.id } : null),
    },
    auditor: {
      findMany: vi.fn(async ({ where = {} }: { where?: { companyId?: string; type?: string; status?: string } } = {}) => state.auditors
        .filter((auditor) => !where.companyId || auditor.companyId === where.companyId)
        .filter((auditor) => !where.type || auditor.type === where.type)
        .filter((auditor) => !where.status || auditor.status === where.status)
        .map(auditorRecord)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const auditor = state.auditors.find((item) => item.id === where.id)
        return auditor ? auditorRecord(auditor) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.auditors.some((auditor) => auditor.companyId === data.companyId && auditor.email === data.email)) throw Object.assign(new Error('unique'), { code: 'P2002' })
        state.sequence += 1
        const auditor = { id: `cmauditor00000000000000${state.sequence}`, createdAt: new Date(), updatedAt: new Date(), ...data }
        state.auditors.push(auditor)
        return auditorRecord(auditor)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const auditor = state.auditors.find((item) => item.id === where.id)
        if (!auditor) throw new Error('Auditor not found')
        if (data.email && state.auditors.some((item) => item.id !== auditor.id && item.companyId === auditor.companyId && item.email === data.email)) throw Object.assign(new Error('unique'), { code: 'P2002' })
        Object.assign(auditor, data, { updatedAt: new Date() })
        return auditorRecord(auditor)
      }),
    },
    auditorCompetency: {
      findMany: vi.fn(async ({ where }: { where: { auditorId: string } }) => state.competencies.filter((competency) => competency.auditorId === where.auditorId).map((competency) => ({ ...competency }))),
      findUnique: vi.fn(async ({ where }: { where: { id?: string; auditorId_nameKey?: { auditorId: string; nameKey: string } } }) => {
        const competency = where.id
          ? state.competencies.find((item) => item.id === where.id)
          : state.competencies.find((item) => item.auditorId === where.auditorId_nameKey?.auditorId && item.nameKey === where.auditorId_nameKey?.nameKey)
        return competency ? { ...competency } : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.competencies.some((competency) => competency.auditorId === data.auditorId && competency.nameKey === data.nameKey)) throw Object.assign(new Error('unique'), { code: 'P2002' })
        state.competencySequence += 1
        const competency = { id: `cmcompetency00000000000${state.competencySequence}`, createdAt: new Date(), updatedAt: new Date(), ...data }
        state.competencies.push(competency)
        return { ...competency }
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const competency = state.competencies.find((item) => item.id === where.id)
        if (!competency) throw new Error('Competency not found')
        if (data.nameKey && state.competencies.some((item) => item.id !== competency.id && item.auditorId === competency.auditorId && item.nameKey === data.nameKey)) throw Object.assign(new Error('unique'), { code: 'P2002' })
        Object.assign(competency, data, { updatedAt: new Date() })
        return { ...competency }
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = state.competencies.findIndex((competency) => competency.id === where.id)
        if (index >= 0) state.competencies.splice(index, 1)
        return { id: where.id }
      }),
    },
  }
  return { db: db as unknown as PrismaClient, state }
}

async function loggedIn(db: PrismaClient, email: string) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

const auditorPayload = {
  name: 'Ana Auditora',
  email: 'ana.auditora@example.com',
  type: 'INTERNAL',
  position: 'Coordinadora de calidad',
  experience: 'Ocho años en sistemas de gestión.',
}

describe('auditor bank service', () => {
  it('creates internal and external auditors, manages competencies and deactivates without deleting history', async () => {
    const { db, state } = makeDb(admin)
    const agent = await loggedIn(db, admin.email)
    const internal = await agent.post('/api/auditors').send(auditorPayload)
    expect(internal.status).toBe(201)
    expect(internal.body.auditor).toMatchObject({ email: auditorPayload.email, type: 'INTERNAL', status: 'AVAILABLE' })

    const external = await agent.post('/api/auditors').send({ ...auditorPayload, name: 'Luis Externo', email: 'luis.external@example.com', type: 'EXTERNAL', organization: 'Consultores S.A.S.' })
    expect(external.status).toBe(201)
    expect(external.body.auditor.type).toBe('EXTERNAL')

    const auditorId = internal.body.auditor.id as string
    const iso = await agent.post(`/api/auditors/${auditorId}/competencies`).send({ name: 'ISO 9001', level: 5, evidence: 'Lead auditor certificate' })
    const risk = await agent.post(`/api/auditors/${auditorId}/competencies`).send({ name: 'Gestión de riesgos', level: 3 })
    expect(iso.status).toBe(201)
    expect(risk.status).toBe(201)
    expect((await agent.get(`/api/auditors/${auditorId}/competencies`)).body.competencies).toHaveLength(2)

    const duplicateCompetency = await agent.post(`/api/auditors/${auditorId}/competencies`).send({ name: 'iso 9001', level: 4 })
    expect(duplicateCompetency.status).toBe(409)
    expect((await agent.patch(`/api/auditors/${auditorId}/competencies/${iso.body.competency.id}`).send({ level: 4 })).status).toBe(200)
    const updated = await agent.patch(`/api/auditors/${auditorId}`).send({ phone: '+57 300 000 0000', status: 'UNAVAILABLE' })
    expect(updated.status).toBe(200)
    expect(updated.body.auditor).toMatchObject({ phone: '+57 300 000 0000', status: 'UNAVAILABLE' })

    const deactivated = await agent.post(`/api/auditors/${auditorId}/deactivate`)
    expect(deactivated.status).toBe(200)
    expect(deactivated.body.auditor.status).toBe('INACTIVE')
    expect(state.auditors).toHaveLength(2)
    expect(state.competencies).toHaveLength(2)
    expect((await agent.get(`/api/auditors/${auditorId}`)).body.auditor.competencies).toHaveLength(2)
  })

  it('validates fields, prevents duplicate email within a company and isolates tenants', async () => {
    const state = newState()
    const own = makeDb(admin, state)
    const ownAgent = await loggedIn(own.db, admin.email)
    const created = await ownAgent.post('/api/auditors').send(auditorPayload)
    expect((await ownAgent.post('/api/auditors').send({ ...auditorPayload, email: auditorPayload.email.toUpperCase() })).status).toBe(409)
    expect((await ownAgent.post('/api/auditors').send({ ...auditorPayload, email: 'bad', name: 'A' })).status).toBe(400)
    expect((await ownAgent.post(`/api/auditors/${created.body.auditor.id}/competencies`)).status).toBe(400)
    expect((await ownAgent.post(`/api/auditors/${created.body.auditor.id}/competencies`).send({ name: 'ISO 27001', level: 6 })).status).toBe(400)

    const foreign = makeDb(foreignAdmin, state)
    const foreignAgent = await loggedIn(foreign.db, foreignAdmin.email)
    expect((await foreignAgent.get(`/api/auditors/${created.body.auditor.id}`)).status).toBe(404)
    const sameEmailOtherCompany = await foreignAgent.post('/api/auditors').send({ ...auditorPayload, type: 'EXTERNAL' })
    expect(sameEmailOtherCompany.status).toBe(201)
    expect(sameEmailOtherCompany.body.auditor.companyId).toBe(otherCompanyId)
  })

  it('allows company users to read but not manage auditors, while superusers select scope', async () => {
    const state = newState()
    const adminDb = makeDb(admin, state)
    expect((await request(createApp(adminDb.db)).get('/api/auditors')).status).toBe(401)
    const adminAgent = await loggedIn(adminDb.db, admin.email)
    await adminAgent.post('/api/auditors').send(auditorPayload)

    const readerDb = makeDb(reader, state)
    const readerAgent = await loggedIn(readerDb.db, reader.email)
    expect((await readerAgent.get('/api/auditors')).status).toBe(200)
    expect((await readerAgent.post('/api/auditors').send({ ...auditorPayload, email: 'reader-write@example.com' })).status).toBe(403)

    const superDb = makeDb(superuser, state)
    const superAgent = await loggedIn(superDb.db, superuser.email)
    expect((await superAgent.get(`/api/auditors?companyId=${companyId}`)).status).toBe(200)
    expect((await superAgent.post('/api/auditors').send({ ...auditorPayload, companyId: otherCompanyId, email: 'super-created@example.com' })).status).toBe(201)
    expect((await superAgent.post('/api/auditors').send({ ...auditorPayload, email: 'missing-company@example.com' })).status).toBe(400)
  })
})
