import bcrypt from 'bcryptjs'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'

type ControlEvaluation = 'PENDING' | 'WEAK' | 'PARTIAL' | 'EFFECTIVE'
type StoredControl = { id: string; riskId: string; description: string; evaluation: ControlEvaluation; createdAt: Date; updatedAt: Date }
type StoredEvidence = { id: string; riskId: string; name: string; description: string; url: string; createdAt: Date; updatedAt: Date }
type AcceptanceStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED'
type Treatment = 'AVOID' | 'MITIGATE' | 'TRANSFER' | 'ACCEPT' | null
type StoredRisk = { id: string; processId: string; name: string; description: string; riskType: string; code: string | null; bpmnActivity: string; riskOwnerId: string | null; acceptanceStatus: AcceptanceStatus; treatment: Treatment; mitigationOwnerId: string | null; mitigationStartDate: Date | null; mitigationDueDate: Date | null; inherentImpact: number; inherentProbability: number; residualImpact: number; residualProbability: number; controls: StoredControl[]; evidences: StoredEvidence[]; createdAt: Date; updatedAt: Date }
type TestProcessType = 'STRATEGIC' | 'MISSIONAL' | 'SUPPORT'
type TestProcess = { id: string; companyId: string; name: string; code: string | null; type: TestProcessType; version: string | null; frequency: string | null; organizationalArea: string | null; supervision: string | null; executionType: string | null; objective: string; description: string | null; responsibleId: string | null; status: 'ACTIVE'; thirdPartyProvided: boolean; critical: boolean; affectsAccounting: boolean; personalData: boolean; createdAt: Date; updatedAt: Date }

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const processId = 'cmprocess000000000000000001'
const otherProcessId = 'cmprocess000000000000000002'
const strategicProcessId = 'cmprocess000000000000000003'
const supportProcessId = 'cmprocess000000000000000004'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@risk.test', name: 'Risk Admin', role: 'COMPANY_ADMIN' as Role, companyId }
const companyUser = { id: 'cmuser0000000000000000001', email: 'user@risk.test', name: 'Risk User', role: 'COMPANY_USER' as Role, companyId }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@risk.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId }

const makeProcess = (id: string, owningCompanyId: string, name: string, type: TestProcessType = 'MISSIONAL'): TestProcess => ({
  id, companyId: owningCompanyId, name, code: 'PROC-01', type, version: '1.0', frequency: null, organizationalArea: null,
  supervision: null, executionType: null, objective: 'Gestionar el proceso', description: null,
  responsibleId: null, status: 'ACTIVE', thirdPartyProvided: false, critical: false,
  affectsAccounting: false, personalData: false, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
})

