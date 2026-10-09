import bcrypt from 'bcryptjs'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'

type ControlEvaluation = 'PENDING' | 'WEAK' | 'PARTIAL' | 'EFFECTIVE'
type StoredControl = { id: string; riskId: string; description: string; evaluation: ControlEvaluation; createdAt: Date; updatedAt: Date }
type StoredRisk = { id: string; processId: string; name: string; description: string; riskType: string; bpmnActivity: string; inherentImpact: number; inherentProbability: number; residualImpact: number; residualProbability: number; controls: StoredControl[]; createdAt: Date; updatedAt: Date }
type TestProcess = { id: string; companyId: string; name: string; code: string | null; type: 'MISSIONAL'; version: string | null; frequency: string | null; organizationalArea: string | null; supervision: string | null; executionType: string | null; objective: string; description: string | null; responsibleId: string | null; status: 'ACTIVE'; thirdPartyProvided: boolean; critical: boolean; affectsAccounting: boolean; personalData: boolean; createdAt: Date; updatedAt: Date }

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const processId = 'cmprocess000000000000000001'
const otherProcessId = 'cmprocess000000000000000002'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@risk.test', name: 'Risk Admin', role: 'COMPANY_ADMIN' as Role, companyId }
const companyUser = { id: 'cmuser0000000000000000001', email: 'user@risk.test', name: 'Risk User', role: 'COMPANY_USER' as Role, companyId }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@risk.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId }

const makeProcess = (id: string, owningCompanyId: string, name: string): TestProcess => ({
  id, companyId: owningCompanyId, name, code: 'PROC-01', type: 'MISSIONAL', version: '1.0', frequency: null, organizationalArea: null,
  supervision: null, executionType: null, objective: 'Gestionar el proceso', description: null,
  responsibleId: null, status: 'ACTIVE', thirdPartyProvided: false, critical: false,
  affectsAccounting: false, personalData: false, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
})

function makeRiskDb(role: Role = 'COMPANY_ADMIN', userCompanyId = companyId) {
  const users = [admin, companyUser, foreignAdmin]
  const currentUser = users.find((user) => user.role === role && user.companyId === userCompanyId) ?? { ...admin, role, companyId: userCompanyId }
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  let sessionActive = false
  let storedProcesses: TestProcess[] = [makeProcess(processId, companyId, 'Proceso principal'), makeProcess(otherProcessId, companyId, 'Otro proceso')]
  const storedRisks: StoredRisk[] = []
  let nextProcess = 3
  let nextRisk = 1
  let nextControl = 1
  const processFor = (id: string) => storedProcesses.find((item) => item.id === id) ?? null
  const processView = (item: TestProcess) => ({ ...item, company: { id: item.companyId }, responsible: null })
  const riskFor = (id: string) => storedRisks.find((item) => item.id === id) ?? null

  const db = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id)
        return user ? { ...user, passwordHash } : null
      }),
    },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-risk', expiresAt: new Date(Date.now() + 86400000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-risk', expiresAt: new Date(Date.now() + 86400000), user: currentUser } : null),
      deleteMany: vi.fn(async () => { sessionActive = false; return { count: 1 } }),
    },
    company: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === companyId ? { id: companyId } : where.id === otherCompanyId ? { id: otherCompanyId } : null),
    },
    process: {
      findMany: vi.fn(async ({ where }: { where?: { companyId?: string } } = {}) => storedProcesses.filter((item) => !where?.companyId || item.companyId === where.companyId).map(processView)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const item = processFor(where.id); return item ? processView(item) : null }),
      findFirst: vi.fn(async ({ where }: { where: { companyId: string; name: string; NOT?: { id: string } } }) => storedProcesses.find((item) => item.companyId === where.companyId && item.name === where.name && item.id !== where.NOT?.id) ? { id: 'duplicate' } : null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const item = { ...makeProcess(`cmprocesscreated${String(nextProcess++).padStart(10, '0')}`, String(data.companyId), String(data.name)), ...data, createdAt: new Date(), updatedAt: new Date() } as TestProcess
        storedProcesses = [...storedProcesses, item]
        return processView(item)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const current = processFor(where.id) as TestProcess
        const updated = { ...current, ...data, updatedAt: new Date() } as TestProcess
        storedProcesses = storedProcesses.map((item) => item.id === where.id ? updated : item)
        return processView(updated)
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        storedProcesses = storedProcesses.filter((item) => item.id !== where.id)
        for (let index = storedRisks.length - 1; index >= 0; index -= 1) if (storedRisks[index].processId === where.id) storedRisks.splice(index, 1)
        return { id: where.id }
      }),
    },
    risk: {
      findMany: vi.fn(async ({ where }: { where: { processId: string } }) => storedRisks.filter((item) => item.processId === where.processId)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => riskFor(where.id)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const risk: StoredRisk = { id: `cmriskcreated${String(nextRisk++).padStart(10, '0')}`, processId: String(data.processId), name: String(data.name), description: String(data.description), riskType: String(data.riskType), bpmnActivity: String(data.bpmnActivity), inherentImpact: Number(data.inherentImpact), inherentProbability: Number(data.inherentProbability), residualImpact: Number(data.residualImpact), residualProbability: Number(data.residualProbability), controls: [], createdAt: new Date(), updatedAt: new Date() }
        storedRisks.push(risk)
        return risk
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const risk = riskFor(where.id) as StoredRisk
        Object.assign(risk, data, { updatedAt: new Date() })
        return risk
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => { const index = storedRisks.findIndex((item) => item.id === where.id); const [removed] = storedRisks.splice(index, 1); return removed }),
    },
    riskControl: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => storedRisks.flatMap((risk) => risk.controls).find((control) => control.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: { riskId: string; description: string; evaluation: ControlEvaluation } }) => {
        const control: StoredControl = { id: `cmcontrol${String(nextControl++).padStart(12, '0')}`, ...data, createdAt: new Date(), updatedAt: new Date() }
        ;(riskFor(data.riskId) as StoredRisk).controls.push(control)
        return control
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<StoredControl> }) => {
        const control = storedRisks.flatMap((risk) => risk.controls).find((item) => item.id === where.id) as StoredControl
        Object.assign(control, data, { updatedAt: new Date() })
        return control
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        for (const risk of storedRisks) { const index = risk.controls.findIndex((item) => item.id === where.id); if (index >= 0) return risk.controls.splice(index, 1)[0] }
        return null
      }),
    },
  }
  return { db: db as unknown as PrismaClient, storedRisks }
}

