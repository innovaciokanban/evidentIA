import bcrypt from 'bcryptjs'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const processId = 'cmprocess000000000000000001'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@procedure.test', name: 'Procedure Admin', role: 'COMPANY_ADMIN' as Role, companyId }
const companyUser = { id: 'cmuser0000000000000000001', email: 'user@procedure.test', name: 'Procedure User', role: 'COMPANY_USER' as Role, companyId }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@procedure.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId }
const process = { id: processId, companyId, name: 'Gestión Comercial', code: 'PROC-01' }

const payload = {
  code: 'PRO-COM-01',
  name: 'Atención de solicitudes',
  objective: 'Estandarizar la atención de las solicitudes del cliente.',
  scope: 'Todas las solicitudes recibidas por los canales oficiales.',
  description: 'Recepción, clasificación, respuesta y cierre de solicitudes.',
  responsibleId: admin.id,
}

function makeProcedureDb(role: Role = 'COMPANY_ADMIN', userCompanyId = companyId) {
  const users = [admin, companyUser, foreignAdmin]
  const currentUser = users.find((user) => user.role === role && user.companyId === userCompanyId) ?? { ...admin, role, companyId: userCompanyId }
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  let sessionActive = false
  const storedProcedures: Array<Record<string, unknown>> = []
  const storedVersions: Array<Record<string, unknown>> = []
  let procedureSeq = 0
  let versionSeq = 0

  const userView = (id: unknown) => {
    const user = users.find((item) => item.id === id)
    return user ? { id: user.id, name: user.name } : null
  }
  const procedureView = (procedure: Record<string, unknown>) => ({
    ...procedure,
    process: { id: processId, companyId: process.companyId, name: process.name, code: process.code },
    responsible: userView(procedure.responsibleId),
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
  return { db: db as unknown as PrismaClient, storedProcedures, storedVersions }
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
  it('creates, reads, updates and deletes a procedure with its version history', async () => {
    const { db, storedVersions } = makeProcedureDb()
    const agent = await loggedIn(db)

    const created = await agent.post(listPath).send(payload)
    expect(created.status).toBe(201)
    expect(created.body.procedure).toMatchObject({
      id: expect.any(String),
      processId,
      companyId,
      code: payload.code,
      name: payload.name,
      status: 'DRAFT',
      version: '1.0',
    })
    expect(created.body.procedure.responsible).toEqual({ id: admin.id, name: admin.name })
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
    expect(approvedEntry.snapshot).toMatchObject({ status: 'APPROVED', version: '2.0', code: payload.code })
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

    const byCode = await agent.get(`${listPath}?search=pro-com`)
    expect(byCode.status).toBe(200)
    expect(byCode.body.procedures).toHaveLength(1)
    expect(byCode.body.procedures[0].code).toBe('PRO-COM-01')

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

    const duplicated = await ownAgent.post(listPath).send(payload)
    expect(duplicated.status).toBe(409)
    const renamed = await ownAgent.patch(`${listPath}/${procedureId}`).send({ code: payload.code })
    expect(renamed.status).toBe(200)
    const second = await ownAgent.post(listPath).send({ ...payload, code: 'PRO-COM-10' })
    const renameConflict = await ownAgent.patch(`${listPath}/${second.body.procedure.id}`).send({ code: payload.code })
    expect(renameConflict.status).toBe(409)
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
    expect((await anonymous.post(listPath).send(payload)).status).toBe(401)
  })
})