function makeRiskDb(role: Role = 'COMPANY_ADMIN', userCompanyId = companyId) {
  const users = [admin, companyUser, foreignAdmin]
  const currentUser = users.find((user) => user.role === role && user.companyId === userCompanyId) ?? { ...admin, role, companyId: userCompanyId }
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  let sessionActive = false
  let storedProcesses: TestProcess[] = [
    makeProcess(processId, companyId, 'Proceso principal'),
    makeProcess(otherProcessId, companyId, 'Otro proceso'),
    makeProcess(strategicProcessId, companyId, 'Proceso estratégico', 'STRATEGIC'),
    makeProcess(supportProcessId, companyId, 'Proceso de apoyo', 'SUPPORT'),
  ]
  const storedRisks: StoredRisk[] = []
  const storedProcessChanges: string[] = []
  let nextProcess = 3
  let nextRisk = 1
  let nextControl = 1
  let nextEvidence = 1
  const processFor = (id: string) => storedProcesses.find((item) => item.id === id) ?? null
  const processView = (item: TestProcess) => ({ ...item, company: { id: item.companyId }, responsible: null })
  const riskFor = (id: string) => storedRisks.find((item) => item.id === id) ?? null
  const ownerView = (userId: string | null) => { const user = users.find((item) => item.id === userId); return user ? { id: user.id, name: user.name } : null }
  const riskView = (risk: StoredRisk) => ({ ...risk, riskOwner: ownerView(risk.riskOwnerId), mitigationOwner: ownerView(risk.mitigationOwnerId) })
  const codeSequences: Record<string, number> = {}

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
    processChange: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { storedProcessChanges.push(String(data.processId)); return { id: 'cmprocesschange', ...data } }),
      findFirst: vi.fn(async ({ where }: { where: { processId: string } }) => storedProcessChanges.includes(where.processId) ? { id: 'cmprocesschange' } : null),
    },
    risk: {
      findMany: vi.fn(async ({ where }: { where: { processId: string } }) => storedRisks.filter((item) => item.processId === where.processId).map(riskView)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const risk = riskFor(where.id); return risk ? riskView(risk) : null }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const code = data.code == null ? null : String(data.code)
        if (code && storedRisks.some((item) => item.code === code)) {
          const conflict = new Error(`Unique constraint failed on code: ${code}`) as Error & { code: string }
          conflict.code = 'P2002'
          throw conflict
        }
        const risk: StoredRisk = { id: `cmriskcreated${String(nextRisk++).padStart(10, '0')}`, processId: String(data.processId), name: String(data.name), description: String(data.description), riskType: String(data.riskType), code, bpmnActivity: String(data.bpmnActivity), riskOwnerId: data.riskOwnerId == null ? null : String(data.riskOwnerId), acceptanceStatus: (data.acceptanceStatus as AcceptanceStatus) ?? 'PENDING', treatment: (data.treatment as Treatment) ?? null, mitigationOwnerId: data.mitigationOwnerId == null ? null : String(data.mitigationOwnerId), mitigationStartDate: (data.mitigationStartDate as Date | null | undefined) ?? null, mitigationDueDate: (data.mitigationDueDate as Date | null | undefined) ?? null, inherentImpact: Number(data.inherentImpact), inherentProbability: Number(data.inherentProbability), residualImpact: Number(data.residualImpact), residualProbability: Number(data.residualProbability), controls: [], evidences: [], createdAt: new Date(), updatedAt: new Date() }
        storedRisks.push(risk)
        return riskView(risk)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const risk = riskFor(where.id) as StoredRisk
        Object.assign(risk, data, { updatedAt: new Date() })
        return riskView(risk)
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => { const index = storedRisks.findIndex((item) => item.id === where.id); const [removed] = storedRisks.splice(index, 1); return removed }),
    },
    riskCodeSequence: {
      upsert: vi.fn(async ({ where, create, update }: { where: { category: string }; create: { category: string; next: number }; update: { next: { increment: number } } }) => {
        const current = codeSequences[where.category]
        if (current === undefined) {
          codeSequences[create.category] = create.next
          return { category: create.category, next: create.next }
        }
        const next = current + update.next.increment
        codeSequences[where.category] = next
        return { category: where.category, next }
      }),
    },
    $transaction: vi.fn(async (operation: (client: unknown) => Promise<unknown>) => operation(db)),
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
    riskEvidence: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => storedRisks.flatMap((risk) => risk.evidences).find((evidence) => evidence.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: { riskId: string; name: string; description: string; url: string } }) => {
        const evidence: StoredEvidence = { id: `cmevidence${String(nextEvidence++).padStart(10, '0')}`, ...data, createdAt: new Date(), updatedAt: new Date() }
        ;(riskFor(data.riskId) as StoredRisk).evidences.push(evidence)
        return evidence
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<StoredEvidence> }) => {
        const evidence = storedRisks.flatMap((risk) => risk.evidences).find((item) => item.id === where.id) as StoredEvidence
        Object.assign(evidence, data, { updatedAt: new Date() })
        return evidence
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        for (const risk of storedRisks) { const index = risk.evidences.findIndex((item) => item.id === where.id); if (index >= 0) return risk.evidences.splice(index, 1)[0] }
        return null
      }),
    },
  }
  return { db: db as unknown as PrismaClient, storedRisks, storedProcesses }
}

/** Fila de riesgo con datos anteriores al catálogo actual (tipo legado, sin código asignado). */
const legacyRiskRow = (overrides: Partial<StoredRisk> & { id: string }): StoredRisk => ({
  processId, name: 'Riesgo legado', description: 'Riesgo guardado con un catálogo anterior.', riskType: 'Operativo', code: null,
  bpmnActivity: 'Actividad antigua', riskOwnerId: null, acceptanceStatus: 'PENDING', treatment: null, mitigationOwnerId: null,
  mitigationStartDate: null, mitigationDueDate: null, inherentImpact: 2, inherentProbability: 2, residualImpact: 1,
  residualProbability: 1, controls: [], evidences: [], createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
  ...overrides,
})

