import bcrypt from 'bcryptjs'
import request from './test-request.js'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp, nextProcedureCode } from './app.js'

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const processId = 'cmprocess000000000000000001'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@procedure.test', name: 'Procedure Admin', role: 'COMPANY_ADMIN' as Role, companyId, isActive: true }
const companyUser = { id: 'cmuser0000000000000000001', email: 'user@procedure.test', name: 'Procedure User', role: 'COMPANY_USER' as Role, companyId, isActive: true }
const inactiveUser = { id: 'cminactive00000000000000001', email: 'inactive@procedure.test', name: 'Inactive User', role: 'COMPANY_USER' as Role, companyId, isActive: false }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@procedure.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId, isActive: true }
const process = { id: processId, companyId, name: 'Gestión Comercial', code: 'PROC-01' }

const payload = {
  code: 'PRO-COM-01',
  name: 'Atención de solicitudes',
  objective: 'Estandarizar la atención de las solicitudes del cliente.',
  scope: 'Todas las solicitudes recibidas por los canales oficiales.',
  description: 'Recepción, clasificación, respuesta y cierre de solicitudes.',
  responsibleId: admin.id,
}

const kpiPayload = (name: string, target = '95%') => ({
  name,
  description: `Medición de ${name}.`,
  frequency: 'Mensual',
  target,
  formula: 'Casos cumplidos / casos totales',
  dataSource: 'Reporte operativo',
  unit: 'Porcentaje',
  reportResponsibleId: admin.id,
  monitorResponsibleId: null,
  greenThreshold: '95%',
  yellowThreshold: '85%',
  redThreshold: '84%',
})

