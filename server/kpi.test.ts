import bcrypt from 'bcryptjs'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const processId = 'cmprocess000000000000000001'
const kpiId = 'cmkpi00000000000000000001'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@kpi.test', name: 'KPI Admin', role: 'COMPANY_ADMIN' as Role, companyId }
const companyUser = { id: 'cmuser0000000000000000001', email: 'user@kpi.test', name: 'KPI User', role: 'COMPANY_USER' as Role, companyId }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@kpi.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId }
const process = { id: processId, companyId, name: 'Gestión Comercial', code: 'PROC-01' }

const payload = {
  name: 'Cumplimiento de entregas',
  description: 'Mide el porcentaje de entregas realizadas dentro del plazo comprometido.',
  frequency: 'Mensual',
  target: '95%',
  formula: 'Entregas a tiempo / total de entregas x 100',
  dataSource: 'Sistema comercial',
  unit: 'Porcentaje',
  reportResponsibleId: admin.id,
  monitorResponsibleId: companyUser.id,
  greenThreshold: '>= 95%',
  yellowThreshold: '80% - 94%',
  redThreshold: '< 80%',
}

function makeKpiDb(role: Role = 'COMPANY_ADMIN', userCompanyId = companyId) {
  const users = [admin, companyUser, foreignAdmin]
  const currentUser = users.find((user) => user.role === role && user.companyId === userCompanyId) ?? { ...admin, role, companyId: userCompanyId }
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  let sessionActive = false
  let storedKpi: Record<string, unknown> | null = null

  const responsibleView = (id: unknown) => {
    const user = users.find((item) => item.id === id)
    return user ? { id: user.id, name: user.name } : null
  }
  const kpiView = (kpi: Record<string, unknown>) => ({
    ...kpi,
    process,
    companyId: process.companyId,
    reportResponsible: responsibleView(kpi.reportResponsibleId),
    monitorResponsible: responsibleView(kpi.monitorResponsibleId),
  })

  const db = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id)
        return user ? { ...user, passwordHash } : null
      }),
    },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-kpi', expiresAt: new Date(Date.now() + 86400000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-kpi', expiresAt: new Date(Date.now() + 86400000), user: currentUser } : null),
      deleteMany: vi.fn(async () => { sessionActive = false; return { count: 1 } }),
    },
    process: {
      findUnique: vi.fn(async () => ({ ...process, company: { id: process.companyId } })),
    },
    kpi: {
      findMany: vi.fn(async () => storedKpi ? [kpiView(storedKpi)] : []),
      findUnique: vi.fn(async () => storedKpi ? kpiView(storedKpi) : null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        storedKpi = { id: kpiId, ...data, createdAt: new Date(), updatedAt: new Date() }
        return kpiView(storedKpi)
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        storedKpi = { ...(storedKpi ?? { id: kpiId }), ...data, updatedAt: new Date() }
        return kpiView(storedKpi)
      }),
      delete: vi.fn(async () => { storedKpi = null; return { id: kpiId } }),
    },
  }
  return { db: db as unknown as PrismaClient, currentUser }
}

async function loggedIn(db: PrismaClient, email = admin.email) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

describe('process KPI API', () => {
  it('creates, reads, updates and deletes a KPI scoped to its process', async () => {
    const { db } = makeKpiDb()
    const agent = await loggedIn(db)

    const created = await agent.post(`/api/processes/${processId}/kpis`).send(payload)
    expect(created.status).toBe(201)
    expect(created.body.kpi).toMatchObject({ id: kpiId, processId, companyId, name: payload.name })
    expect(created.body.kpi.reportResponsible).toEqual({ id: admin.id, name: admin.name })

    const listed = await agent.get(`/api/processes/${processId}/kpis`)
    expect(listed.status).toBe(200)
    expect(listed.body.kpis).toHaveLength(1)

    const updated = await agent.patch(`/api/processes/${processId}/kpis/${kpiId}`).send({ target: '98%' })
    expect(updated.status).toBe(200)
    expect(updated.body.kpi.target).toBe('98%')

    const removed = await agent.delete(`/api/processes/${processId}/kpis/${kpiId}`)
    expect(removed.status).toBe(204)
    expect((await agent.get(`/api/processes/${processId}/kpis`)).body.kpis).toHaveLength(0)
  })

  it('allows read-only users to list KPIs but blocks writes', async () => {
    const { db } = makeKpiDb('COMPANY_USER')
    const agent = await loggedIn(db, companyUser.email)

    expect((await agent.get(`/api/processes/${processId}/kpis`)).status).toBe(200)
    const created = await agent.post(`/api/processes/${processId}/kpis`).send(payload)
    expect(created.status).toBe(403)
  })

  it('hides another company process and rejects cross-company responsible users', async () => {
    const foreign = makeKpiDb('COMPANY_ADMIN', otherCompanyId)
    const foreignAgent = await loggedIn(foreign.db, foreignAdmin.email)
    expect((await foreignAgent.get(`/api/processes/${processId}/kpis`)).status).toBe(404)

    const own = makeKpiDb()
    const ownAgent = await loggedIn(own.db)
    const created = await ownAgent.post(`/api/processes/${processId}/kpis`).send({ ...payload, monitorResponsibleId: foreignAdmin.id })
    expect(created.status).toBe(403)
  })
})
