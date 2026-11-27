import bcrypt from 'bcryptjs'
import request from './test-request.js'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const auditId = 'cmaudit000000000000000001'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@team.test', name: 'Team Admin', role: 'COMPANY_ADMIN' as Role, companyId, isActive: true }
const reader = { id: 'cmreader00000000000000001', email: 'reader@team.test', name: 'Team Reader', role: 'COMPANY_USER' as Role, companyId, isActive: true }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@team.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId, isActive: true }
const superuser = { id: 'cmsuperuser000000000000001', email: 'super@team.test', name: 'Global Admin', role: 'SUPERUSER' as Role, companyId: null, isActive: true }

type AuditorState = {
  id: string
  companyId: string
  name: string
  email: string
  type: 'INTERNAL' | 'EXTERNAL'
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'INACTIVE'
  competencies: Array<Record<string, unknown>>
}

type MemberState = Record<string, unknown> & { id: string; auditId: string; auditorId: string; companyId: string; role: 'LEAD' | 'MEMBER'; isActive: boolean }

type TeamState = {
  auditors: AuditorState[]
  members: MemberState[]
  events: Array<Record<string, unknown>>
  sequence: number
}

const newState = (): TeamState => ({
  auditors: [
    { id: 'cmauditor0000000000000001', companyId, name: 'Ana Interna', email: 'ana@team.test', type: 'INTERNAL', status: 'AVAILABLE', competencies: [{ id: 'cmcompetency00000000000001', auditorId: 'cmauditor0000000000000001', name: 'ISO 9001', level: 5, evidence: 'Certificate', createdAt: new Date(), updatedAt: new Date() }] },
    { id: 'cmauditor0000000000000002', companyId, name: 'Luis Externo', email: 'luis@team.test', type: 'EXTERNAL', status: 'AVAILABLE', competencies: [] },
  ],
  members: [],
  events: [],
  sequence: 0,
})

function makeDb(currentUser: typeof admin | typeof reader | typeof foreignAdmin | typeof superuser, state = newState()) {
  const users = [admin, reader, foreignAdmin, superuser]
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  let sessionActive = false
  const actor = (id: unknown) => {
    const user = users.find((item) => item.id === id)
    return user ? { id: user.id, name: user.name, email: user.email, isActive: user.isActive } : null
  }
  const auditor = (id: string) => state.auditors.find((item) => item.id === id) ?? null
  const memberRecord = (member: MemberState) => {
    const auditorValue = auditor(member.auditorId)
    if (!auditorValue) throw new Error('Auditor missing')
    return {
      ...member,
      auditor: { ...auditorValue, competencies: auditorValue.competencies },
      assignedBy: actor(member.assignedById),
      removedBy: actor(member.removedById),
      independenceEvaluatedBy: actor(member.independenceEvaluatedById),
    }
  }
  const matches = (member: MemberState, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => member[key] === value)
  const db: Record<string, unknown> = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id)
        return user ? { ...user, passwordHash } : null
      }),
    },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-team', expiresAt: new Date(Date.now() + 86400000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-team', expiresAt: new Date(Date.now() + 86400000), user: currentUser } : null),
      deleteMany: vi.fn(async () => { sessionActive = false; return { count: 1 } }),
    },
    company: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => [companyId, otherCompanyId].includes(where.id) ? { id: where.id } : null) },
    audit: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === auditId ? { id: auditId, process: { companyId } } : null),
    },
    auditor: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => auditor(where.id)),
    },
    auditTeamMember: {
      findMany: vi.fn(async ({ where }: { where: { auditId: string; companyId?: string } }) => state.members.filter((member) => member.auditId === where.auditId && (!where.companyId || member.companyId === where.companyId)).map(memberRecord)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const member = state.members.find((item) => item.id === where.id)
        return member ? memberRecord(member) : null
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const member = state.members.find((item) => matches(item, where))
        return member ? memberRecord(member) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.sequence += 1
        const member = { id: `cmteam000000000000000${state.sequence}`, createdAt: new Date(), updatedAt: new Date(), isActive: true, independenceStatus: 'PENDING', ...data } as MemberState
        if (state.members.some((item) => item.auditId === member.auditId && item.auditorId === member.auditorId && item.isActive)) throw Object.assign(new Error('duplicate'), { code: 'P2002' })
        if (member.role === 'LEAD' && state.members.some((item) => item.auditId === member.auditId && item.role === 'LEAD' && item.isActive)) throw Object.assign(new Error('leader'), { code: 'P2002' })
        state.members.push(member)
        return memberRecord(member)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const member = state.members.find((item) => item.id === where.id)
        if (!member) throw new Error('Member missing')
        Object.assign(member, data, { updatedAt: new Date() })
        return memberRecord(member)
      }),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const event = { id: `cmevent${state.events.length + 1}`, occurredAt: new Date(), ...data }
        state.events.push(event)
        return event
      }),
    },
    $transaction: vi.fn(async (operation: (client: unknown) => Promise<unknown>) => operation(db)),
    $queryRaw: vi.fn(async () => []),
  }
  return { db: db as unknown as PrismaClient, state }
}

async function loggedIn(db: PrismaClient, email: string) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