const riskPayload = {
  name: 'Entrega tardía de información', description: 'La información puede llegar después del plazo y afectar la respuesta.', riskType: 'Operativo', bpmnActivity: 'Validar solicitud',
  inherentImpact: 3, inherentProbability: 4, residualImpact: 2, residualProbability: 2,
}

async function loggedIn(db: PrismaClient, email: string) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

describe('process risk API', () => {
  it('creates multiple risks, calculates levels, validates scale, edits and deletes', async () => {
    const { db } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    const created = await agent.post(`/api/processes/${processId}/risks`).send(riskPayload)
    expect(created.status).toBe(201)
    expect(created.body.risk).toMatchObject({ processId, inherentScore: 12, inherentLevel: 'HIGH', residualScore: 4, residualLevel: 'LOW' })
    const second = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Información incompleta', processId: otherProcessId })
    expect(second.status).toBe(201)
    expect(second.body.risk.processId).toBe(processId)
    expect((await agent.get(`/api/processes/${processId}/risks`)).body.risks).toHaveLength(2)
    const updated = await agent.patch(`/api/processes/${processId}/risks/${created.body.risk.id}`).send({ residualImpact: 5, residualProbability: 5 })
    expect(updated.body.risk.residualLevel).toBe('CRITICAL')
    expect((await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, inherentImpact: 6 })).status).toBe(400)
    expect((await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, inherentProbability: 0 })).status).toBe(400)
    expect((await agent.delete(`/api/processes/${processId}/risks/${created.body.risk.id}`)).status).toBe(204)
  })

  it('creates, edits and deletes controls attached to the correct risk', async () => {
    const { db } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    const risk = await agent.post(`/api/processes/${processId}/risks`).send(riskPayload)
    const created = await agent.post(`/api/processes/${processId}/risks/${risk.body.risk.id}/controls`).send({ description: 'Validar datos antes de registrar', evaluation: 'PARTIAL' })
    expect(created.status).toBe(201)
    expect(created.body.control.riskId).toBe(risk.body.risk.id)
    const updated = await agent.patch(`/api/processes/${processId}/risks/${risk.body.risk.id}/controls/${created.body.control.id}`).send({ evaluation: 'EFFECTIVE' })
    expect(updated.body.control.evaluation).toBe('EFFECTIVE')
    expect((await agent.delete(`/api/processes/${processId}/risks/${risk.body.risk.id}/controls/${created.body.control.id}`)).status).toBe(204)
  })

  it('isolates risks by process and company and preserves read-only permissions', async () => {
    const { db } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    const created = await agent.post(`/api/processes/${otherProcessId}/risks`).send(riskPayload)
    expect((await agent.get(`/api/processes/${processId}/risks`)).body.risks).toHaveLength(0)
    expect((await agent.get(`/api/processes/${otherProcessId}/risks`)).body.risks[0].id).toBe(created.body.risk.id)
    expect((await agent.patch(`/api/processes/${processId}/risks/${created.body.risk.id}`).send({ name: 'Cruce inválido' })).status).toBe(404)

    const foreign = makeRiskDb('COMPANY_ADMIN', otherCompanyId)
    const foreignAgent = await loggedIn(foreign.db, foreignAdmin.email)
    expect((await foreignAgent.get(`/api/processes/${processId}/risks`)).status).toBe(404)
    const readOnly = makeRiskDb('COMPANY_USER')
    const readOnlyAgent = await loggedIn(readOnly.db, companyUser.email)
    expect((await readOnlyAgent.get(`/api/processes/${processId}/risks`)).status).toBe(200)
    expect((await readOnlyAgent.post(`/api/processes/${processId}/risks`).send(riskPayload)).status).toBe(403)
  })

  it('creates a process before its risk and cascades risks when the process is deleted', async () => {
    const { db, storedRisks } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    const process = await agent.post('/api/processes').send({ name: 'Proceso nuevo', type: 'MISSIONAL', category: 'misional', objective: 'Objetivo nuevo', companyId })
    expect(process.status).toBe(201)
    const createdProcessId = process.body.process.id as string
    expect((await agent.post(`/api/processes/${createdProcessId}/risks`).send(riskPayload)).status).toBe(201)
    expect((await agent.patch(`/api/processes/${createdProcessId}`).send({ description: 'Proceso actualizado' })).status).toBe(200)
    expect(storedRisks.some((risk) => risk.processId === createdProcessId)).toBe(true)
    expect((await agent.delete(`/api/processes/${createdProcessId}`)).status).toBe(204)
    expect(storedRisks.some((risk) => risk.processId === createdProcessId)).toBe(false)
  })
})