function makeProcedureDb(role: Role = 'COMPANY_ADMIN', userCompanyId = companyId) {
  const users = [admin, companyUser, inactiveUser, foreignAdmin]
  const currentUser = users.find((user) => user.role === role && user.companyId === userCompanyId) ?? { ...admin, role, companyId: userCompanyId }
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  let sessionActive = false
  const storedProcedures: Array<Record<string, unknown>> = []
  const storedKpis: Array<Record<string, unknown>> = []
  const storedProcessKpis: Array<{ processId: string; kpiId: string }> = []
  const storedProcedureKpis: Array<{ procedureId: string; kpiId: string }> = []
  const storedSteps: Array<Record<string, unknown>> = []
  const storedStepResponsibles: Array<{ stepId: string; userId: string }> = []
  const storedIndicators: Array<Record<string, unknown>> = []
  const storedVersions: Array<Record<string, unknown>> = []
  let procedureSeq = 0
  let versionSeq = 0

  const userView = (id: unknown) => {
    const user = users.find((item) => item.id === id)
     return user ? { id: user.id, name: user.name, isActive: user.isActive } : null
  }
  const kpiView = (kpi: Record<string, unknown>) => ({
    ...kpi,
    process: { id: processId, companyId, name: process.name, code: process.code },
    reportResponsible: userView(kpi.reportResponsibleId),
    monitorResponsible: userView(kpi.monitorResponsibleId),
  })
  const procedureView = (procedure: Record<string, unknown>) => ({
    ...procedure,
    process: { id: processId, companyId: process.companyId, name: process.name, code: process.code },
    responsible: userView(procedure.responsibleId),
    steps: storedSteps.filter((step) => step.procedureId === procedure.id).sort((a, b) => Number(a.position) - Number(b.position)).map((step) => {
       const links = storedStepResponsibles.filter((link) => link.stepId === step.id).sort((a, b) => a.userId.localeCompare(b.userId))
       return { ...step, responsibles: links.map((link) => ({ userId: link.userId, user: userView(link.userId) })) }
     }),
    indicators: storedIndicators.filter((indicator) => indicator.procedureId === procedure.id).map((indicator) => ({
      ...indicator,
      reportResponsible: userView(indicator.reportResponsibleId),
      monitorResponsible: userView(indicator.monitorResponsibleId),
    })),
    kpis: storedProcedureKpis
      .filter((link) => link.procedureId === procedure.id)
      .map((link) => ({ kpi: kpiView(storedKpis.find((kpi) => kpi.id === link.kpiId)!) })),
  })
  const versionView = (version: Record<string, unknown>) => ({
    ...version,
    changedBy: userView(version.changedById),
  })

  const procedureMatches = (procedure: Record<string, unknown>, where?: WhereClause) => {
    if (where?.processId && procedure.processId !== where.processId) return false
    if (where?.status && procedure.status !== where.status) return false
    if (where?.code !== undefined && procedure.code !== where.code) return false
    if (where?.OR) {
      return where.OR.some((clause) => {
        if (clause.code?.contains) return String(procedure.code).toLowerCase().includes(clause.code.contains.toLowerCase())
        if (clause.name?.contains) return String(procedure.name).toLowerCase().includes(clause.name.contains.toLowerCase())
        return false
      })
    }
    return true
  }
  const versionMatches = (version: Record<string, unknown>, where?: WhereClause) => {
    if (where?.procedureId && version.procedureId !== where.procedureId) return false
    if (where?.action && version.action !== where.action) return false
    if (where?.status && version.status !== where.status) return false
    return true
  }
  const sortedVersions = (where?: WhereClause) => storedVersions
    .filter((version) => versionMatches(version, where))
    .sort((a, b) => String(b.changedAt).localeCompare(String(a.changedAt)) || String(b.id).localeCompare(String(a.id)))

  const db: Record<string, unknown> = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id)
        return user ? { ...user, passwordHash } : null
      }),
    },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-procedure', expiresAt: new Date(Date.now() + 86400000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-procedure', expiresAt: new Date(Date.now() + 86400000), user: currentUser } : null),
      deleteMany: vi.fn(async () => { sessionActive = false; return { count: 1 } }),
    },
    process: {
      findUnique: vi.fn(async () => ({ ...process, company: { id: process.companyId } })),
    },
    kpi: {
      findMany: vi.fn(async ({ where, select }: { where?: { processId?: string }; select?: { id?: boolean; name?: boolean } } = {}) => storedKpis
        .filter((kpi) => !where?.processId || kpi.processId === where.processId)
        .map((kpi) => select ? { id: kpi.id, name: kpi.name } : kpiView(kpi))),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const kpi = storedKpis.find((item) => item.id === where.id)
        return kpi ? kpiView(kpi) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const kpi = { ...data, id: `cmkpi${String(storedKpis.length + 1).padStart(20, '0')}`, createdAt: new Date(), updatedAt: new Date() }
        storedKpis.push(kpi)
        return kpiView(kpi)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const kpi = storedKpis.find((item) => item.id === where.id)
        if (!kpi) throw new Error('KPI not found')
        Object.assign(kpi, data, { updatedAt: new Date() })
        return kpiView(kpi)
      }),
    },
    processKpi: {
      findMany: vi.fn(async ({ where, select }: { where?: { processId?: string }; select?: { kpiId?: boolean; kpi?: { select: { id: boolean; name: boolean } } } } = {}) => storedProcessKpis
        .filter((link) => !where?.processId || link.processId === where.processId)
        .map((link) => {
          const kpi = storedKpis.find((item) => item.id === link.kpiId)
          return select?.kpi ? { kpiId: link.kpiId, kpi: kpi ? { id: kpi.id, name: kpi.name } : null } : { kpiId: link.kpiId }
        })),
      create: vi.fn(async ({ data }: { data: { processId: string; kpiId: string } }) => { storedProcessKpis.push(data); return data }),
    },
    procedureKpi: {
      findMany: vi.fn(async ({ where }: { where?: { procedureId?: string } } = {}) => storedProcedureKpis.filter((link) => !where?.procedureId || link.procedureId === where.procedureId)),
      create: vi.fn(async ({ data }: { data: { procedureId: string; kpiId: string } }) => {
        const link = { ...data }
        storedProcedureKpis.push(link)
        return link
      }),
      deleteMany: vi.fn(async ({ where }: { where: { procedureId: string; kpiId: { notIn: string[] } } }) => {
        const before = storedProcedureKpis.length
        for (let index = storedProcedureKpis.length - 1; index >= 0; index -= 1) {
          const link = storedProcedureKpis[index]
          if (link.procedureId === where.procedureId && !where.kpiId.notIn.includes(link.kpiId)) storedProcedureKpis.splice(index, 1)
        }
        return { count: before - storedProcedureKpis.length }
      }),
    },
    procedure: {
      findMany: vi.fn(async ({ where }: { where?: WhereClause } = {}) => storedProcedures.filter((procedure) => procedureMatches(procedure, where)).map(procedureView)),
      findFirst: vi.fn(async ({ where }: { where?: WhereClause } = {}) => {
        const found = storedProcedures.find((procedure) => procedureMatches(procedure, where) && (!where?.NOT?.id || procedure.id !== where.NOT.id))
        return found ? { id: found.id } : null
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = storedProcedures.find((procedure) => procedure.id === where.id)
        return found ? procedureView(found) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        procedureSeq += 1
        // El mock aplica a mano los @default del schema (Prisma los aplicaría en la base real).
        const procedure = { id: `cmprocedure${String(procedureSeq).padStart(17, '0')}`, status: 'DRAFT', version: '1.0', description: null, responsibleId: null, createdAt: new Date(), updatedAt: new Date(), ...data }
        storedProcedures.push(procedure)
        return procedureView(procedure)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const procedure = storedProcedures.find((item) => item.id === where.id)
        if (!procedure) throw new Error('Procedure not found')
        Object.assign(procedure, data, { updatedAt: new Date() })
        return procedureView(procedure)
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedProcedures.findIndex((item) => item.id === where.id)
        if (index >= 0) storedProcedures.splice(index, 1)
        for (let stepIndex = storedSteps.length - 1; stepIndex >= 0; stepIndex -= 1) {
          if (storedSteps[stepIndex].procedureId === where.id) {
            const stepId = String(storedSteps[stepIndex].id)
            storedSteps.splice(stepIndex, 1)
            for (let linkIndex = storedStepResponsibles.length - 1; linkIndex >= 0; linkIndex -= 1) if (storedStepResponsibles[linkIndex].stepId === stepId) storedStepResponsibles.splice(linkIndex, 1)
          }
        }
        for (let indicatorIndex = storedIndicators.length - 1; indicatorIndex >= 0; indicatorIndex -= 1) {
          if (storedIndicators[indicatorIndex].procedureId === where.id) storedIndicators.splice(indicatorIndex, 1)
        }
        return { id: where.id }
      }),
    },
    procedureStep: {
      findMany: vi.fn(async ({ where }: { where?: { procedureId?: string }; select?: { id?: boolean } } = {}) => storedSteps.filter((step) => !where?.procedureId || step.procedureId === where.procedureId).map((step) => ({ ...step, responsibles: storedStepResponsibles.filter((link) => link.stepId === step.id).map((link) => ({ userId: link.userId })) }))),
      updateMany: vi.fn(async ({ where, data }: { where: { procedureId: string }; data: { position: { increment: number } } }) => {
        const matches = storedSteps.filter((step) => step.procedureId === where.procedureId)
        matches.forEach((step) => { step.position = Number(step.position) + data.position.increment })
        return { count: matches.length }
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const step = { id: `c${String(storedSteps.length + 1).padStart(24, '0')}`, createdAt: new Date(), updatedAt: new Date(), ...data }
        storedSteps.push(step)
        return step
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const step = storedSteps.find((item) => item.id === where.id)
        if (!step) throw new Error('Procedure step not found')
        Object.assign(step, data, { updatedAt: new Date() })
        return step
      }),
      deleteMany: vi.fn(async ({ where }: { where: { procedureId: string; id?: { notIn: string[] } } }) => {
        const before = storedSteps.length
        for (let index = storedSteps.length - 1; index >= 0; index -= 1) {
          const step = storedSteps[index]
          if (step.procedureId === where.procedureId && (!where.id || !where.id.notIn.includes(String(step.id)))) {
            const stepId = String(step.id)
            storedSteps.splice(index, 1)
            for (let linkIndex = storedStepResponsibles.length - 1; linkIndex >= 0; linkIndex -= 1) if (storedStepResponsibles[linkIndex].stepId === stepId) storedStepResponsibles.splice(linkIndex, 1)
          }
        }
        return { count: before - storedSteps.length }
      }),
    },
    procedureStepResponsible: {
      deleteMany: vi.fn(async ({ where }: { where: { stepId: string } }) => {
        const before = storedStepResponsibles.length
        for (let index = storedStepResponsibles.length - 1; index >= 0; index -= 1) if (storedStepResponsibles[index].stepId === where.stepId) storedStepResponsibles.splice(index, 1)
        return { count: before - storedStepResponsibles.length }
      }),
      createMany: vi.fn(async ({ data }: { data: Array<{ stepId: string; userId: string }> }) => {
        storedStepResponsibles.push(...data)
        return { count: data.length }
      }),
    },
    procedureIndicator: {
      findMany: vi.fn(async ({ where }: { where?: { procedureId?: string }; select?: { id?: boolean; name?: boolean } } = {}) => storedIndicators
        .filter((indicator) => !where?.procedureId || indicator.procedureId === where.procedureId)
        .map((indicator) => ({ id: indicator.id, name: indicator.name }))),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const indicator = { id: `cmi${String(storedIndicators.length + 1).padStart(22, '0')}`, createdAt: new Date(), updatedAt: new Date(), ...data }
        storedIndicators.push(indicator)
        return indicator
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const indicator = storedIndicators.find((item) => item.id === where.id)
        if (!indicator) throw new Error('Procedure indicator not found')
        Object.assign(indicator, data, { updatedAt: new Date() })
        return indicator
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedIndicators.findIndex((item) => item.id === where.id)
        if (index >= 0) storedIndicators.splice(index, 1)
        return { id: where.id }
      }),
    },
    procedureVersion: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        versionSeq += 1
        const version = { id: `cmproversion${String(versionSeq).padStart(19, '0')}`, changedAt: new Date(Date.now() + versionSeq), ...data }
        storedVersions.push(version)
        return version
      }),
      findFirst: vi.fn(async ({ where }: { where?: WhereClause } = {}) => {
        const found = storedVersions.find((version) => versionMatches(version, where))
        return found ? { id: found.id } : null
      }),
      count: vi.fn(async ({ where }: { where?: WhereClause } = {}) => storedVersions.filter((version) => versionMatches(version, where)).length),
      findMany: vi.fn(async ({ where }: { where?: WhereClause } = {}) => sortedVersions(where).map(versionView)),
      deleteMany: vi.fn(async ({ where }: { where?: WhereClause } = {}) => {
        const before = storedVersions.length
        for (let index = storedVersions.length - 1; index >= 0; index -= 1) {
          if (versionMatches(storedVersions[index], where)) storedVersions.splice(index, 1)
        }
        return { count: before - storedVersions.length }
      }),
    },
  }
  // Misma convención que el resto de arneses: la transacción ejecuta sobre el propio mock.
  db.$transaction = vi.fn(async (fn: (client: Record<string, unknown>) => Promise<unknown>) => fn(db))
  return { db: db as unknown as PrismaClient, storedProcedures, storedKpis, storedProcessKpis, storedProcedureKpis, storedSteps, storedStepResponsibles, storedIndicators, storedVersions }
}