describe('audit team and independence service', () => {
  it('assigns internal and external auditors, exposes competencies, and changes the only leader', async () => {
    const { db, state } = makeDb(admin)
    const agent = await loggedIn(db, admin.email)
    const internal = await agent.post(`/api/audits/${auditId}/team`).send({ auditorId: state.auditors[0].id, role: 'LEAD' })
    expect(internal.status).toBe(201)
    expect(internal.body.member).toMatchObject({ role: 'LEAD', independenceStatus: 'PENDING', auditor: { type: 'INTERNAL', status: 'AVAILABLE' } })
    expect(internal.body.member.auditor.competencies[0]).toMatchObject({ name: 'ISO 9001', level: 5 })

    const external = await agent.post(`/api/audits/${auditId}/team`).send({ auditorId: state.auditors[1].id, role: 'LEAD' })
    expect(external.status).toBe(201)
    expect((await agent.get(`/api/audits/${auditId}/team`)).body.members.map((member: { role: string }) => member.role)).toEqual(['MEMBER', 'LEAD'])
    expect((await agent.post(`/api/audits/${auditId}/team`).send({ auditorId: state.auditors[1].id })).status).toBe(409)
    expect((await agent.get(`/api/audits/${auditId}/team`)).body.history).toHaveLength(2)
    expect(state.events.map((event) => event.eventType)).toContain('TEAM_MEMBER_ASSIGNED')
  })

  it('rejects unavailable and inactive auditors while retaining removed assignments for history', async () => {
    const state = newState()
    state.auditors[0].status = 'UNAVAILABLE'
    state.auditors[1].status = 'INACTIVE'
    const { db } = makeDb(admin, state)
    const agent = await loggedIn(db, admin.email)
    expect((await agent.post(`/api/audits/${auditId}/team`).send({ auditorId: state.auditors[0].id })).status).toBe(409)
    expect((await agent.post(`/api/audits/${auditId}/team`).send({ auditorId: state.auditors[1].id })).status).toBe(409)

    state.auditors[0].status = 'AVAILABLE'
    const assigned = await agent.post(`/api/audits/${auditId}/team`).send({ auditorId: state.auditors[0].id })
    expect(assigned.status).toBe(201)
    expect((await agent.delete(`/api/audits/${auditId}/team/${assigned.body.member.id}`)).status).toBe(200)
    const team = await agent.get(`/api/audits/${auditId}/team`)
    expect(team.body.members).toHaveLength(0)
    expect(team.body.history).toHaveLength(1)
    expect(team.body.history[0]).toMatchObject({ isActive: false, removedBy: { id: admin.id } })
    expect((await agent.post(`/api/audits/${auditId}/team`).send({ auditorId: state.auditors[0].id })).status).toBe(201)
    expect((await agent.get(`/api/audits/${auditId}/team`)).body.history).toHaveLength(2)
  })

  it('requires independence justification and records evaluator and status transitions distinctly', async () => {
    const { db, state } = makeDb(admin)
    const agent = await loggedIn(db, admin.email)
    const assigned = await agent.post(`/api/audits/${auditId}/team`).send({ auditorId: state.auditors[0].id })
    const memberId = assigned.body.member.id as string
    expect((await agent.patch(`/api/audits/${auditId}/team/${memberId}/independence`).send({ status: 'CONFLICT' })).status).toBe(400)
    expect((await agent.patch(`/api/audits/${auditId}/team/${memberId}/independence`).send({ status: 'MITIGATED', declaration: 'Reviewed relationships', conflictDescription: 'Prior consulting relationship' })).status).toBe(400)

    const conflict = await agent.patch(`/api/audits/${auditId}/team/${memberId}/independence`).send({ status: 'CONFLICT', declaration: 'Reviewed relationships', conflictDescription: 'Prior consulting relationship' })
    expect(conflict.status).toBe(200)
    expect(conflict.body.member).toMatchObject({ independenceStatus: 'CONFLICT', independenceEvaluatedBy: { id: admin.id } })
    const mitigated = await agent.patch(`/api/audits/${auditId}/team/${memberId}/independence`).send({ status: 'MITIGATED', mitigationMeasures: 'Independent reviewer assigned' })
    expect(mitigated.status).toBe(200)
    expect(mitigated.body.member.independenceStatus).toBe('MITIGATED')
    expect(state.events.map((event) => event.eventType)).toContain('INDEPENDENCE_EVALUATED')
  })

  it('allows company users to read, blocks writes, and isolates other companies', async () => {
    const state = newState()
    const own = makeDb(admin, state)
    const adminAgent = await loggedIn(own.db, admin.email)
    const assigned = await adminAgent.post(`/api/audits/${auditId}/team`).send({ auditorId: state.auditors[0].id })

    expect((await request(createApp(makeDb(admin).db)).get(`/api/audits/${auditId}/team`)).status).toBe(401)
    const readerAgent = await loggedIn(makeDb(reader, state).db, reader.email)
    expect((await readerAgent.get(`/api/audits/${auditId}/team`)).status).toBe(200)
    expect((await readerAgent.patch(`/api/audits/${auditId}/team/${assigned.body.member.id}`).send({ role: 'LEAD' })).status).toBe(403)
    expect((await readerAgent.delete(`/api/audits/${auditId}/team/${assigned.body.member.id}`)).status).toBe(403)

    const foreignAgent = await loggedIn(makeDb(foreignAdmin, state).db, foreignAdmin.email)
    expect((await foreignAgent.get(`/api/audits/${auditId}/team`)).status).toBe(404)
    const superAgent = await loggedIn(makeDb(superuser, state).db, superuser.email)
    expect((await superAgent.get(`/api/audits/${auditId}/team`)).status).toBe(200)
  })
})
