import bcrypt from 'bcryptjs'
import request from './test-request.js'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const auditId = 'cmaudit000000000000000001'
const otherAuditId = 'cmaudit000000000000000002'
const processId = 'cmprocess00000000000000001'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@plan.test', name: 'Plan Admin', role: 'COMPANY_ADMIN' as Role, companyId, isActive: true }
const reader = { id: 'cmreader00000000000000001', email: 'reader@plan.test', name: 'Plan Reader', role: 'COMPANY_USER' as Role, companyId, isActive: true }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@plan.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId, isActive: true }

type PlanRow = Record<string, unknown> & { id: string }
type TeamMemberQuery = { id?: { in?: string[] }; auditId?: string; companyId?: string; isActive?: boolean }
type PlanState = {
  plan: PlanRow | null
  activities: PlanRow[]
  activityAuditors: PlanRow[]
  team: PlanRow[]
  events: PlanRow[]
  sequence: number
}

const newState = (): PlanState => ({ plan: null, activities: [], activityAuditors: [], team: [], events: [], sequence: 0 })

function makeDb(currentUser: typeof admin | typeof reader | typeof foreignAdmin, state = newState()) {
  const users = [admin, reader, foreignAdmin]
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  let sessionActive = false
  const process = { id: processId, companyId, name: 'Proceso comercial', code: 'PROC-01' }
  const actor = (id: unknown) => users.find((user) => user.id === id) ?? null
  const teamMemberView = (member: PlanRow) => ({
    ...member,
    auditor: member.auditor ?? {
      id: member.auditorId,
      companyId: member.companyId,
      name: member.name ?? 'Auditor de prueba',
      email: member.email ?? 'auditor@example.com',
      type: member.type ?? 'INTERNAL',
    },
  })
  const activityView = (activity: PlanRow) => ({
    ...activity,
    responsible: activity.responsibleId ? actor(activity.responsibleId) : null,
    process: activity.processId ? process : null,
    auditorAssignments: state.activityAuditors
      .filter((assignment) => assignment.activityId === activity.id && assignment.isActive)
      .map((assignment) => ({ ...assignment, auditTeamMember: teamMemberView(state.team.find((member) => member.id === assignment.auditTeamMemberId) ?? {}) })),
  })
  const planView = () => state.plan ? {
    ...state.plan,
    preparedBy: state.plan.preparedById ? actor(state.plan.preparedById) : null,
    approvedBy: state.plan.approvedById ? actor(state.plan.approvedById) : null,
    activities: state.activities.map(activityView),
  } : null
  const overlaps = (activity: PlanRow, where: Record<string, unknown>) => {
    const excludedId = where.id as { not?: string } | undefined
    const start = where.scheduledStart as { lt: Date }
    const end = where.scheduledEnd as { gt: Date }
    return activity.auditPlanId === where.auditPlanId
      && activity.status !== 'CANCELLED'
      && (!excludedId?.not || activity.id !== excludedId.not)
      && new Date(activity.scheduledStart as string) < start.lt
      && new Date(activity.scheduledEnd as string) > end.gt
  }

  const db: Record<string, unknown> = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id)
        return user ? { ...user, passwordHash } : null
      }),
    },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-plan', expiresAt: new Date(Date.now() + 86400000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-plan', expiresAt: new Date(Date.now() + 86400000), user: currentUser } : null),
      deleteMany: vi.fn(async () => { sessionActive = false; return { count: 1 } }),
    },
    audit: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === auditId ? { id: auditId, processId, status: 'PLANNED', process: { companyId } } : null),
    },
    auditPlan: {
      findUnique: vi.fn(async () => planView()),
      findUniqueOrThrow: vi.fn(async () => planView()),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.sequence += 1
        state.plan = { id: `cmplan00000000000000000${state.sequence}`, createdAt: new Date(), updatedAt: new Date(), status: 'DRAFT', ...data } as PlanRow
        return planView()
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (!state.plan) throw new Error('Plan missing')
        Object.assign(state.plan, data, { updatedAt: new Date() })
        return planView()
      }),
    },
    auditPlanActivity: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => state.activities.find((activity) => overlaps(activity, where)) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.activities.find((activity) => activity.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.sequence += 1
        const activity = { id: `00000000-0000-4000-8000-${String(state.sequence).padStart(12, '0')}`, createdAt: new Date(), updatedAt: new Date(), status: 'PLANNED', ...data } as PlanRow
        state.activities.push(activity)
        return activity
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const activity = state.activities.find((item) => item.id === where.id)
        if (!activity) throw new Error('Activity missing')
        Object.assign(activity, data, { updatedAt: new Date() })
        return activity
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = state.activities.findIndex((activity) => activity.id === where.id)
        if (index >= 0) state.activities.splice(index, 1)
        return { id: where.id }
      }),
    },
    auditTeamMember: {
      findMany: vi.fn(async ({ where }: { where?: TeamMemberQuery } = {}) => state.team.filter((member) => {
        const ids = where?.id?.in
        return (!ids || ids.includes(String(member.id)))
          && (!where?.auditId || member.auditId === where.auditId)
          && (!where?.companyId || member.companyId === where.companyId)
          && (!where?.isActive || member.isActive === where.isActive)
      }).map(teamMemberView)),
    },
    auditPlanActivityAuditor: {
      findMany: vi.fn(async ({ where }: { where?: { activityId?: string } } = {}) => state.activityAuditors.filter((assignment) => !where?.activityId || assignment.activityId === where.activityId)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.sequence += 1
        const assignment = { id: `cmauditorassignment000${state.sequence}`, isActive: true, assignedAt: new Date(), ...data } as PlanRow
        state.activityAuditors.push(assignment)
        return assignment
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const assignment = state.activityAuditors.find((item) => item.id === where.id)
        if (!assignment) throw new Error('Assignment missing')
        Object.assign(assignment, data)
        return assignment
      }),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const event = { id: `cmevent${state.events.length + 1}`, occurredAt: new Date(), ...data }
        state.events.push(event)
        return event
      }),
    },
    process: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === processId ? process : null),
    },
    auditProcess: {
      findFirst: vi.fn(async () => null),
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

const activityPayload = {
  type: 'INTERVIEW',
  title: 'Entrevista con responsable del proceso',
  scheduledStart: '2026-11-24T09:00:00.000Z',
  scheduledEnd: '2026-11-24T10:00:00.000Z',
  responsibleId: admin.id,
  processId,
}

const teamMember = (id: string, overrides: Record<string, unknown> = {}): PlanRow => ({
  id,
  auditId,
  companyId,
  auditorId: `auditor-${id}`,
  name: `Auditor ${id}`,
  email: `${id}@auditor.test`,
  type: 'INTERNAL',
  role: 'MEMBER',
  isActive: true,
  independenceStatus: 'CLEAR',
  mitigationMeasures: null,
  ...overrides,
})

const teamLeadId = '00000000-0000-4000-8000-000000000001'
const teamMemberId = '00000000-0000-4000-8000-000000000002'
const foreignTeamMemberId = '00000000-0000-4000-8000-000000000003'
const retiredTeamMemberId = '00000000-0000-4000-8000-000000000004'
const otherAuditTeamMemberId = '00000000-0000-4000-8000-000000000005'

describe('audit plan and agenda service', () => {
  it('creates a plan, rejects overlapping activities, and enforces team readiness', async () => {
    const { db, state } = makeDb(admin)
    const agent = await loggedIn(db, admin.email)
    expect((await agent.post(`/api/audits/${auditId}/plan`).send({ methodology: 'Risk-based interviews and document review.' })).status).toBe(201)
    expect((await agent.post(`/api/audits/${auditId}/plan/activities`).send(activityPayload)).status).toBe(201)
    expect((await agent.post(`/api/audits/${auditId}/plan/activities`).send({ ...activityPayload, title: 'Actividad solapada', scheduledStart: '2026-11-24T09:30:00.000Z', scheduledEnd: '2026-11-24T10:30:00.000Z' })).status).toBe(409)
    expect((await agent.post(`/api/audits/${auditId}/plan/status`).send({ status: 'READY' })).status).toBe(409)

    state.team.push(teamMember(teamLeadId, { role: 'LEAD', independenceStatus: 'PENDING' }))
    const assigned = await agent.put(`/api/audits/${auditId}/plan/activities/${state.activities[0].id}/auditors`).send({ auditTeamMemberIds: [teamLeadId] })
    expect(assigned.status).toBe(200)
    expect(assigned.body.plan.activities[0].auditors).toHaveLength(1)
    expect(assigned.body.plan.activities[0].responsible.id).toBe(admin.id)
    expect((await agent.post(`/api/audits/${auditId}/plan/status`).send({ status: 'READY' })).status).toBe(409)
    state.team[0].independenceStatus = 'CLEAR'
    expect((await agent.post(`/api/audits/${auditId}/plan/status`).send({ status: 'READY' })).status).toBe(200)
    expect((await agent.post(`/api/audits/${auditId}/plan/status`).send({ status: 'APPROVED' })).body.plan.status).toBe('APPROVED')
    expect(state.events.map((event) => event.eventType)).toContain('AUDIT_PLAN_STATUS_CHANGED')
  })

  it('allows readers to view the plan but blocks writes and isolates companies', async () => {
    const initial = makeDb(admin)
    const adminAgent = await loggedIn(initial.db, admin.email)
    await adminAgent.post(`/api/audits/${auditId}/plan`).send({ methodology: 'Document review.' })
    await adminAgent.post(`/api/audits/${auditId}/plan/activities`).send(activityPayload)
    const readerDb = makeDb(reader, initial.state)
    const readerAgent = await loggedIn(readerDb.db, reader.email)
    expect((await readerAgent.get(`/api/audits/${auditId}/plan`)).status).toBe(200)
    expect((await readerAgent.patch(`/api/audits/${auditId}/plan`).send({ notes: 'Nope' })).status).toBe(403)
    expect((await readerAgent.put(`/api/audits/${auditId}/plan/activities/${initial.state.activities[0].id}/auditors`).send({ auditTeamMemberIds: [] })).status).toBe(403)
    const foreignAgent = await loggedIn(makeDb(foreignAdmin).db, foreignAdmin.email)
    expect((await foreignAgent.get(`/api/audits/${auditId}/plan`)).status).toBe(404)
  })

  it('assigns multiple internal or external team members without changing the operational responsible user', async () => {
    const { db, state } = makeDb(admin)
    const agent = await loggedIn(db, admin.email)
    state.team.push(
      teamMember(teamLeadId, { role: 'LEAD', independenceStatus: 'MITIGATED', mitigationMeasures: 'Revisión independiente.', name: 'Auditor Externo', type: 'EXTERNAL' }),
      teamMember(teamMemberId, { role: 'MEMBER', name: 'Auditor Interno' }),
    )
    await agent.post(`/api/audits/${auditId}/plan`).send({ methodology: 'Document review.' })
    await agent.post(`/api/audits/${auditId}/plan/activities`).send(activityPayload)

    const activityId = state.activities[0].id
    const response = await agent.put(`/api/audits/${auditId}/plan/activities/${activityId}/auditors`).send({ auditTeamMemberIds: [teamLeadId, teamMemberId] })
    expect(response.status).toBe(200)
    expect(response.body.plan.activities[0].auditors).toEqual([
      expect.objectContaining({ teamMemberId: teamLeadId, name: 'Auditor Externo', role: 'LEAD', type: 'EXTERNAL', independenceStatus: 'MITIGATED' }),
      expect.objectContaining({ teamMemberId, name: 'Auditor Interno', role: 'MEMBER', type: 'INTERNAL', independenceStatus: 'CLEAR' }),
    ])
    expect(response.body.plan.activities[0].responsible).toMatchObject({ id: admin.id, name: admin.name })
    expect(state.activityAuditors).toHaveLength(2)
    expect(state.events.at(-1)).toMatchObject({ eventType: 'AUDIT_PLAN_ACTIVITY_UPDATED' })

    const cleared = await agent.put(`/api/audits/${auditId}/plan/activities/${activityId}/auditors`).send({ auditTeamMemberIds: [] })
    expect(cleared.status).toBe(200)
    expect(cleared.body.plan.activities[0].auditors).toEqual([])
    expect(state.activities).toHaveLength(1)
    expect(state.activityAuditors.every((assignment) => assignment.isActive === false)).toBe(true)
  })

  it('edits a planned activity and assigns auditors without forcing a status transition', async () => {
    const { db, state } = makeDb(admin)
    const agent = await loggedIn(db, admin.email)
    state.team.push(
      teamMember(teamLeadId, { role: 'LEAD', independenceStatus: 'MITIGATED', mitigationMeasures: 'Revisión independiente.' }),
      teamMember(teamMemberId),
    )
    await agent.post(`/api/audits/${auditId}/plan`).send({ methodology: 'Document review.' })
    await agent.post(`/api/audits/${auditId}/plan/activities`).send(activityPayload)
    const activityId = state.activities[0].id

    const edited = await agent.patch(`/api/audits/${auditId}/plan/activities/${activityId}`).send({
      title: 'Reunión de apertura actualizada',
      responsibleId: admin.id,
      processId,
    })
    expect(edited.status).toBe(200)
    expect(edited.body.plan.activities[0]).toMatchObject({ status: 'PLANNED', responsible: { id: admin.id }, process: { id: processId } })

    const sameStatus = await agent.patch(`/api/audits/${auditId}/plan/activities/${activityId}`).send({ status: 'PLANNED' })
    expect(sameStatus.status).toBe(200)

    const assigned = await agent.put(`/api/audits/${auditId}/plan/activities/${activityId}/auditors`).send({ auditTeamMemberIds: [teamLeadId, teamMemberId] })
    expect(assigned.status).toBe(200)
    expect(assigned.body.plan.activities[0].auditors).toHaveLength(2)
    expect(assigned.body.plan.activities[0]).toMatchObject({ status: 'PLANNED', responsible: { id: admin.id }, process: { id: processId } })
    expect(state.activities).toHaveLength(1)

    const invalidTransition = await agent.patch(`/api/audits/${auditId}/plan/activities/${activityId}`).send({ status: 'IN_PROGRESS' })
    expect(invalidTransition.status).toBe(200)
    const invalidReverse = await agent.patch(`/api/audits/${auditId}/plan/activities/${activityId}`).send({ status: 'PLANNED' })
    expect(invalidReverse.status).toBe(409)
    expect(invalidReverse.body.error).toBe('Invalid audit plan activity status transition')
  })

  it('rejects duplicate, foreign and retired team member assignments', async () => {
    const { db, state } = makeDb(admin)
    const agent = await loggedIn(db, admin.email)
    state.team.push(
      teamMember(teamMemberId),
      teamMember(foreignTeamMemberId, { companyId: otherCompanyId }),
      teamMember(retiredTeamMemberId, { isActive: false }),
      teamMember(otherAuditTeamMemberId, { auditId: otherAuditId }),
    )
    await agent.post(`/api/audits/${auditId}/plan`).send({ methodology: 'Document review.' })
    await agent.post(`/api/audits/${auditId}/plan/activities`).send(activityPayload)
    const path = `/api/audits/${auditId}/plan/activities/${state.activities[0].id}/auditors`

    expect((await agent.put(path).send({ auditTeamMemberIds: [teamMemberId, teamMemberId] })).status).toBe(400)
    expect((await agent.put(path).send({ auditTeamMemberIds: [foreignTeamMemberId] })).status).toBe(404)
    expect((await agent.put(path).send({ auditTeamMemberIds: [retiredTeamMemberId] })).status).toBe(409)
    expect((await agent.put(path).send({ auditTeamMemberIds: [otherAuditTeamMemberId] })).status).toBe(404)
    expect(state.activityAuditors).toHaveLength(0)
  })

  it('blocks pending or conflicted assigned auditors at READY and returns mitigated warnings', async () => {
    const { db, state } = makeDb(admin)
    const agent = await loggedIn(db, admin.email)
    state.team.push(teamMember(teamLeadId, { role: 'LEAD', independenceStatus: 'MITIGATED', mitigationMeasures: 'Revisión por un segundo auditor.' }))
    await agent.post(`/api/audits/${auditId}/plan`).send({ methodology: 'Document review.' })
    await agent.post(`/api/audits/${auditId}/plan/activities`).send(activityPayload)
    const path = `/api/audits/${auditId}/plan/activities/${state.activities[0].id}/auditors`
    await agent.put(path).send({ auditTeamMemberIds: [teamLeadId] })

    const ready = await agent.post(`/api/audits/${auditId}/plan/status`).send({ status: 'READY' })
    expect(ready.status).toBe(200)
    expect(ready.body.warnings[0]).toContain('Mitigado')
    state.team[0].independenceStatus = 'CONFLICT'
    expect((await agent.post(`/api/audits/${auditId}/plan/status`).send({ status: 'APPROVED' })).status).toBe(409)
  })
})