async function loggedIn(db: PrismaClient, email = admin.email) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

const listPath = `/api/processes/${processId}/procedures`

// Forma estructural del `where` que envía la API a estos delegados: el arnés no replica Prisma y
// solo interpreta los criterios que las rutas de procedimientos realmente usan.
type WhereClause = {
  processId?: string
  procedureId?: string
  status?: string
  code?: string
  action?: string
  NOT?: { id?: string }
  OR?: Array<{ code?: { contains?: string }; name?: { contains?: string } }>
}

describe('process procedure API', () => {
  it('generates the next procedure code without reusing legacy codes', () => {
    expect(nextProcedureCode(['PRO-EST-001', 'PROC-01', 'PROC-03'])).toBe('PROC-04')
    expect(nextProcedureCode(['PRO-EST-001'])).toBe('PROC-01')
  })

  it('previews the next company code without reserving it and enforces access', async () => {
    const { db, storedProcedures } = makeProcedureDb()
    const agent = await loggedIn(db)

    const preview = await agent.get(`${listPath}/next-code`)
    expect(preview.status).toBe(200)
    expect(preview.body).toEqual({ code: 'PROC-01' })
    expect(storedProcedures).toHaveLength(0)

    const created = await agent.post(listPath).send(payload)
    expect(created.body.procedure.code).toBe('PROC-01')
    expect((await agent.get(`${listPath}/next-code`)).body).toEqual({ code: 'PROC-02' })

    const readOnly = makeProcedureDb('COMPANY_USER')
    const readOnlyAgent = await loggedIn(readOnly.db, companyUser.email)
    expect((await readOnlyAgent.get(`${listPath}/next-code`)).body).toEqual({ code: 'PROC-01' })

    const foreign = makeProcedureDb('COMPANY_ADMIN', otherCompanyId)
    const foreignAgent = await loggedIn(foreign.db, foreignAdmin.email)
    expect((await foreignAgent.get(`${listPath}/next-code`)).status).toBe(404)
  })

  it('assigns distinct codes when creations race for the same company', async () => {
    const { db } = makeProcedureDb()
    const agent = await loggedIn(db)

    const [first, second] = await Promise.all([
      agent.post(listPath).send(payload),
      agent.post(listPath).send({ ...payload, name: 'Seguimiento de solicitudes' }),
    ])

    expect([first.status, second.status]).toEqual([201, 201])
    expect([first.body.procedure.code, second.body.procedure.code].sort()).toEqual(['PROC-01', 'PROC-02'])
  })

  it('creates, reads, updates and deletes a procedure with its version history', async () => {
    const { db, storedVersions } = makeProcedureDb()
    const agent = await loggedIn(db)

    const created = await agent.post(listPath).send(payload)
    expect(created.status).toBe(201)
    expect(created.body.procedure).toMatchObject({
      id: expect.any(String),
      processId,
      companyId,
       code: 'PROC-01',
      name: payload.name,
      status: 'DRAFT',
      version: '1.0',
    })
    expect(created.body.procedure.responsible).toEqual({ id: admin.id, name: admin.name, isActive: true })
    const procedureId = created.body.procedure.id as string
    expect(storedVersions).toHaveLength(1)
    expect(storedVersions[0]).toMatchObject({ action: 'CREATED', status: 'DRAFT', version: '1.0', changedById: admin.id, changedByName: admin.name })

    const listed = await agent.get(listPath)
    expect(listed.status).toBe(200)
    expect(listed.body.procedures).toHaveLength(1)

    const updated = await agent.patch(`${listPath}/${procedureId}`).send({ name: 'Atención de solicitudes v2' })
    expect(updated.status).toBe(200)
    expect(updated.body.procedure.name).toBe('Atención de solicitudes v2')
    expect(storedVersions).toHaveLength(2)

    const history = await agent.get(`${listPath}/${procedureId}/history`)
    expect(history.status).toBe(200)
    expect(history.body).toMatchObject({ total: 2, page: 1, pageSize: 20 })
    expect(history.body.versions[0]).toMatchObject({ action: 'UPDATED', version: '1.0' })
    expect(history.body.versions[1]).toMatchObject({ action: 'CREATED' })

    const removed = await agent.delete(`${listPath}/${procedureId}`)
    expect(removed.status).toBe(204)
    expect((await agent.get(listPath)).body.procedures).toHaveLength(0)
    expect(storedVersions).toHaveLength(0)
  })

  it('creates, reorders and removes steps, and creates independent procedure indicators transactionally', async () => {
    const { db, storedSteps, storedStepResponsibles, storedIndicators, storedVersions } = makeProcedureDb()
    const agent = await loggedIn(db)
    const created = await agent.post(listPath).send({
      ...payload,
      steps: [
        { position: 0, title: 'Recibir solicitud', instruction: 'Registrar la solicitud.', criteria: 'Canal oficial.', responsibleIds: [admin.id, companyUser.id] },
        { position: 1, title: 'Cerrar solicitud', instruction: 'Confirmar el cierre.', criteria: null },
      ],
      indicators: [kpiPayload('Cumplimiento operativo')],
    })
    expect(created.status).toBe(201)
    expect(created.body.procedure.code).toBe('PROC-01')
    expect(created.body.procedure.steps.map((step: { title: string }) => step.title)).toEqual(['Recibir solicitud', 'Cerrar solicitud'])
    expect(created.body.procedure.indicators).toHaveLength(1)
    expect(storedSteps).toHaveLength(2)
    expect(storedStepResponsibles).toEqual(expect.arrayContaining([{ stepId: created.body.procedure.steps[0].id, userId: admin.id }, { stepId: created.body.procedure.steps[0].id, userId: companyUser.id }]))
    expect(created.body.procedure.steps[0].responsibleIds).toEqual([admin.id, companyUser.id].sort())
    expect(storedIndicators).toHaveLength(1)
    expect(storedVersions[0].snapshot).toMatchObject({
      steps: expect.arrayContaining([expect.objectContaining({ position: 0, title: 'Recibir solicitud', responsibleIds: [admin.id, companyUser.id] })]),
      indicators: expect.arrayContaining([expect.objectContaining({ name: 'Cumplimiento operativo' })]),
    })
    expect(created.body.procedure.steps[0].responsibles).toEqual([
      { id: admin.id, name: admin.name, isActive: true },
      { id: companyUser.id, name: companyUser.name, isActive: true },
    ])
    expect(created.body.procedure.steps[0].responsibles[0]).not.toHaveProperty('email')

    const procedureId = created.body.procedure.id as string
    const [firstStep, secondStep] = created.body.procedure.steps
    const reordered = await agent.patch(`${listPath}/${procedureId}`).send({
      steps: [
        { id: secondStep.id, position: 0, title: 'Cerrar solicitud actualizada', instruction: secondStep.instruction, criteria: secondStep.criteria },
        { id: firstStep.id, position: 1, title: firstStep.title, instruction: firstStep.instruction, criteria: firstStep.criteria },
      ],
    })
    expect(reordered.status).toBe(200)
    expect(reordered.body.procedure.steps.map((step: { title: string }) => step.title)).toEqual(['Cerrar solicitud actualizada', 'Recibir solicitud'])
    expect(reordered.body.procedure.steps.find((step: { id: string }) => step.id === firstStep.id).responsibleIds).toEqual([admin.id, companyUser.id].sort())

    const indicatorId = created.body.procedure.indicators[0].id as string
    const editedIndicator = await agent.patch(`${listPath}/${procedureId}/indicators/${indicatorId}`).send({ target: '98%' })
    expect(editedIndicator.status).toBe(200)
    expect(editedIndicator.body.indicator.target).toBe('98%')
    expect((await agent.delete(`${listPath}/${procedureId}/indicators/${indicatorId}`)).status).toBe(204)
    expect((await agent.get(`${listPath}/${procedureId}/indicators`)).body.indicators).toHaveLength(0)

    const removedStep = await agent.patch(`${listPath}/${procedureId}`).send({ steps: [{ id: secondStep.id, position: 0, title: 'Cerrar solicitud actualizada', instruction: secondStep.instruction, criteria: secondStep.criteria }] })
    expect(removedStep.status).toBe(200)
    expect(removedStep.body.procedure.steps).toHaveLength(1)
    expect(storedVersions.length).toBeGreaterThan(3)
  })

  it('replaces step responsible links only when responsibleIds is supplied', async () => {
    const { db, storedStepResponsibles } = makeProcedureDb()
    const agent = await loggedIn(db)
    const created = await agent.post(listPath).send({ ...payload, steps: [{ position: 0, title: 'Validar solicitud', instruction: 'Validar los datos.', responsibleIds: [admin.id, companyUser.id] }] })
    const procedureId = created.body.procedure.id as string
    const step = created.body.procedure.steps[0]

    const preserved = await agent.patch(`${listPath}/${procedureId}`).send({ steps: [{ id: step.id, position: 0, title: step.title, instruction: step.instruction }] })
    expect(preserved.status).toBe(200)
    expect(preserved.body.procedure.steps[0].responsibleIds).toEqual([admin.id, companyUser.id].sort())

    const cleared = await agent.patch(`${listPath}/${procedureId}`).send({ steps: [{ id: step.id, position: 0, title: step.title, instruction: step.instruction, responsibleIds: [] }] })
    expect(cleared.status).toBe(200)
    expect(cleared.body.procedure.steps[0].responsibleIds).toEqual([])
    expect(storedStepResponsibles).toEqual([])
  })

  it('rejects duplicate, foreign-company and inactive step responsible users', async () => {
    const duplicateDb = makeProcedureDb()
    const duplicateAgent = await loggedIn(duplicateDb.db)
    const duplicate = await duplicateAgent.post(listPath).send({ ...payload, steps: [{ position: 0, title: 'Validar solicitud', instruction: 'Validar los datos.', responsibleIds: [admin.id, admin.id] }] })
    expect(duplicate.status).toBe(400)

    const foreignDb = makeProcedureDb()
    const foreignAgent = await loggedIn(foreignDb.db)
    const foreign = await foreignAgent.post(listPath).send({ ...payload, steps: [{ position: 0, title: 'Validar solicitud', instruction: 'Validar los datos.', responsibleIds: [foreignAdmin.id] }] })
    expect(foreign.status).toBe(403)

    const inactiveDb = makeProcedureDb()
    const inactiveAgent = await loggedIn(inactiveDb.db)
    const inactive = await inactiveAgent.post(listPath).send({ ...payload, steps: [{ position: 0, title: 'Validar solicitud', instruction: 'Validar los datos.', responsibleIds: [inactiveUser.id] }] })
    expect(inactive.status).toBe(409)
  })

  it('creates and edits multiple embedded KPIs without deleting the process KPIs', async () => {
    const { db, storedKpis, storedProcedureKpis } = makeProcedureDb()
    const agent = await loggedIn(db)
    const first = await agent.post(listPath).send({
      ...payload,
      kpis: [kpiPayload('Cumplimiento de atención'), kpiPayload('Satisfacción del cliente', '90%')],
    })
    expect(first.status).toBe(201)
    expect(first.body.procedure.kpis).toHaveLength(2)
    expect(first.body.procedure.kpis.map((kpi: { name: string }) => kpi.name)).toEqual(['Cumplimiento de atención', 'Satisfacción del cliente'])
    expect(storedKpis).toHaveLength(2)
    expect(storedProcedureKpis).toHaveLength(2)

    const firstProcedureId = first.body.procedure.id as string
    const firstKpi = first.body.procedure.kpis[0]
    const secondProcedure = await agent.post(listPath).send({
      ...payload,
      code: 'PRO-COM-02',
      name: 'Seguimiento de solicitudes',
      kpis: [{ ...kpiPayload(firstKpi.name), id: firstKpi.id }],
    })
    expect(secondProcedure.status).toBe(201)
    expect(secondProcedure.body.procedure.kpis).toHaveLength(1)
    expect(secondProcedure.body.procedure.kpis[0].id).toBe(firstKpi.id)
    expect(storedKpis).toHaveLength(2)

    const edited = await agent.patch(`${listPath}/${firstProcedureId}`).send({
      kpis: [{ ...kpiPayload('Cumplimiento de atención actualizado', '98%'), id: firstKpi.id }],
    })
    expect(edited.status).toBe(200)
    expect(edited.body.procedure.kpis).toHaveLength(1)
    expect(edited.body.procedure.kpis[0]).toMatchObject({ id: firstKpi.id, name: 'Cumplimiento de atención actualizado', target: '98%' })
    expect(storedKpis).toHaveLength(2)
    expect(storedProcedureKpis).toEqual(expect.arrayContaining([
      { procedureId: secondProcedure.body.procedure.id, kpiId: firstKpi.id },
      { procedureId: firstProcedureId, kpiId: firstKpi.id },
    ]))
  })

  it('enforces the review flow and never overwrites approved content', async () => {
    const { db, storedVersions } = makeProcedureDb()
    const agent = await loggedIn(db)
    const created = await agent.post(listPath).send(payload)
    const procedureId = created.body.procedure.id as string

    const submitted = await agent.post(`${listPath}/${procedureId}/status`).send({ status: 'IN_REVIEW' })
    expect(submitted.status).toBe(200)
    expect(submitted.body.procedure).toMatchObject({ status: 'IN_REVIEW', version: '1.0' })

    // En revisión el contenido está congelado.
    const editWhileReviewing = await agent.patch(`${listPath}/${procedureId}`).send({ name: 'Cambios en revisión' })
    expect(editWhileReviewing.status).toBe(409)

    const approved = await agent.post(`${listPath}/${procedureId}/status`).send({ status: 'APPROVED', comment: 'Cumple con la política documental.' })
    expect(approved.status).toBe(200)
    expect(approved.body.procedure).toMatchObject({ status: 'APPROVED', version: '2.0' })

    // Lo aprobado no se edita: hay que abrir una nueva revisión desde el endpoint de estado.
    const editApproved = await agent.patch(`${listPath}/${procedureId}`).send({ name: 'Edición sobre aprobado' })
    expect(editApproved.status).toBe(409)
    expect(editApproved.body.error).toBe('Only a draft procedure can be edited')

    const history = await agent.get(`${listPath}/${procedureId}/history`)
    const approvedEntry = history.body.versions.find((entry: { action: string; status: string }) => entry.action === 'STATUS_CHANGED' && entry.status === 'APPROVED')
    expect(approvedEntry).toBeTruthy()
     expect(approvedEntry.snapshot).toMatchObject({ status: 'APPROVED', version: '2.0', code: 'PROC-01' })
    expect(approvedEntry.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'status', previousValue: 'IN_REVIEW', newValue: 'APPROVED' }),
      expect.objectContaining({ field: 'comment', newValue: 'Cumple con la política documental.' }),
    ]))

    const reopened = await agent.post(`${listPath}/${procedureId}/status`).send({ status: 'DRAFT' })
    expect(reopened.status).toBe(200)
    expect(reopened.body.procedure).toMatchObject({ status: 'DRAFT', version: '2.0' })

    const editAfterReopen = await agent.patch(`${listPath}/${procedureId}`).send({ name: 'Revisión 2 del procedimiento' })
    expect(editAfterReopen.status).toBe(200)

    // Transiciones inválidas: no se puede saltar de borrador a aprobado ni repetir el mismo estado.
    const skippedFlow = await agent.post(`${listPath}/${procedureId}/status`).send({ status: 'APPROVED' })
    expect(skippedFlow.status).toBe(409)
    const sameStatus = await agent.post(`${listPath}/${procedureId}/status`).send({ status: 'DRAFT' })
    expect(sameStatus.status).toBe(409)

    // El historial solo crece: nada lo sobrescribe (creación, revisión, aprobación, reapertura y
    // la edición posterior a la reapertura).
    expect(storedVersions.length).toBeGreaterThanOrEqual(5)
  })

  it('allows deleting a draft but protects procedures with approved versions', async () => {
    const { db, storedProcedures } = makeProcedureDb()
    const agent = await loggedIn(db)

    const draft = await agent.post(listPath).send(payload)
    expect((await agent.delete(`${listPath}/${draft.body.procedure.id}`)).status).toBe(204)

    const approved = await agent.post(listPath).send({ ...payload, code: 'PRO-COM-02' })
    const approvedId = approved.body.procedure.id as string
    await agent.post(`${listPath}/${approvedId}/status`).send({ status: 'IN_REVIEW' })
    await agent.post(`${listPath}/${approvedId}/status`).send({ status: 'APPROVED' })

    const blocked = await agent.delete(`${listPath}/${approvedId}`)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error).toBe('The procedure has approved versions; mark it obsolete instead')
    expect(storedProcedures).toHaveLength(1)
  })

  it('filters by code, name and status, and validates bad filters', async () => {
    const { db } = makeProcedureDb()
    const agent = await loggedIn(db)

    const first = await agent.post(listPath).send(payload)
    await agent.post(listPath).send({ ...payload, code: 'PRO-LOG-01', name: 'Logística de almacén' })
    await agent.post(`${listPath}/${first.body.procedure.id}/status`).send({ status: 'IN_REVIEW' })

     const byCode = await agent.get(`${listPath}?search=proc-01`)
    expect(byCode.status).toBe(200)
    expect(byCode.body.procedures).toHaveLength(1)
     expect(byCode.body.procedures[0].code).toBe('PROC-01')

    const byName = await agent.get(`${listPath}?search=log%C3%ADstica`)
    expect(byName.status).toBe(200)
    expect(byName.body.procedures).toHaveLength(1)

    const byStatus = await agent.get(`${listPath}?status=IN_REVIEW`)
    expect(byStatus.status).toBe(200)
    expect(byStatus.body.procedures).toHaveLength(1)
    expect(byStatus.body.procedures[0].status).toBe('IN_REVIEW')

    const badStatus = await agent.get(`${listPath}?status=ARCHIVED`)
    expect(badStatus.status).toBe(400)
    const badSearch = await agent.get(`${listPath}?search=${'x'.repeat(121)}`)
    expect(badSearch.status).toBe(400)
  })

  it('allows read-only users to list procedures but blocks every write', async () => {
    const { db } = makeProcedureDb('COMPANY_USER')
    const agent = await loggedIn(db, companyUser.email)

    expect((await agent.get(listPath)).status).toBe(200)
    expect((await agent.post(listPath).send(payload)).status).toBe(403)

    // userWriteGuard corre antes que el handler: cualquier escritura sobre un id arbitrario
    // devuelve 403 para COMPANY_USER sin llegar a consultar la base.
    const anyId = 'cmprocedure00000000000000001'
    expect((await agent.patch(`${listPath}/${anyId}`).send({ name: 'Nuevo nombre' })).status).toBe(403)
    expect((await agent.post(`${listPath}/${anyId}/status`).send({ status: 'IN_REVIEW' })).status).toBe(403)
    expect((await agent.delete(`${listPath}/${anyId}`)).status).toBe(403)
  })

  it('hides another company process and rejects cross-company references', async () => {
    const foreign = makeProcedureDb('COMPANY_ADMIN', otherCompanyId)
    const foreignAgent = await loggedIn(foreign.db, foreignAdmin.email)
    expect((await foreignAgent.get(listPath)).status).toBe(404)
    expect((await foreignAgent.post(listPath).send(payload)).status).toBe(404)

    const own = makeProcedureDb()
    const ownAgent = await loggedIn(own.db)
    const created = await ownAgent.post(listPath).send(payload)
    const procedureId = created.body.procedure.id as string
    const foreignAgentOnOwn = await loggedIn(foreign.db, foreignAdmin.email)
    expect((await foreignAgentOnOwn.patch(`${listPath}/${procedureId}`).send({ name: 'Intento ajeno' })).status).toBe(404)
    expect((await foreignAgentOnOwn.post(`${listPath}/${procedureId}/status`).send({ status: 'IN_REVIEW' })).status).toBe(404)
    expect((await foreignAgentOnOwn.get(`${listPath}/${procedureId}/history`)).status).toBe(404)

    const crossCompanyResponsible = await ownAgent.post(listPath).send({ ...payload, code: 'PRO-COM-09', responsibleId: foreignAdmin.id })
    expect(crossCompanyResponsible.status).toBe(403)

     const secondGenerated = await ownAgent.post(listPath).send(payload)
     expect(secondGenerated.status).toBe(201)
     expect(secondGenerated.body.procedure.code).toBe('PROC-02')
     const renamed = await ownAgent.patch(`${listPath}/${procedureId}`).send({ code: 'PROC-01' })
     expect(renamed.status).toBe(200)
     const attemptedRename = await ownAgent.patch(`${listPath}/${procedureId}`).send({ code: 'PROC-99' })
     expect(attemptedRename.status).toBe(409)
  })

  it('rejects malformed payloads, statuses and ids with 400', async () => {
    const { db } = makeProcedureDb()
    const agent = await loggedIn(db)
    const created = await agent.post(listPath).send(payload)
    const procedureId = created.body.procedure.id as string

    const missingFields = await agent.post(listPath).send({ code: 'X' })
    expect(missingFields.status).toBe(400)
    const emptyPatch = await agent.patch(`${listPath}/${procedureId}`).send({})
    expect(emptyPatch.status).toBe(400)
    const badStatus = await agent.post(`${listPath}/${procedureId}/status`).send({ status: 'ARCHIVED' })
    expect(badStatus.status).toBe(400)
    const badIds = await agent.get(`/api/processes/${processId}/procedures/not-a-cuid/history`)
    expect(badIds.status).toBe(400)
    const badPage = await agent.get(`${listPath}/${procedureId}/history?page=0`)
    expect(badPage.status).toBe(400)
  })

  it('requires authentication for the whole module', async () => {
    const { db } = makeProcedureDb()
    const anonymous = request.agent(createApp(db))
    expect((await anonymous.get(listPath)).status).toBe(401)
    expect((await anonymous.get(`${listPath}/next-code`)).status).toBe(401)
    expect((await anonymous.post(listPath).send(payload)).status).toBe(401)
  })
})
