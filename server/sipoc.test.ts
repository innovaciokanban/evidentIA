import bcrypt from 'bcryptjs'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'

type SipocKind = 'suppliers' | 'inputs' | 'outputs' | 'customers'
type SipocRecord = { id: string; processId: string; description: string; createdAt: Date; updatedAt: Date }
type TestProcess = {
  id: string; companyId: string; name: string; code: string | null; type: 'MISSIONAL'; version: string | null; frequency: string | null
  organizationalArea: string | null; supervision: string | null
  deliveryMethod: string | null; executionType: string | null; objective: string; description: string | null; responsibleId: string | null
  status: 'ACTIVE'; thirdPartyProvided: boolean; critical: boolean; cashMovement: boolean; contingencyPlan: boolean
  taxOperations: boolean; affectsAccounting: boolean; personalData: boolean; createdAt: Date; updatedAt: Date
}

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const processId = 'cmprocess000000000000000001'
const otherProcessId = 'cmprocess000000000000000002'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@sipoc.test', name: 'SIPOC Admin', role: 'COMPANY_ADMIN' as Role, companyId }
const companyUser = { id: 'cmuser0000000000000000001', email: 'user@sipoc.test', name: 'SIPOC User', role: 'COMPANY_USER' as Role, companyId }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@sipoc.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId }

const makeProcess = (id: string, owningCompanyId: string, name: string): TestProcess => ({
  id, companyId: owningCompanyId, name, code: name === 'Proceso principal' ? 'PROC-01' : 'PROC-02', type: 'MISSIONAL', version: '1.0', frequency: null,
  organizationalArea: null, supervision: null, deliveryMethod: null, executionType: null,
  objective: 'Gestionar el proceso', description: null, responsibleId: null, status: 'ACTIVE', thirdPartyProvided: false,
  critical: false, cashMovement: false, contingencyPlan: false, taxOperations: false, affectsAccounting: false, personalData: false,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
})

function makeSipocDb(role: Role = 'COMPANY_ADMIN', userCompanyId = companyId) {
  const users = [admin, companyUser, foreignAdmin]
  const currentUser = users.find((user) => user.role === role && user.companyId === userCompanyId) ?? { ...admin, role, companyId: userCompanyId }
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  let sessionActive = false
  let storedProcesses: TestProcess[] = [makeProcess(processId, companyId, 'Proceso principal'), makeProcess(otherProcessId, companyId, 'Otro proceso')]
  const storedItems: Record<SipocKind, SipocRecord[]> = { suppliers: [], inputs: [], outputs: [], customers: [] }
  let nextProcess = 3
  let nextItem = 1

  const processView = (item: TestProcess) => ({ ...item, company: { id: item.companyId }, responsible: null })
  const processFor = (id: string) => storedProcesses.find((item) => item.id === id) ?? null
  const db = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id)
        return user ? { ...user, passwordHash } : null
      }),
    },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-sipoc', expiresAt: new Date(Date.now() + 86400000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-sipoc', expiresAt: new Date(Date.now() + 86400000), user: currentUser } : null),
      deleteMany: vi.fn(async () => { sessionActive = false; return { count: 1 } }),
    },
    company: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === companyId ? { id: companyId } : where.id === otherCompanyId ? { id: otherCompanyId } : null),
    },
    process: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const item = processFor(where.id)
        return item ? processView(item) : null
      }),
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
        for (const items of Object.values(storedItems)) {
          const remaining = items.filter((item) => item.processId !== where.id)
          items.splice(0, items.length, ...remaining)
        }
        return { id: where.id }
      }),
    },
  } as Record<string, unknown>

  // Keep the delegate names explicit because Prisma uses singular model properties.
  const delegates: Record<SipocKind, string> = { suppliers: 'sipocSupplier', inputs: 'sipocInput', outputs: 'sipocOutput', customers: 'sipocCustomer' }
  for (const kind of Object.keys(delegates) as SipocKind[]) {
    db[delegates[kind]] = {
      findMany: vi.fn(async ({ where }: { where: { processId: string } }) => storedItems[kind].filter((item) => item.processId === where.processId)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => storedItems[kind].find((item) => item.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: { processId: string; description: string } }) => {
        const item = { id: `cmsipoc${String(nextItem++).padStart(16, '0')}`, ...data, createdAt: new Date(), updatedAt: new Date() }
        storedItems[kind].push(item)
        return item
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { description: string } }) => {
        const index = storedItems[kind].findIndex((item) => item.id === where.id)
        storedItems[kind][index] = { ...storedItems[kind][index], ...data, updatedAt: new Date() }
        return storedItems[kind][index]
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedItems[kind].findIndex((item) => item.id === where.id)
        const [removed] = storedItems[kind].splice(index, 1)
        return removed
      }),
    }
  }

  return { db: db as unknown as PrismaClient, storedItems }
}

