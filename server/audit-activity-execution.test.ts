import bcrypt from 'bcryptjs'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import request from './test-request.js'
import { createApp } from './app.js'

const companyId = 'cmcompany00000000000000001'
const auditId = 'cmaudit000000000000000001'
const processId = 'cmprocess00000000000000001'
const activityId = '00000000-0000-4000-8000-000000000001'
const teamMemberId = '00000000-0000-4000-8000-000000000002'
const checklistItemId = '00000000-0000-4000-8000-000000000003'
const evidenceId = '00000000-0000-4000-8000-000000000004'
const evidenceFileId = '00000000-0000-4000-8000-000000000005'
const findingId = '00000000-0000-4000-8000-000000000006'
const foreignFindingId = '00000000-0000-4000-8000-000000000007'

const admin = { id: 'cmadmin000000000000000001', email: 'execution@audit.test', name: 'Execution Admin', role: 'COMPANY_ADMIN' as Role, companyId, isActive: true }
const reader = { id: 'cmreader000000000000000001', email: 'reader@audit.test', name: 'Execution Reader', role: 'COMPANY_USER' as Role, companyId, isActive: true }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@audit.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: 'cmcompany00000000000000002', isActive: true }

type Row = Record<string, unknown> & { id: string }
type State = {
  plan: Row
  activity: Row
  assignment: Row
  member: Row
  events: Row[]
  checklistLinks: Row[]
  evidenceLinks: Row[]
  evidenceFileLinks: Row[]
  findingLinks: Row[]
  auditStatus: 'PLANNED' | 'IN_PROGRESS' | 'CLOSED' | 'CANCELLED'
  sequence: number
}

const resource = (id: string, auditResourceId = auditId) => ({ id, auditId: auditResourceId })