const riskPayload = {
  name: 'Entrega tardía de información', description: 'La información puede llegar después del plazo y afectar la respuesta.', bpmnActivity: 'Validar solicitud',
  // Un riesgo nace sin controles: el alta solo admite el residual neutro (1×1).
  inherentImpact: 3, inherentProbability: 4, residualImpact: 1, residualProbability: 1,
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
    expect(created.body.risk).toMatchObject({ processId, riskType: 'MISIONAL', code: 'MIS-R1', riskOwner: null, inherentScore: 12, inherentLevel: 'MEDIUM', residualScore: 1, residualLevel: 'LOW' })
    expect(created.body.risk).not.toHaveProperty('bpmnActivity')
    const second = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Información incompleta', processId: otherProcessId })
    expect(second.status).toBe(201)
    expect(second.body.risk.processId).toBe(processId)
    expect((await agent.get(`/api/processes/${processId}/risks`)).body.risks).toHaveLength(2)
    // Sin controles el residual queda bloqueado, tanto en el alta como en la edición.
    const blocked = await agent.patch(`/api/processes/${processId}/risks/${created.body.risk.id}`).send({ residualImpact: 5, residualProbability: 5 })
    expect(blocked.status).toBe(400)
    expect(blocked.body.error).toBe('Residual risk values require at least one control')
    // Con al menos un control (cualquiera sirve, su evaluación no importa) el residual se edita.
    await agent.post(`/api/processes/${processId}/risks/${created.body.risk.id}/controls`).send({ description: 'Revisión del plazo de entrega' })
    const updated = await agent.patch(`/api/processes/${processId}/risks/${created.body.risk.id}`).send({ residualImpact: 5, residualProbability: 5 })
    expect(updated.status).toBe(200)
    expect(updated.body.risk.residualLevel).toBe('HIGH')
    expect((await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, inherentImpact: 6 })).status).toBe(400)
    expect((await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, inherentProbability: 0 })).status).toBe(400)
    expect((await agent.delete(`/api/processes/${processId}/risks/${created.body.risk.id}`)).status).toBe(204)
  })

  it('derives inherent and residual scores with the consultant matrix ranges', async () => {
    const { db } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    const boundaries: Array<{ impact: number; probability: number; score: number; level: string }> = [
      { impact: 1, probability: 1, score: 1, level: 'LOW' },
      { impact: 1, probability: 5, score: 5, level: 'LOW' },
      { impact: 2, probability: 3, score: 6, level: 'MEDIUM' },
      { impact: 3, probability: 5, score: 15, level: 'MEDIUM' },
      { impact: 4, probability: 4, score: 16, level: 'HIGH' },
      { impact: 5, probability: 5, score: 25, level: 'HIGH' },
    ]
    for (const entry of boundaries) {
      const created = await agent.post(`/api/processes/${processId}/risks`).send({
        ...riskPayload,
        name: `Riesgo matriz ${entry.score}`,
        inherentImpact: entry.impact,
        inherentProbability: entry.probability,
      })
      expect(created.status).toBe(201)
      expect(created.body.risk).toMatchObject({
        inherentScore: entry.score,
        inherentLevel: entry.level,
        residualScore: 1,
        residualLevel: 'LOW',
      })
      // El residual se evalúa recién cuando el riesgo tiene al menos un control.
      await agent.post(`/api/processes/${processId}/risks/${created.body.risk.id}/controls`).send({ description: 'Control de la matriz de riesgo' })
      const patched = await agent.patch(`/api/processes/${processId}/risks/${created.body.risk.id}`).send({
        residualImpact: entry.probability,
        residualProbability: entry.impact,
      })
      expect(patched.status).toBe(200)
      expect(patched.body.risk).toMatchObject({
        residualScore: entry.probability * entry.impact,
        residualLevel: entry.level,
      })
      const listed = await agent.get(`/api/processes/${processId}/risks`)
      const listedRisk = listed.body.risks.find((risk: { id: string }) => risk.id === created.body.risk.id)
      expect(listedRisk).toMatchObject({ inherentScore: entry.score, inherentLevel: entry.level, residualScore: entry.probability * entry.impact, residualLevel: entry.level })
      expect((await agent.delete(`/api/processes/${processId}/risks/${created.body.risk.id}`)).status).toBe(204)
      expect((await agent.get(`/api/processes/${processId}/risks`)).body.risks).toHaveLength(0)
    }
  })

  it('keeps inherent and residual levels independent when only one side changes', async () => {
    const { db } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    const created = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, inherentImpact: 5, inherentProbability: 5, residualImpact: 1, residualProbability: 1 })
    expect(created.body.risk).toMatchObject({ inherentScore: 25, inherentLevel: 'HIGH', residualScore: 1, residualLevel: 'LOW' })
    // El residual solo se toca con al menos un control asociado.
    await agent.post(`/api/processes/${processId}/risks/${created.body.risk.id}/controls`).send({ description: 'Control de independencia de niveles' })
    const updated = await agent.patch(`/api/processes/${processId}/risks/${created.body.risk.id}`).send({ residualImpact: 4, residualProbability: 4 })
    expect(updated.body.risk).toMatchObject({ inherentScore: 25, inherentLevel: 'HIGH', residualScore: 16, residualLevel: 'HIGH' })
    const updatedInherent = await agent.patch(`/api/processes/${processId}/risks/${created.body.risk.id}`).send({ inherentImpact: 1, inherentProbability: 2 })
    expect(updatedInherent.body.risk).toMatchObject({ inherentScore: 2, inherentLevel: 'LOW', residualScore: 16, residualLevel: 'HIGH' })
  })

  it('assigns, changes and clears a risk owner while enforcing company isolation', async () => {
    const { db } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    const created = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: companyUser.id })
    expect(created.status).toBe(201)
    expect(created.body.risk.riskOwner).toEqual({ id: companyUser.id, name: companyUser.name })

    const cleared = await agent.patch(`/api/processes/${processId}/risks/${created.body.risk.id}`).send({ riskOwnerId: null })
    expect(cleared.status).toBe(200)
    expect(cleared.body.risk.riskOwner).toBeNull()

    const foreign = makeRiskDb('COMPANY_ADMIN', otherCompanyId)
    const foreignAgent = await loggedIn(foreign.db, foreignAdmin.email)
    const rejected = await foreignAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: foreignAdmin.id })
    expect(rejected.status).toBe(404)

    const crossCompanyOwner = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Riesgo con dueño ajeno', riskOwnerId: foreignAdmin.id })
    expect(crossCompanyOwner.status).toBe(403)
  })

  it('derives the risk type from the process category and rejects incompatible client types', async () => {
    const { db } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    // Sin enviar el tipo, el proceso MISSIONAL determina MISIONAL y su prefijo de código.
    const created = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, bpmnActivity: undefined })
    expect(created.status).toBe(201)
    expect(created.body.risk.riskType).toBe('MISIONAL')
    expect(created.body.risk.code).toBe('MIS-R1')
    // Clientes antiguos que aún envían el tipo: se acepta solo si coincide con el proceso.
    const echoed = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Riesgo misional con eco', riskType: 'MISIONAL' })
    expect(echoed.status).toBe(201)
    expect(echoed.body.risk.riskType).toBe('MISIONAL')
    // Una categoría incompatible con el proceso se rechaza: no se asocia un tipo que el proceso no justifica.
    expect((await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Riesgo estratégico forzado', riskType: 'ESTRATEGICO' })).status).toBe(400)
    expect((await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Riesgo de apoyo forzado', riskType: 'APOYO' })).status).toBe(400)
    expect((await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Riesgo táctico', riskType: 'TACTICO' })).status).toBe(400)
    expect((await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Riesgo operacional', riskType: 'OPERACIONAL' })).status).toBe(400)
    expect((await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Riesgo inválido', riskType: 'Operativo' })).status).toBe(400)
    // Cada tipo de proceso produce su propia categoría y su prefijo.
    const strategic = await agent.post(`/api/processes/${strategicProcessId}/risks`).send({ ...riskPayload, name: 'Riesgo del proceso estratégico' })
    expect(strategic.body.risk).toMatchObject({ riskType: 'ESTRATEGICO', code: 'EST-R1' })
    const support = await agent.post(`/api/processes/${supportProcessId}/risks`).send({ ...riskPayload, name: 'Riesgo del proceso de apoyo' })
    expect(support.body.risk).toMatchObject({ riskType: 'APOYO', code: 'APO-R1' })
  })

  it('keeps historical types and codes visible and completes the classification only while the risk has no code', async () => {
    const { db, storedRisks } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    storedRisks.push(legacyRiskRow({ id: 'cmrisklegacy0000000000001' }))
    const listed = await agent.get(`/api/processes/${processId}/risks`)
    const listedLegacy = listed.body.risks.find((risk: { id: string }) => risk.id === 'cmrisklegacy0000000000001')
    expect(listedLegacy.riskType).toBe('Operativo')
    expect(listedLegacy.code).toBeNull()
    // Editar un riesgo legado sin código completa su clasificación con la categoría del proceso y
    // le asigna el primer código disponible de esa categoría.
    const edited = await agent.patch(`/api/processes/${processId}/risks/cmrisklegacy0000000000001`).send({ name: 'Riesgo legado editado' })
    expect(edited.status).toBe(200)
    expect(edited.body.risk).toMatchObject({ name: 'Riesgo legado editado', riskType: 'MISIONAL', code: 'MIS-R1' })
    // En edición sigue rechazándose cualquier categoría incompatible con el proceso.
    expect((await agent.patch(`/api/processes/${processId}/risks/cmrisklegacy0000000000001`).send({ riskType: 'ESTRATEGICO' })).status).toBe(400)
    expect((await agent.patch(`/api/processes/${processId}/risks/cmrisklegacy0000000000001`).send({ riskType: 'TACTICO' })).status).toBe(400)
    // El eco del tipo vigente (cliente antiguo) no cambia nada ni renumera el código.
    const echoed = await agent.patch(`/api/processes/${processId}/risks/cmrisklegacy0000000000001`).send({ riskType: 'MISIONAL', name: 'Riesgo legado con eco' })
    expect(echoed.status).toBe(200)
    expect(echoed.body.risk).toMatchObject({ riskType: 'MISIONAL', code: 'MIS-R1' })
    // Un riesgo legado que ya tiene código conserva su tipo histórico aunque no coincida con el proceso.
    storedRisks.push(legacyRiskRow({ id: 'cmrisklegacy0000000000002', name: 'Riesgo legado clasificado', riskType: 'ESTRATEGICO', code: 'EST-R7' }))
    const historical = await agent.patch(`/api/processes/${processId}/risks/cmrisklegacy0000000000002`).send({ name: 'Riesgo legado clasificado renombrado' })
    expect(historical.status).toBe(200)
    expect(historical.body.risk).toMatchObject({ riskType: 'ESTRATEGICO', code: 'EST-R7' })
  })

  it('assigns an independent consecutive code per category and ignores any client-supplied code', async () => {
    const { db } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    const codes = [] as string[]
    const create = async (targetProcessId: string, name: string, extra: Record<string, unknown> = {}) => {
      const created = await agent.post(`/api/processes/${targetProcessId}/risks`).send({ ...riskPayload, name, ...extra })
      expect(created.status).toBe(201)
      codes.push(created.body.risk.code)
    }
    await create(strategicProcessId, 'Riesgo estratégico 1')
    await create(processId, 'Riesgo misional 1')
    await create(strategicProcessId, 'Riesgo estratégico 2')
    await create(supportProcessId, 'Riesgo de apoyo 1')
    await create(processId, 'Riesgo misional 2')
    expect(codes).toEqual(['EST-R1', 'MIS-R1', 'EST-R2', 'APO-R1', 'MIS-R2'])
    const spoofed = await agent.post(`/api/processes/${strategicProcessId}/risks`).send({ ...riskPayload, name: 'Riesgo con código enviado', code: 'EST-R99' })
    expect(spoofed.status).toBe(201)
    expect(spoofed.body.risk.code).toBe('EST-R3')
    const listed = await agent.get(`/api/processes/${strategicProcessId}/risks`)
    expect(listed.body.risks.some((risk: { code: string | null }) => risk.code === 'EST-R99')).toBe(false)
  })

  it('keeps the generated code immutable when editing and never renumbers it', async () => {
    const { db } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    const created = await agent.post(`/api/processes/${processId}/risks`).send(riskPayload)
    const riskId = created.body.risk.id as string
    expect(created.body.risk.code).toBe('MIS-R1')
    const renamed = await agent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ name: 'Riesgo misional renombrado' })
    expect(renamed.body.risk).toMatchObject({ riskType: 'MISIONAL', code: 'MIS-R1' })
    // El tipo no es editable: cambiarlo a otra categoría que no sea la del proceso se rechaza.
    const retype = await agent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ riskType: 'ESTRATEGICO' })
    expect(retype.status).toBe(400)
    expect((await agent.get(`/api/processes/${processId}/risks`)).body.risks.find((risk: { id: string }) => risk.id === riskId)).toMatchObject({ riskType: 'MISIONAL', code: 'MIS-R1' })
    const echoed = await agent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ riskType: 'MISIONAL', name: 'Riesgo con eco de tipo' })
    expect(echoed.body.risk).toMatchObject({ riskType: 'MISIONAL', code: 'MIS-R1' })
    expect((await agent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ code: 'EST-R99' })).status).toBe(400)
    const spoofed = await agent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ name: 'Edición con código enviado', code: 'EST-R99' })
    expect(spoofed.status).toBe(200)
    expect(spoofed.body.risk).toMatchObject({ name: 'Edición con código enviado', code: 'MIS-R1' })
    const untouched = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Siguiente misional' })
    expect(untouched.body.risk.code).toBe('MIS-R2')
    const untouchedStrategic = await agent.post(`/api/processes/${strategicProcessId}/risks`).send({ ...riskPayload, name: 'Siguiente estratégico' })
    expect(untouchedStrategic.body.risk.code).toBe('EST-R1')
  })

  it('retries with a fresh number when the unique code is already taken', async () => {
    const { db, storedRisks } = makeRiskDb()
    storedRisks.push(legacyRiskRow({ id: 'cmriskestclash0000000001', processId: strategicProcessId, name: 'Riesgo con código heredado', description: 'Código backfill sin contador.', riskType: 'ESTRATEGICO', code: 'EST-R1', bpmnActivity: 'Actividad heredada', inherentImpact: 1, inherentProbability: 1, residualImpact: 1, residualProbability: 1 }))
    const agent = await loggedIn(db, admin.email)
    const created = await agent.post(`/api/processes/${strategicProcessId}/risks`).send(riskPayload)
    expect(created.status).toBe(201)
    expect(created.body.risk.code).toBe('EST-R2')
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

  it('validates control effectiveness against the existing evaluation scale', async () => {
    const { db } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    const risk = await agent.post(`/api/processes/${processId}/risks`).send(riskPayload)
    const riskId = risk.body.risk.id as string
    const created = await agent.post(`/api/processes/${processId}/risks/${riskId}/controls`).send({ description: 'Revisión periódica de accesos', evaluation: 'EFFECTIVE' })
    expect(created.status).toBe(201)
    expect(created.body.control.evaluation).toBe('EFFECTIVE')
    const withDefault = await agent.post(`/api/processes/${processId}/risks/${riskId}/controls`).send({ description: 'Monitoreo diario de indicadores' })
    expect(withDefault.status).toBe(201)
    expect(withDefault.body.control.evaluation).toBe('PENDING')
    expect((await agent.post(`/api/processes/${processId}/risks/${riskId}/controls`).send({ description: 'Control con escala inventada', evaluation: 'CRITICAL' })).status).toBe(400)
    expect((await agent.patch(`/api/processes/${processId}/risks/${riskId}/controls/${created.body.control.id}`).send({ evaluation: 'EXCELLENT' })).status).toBe(400)
    expect((await agent.patch(`/api/processes/${processId}/risks/${riskId}/controls/${created.body.control.id}`).send({})).status).toBe(400)
    const descriptionOnly = await agent.patch(`/api/processes/${processId}/risks/${riskId}/controls/${created.body.control.id}`).send({ description: 'Revisión mensual de accesos' })
    expect(descriptionOnly.status).toBe(200)
    expect(descriptionOnly.body.control.description).toBe('Revisión mensual de accesos')
    expect(descriptionOnly.body.control.evaluation).toBe('EFFECTIVE')
    const listed = await agent.get(`/api/processes/${processId}/risks`)
    const listedControls = listed.body.risks.find((item: { id: string }) => item.id === riskId).controls as Array<{ id: string; evaluation: string }>
    expect(listedControls.find((control) => control.id === created.body.control.id)?.evaluation).toBe('EFFECTIVE')
    expect(listedControls.find((control) => control.id === withDefault.body.control.id)?.evaluation).toBe('PENDING')
    const readOnly = makeRiskDb('COMPANY_USER')
    const readOnlyAgent = await loggedIn(readOnly.db, companyUser.email)
    expect((await readOnlyAgent.post(`/api/processes/${processId}/risks/${riskId}/controls`).send({ description: 'Sin permiso para editar', evaluation: 'WEAK' })).status).toBe(403)
  })

  it('locks residual risk values until the risk has at least one control', async () => {
    const { db, storedRisks } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    // El alta rechaza un residual que no sea el neutro (1×1): un riesgo nace sin controles.
    const rejected = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Riesgo con residual forzado', residualImpact: 5, residualProbability: 4 })
    expect(rejected.status).toBe(400)
    expect(rejected.body.error).toBe('Residual risk values require at least one control')
    const created = await agent.post(`/api/processes/${processId}/risks`).send(riskPayload)
    expect(created.status).toBe(201)
    const riskId = created.body.risk.id as string
    expect(created.body.risk).toMatchObject({ residualImpact: 1, residualProbability: 1, residualScore: 1, residualLevel: 'LOW' })
    // Sin controles el residual no cambia, pero el resto de los campos sí se puede editar.
    expect((await agent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ residualImpact: 3 })).status).toBe(400)
    const otherFields = await agent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ name: 'Riesgo renombrado sin controles', treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED', residualImpact: 1, residualProbability: 1 })
    expect(otherFields.status).toBe(200)
    expect(otherFields.body.risk).toMatchObject({ name: 'Riesgo renombrado sin controles', treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED', residualImpact: 1, residualProbability: 1 })
    // El primer control habilita la edición residual, sin importar su evaluación (aquí, PENDING).
    const control = await agent.post(`/api/processes/${processId}/risks/${riskId}/controls`).send({ description: 'Control inicial del riesgo', evaluation: 'PENDING' })
    expect(control.status).toBe(201)
    const unlocked = await agent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ residualImpact: 4, residualProbability: 3 })
    expect(unlocked.status).toBe(200)
    expect(unlocked.body.risk).toMatchObject({ residualImpact: 4, residualProbability: 3, residualScore: 12, residualLevel: 'MEDIUM' })
    // Al eliminar el único control el residual se bloquea de nuevo pero sus valores se conservan.
    expect((await agent.delete(`/api/processes/${processId}/risks/${riskId}/controls/${control.body.control.id}`)).status).toBe(204)
    const listed = await agent.get(`/api/processes/${processId}/risks`)
    const listedRisk = listed.body.risks.find((risk: { id: string }) => risk.id === riskId)
    expect(listedRisk).toMatchObject({ residualImpact: 4, residualProbability: 3, residualScore: 12, residualLevel: 'MEDIUM', controls: [] })
    expect((await agent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ residualImpact: 1 })).status).toBe(400)
    // El resto de los campos sigue siendo editable sin controles y el residual no se borra.
    expect((await agent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ name: 'Riesgo tras quitar el control' })).status).toBe(200)
    expect((storedRisks.find((risk) => risk.id === riskId) as StoredRisk).residualImpact).toBe(4)
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

  it('protects a process with risk history from physical deletion', async () => {
    const { db, storedRisks } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    const process = await agent.post('/api/processes').send({ name: 'Proceso nuevo', type: 'MISSIONAL', category: 'misional', objective: 'Objetivo nuevo', companyId })
    expect(process.status).toBe(201)
    const createdProcessId = process.body.process.id as string
    expect((await agent.post(`/api/processes/${createdProcessId}/risks`).send(riskPayload)).status).toBe(201)
    expect((await agent.patch(`/api/processes/${createdProcessId}`).send({ description: 'Proceso actualizado' })).status).toBe(200)
    expect(storedRisks.some((risk) => risk.processId === createdProcessId)).toBe(true)
    expect((await agent.delete(`/api/processes/${createdProcessId}`)).status).toBe(409)
    expect(storedRisks.some((risk) => risk.processId === createdProcessId)).toBe(true)
  })

  it('validates treatment and acceptance options without touching matrix levels', async () => {
    const { db } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    const created = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED', inherentImpact: 5, inherentProbability: 5, residualImpact: 1, residualProbability: 1 })
    expect(created.status).toBe(201)
    expect(created.body.risk).toMatchObject({ treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED', inherentScore: 25, inherentLevel: 'HIGH', residualScore: 1, residualLevel: 'LOW' })
    expect((await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Tratamiento inválido', treatment: 'Remediar' })).status).toBe(400)
    expect((await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Aceptación inválida', acceptanceStatus: 'UNKNOWN' })).status).toBe(400)
    const defaults = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Riesgo sin tratamiento' })
    expect(defaults.status).toBe(201)
    expect(defaults.body.risk).toMatchObject({ acceptanceStatus: 'PENDING', treatment: null, mitigationOwner: null, mitigationStartDate: null, mitigationDueDate: null, evidences: [] })
    const patched = await agent.patch(`/api/processes/${processId}/risks/${defaults.body.risk.id}`).send({ acceptanceStatus: 'REJECTED', treatment: null })
    expect(patched.status).toBe(200)
    expect(patched.body.risk).toMatchObject({ acceptanceStatus: 'REJECTED', treatment: null })
    expect(patched.body.risk.inherentLevel).toBe(defaults.body.risk.inherentLevel)
    expect(patched.body.risk.residualLevel).toBe(defaults.body.risk.residualLevel)
  })

  it('persists the mitigation plan and rejects inverted date ranges', async () => {
    const { db } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    const created = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, mitigationOwnerId: companyUser.id, mitigationStartDate: '2026-11-01', mitigationDueDate: '2026-11-30' })
    expect(created.status).toBe(201)
    expect(created.body.risk.mitigationOwner).toEqual({ id: companyUser.id, name: companyUser.name })
    expect(created.body.risk.mitigationStartDate).not.toBeNull()
    expect(created.body.risk.mitigationDueDate).not.toBeNull()
    const inverted = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Fechas invertidas', mitigationStartDate: '2026-11-30', mitigationDueDate: '2026-11-01' })
    expect(inverted.status).toBe(400)
    const riskId = created.body.risk.id as string
    const overlappingPatch = await agent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ mitigationDueDate: '2026-10-01' })
    expect(overlappingPatch.status).toBe(400)
    const cleared = await agent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ mitigationStartDate: null, mitigationDueDate: null, mitigationOwnerId: null })
    expect(cleared.status).toBe(200)
    expect(cleared.body.risk.mitigationOwner).toBeNull()
    expect(cleared.body.risk.mitigationStartDate).toBeNull()
    expect(cleared.body.risk.mitigationDueDate).toBeNull()
    const crossCompanyOwner = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Plan con dueño ajeno', mitigationOwnerId: foreignAdmin.id })
    expect(crossCompanyOwner.status).toBe(403)
    const readOnly = makeRiskDb('COMPANY_USER')
    const readOnlyAgent = await loggedIn(readOnly.db, companyUser.email)
    expect((await readOnlyAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, mitigationStartDate: '2026-11-01', mitigationDueDate: '2026-11-30' })).status).toBe(403)
  })

  it('creates, edits and deletes evidence attached to the correct risk', async () => {
    const { db } = makeRiskDb()
    const agent = await loggedIn(db, admin.email)
    const risk = await agent.post(`/api/processes/${processId}/risks`).send(riskPayload)
    const created = await agent.post(`/api/processes/${processId}/risks/${risk.body.risk.id}/evidences`).send({ name: 'Acta de aprobación', description: 'Documento que demuestra la aprobación del plan de mitigación.', url: 'https://evidentia.test/acta.pdf' })
    expect(created.status).toBe(201)
    expect(created.body.evidence.riskId).toBe(risk.body.risk.id)
    const listed = await agent.get(`/api/processes/${processId}/risks`)
    expect(listed.body.risks.find((item: { id: string }) => item.id === risk.body.risk.id).evidences).toHaveLength(1)
    const updated = await agent.patch(`/api/processes/${processId}/risks/${risk.body.risk.id}/evidences/${created.body.evidence.id}`).send({ name: 'Acta final' })
    expect(updated.status).toBe(200)
    expect(updated.body.evidence.name).toBe('Acta final')
    expect((await agent.post(`/api/processes/${processId}/risks/${risk.body.risk.id}/evidences`).send({ name: 'Enlace inválido', description: 'La URL debe usar un protocolo web.', url: 'ftp://archivo.test/doc' })).status).toBe(400)
    expect((await agent.post(`/api/processes/${processId}/risks/${risk.body.risk.id}/evidences`).send({ name: 'XY', description: 'Nombre demasiado corto para la evidencia.', url: 'https://evidentia.test/doc.pdf' })).status).toBe(400)
    const other = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Otro riesgo' })
    expect((await agent.patch(`/api/processes/${processId}/risks/${other.body.risk.id}/evidences/${created.body.evidence.id}`).send({ name: 'No existe' })).status).toBe(404)
    expect((await agent.delete(`/api/processes/${processId}/risks/${other.body.risk.id}/evidences/${created.body.evidence.id}`)).status).toBe(404)
    const readOnly = makeRiskDb('COMPANY_USER')
    const readOnlyAgent = await loggedIn(readOnly.db, companyUser.email)
    expect((await readOnlyAgent.post(`/api/processes/${processId}/risks/${risk.body.risk.id}/evidences`).send({ name: 'Sin permiso', description: 'El usuario solo tiene lectura.', url: 'https://evidentia.test/doc.pdf' })).status).toBe(403)
    expect((await agent.delete(`/api/processes/${processId}/risks/${risk.body.risk.id}/evidences/${created.body.evidence.id}`)).status).toBe(204)
    const afterDelete = await agent.get(`/api/processes/${processId}/risks`)
    expect(afterDelete.body.risks.find((item: { id: string }) => item.id === risk.body.risk.id).evidences).toHaveLength(0)
  })
})