async function loggedIn(db: PrismaClient, email: string) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

describe('process SIPOC API', () => {
  it('creates, lists, edits and deletes suppliers, inputs, outputs and customers', async () => {
    const { db } = makeSipocDb()
    const agent = await loggedIn(db, admin.email)
    const descriptions: Record<SipocKind, string> = { suppliers: 'Área comercial', inputs: 'Solicitud del cliente', outputs: 'Respuesta al cliente', customers: 'Cliente externo' }
    const ids: Partial<Record<SipocKind, string>> = {}

    for (const kind of Object.keys(descriptions) as SipocKind[]) {
      const created = await agent.post(`/api/processes/${processId}/sipoc/${kind}`).send({ description: descriptions[kind] })
      expect(created.status).toBe(201)
      expect(created.body.item).toMatchObject({ processId, description: descriptions[kind] })
      ids[kind] = created.body.item.id
    }
    const listed = await agent.get(`/api/processes/${processId}/sipoc`)
    expect(listed.status).toBe(200)
    const listedItems = listed.body as Record<SipocKind, unknown[]>
    expect(Object.values(listedItems).map((items) => items.length)).toEqual([1, 1, 1, 1])

    for (const kind of Object.keys(ids) as SipocKind[]) {
      const updated = await agent.patch(`/api/processes/${processId}/sipoc/${kind}/${ids[kind]}`).send({ description: `${descriptions[kind]} actualizado` })
      expect(updated.status).toBe(200)
      expect(updated.body.item.description).toContain('actualizado')
      expect((await agent.delete(`/api/processes/${processId}/sipoc/${kind}/${ids[kind]}`)).status).toBe(204)
    }
    const emptyItems = (await agent.get(`/api/processes/${processId}/sipoc`)).body as Record<SipocKind, unknown[]>
    expect(Object.values(emptyItems).every((items) => items.length === 0)).toBe(true)
  })

  it('keeps SIPOC attached to the requested process and does not mix sibling processes', async () => {
    const { db } = makeSipocDb()
    const agent = await loggedIn(db, admin.email)
    const created = await agent.post(`/api/processes/${otherProcessId}/sipoc/inputs`).send({ description: 'Entrada del otro proceso' })
    expect(created.body.item.processId).toBe(otherProcessId)
    expect((await agent.get(`/api/processes/${processId}/sipoc`)).body.inputs).toHaveLength(0)
    expect((await agent.get(`/api/processes/${otherProcessId}/sipoc`)).body.inputs[0].description).toBe('Entrada del otro proceso')
    expect((await agent.patch(`/api/processes/${processId}/sipoc/inputs/${created.body.item.id}`).send({ description: 'Intento cruzado' })).status).toBe(404)
  })

  it('enforces tenant isolation and read-only permissions', async () => {
    const foreign = makeSipocDb('COMPANY_ADMIN', otherCompanyId)
    const foreignAgent = await loggedIn(foreign.db, foreignAdmin.email)
    expect((await foreignAgent.get(`/api/processes/${processId}/sipoc`)).status).toBe(404)
    expect((await foreignAgent.post(`/api/processes/${processId}/sipoc/suppliers`).send({ description: 'No permitido' })).status).toBe(404)

    const readOnly = makeSipocDb('COMPANY_USER')
    const readOnlyAgent = await loggedIn(readOnly.db, companyUser.email)
    expect((await readOnlyAgent.get(`/api/processes/${processId}/sipoc`)).status).toBe(200)
    expect((await readOnlyAgent.post(`/api/processes/${processId}/sipoc/suppliers`).send({ description: 'No permitido' })).status).toBe(403)
  })

  it('creates a process before SIPOC, updates the process, and cascades on deletion', async () => {
    const { db, storedItems } = makeSipocDb()
    const agent = await loggedIn(db, admin.email)
    const created = await agent.post('/api/processes').send({ name: 'Proceso nuevo', type: 'MISSIONAL', objective: 'Objetivo nuevo', companyId })
    expect(created.status).toBe(201)
    const createdProcessId = created.body.process.id as string
    expect((await agent.patch(`/api/processes/${createdProcessId}`).send({ description: 'Descripción actualizada' })).status).toBe(200)
    const item = await agent.post(`/api/processes/${createdProcessId}/sipoc/outputs`).send({ description: 'Resultado del proceso nuevo' })
    expect(item.status).toBe(201)
    expect(item.body.item.processId).toBe(createdProcessId)
    expect((await agent.delete(`/api/processes/${createdProcessId}`)).status).toBe(204)
    expect(storedItems.outputs).toHaveLength(0)
    expect((await agent.get(`/api/processes/${createdProcessId}/sipoc`)).status).toBe(404)
  })
})