function makeDb(currentUser: typeof admin | typeof reader | typeof foreignAdmin, overrides: Partial<State> = {}) {
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  let sessionActive = false
  const state: State = {
    plan: { id: '00000000-0000-4000-8000-000000000010', auditId, status: 'APPROVED', approvedAt: new Date(), approvedById: admin.id },
    activity: {
      id: activityId,
      auditPlanId: '00000000-0000-4000-8000-000000000010',
      title: 'Entrevista de ejecución',
      type: 'INTERVIEW',
      status: 'PLANNED',
      scheduledStart: new Date('2026-11-24T09:00:00.000Z'),
      scheduledEnd: new Date('2026-11-24T10:00:00.000Z'),
      responsibleId: admin.id,
      processId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    assignment: { id: '00000000-0000-4000-8000-000000000011', activityId, auditTeamMemberId: teamMemberId, isActive: true },
    member: { id: teamMemberId, auditId, companyId, auditorId: '00000000-0000-4000-8000-000000000012', role: 'LEAD', isActive: true, independenceStatus: 'MITIGATED', mitigationMeasures: 'Revisión independiente.', auditor: { id: '00000000-0000-4000-8000-000000000012', name: 'Auditor líder', email: 'lead@audit.test', type: 'INTERNAL' } },
    events: [],
    checklistLinks: [],
    evidenceLinks: [],
    evidenceFileLinks: [],
    findingLinks: [],
    auditStatus: 'PLANNED',
    sequence: 20,
    ...overrides,
  }
  const users = [admin, reader, foreignAdmin]
  const actor = (id: unknown) => users.find((user) => user.id === id) ?? null
  const memberView = () => state.member
  const activityView = () => ({
    ...state.activity,
    responsible: actor(state.activity.responsibleId),
    process: { id: processId, companyId, name: 'Proceso comercial', code: 'PROC-01' },
    startedBy: actor(state.activity.startedById),
    completedBy: actor(state.activity.completedById),
    auditorAssignments: state.assignment.isActive ? [{ ...state.assignment, auditTeamMember: memberView() }] : [],
    checklistItemLinks: state.checklistLinks.filter((link) => link.isActive).map((link) => ({ ...link, item: resource(link.itemId) })),
    evidenceLinks: state.evidenceLinks.filter((link) => link.isActive).map((link) => ({ ...link, evidence: resource(link.evidenceId) })),
    evidenceFileLinks: state.evidenceFileLinks.filter((link) => link.isActive).map((link) => ({ ...link, evidenceFile: resource(link.evidenceFileId) })),
    findingLinks: state.findingLinks.filter((link) => link.isActive).map((link) => ({ ...link, finding: resource(link.findingId) })),
  })
  const planView = () => ({ ...state.plan, preparedBy: null, approvedBy: admin, activities: [activityView()] })
  const filterIds = (where: { id?: { in?: string[] } }, rows: Row[]) => rows.filter((row) => !where.id?.in || where.id.in.includes(row.id))
  const linkModel = (key: 'checklistLinks' | 'evidenceLinks' | 'evidenceFileLinks' | 'findingLinks') => ({
    findMany: vi.fn(async () => state[key]),
    create: vi.fn(async ({ data }: { data: Row }) => {
      state.sequence += 1
      const link = { id: `link-${state.sequence}`, isActive: true, linkedAt: new Date(), ...data } as Row
      state[key].push(link)
      return link
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
      const link = state[key].find((candidate) => candidate.id === where.id)
      if (!link) throw new Error('Link missing')
      Object.assign(link, data)
      return link
    }),
  })
  const db: Record<string, unknown> = {
    user: { findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => { const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id); return user ? { ...user, passwordHash } : null }) },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-execution', expiresAt: new Date(Date.now() + 86400000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-execution', expiresAt: new Date(Date.now() + 86400000), user: currentUser } : null),
      deleteMany: vi.fn(async () => { sessionActive = false; return { count: 1 } }),
    },
     audit: { findUnique: vi.fn(async () => ({ id: auditId, processId, status: state.auditStatus, process: { companyId } })) },
    auditPlan: { findUnique: vi.fn(async () => planView()), findUniqueOrThrow: vi.fn(async () => planView()) },
    auditPlanActivity: { update: vi.fn(async ({ data }: { data: Row }) => { Object.assign(state.activity, data, { updatedAt: new Date() }); return state.activity }) },
    auditTeamMember: { findMany: vi.fn(async () => [state.member]) },
    auditEvent: { create: vi.fn(async ({ data }: { data: Row }) => { const event = { id: `event-${state.events.length + 1}`, occurredAt: new Date(), ...data }; state.events.push(event); return event }) },
    auditChecklistItem: { findMany: vi.fn(async ({ where }: { where: { id?: { in?: string[] } } }) => filterIds(where, [{ ...resource(checklistItemId), checklistId: 'checklist-1', description: 'Criterio', result: 'PENDING' }])) },
    auditEvidence: { findMany: vi.fn(async ({ where }: { where: { id?: { in?: string[] } } }) => filterIds(where, [{ ...resource(evidenceId), name: 'Evidencia', url: 'https://example.test/evidence' }])) },
    auditEvidenceFile: { findMany: vi.fn(async ({ where }: { where: { id?: { in?: string[] } } }) => filterIds(where, [{ ...resource(evidenceFileId), filename: 'evidence.pdf' }])) },
    auditFinding: { findMany: vi.fn(async ({ where }: { where: { id?: { in?: string[] } } }) => filterIds(where, [{ ...resource(findingId), title: 'Hallazgo' }])) },
    auditPlanActivityChecklistItem: linkModel('checklistLinks', 'itemId'),
    auditPlanActivityEvidence: linkModel('evidenceLinks', 'evidenceId'),
    auditPlanActivityEvidenceFile: linkModel('evidenceFileLinks', 'evidenceFileId'),
    auditPlanActivityFinding: linkModel('findingLinks', 'findingId'),
    process: { findUnique: vi.fn(async () => ({ id: processId, companyId })) },
    auditProcess: { findFirst: vi.fn(async () => null) },
    $queryRaw: vi.fn(async () => []),
  }
  db.$transaction = vi.fn(async (operation: (client: unknown) => Promise<unknown>) => operation(db))
  return { db: db as unknown as PrismaClient, state }
}

