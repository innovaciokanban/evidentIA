import bcrypt from 'bcryptjs'
import request from './test-request.js'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const processId = 'cmprocess000000000000000001'
const firstIndicatorId = 'cmindicator0000000000000001'
const secondIndicatorId = 'cmindicator0000000000000002'
const thirdIndicatorId = 'cmindicator0000000000000003'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@indicator.test', name: 'Indicator Admin', role: 'COMPANY_ADMIN' as Role, companyId, isActive: true }
const companyUser = { id: 'cmuser0000000000000000001', email: 'user@indicator.test', name: 'Indicator User', role: 'COMPANY_USER' as Role, companyId, isActive: true }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@indicator.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId, isActive: true }
const process = { id: processId, companyId, name: 'Gestión Comercial', code: 'PROC-01' }

const payload = {
  name: 'Cumplimiento de entregas',
  description: 'Mide el porcentaje de entregas dentro del plazo comprometido.',
  frequency: 'Mensual',
  target: '95%',
  formula: 'Entregas a tiempo / total de entregas',
  dataSource: 'Sistema comercial',
  unit: 'Porcentaje',
  reportResponsibleId: admin.id,
  monitorResponsibleId: companyUser.id,
  greenThreshold: '>= 95%',
  yellowThreshold: '80% - 94%',
  redThreshold: '< 80%',
  baselineValue: '88%',
  measurementMethod: 'Corte mensual',
  deadline: '2026-12-31',
}

function makeIndicatorDb(role: Role = 'COMPANY_ADMIN', userCompanyId = companyId) {
  const users = [admin, companyUser, foreignAdmin]
  const currentUser = users.find((user) => user.role === role && user.companyId === userCompanyId) ?? { ...admin, role, companyId: userCompanyId }
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  let sessionActive = false
  let storedIndicators: Array<Record<string, unknown>> = []

  const responsibleView = (id: unknown) => {
    const user = users.find((item) => item.id === id)
    return user ? { id: user.id, name: user.name, isActive: user.isActive } : null
  }
  const indicatorView = (indicator: Record<string, unknown>) => ({
    ...indicator,
    reportResponsible: responsibleView(indicator.reportResponsibleId),
    monitorResponsible: responsibleView(indicator.monitorResponsibleId),
  })

  const db = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id)
        return user ? { ...user, passwordHash } : null
      }),
    },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-indicator', expiresAt: new Date(Date.now() + 86400000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-indicator', expiresAt: new Date(Date.now() + 86400000), user: currentUser } : null),
      deleteMany: vi.fn(async () => { sessionActive = false; return { count: 1 } }),
    },
    process: {
      findUnique: vi.fn(async () => ({ ...process, company: { id: process.companyId } })),
    },
    processIndicator: {
      findMany: vi.fn(async ({ select }: { select?: Record<string, boolean> }) => select ? storedIndicators.map(({ id, name }) => ({ id, name })) : storedIndicators.map(indicatorView)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const indicator = storedIndicators.find((item) => item.id === where.id)
        return indicator ? indicatorView(indicator) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = storedIndicators.length === 0 ? firstIndicatorId : storedIndicators.length === 1 ? secondIndicatorId : thirdIndicatorId
        const indicator = { id, ...data, createdAt: new Date(), updatedAt: new Date() }
        storedIndicators.push(indicator)
        return indicatorView(indicator)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = storedIndicators.findIndex((item) => item.id === where.id)
        storedIndicators[index] = { ...storedIndicators[index], ...data, updatedAt: new Date() }
        return indicatorView(storedIndicators[index])
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        storedIndicators = storedIndicators.filter((item) => item.id !== where.id)
        return { id: where.id }
      }),
    },
    kpi: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    processKpi: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(async (operation: (client: unknown) => Promise<unknown>) => operation(db)),
  }
  return { db: db as unknown as PrismaClient, currentUser }
}

async function loggedIn(db: PrismaClient, email = admin.email) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

describe('process indicator API', () => {
  it('creates, lists, updates and deletes multiple indicators without touching the KPI catalog', async () => {
    const { db } = makeIndicatorDb()
    const agent = await loggedIn(db)

    const created = await agent.post(`/api/processes/${processId}/indicators`).send(payload)
    expect(created.status).toBe(201)
    expect(created.body.indicator).toMatchObject({ id: firstIndicatorId, processId, name: payload.name })

    const second = await agent.post(`/api/processes/${processId}/indicators`).send({ ...payload, name: 'Tiempo de respuesta' })
    expect(second.status).toBe(201)
    const third = await agent.post(`/api/processes/${processId}/indicators`).send({ ...payload, name: 'Satisfacción del cliente' })
    expect(third.status).toBe(201)
    const listed = await agent.get(`/api/processes/${processId}/indicators`)
    expect(listed.status).toBe(200)
    expect(listed.body.indicators).toHaveLength(3)

    const updated = await agent.patch(`/api/processes/${processId}/indicators/${firstIndicatorId}`).send({ target: '98%' })
    expect(updated.status).toBe(200)
    expect(updated.body.indicator.target).toBe('98%')

    expect((await agent.delete(`/api/processes/${processId}/indicators/${secondIndicatorId}`)).status).toBe(204)
    expect((await agent.get(`/api/processes/${processId}/indicators`)).body.indicators).toHaveLength(2)
    expect(db.kpi.create).not.toHaveBeenCalled()
    expect(db.processKpi.create).not.toHaveBeenCalled()
  })

  it('rejects normalized duplicate names and cross-company responsible users', async () => {
    const { db } = makeIndicatorDb()
    const agent = await loggedIn(db)
    expect((await agent.post(`/api/processes/${processId}/indicators`).send(payload)).status).toBe(201)

    const duplicate = await agent.post(`/api/processes/${processId}/indicators`).send({ ...payload, name: '  CUMPLIMIENTO   DE entregas ' })
    expect(duplicate.status).toBe(409)

    const foreign = await agent.post(`/api/processes/${processId}/indicators`).send({ ...payload, name: 'Indicador extranjero', reportResponsibleId: foreignAdmin.id })
    expect(foreign.status).toBe(403)
  })

  it('allows reads for company users, blocks writes, and hides another company process', async () => {
    const readOnly = makeIndicatorDb('COMPANY_USER')
    const readOnlyAgent = await loggedIn(readOnly.db, companyUser.email)
    expect((await readOnlyAgent.get(`/api/processes/${processId}/indicators`)).status).toBe(200)
    expect((await readOnlyAgent.post(`/api/processes/${processId}/indicators`).send(payload)).status).toBe(403)

    const foreign = makeIndicatorDb('COMPANY_ADMIN', otherCompanyId)
    const foreignAgent = await loggedIn(foreign.db, foreignAdmin.email)
    expect((await foreignAgent.get(`/api/processes/${processId}/indicators`)).status).toBe(404)
  })
})