async function loggedIn(db: PrismaClient, email: string) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

describe('audit activity execution', () => {
  it('starts, updates, links resources and completes without changing planning fields', async () => {
    const { db, state } = makeDb(admin)
    const agent = await loggedIn(db, admin.email)
    const start = await agent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/start`).send({})
    expect(start.status).toBe(200)
    expect(start.body.warnings[0]).toContain('mitigated')
    expect(state.activity).toMatchObject({ status: 'IN_PROGRESS', title: 'Entrevista de ejecución', processId })
    expect(state.activity.actualStart).toBeInstanceOf(Date)
    expect((await agent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/start`).send({})).status).toBe(409)

    const updated = await agent.patch(`/api/audits/${auditId}/plan/activities/${activityId}/execution`).send({ executionObservations: 'Se revisaron los controles.' })
    expect(updated.status).toBe(200)
    expect(updated.body.plan.activities[0].execution.observations).toBe('Se revisaron los controles.')

    for (const [suffix, body] of [
      ['checklist-items', { itemIds: [checklistItemId] }],
      ['evidences', { evidenceIds: [evidenceId] }],
      ['evidence-files', { evidenceFileIds: [evidenceFileId] }],
      ['findings', { findingIds: [findingId] }],
    ] as const) {
      expect((await agent.put(`/api/audits/${auditId}/plan/activities/${activityId}/execution/${suffix}`).send(body)).status).toBe(200)
    }
    expect((await agent.put(`/api/audits/${auditId}/plan/activities/${activityId}/execution/findings`).send({ findingIds: [] })).status).toBe(200)
    expect(state.findingLinks[0].isActive).toBe(false)
    expect(state.events.map((event) => event.eventType)).toContain('AUDIT_PLAN_ACTIVITY_RESOURCE_UNLINKED')
    expect((await agent.put(`/api/audits/${auditId}/plan/activities/${activityId}/execution/findings`).send({ findingIds: [findingId] })).status).toBe(200)

    const complete = await agent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/complete`).send({ executionResult: 'SATISFACTORY' })
    expect(complete.status).toBe(200)
    expect(complete.body.plan.activities[0].status).toBe('COMPLETED')
    expect(complete.body.plan.activities[0].execution.result).toBe('SATISFACTORY')
    expect((state.activity.actualEnd as Date).getTime()).toBeGreaterThan((state.activity.actualStart as Date).getTime())
    expect(state.activity.scheduledStart).toEqual(new Date('2026-11-24T09:00:00.000Z'))
    expect(state.activity.scheduledEnd).toEqual(new Date('2026-11-24T10:00:00.000Z'))
    expect(state.events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'AUDIT_PLAN_ACTIVITY_EXECUTION_STARTED',
      'AUDIT_PLAN_ACTIVITY_EXECUTION_UPDATED',
      'AUDIT_PLAN_ACTIVITY_RESOURCE_LINKED',
      'AUDIT_PLAN_ACTIVITY_EXECUTION_COMPLETED',
    ]))
    expect((await agent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/complete`).send({ executionResult: 'ISSUE' })).status).toBe(409)
    expect((await agent.put(`/api/audits/${auditId}/plan/activities/${activityId}/execution/findings`).send({ findingIds: [] })).status).toBe(409)
  })

  it('requires an approved plan, valid transitions and complete dates/result', async () => {
    const { db, state } = makeDb(admin)
    const agent = await loggedIn(db, admin.email)
    state.plan.status = 'READY'
    expect((await agent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/start`).send({})).status).toBe(409)
    state.plan.status = 'APPROVED'
    state.activity.status = 'COMPLETED'
    expect((await agent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/start`).send({})).status).toBe(409)
    state.activity.status = 'PLANNED'
    expect((await agent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/cancel`).send({ executionObservations: 'No disponible' })).status).toBe(200)
    expect((await agent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/cancel`).send({})).status).toBe(409)
  })

  it('blocks unresolved or retired auditors and preserves read/write isolation', async () => {
    const clear = makeDb(admin)
    clear.state.member.independenceStatus = 'CLEAR'
    const clearAgent = await loggedIn(clear.db, admin.email)
    const clearStart = await clearAgent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/start`).send({})
    expect(clearStart.status).toBe(200)
    expect(clearStart.body.warnings).toBeUndefined()

    const pending = makeDb(admin)
    pending.state.member.independenceStatus = 'PENDING'
    const pendingAgent = await loggedIn(pending.db, admin.email)
    expect((await pendingAgent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/start`).send({})).status).toBe(409)

    const retired = makeDb(admin)
    retired.state.member.isActive = false
    const retiredAgent = await loggedIn(retired.db, admin.email)
    expect((await retiredAgent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/start`).send({})).status).toBe(409)

    const isolated = makeDb(reader)
    const readerAgent = await loggedIn(isolated.db, reader.email)
    expect((await readerAgent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/start`).send({})).status).toBe(403)
    const externalAgent = request.agent(createApp(clear.db))
    expect((await externalAgent.post('/api/auth/login').send({ email: 'lead@audit.test', password: 'Password123!' })).status).toBe(401)
  })

  it('rejects duplicate and cross-audit resource links', async () => {
    const { db, state } = makeDb(admin)
    const agent = await loggedIn(db, admin.email)
    await agent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/start`).send({})
    expect((await agent.put(`/api/audits/${auditId}/plan/activities/${activityId}/execution/findings`).send({ findingIds: [findingId, findingId] })).status).toBe(400)
    const foreign = await agent.put(`/api/audits/${auditId}/plan/activities/${activityId}/execution/findings`).send({ findingIds: [foreignFindingId] })
    expect(foreign.status).toBe(404)
    expect(state.findingLinks).toHaveLength(0)
  })

  it('keeps terminal activities immutable and isolates closed audits and companies', async () => {
    const completed = makeDb(admin)
    const completedAgent = await loggedIn(completed.db, admin.email)
    await completedAgent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/start`).send({})
    const completion = await completedAgent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/complete`).send({ executionResult: 'ISSUE' })
    expect(completion.status).toBe(200)
    expect((await completedAgent.patch(`/api/audits/${auditId}/plan/activities/${activityId}/execution`).send({ executionObservations: 'No debe cambiar.' })).status).toBe(409)
    expect((await completedAgent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/start`).send({})).status).toBe(409)
    expect((await completedAgent.put(`/api/audits/${auditId}/plan/activities/${activityId}/execution/findings`).send({ findingIds: [] })).status).toBe(409)

    const planned = makeDb(admin)
    const plannedAgent = await loggedIn(planned.db, admin.email)
    expect((await plannedAgent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/complete`).send({ executionResult: 'ISSUE' })).status).toBe(409)
    expect((await plannedAgent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/complete`).send({ executionResult: 'INVALID' })).status).toBe(400)

    for (const auditStatus of ['CLOSED', 'CANCELLED'] as const) {
      const terminal = makeDb(admin, { auditStatus })
      const terminalAgent = await loggedIn(terminal.db, admin.email)
      expect((await terminalAgent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/start`).send({})).status).toBe(409)
    }

    const foreign = makeDb(foreignAdmin)
    const foreignAgent = await loggedIn(foreign.db, foreignAdmin.email)
    expect((await foreignAgent.post(`/api/audits/${auditId}/plan/activities/${activityId}/execution/start`).send({})).status).toBe(404)
  })
})
