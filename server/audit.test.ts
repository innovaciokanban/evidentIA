import bcrypt from 'bcryptjs'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp, nextAuditCode } from './app.js'

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const processId = 'cmprocess000000000000000001'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@audit.test', name: 'Audit Admin', role: 'COMPANY_ADMIN' as Role, companyId }
const companyUser = { id: 'cmuser0000000000000000001', email: 'user@audit.test', name: 'Audit User', role: 'COMPANY_USER' as Role, companyId }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@audit.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId }
const process = { id: processId, companyId, name: 'Gestión Comercial', code: 'PROC-01' }

const payload = {
  title: 'Auditoría interna de cumplimiento',
  scope: 'Procesos comerciales de la empresa.',
  criteria: 'Manual de calidad v2 y normativa aplicable.',
  leadAuditorId: admin.id,
  responsibleId: admin.id,
}

function makeAuditDb(role: Role = 'COMPANY_ADMIN', userCompanyId = companyId) {
  const users = [admin, companyUser, foreignAdmin]
  const currentUser = users.find((user) => user.role === role && user.companyId === userCompanyId) ?? { ...admin, role, companyId: userCompanyId }
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  let sessionActive = false
  const storedAudits: Array<Record<string, unknown>> = []
  const storedFindings: Array<Record<string, unknown>> = []
  const storedEvidences: Array<Record<string, unknown>> = []
  const storedEvents: Array<Record<string, unknown>> = []
  let auditSeq = 0
  let findingSeq = 0
  let evidenceSeq = 0
  let eventSeq = 0

  const userView = (id: unknown) => {
    const user = users.find((item) => item.id === id)
    return user ? { id: user.id, name: user.name } : null
  }
  const findingView = (finding: Record<string, unknown>) => ({
    ...finding,
    responsible: userView(finding.responsibleId),
    verifiedBy: userView(finding.verifiedById),
  })
  const auditView = (audit: Record<string, unknown>) => ({
    ...audit,
    process: { id: processId, companyId: process.companyId, name: process.name, code: process.code },
    leadAuditor: userView(audit.leadAuditorId),
    responsible: userView(audit.responsibleId),
    findings: storedFindings.filter((item) => item.auditId === audit.id).map(findingView),
    evidences: storedEvidences.filter((item) => item.auditId === audit.id),
  })

  const auditMatches = (audit: Record<string, unknown>, where?: AuditWhere) => {
    if (where?.id && audit.id !== where.id) return false
    if (where?.processId && audit.processId !== where.processId) return false
    if (where?.status && audit.status !== where.status) return false
    if (where?.process?.companyId) {
      if (process.companyId !== where.process.companyId) return false
    }
    if (where?.OR) {
      return where.OR.some((clause) => {
        if (clause.code?.contains) return String(audit.code).toLowerCase().includes(clause.code.contains.toLowerCase())
        if (clause.title?.contains) return String(audit.title).toLowerCase().includes(clause.title.contains.toLowerCase())
        return false
      })
    }
    return true
  }
  const findingMatches = (finding: Record<string, unknown>, where?: FindingWhere) => {
    if (where?.id && finding.id !== where.id) return false
    if (where?.auditId && finding.auditId !== where.auditId) return false
    if (where?.status && finding.status !== where.status) return false
    return true
  }
  const evidenceMatches = (evidence: Record<string, unknown>, where?: EvidenceWhere) => {
    if (where?.id && evidence.id !== where.id) return false
    if (where?.auditId && evidence.auditId !== where.auditId) return false
    if (where?.findingId !== undefined && evidence.findingId !== where.findingId) return false
    return true
  }
  const eventMatches = (event: Record<string, unknown>, where?: EventWhere) => {
    if (where?.auditId && event.auditId !== where.auditId) return false
    if (where?.eventType && event.eventType !== where.eventType) return false
    return true
  }
  const sortedEvents = (where?: EventWhere) => storedEvents
    .filter((event) => eventMatches(event, where))
    .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)) || String(b.id).localeCompare(String(a.id)))

  const db: Record<string, unknown> = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id)
        return user ? { ...user, passwordHash } : null
      }),
    },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-audit', expiresAt: new Date(Date.now() + 86400000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-audit', expiresAt: new Date(Date.now() + 86400000), user: currentUser } : null),
      deleteMany: vi.fn(async () => { sessionActive = false; return { count: 1 } }),
    },
    process: {
      findUnique: vi.fn(async () => ({ ...process, company: { id: process.companyId } })),
    },
    audit: {
      findMany: vi.fn(async ({ where }: { where?: AuditWhere } = {}) => storedAudits.filter((audit) => auditMatches(audit, where)).map(auditView)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = storedAudits.find((audit) => audit.id === where.id)
        return found ? auditView(found) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditSeq += 1
        const audit = {
          id: `cmaudit${String(auditSeq).padStart(20, '0')}`,
          status: 'PLANNED',
          auditType: null,
          objectives: null,
          plannedDate: null,
          startDate: null,
          endDate: null,
          summary: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }
        storedAudits.push(audit)
        return auditView(audit)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const audit = storedAudits.find((item) => item.id === where.id)
        if (!audit) throw new Error('Audit not found')
        Object.assign(audit, data, { updatedAt: new Date() })
        return auditView(audit)
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedAudits.findIndex((item) => item.id === where.id)
        if (index >= 0) storedAudits.splice(index, 1)
        return { id: where.id }
      }),
    },
    auditFinding: {
      findMany: vi.fn(async ({ where }: { where?: FindingWhere } = {}) => storedFindings.filter((finding) => findingMatches(finding, where)).map(findingView)),
      findFirst: vi.fn(async ({ where }: { where?: FindingWhere } = {}) => {
        const found = storedFindings.find((finding) => findingMatches(finding, where))
        return found ? { id: found.id } : null
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = storedFindings.find((finding) => finding.id === where.id)
        return found ? findingView(found) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        findingSeq += 1
        const finding = {
          id: `cmfinding${String(findingSeq).padStart(19, '0')}`,
          status: 'OPEN',
          dueDate: null,
          resolution: null,
          verifiedById: null,
          verifiedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }
        storedFindings.push(finding)
        return findingView(finding)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const finding = storedFindings.find((item) => item.id === where.id)
        if (!finding) throw new Error('Finding not found')
        Object.assign(finding, data, { updatedAt: new Date() })
        return findingView(finding)
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedFindings.findIndex((item) => item.id === where.id)
        if (index >= 0) storedFindings.splice(index, 1)
        return { id: where.id }
      }),
    },
    auditEvidence: {
      findMany: vi.fn(async ({ where }: { where?: EvidenceWhere } = {}) => storedEvidences.filter((evidence) => evidenceMatches(evidence, where))),
      findFirst: vi.fn(async ({ where }: { where?: EvidenceWhere } = {}) => {
        const found = storedEvidences.find((evidence) => evidenceMatches(evidence, where))
        return found ? { id: found.id } : null
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => storedEvidences.find((item) => item.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        evidenceSeq += 1
        const evidence = {
          id: `cmevidence${String(evidenceSeq).padStart(18, '0')}`,
          findingId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }
        storedEvidences.push(evidence)
        return evidence
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const evidence = storedEvidences.find((item) => item.id === where.id)
        if (!evidence) throw new Error('Evidence not found')
        Object.assign(evidence, data, { updatedAt: new Date() })
        return evidence
      }),
      updateMany: vi.fn(async ({ where, data }: { where: EvidenceWhere; data: Record<string, unknown> }) => {
        let count = 0
        for (const evidence of storedEvidences) {
          if (evidenceMatches(evidence, where)) { Object.assign(evidence, data); count += 1 }
        }
        return { count }
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedEvidences.findIndex((item) => item.id === where.id)
        if (index >= 0) storedEvidences.splice(index, 1)
        return { id: where.id }
      }),
      deleteMany: vi.fn(async ({ where }: { where?: EvidenceWhere } = {}) => {
        const before = storedEvidences.length
        for (let index = storedEvidences.length - 1; index >= 0; index -= 1) {
          if (evidenceMatches(storedEvidences[index], where)) storedEvidences.splice(index, 1)
        }
        return { count: before - storedEvidences.length }
      }),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        eventSeq += 1
        const event = { id: `cmaevent${String(eventSeq).padStart(20, '0')}`, occurredAt: new Date(Date.now() + eventSeq), changes: null, metadata: null, ...data }
        storedEvents.push(event)
        return event
      }),
      findMany: vi.fn(async ({ where }: { where?: EventWhere } = {}) => sortedEvents(where).map((event) => ({ ...event, actor: userView(event.actorId) }))),
      count: vi.fn(async ({ where }: { where?: EventWhere } = {}) => storedEvents.filter((event) => eventMatches(event, where)).length),
      deleteMany: vi.fn(async ({ where }: { where?: EventWhere } = {}) => {
        const before = storedEvents.length
        for (let index = storedEvents.length - 1; index >= 0; index -= 1) {
          if (eventMatches(storedEvents[index], where)) storedEvents.splice(index, 1)
        }
        return { count: before - storedEvents.length }
      }),
    },
  }
  db.$queryRaw = vi.fn(async () => [{ locked: true }])
  // Misma convención que el resto de arneses: la transacción ejecuta sobre el propio mock.
  db.$transaction = vi.fn(async (fn: (client: Record<string, unknown>) => Promise<unknown>) => fn(db))
  return { db: db as unknown as PrismaClient, storedAudits, storedFindings, storedEvidences, storedEvents }
}

async function loggedIn(db: PrismaClient, email = admin.email) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

const listPath = `/api/processes/${processId}/audits`

// Forma estructural del `where` que envía la API a estos delegados: el arnés no replica Prisma y
// solo interpreta los criterios que las rutas de auditorías realmente usan.
type AuditWhere = {
  id?: string
  processId?: string
  status?: string
  process?: { companyId?: string }
  OR?: Array<{ code?: { contains?: string }; title?: { contains?: string } }>
}
type FindingWhere = { id?: string; auditId?: string; status?: string }
type EvidenceWhere = { id?: string; auditId?: string; findingId?: string | null }
type EventWhere = { auditId?: string; eventType?: string }

describe('nextAuditCode', () => {
  it('issues sequential codes and skips gaps left by deleted audits', () => {
    expect(nextAuditCode([])).toBe('AUD-001')
    expect(nextAuditCode(['AUD-001'])).toBe('AUD-002')
    expect(nextAuditCode(['AUD-001', 'AUD-003'])).toBe('AUD-002')
    expect(nextAuditCode(['AUD-001', 'AUD-002', 'not-a-code'])).toBe('AUD-003')
    expect(nextAuditCode([null, undefined, ''])).toBe('AUD-001')
  })
})

describe('process audit API', () => {
  it('creates, reads, updates and deletes an audit with automatic code and history', async () => {
    const { db, storedEvents, storedAudits } = makeAuditDb()
    const agent = await loggedIn(db)

    const created = await agent.post(listPath).send(payload)
    expect(created.status).toBe(201)
    expect(created.body.audit).toMatchObject({
      id: expect.any(String),
      processId,
      companyId,
      code: 'AUD-001',
      title: payload.title,
      status: 'PLANNED',
      findings: [],
      evidences: [],
    })
    expect(created.body.audit.leadAuditor).toEqual({ id: admin.id, name: admin.name })
    expect(created.body.audit.responsible).toEqual({ id: admin.id, name: admin.name })
    expect(storedEvents).toHaveLength(1)
    expect(storedEvents[0]).toMatchObject({ eventType: 'AUDIT_CREATED', actorId: admin.id })

    const second = await agent.post(listPath).send({ ...payload, title: 'Auditoría de seguimiento' })
    expect(second.status).toBe(201)
    expect(second.body.audit.code).toBe('AUD-002')

    const listed = await agent.get(listPath)
    expect(listed.status).toBe(200)
    expect(listed.body.audits).toHaveLength(2)
    expect(listed.body.audits[0].code).toBe('AUD-001')

    const auditId = created.body.audit.id as string
    const fetched = await agent.get(`${listPath}/${auditId}`)
    expect(fetched.status).toBe(200)
    expect(fetched.body.audit.code).toBe('AUD-001')

    const updated = await agent.patch(`${listPath}/${auditId}`).send({ title: 'Auditoría interna v2', auditType: 'Interna' })
    expect(updated.status).toBe(200)
    expect(updated.body.audit).toMatchObject({ title: 'Auditoría interna v2', auditType: 'Interna' })

    const history = await agent.get(`${listPath}/${auditId}/history`)
    expect(history.status).toBe(200)
    expect(history.body).toMatchObject({ total: 2, page: 1, pageSize: 20 })
    expect(history.body.events[0].eventType).toBe('AUDIT_UPDATED')
    expect(history.body.events[1].eventType).toBe('AUDIT_CREATED')

    const removed = await agent.delete(`${listPath}/${auditId}`)
    expect(removed.status).toBe(204)
    expect(storedAudits).toHaveLength(1)
  })

  it('enforces the audit lifecycle, requires a summary to close and blocks writes once terminal', async () => {
    const { db } = makeAuditDb()
    const agent = await loggedIn(db)
    const created = await agent.post(listPath).send(payload)
    const auditId = created.body.audit.id as string

    const started = await agent.post(`${listPath}/${auditId}/status`).send({ status: 'IN_PROGRESS' })
    expect(started.status).toBe(200)
    expect(started.body.audit).toMatchObject({ status: 'IN_PROGRESS' })
    expect(started.body.audit.startDate).toBeTruthy()

    const closedWithoutSummary = await agent.post(`${listPath}/${auditId}/status`).send({ status: 'CLOSED' })
    expect(closedWithoutSummary.status).toBe(400)
    expect(closedWithoutSummary.body.error).toBe('Closing an audit requires a summary with at least 3 characters')

    const closed = await agent.post(`${listPath}/${auditId}/status`).send({ status: 'CLOSED', summary: 'Auditoría sin no conformidades.' })
    expect(closed.status).toBe(200)
    expect(closed.body.audit).toMatchObject({ status: 'CLOSED', summary: 'Auditoría sin no conformidades.' })
    expect(closed.body.audit.endDate).toBeTruthy()

    // Terminal: toda escritura queda bloqueada (409) sin reabrir.
    const editClosed = await agent.patch(`${listPath}/${auditId}`).send({ title: 'Intento de edición' })
    expect(editClosed.status).toBe(409)
    const reopen = await agent.post(`${listPath}/${auditId}/status`).send({ status: 'IN_PROGRESS' })
    expect(reopen.status).toBe(409)
    expect(reopen.body.error).toBe('Invalid audit status transition')

    // Transiciones inválidas desde PLANNED (no se salta a CLOSED).
    const { db: plannedDb } = makeAuditDb()
    const plannedAgent = await loggedIn(plannedDb)
    const planned = await plannedAgent.post(listPath).send(payload)
    const plannedId = planned.body.audit.id as string
    const skipped = await plannedAgent.post(`${listPath}/${plannedId}/status`).send({ status: 'CLOSED', summary: 'Salto ilegal.' })
    expect(skipped.status).toBe(409)
    const sameStatus = await plannedAgent.post(`${listPath}/${plannedId}/status`).send({ status: 'PLANNED' })
    expect(sameStatus.status).toBe(409)

    const cancelled = await plannedAgent.post(`${listPath}/${plannedId}/status`).send({ status: 'CANCELLED' })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.audit).toMatchObject({ status: 'CANCELLED' })
    expect(cancelled.body.audit.endDate).toBeTruthy()
  })

  it('supports findings, evidence, the finding lifecycle and protects verified findings', async () => {
    const { db, storedFindings, storedEvidences, storedAudits } = makeAuditDb()
    const agent = await loggedIn(db)
    const created = await agent.post(listPath).send(payload)
    const auditId = created.body.audit.id as string
    const findingPath = `${listPath}/${auditId}/findings`

    const finding = await agent.post(findingPath).send({
      title: 'Falta de registro de capacitación',
      description: 'Dos colaboradores sin evidencia de capacitación en el periodo auditado.',
      type: 'NONCONFORMITY',
      severity: 'MAJOR',
      responsibleId: admin.id,
    })
    expect(finding.status).toBe(201)
    expect(finding.body.finding).toMatchObject({ status: 'OPEN', type: 'NONCONFORMITY', severity: 'MAJOR' })
    const findingId = finding.body.finding.id as string

    const listedFindings = await agent.get(findingPath)
    expect(listedFindings.status).toBe(200)
    expect(listedFindings.body.findings).toHaveLength(1)

    // Flujo del hallazgo: OPEN → IN_PROGRESS → RESOLVED (exige resolución) → VERIFIED.
    const inProgress = await agent.post(`${findingPath}/${findingId}/status`).send({ status: 'IN_PROGRESS' })
    expect(inProgress.status).toBe(200)
    expect(inProgress.body.finding.status).toBe('IN_PROGRESS')

    const resolvedWithoutText = await agent.post(`${findingPath}/${findingId}/status`).send({ status: 'RESOLVED' })
    expect(resolvedWithoutText.status).toBe(400)

    const resolved = await agent.post(`${findingPath}/${findingId}/status`).send({ status: 'RESOLVED', resolution: 'Capacitación programada y registrada.' })
    expect(resolved.status).toBe(200)
    expect(resolved.body.finding).toMatchObject({ status: 'RESOLVED', resolution: 'Capacitación programada y registrada.' })

    const verified = await agent.post(`${findingPath}/${findingId}/status`).send({ status: 'VERIFIED' })
    expect(verified.status).toBe(200)
    expect(verified.body.finding).toMatchObject({ status: 'VERIFIED' })
    expect(verified.body.finding.verifiedBy).toEqual({ id: admin.id, name: admin.name })
    expect(verified.body.finding.verifiedAt).toBeTruthy()

    // VERIFIED es terminal para el hallazgo: no se edita ni se borra.
    const editVerified = await agent.patch(`${findingPath}/${findingId}`).send({ title: 'Edición tras verificación' })
    expect(editVerified.status).toBe(409)
    expect(editVerified.body.error).toBe('A verified finding cannot be edited')
    const deleteVerified = await agent.delete(`${findingPath}/${findingId}`)
    expect(deleteVerified.status).toBe(409)
    expect(deleteVerified.body.error).toBe('A verified finding cannot be deleted')

    // Una auditoría con hallazgos no se borra: se cancela en su lugar.
    const deleteAuditWithFindings = await agent.delete(`${listPath}/${auditId}`)
    expect(deleteAuditWithFindings.status).toBe(409)
    expect(deleteAuditWithFindings.body.error).toBe('The audit has findings; cancel it instead')
    expect(storedAudits).toHaveLength(1)

    // Evidencias: URL válida y anclaje a hallazgo de la MISMA auditoría.
    const evidencePath = `${listPath}/${auditId}/evidences`
    const badUrl = await agent.post(evidencePath).send({ name: 'Plan de capacitación', description: 'Evidencia del plan.', url: 'ftp://archivo.com/plan.pdf' })
    expect(badUrl.status).toBe(400)

    const evidence = await agent.post(evidencePath).send({
      name: 'Plan de capacitación',
      description: 'Evidencia del plan de capacitación firmado.',
      url: 'https://evidentia.test/capacitacion.pdf',
      findingId,
    })
    expect(evidence.status).toBe(201)
    expect(evidence.body.evidence).toMatchObject({ findingId, url: 'https://evidentia.test/capacitacion.pdf' })

    // Hallazgo de otra auditoría: 404 sin filtrar existencia.
    const crossFinding = await agent.post(evidencePath).send({
      name: 'Evidencia cruzada',
      description: 'Intento de anclar a un hallazgo ajeno.',
      url: 'https://evidentia.test/ajena.pdf',
      findingId: 'cmfinding00000000000000099',
    })
    expect(crossFinding.status).toBe(404)
    expect(crossFinding.body.error).toBe('Finding not found')

    const listedEvidences = await agent.get(evidencePath)
    expect(listedEvidences.status).toBe(200)
    expect(listedEvidences.body.evidences).toHaveLength(1)

    // Cerrar la auditoría con hallazgo verificado bloquea hallazgos y evidencias.
    const start = await agent.post(`${listPath}/${auditId}/status`).send({ status: 'IN_PROGRESS' })
    expect(start.status).toBe(200)
    const closed = await agent.post(`${listPath}/${auditId}/status`).send({ status: 'CLOSED', summary: 'Cierre con hallazgo verificado.' })
    expect(closed.status).toBe(200)
    const findingAfterClose = await agent.post(findingPath).send({
      title: 'Hallazgo tardío',
      description: 'Intento de registrar un hallazgo tras el cierre.',
      type: 'OBSERVATION',
      severity: 'MINOR',
    })
    expect(findingAfterClose.status).toBe(409)
    const evidenceAfterClose = await agent.post(evidencePath).send({
      name: 'Evidencia tardía',
      description: 'Intento de registrar evidencia tras el cierre.',
      url: 'https://evidentia.test/tardia.pdf',
    })
    expect(evidenceAfterClose.status).toBe(409)

    expect(storedFindings).toHaveLength(1)
    expect(storedEvidences).toHaveLength(1)
  })

  it('deletes an unlinked audit, keeps evidences when a finding is deleted and writes append-only history', async () => {
    const { db, storedEvents, storedFindings, storedEvidences, storedAudits } = makeAuditDb()
    const agent = await loggedIn(db)

    // Auditoría sin hallazgos: se borra limpia (evidencias + eventos + auditoría en la misma tx).
    const disposable = await agent.post(listPath).send({ ...payload, title: 'Auditoría desechable' })
    const disposableId = disposable.body.audit.id as string
    const disposableEvidence = await agent.post(`${listPath}/${disposableId}/evidences`).send({
      name: 'Anexo de apertura',
      description: 'Evidencia de la auditoría desechable.',
      url: 'https://evidentia.test/apertura.pdf',
    })
    expect(disposableEvidence.status).toBe(201)
    const removed = await agent.delete(`${listPath}/${disposableId}`)
    expect(removed.status).toBe(204)
    expect(storedAudits).toHaveLength(0)
    expect(storedEvidences).toHaveLength(0)
    expect(storedEvents).toHaveLength(0)

    // Hallazgo eliminado: sus evidencias quedan con findingId en null (SET NULL).
    const kept = await agent.post(listPath).send(payload)
    const keptId = kept.body.audit.id as string
    const finding = await agent.post(`${listPath}/${keptId}/findings`).send({
      title: 'Observación menor',
      description: 'Observación sobre el registro de actas.',
      type: 'OBSERVATION',
      severity: 'MINOR',
    })
    const findingId = finding.body.finding.id as string
    const evidence = await agent.post(`${listPath}/${keptId}/evidences`).send({
      name: 'Acta de la reunión',
      description: 'Evidencia anclada al hallazgo.',
      url: 'https://evidentia.test/acta.pdf',
      findingId,
    })
    expect(evidence.status).toBe(201)

    const deleteFinding = await agent.delete(`${listPath}/${keptId}/findings/${findingId}`)
    expect(deleteFinding.status).toBe(204)
    expect(storedFindings).toHaveLength(0)
    expect(storedEvidences).toHaveLength(1)
    expect(storedEvidences[0].findingId).toBeNull()

    // El historial solo crece y cada operación deja su evento.
    const history = await agent.get(`${listPath}/${keptId}/history`)
    expect(history.status).toBe(200)
    const types = history.body.events.map((event: { eventType: string }) => event.eventType)
    expect(types).toEqual(expect.arrayContaining(['AUDIT_CREATED', 'FINDING_CREATED', 'EVIDENCE_CREATED', 'FINDING_DELETED']))

    const filtered = await agent.get(`${listPath}/${keptId}/history?eventType=FINDING_CREATED`)
    expect(filtered.status).toBe(200)
    expect(filtered.body.events).toHaveLength(1)
    expect(filtered.body.events[0].eventType).toBe('FINDING_CREATED')
  })

  it('does not write history for no-op updates', async () => {
    const { db, storedEvents } = makeAuditDb()
    const agent = await loggedIn(db)
    const created = await agent.post(listPath).send(payload)
    const auditId = created.body.audit.id as string
    const before = storedEvents.length

    const noop = await agent.patch(`${listPath}/${auditId}`).send({ title: payload.title })
    expect(noop.status).toBe(200)
    expect(storedEvents).toHaveLength(before)
  })

  it('filters by code, title and status, and validates bad filters', async () => {
    const { db } = makeAuditDb()
    const agent = await loggedIn(db)

    const first = await agent.post(listPath).send(payload)
    await agent.post(listPath).send({ ...payload, title: 'Auditoría logística' })
    await agent.post(`${listPath}/${first.body.audit.id}/status`).send({ status: 'IN_PROGRESS' })

    const byCode = await agent.get(`${listPath}?search=aud-001`)
    expect(byCode.status).toBe(200)
    expect(byCode.body.audits).toHaveLength(1)
    expect(byCode.body.audits[0].code).toBe('AUD-001')

    const byTitle = await agent.get(`${listPath}?search=log%C3%ADstica`)
    expect(byTitle.status).toBe(200)
    expect(byTitle.body.audits).toHaveLength(1)

    const byStatus = await agent.get(`${listPath}?status=IN_PROGRESS`)
    expect(byStatus.status).toBe(200)
    expect(byStatus.body.audits).toHaveLength(1)
    expect(byStatus.body.audits[0].status).toBe('IN_PROGRESS')

    const badStatus = await agent.get(`${listPath}?status=ARCHIVED`)
    expect(badStatus.status).toBe(400)
    const badSearch = await agent.get(`${listPath}?search=${'x'.repeat(121)}`)
    expect(badSearch.status).toBe(400)
  })

  it('allows read-only users to list audits but blocks every write', async () => {
    const { db } = makeAuditDb('COMPANY_USER')
    const agent = await loggedIn(db, companyUser.email)

    expect((await agent.get(listPath)).status).toBe(200)
    expect((await agent.post(listPath).send(payload)).status).toBe(403)

    // userWriteGuard corre antes que el handler: cualquier escritura sobre un id arbitrario
    // devuelve 403 para COMPANY_USER sin llegar a consultar la base.
    const anyId = 'cmaudit000000000000000001'
    expect((await agent.patch(`${listPath}/${anyId}`).send({ title: 'Nuevo título' })).status).toBe(403)
    expect((await agent.post(`${listPath}/${anyId}/status`).send({ status: 'IN_PROGRESS' })).status).toBe(403)
    expect((await agent.delete(`${listPath}/${anyId}`)).status).toBe(403)
    expect((await agent.post(`${listPath}/${anyId}/findings`).send({ title: 'Hallazgo', description: 'Descripción.', type: 'OBSERVATION', severity: 'MINOR' })).status).toBe(403)
    expect((await agent.post(`${listPath}/${anyId}/evidences`).send({ name: 'Evidencia', description: 'Descripción.', url: 'https://evidentia.test/e.pdf' })).status).toBe(403)
  })

  it('hides another company process and rejects cross-company references', async () => {
    const foreign = makeAuditDb('COMPANY_ADMIN', otherCompanyId)
    const foreignAgent = await loggedIn(foreign.db, foreignAdmin.email)
    expect((await foreignAgent.get(listPath)).status).toBe(404)
    expect((await foreignAgent.post(listPath).send(payload)).status).toBe(404)

    const own = makeAuditDb()
    const ownAgent = await loggedIn(own.db)
    const created = await ownAgent.post(listPath).send(payload)
    const auditId = created.body.audit.id as string
    const foreignAgentOnOwn = await loggedIn(foreign.db, foreignAdmin.email)
    expect((await foreignAgentOnOwn.patch(`${listPath}/${auditId}`).send({ title: 'Intento ajeno' })).status).toBe(404)
    expect((await foreignAgentOnOwn.post(`${listPath}/${auditId}/status`).send({ status: 'IN_PROGRESS' })).status).toBe(404)
    expect((await foreignAgentOnOwn.get(`${listPath}/${auditId}/history`)).status).toBe(404)
    expect((await foreignAgentOnOwn.get(`${listPath}/${auditId}/findings`)).status).toBe(404)

    // Responsable de otra empresa: 403 sin filtrar existencia.
    const crossLead = await ownAgent.post(listPath).send({ ...payload, leadAuditorId: foreignAdmin.id })
    expect(crossLead.status).toBe(403)
    const crossResponsible = await ownAgent.post(listPath).send({ ...payload, responsibleId: foreignAdmin.id })
    expect(crossResponsible.status).toBe(403)
  })

  it('rejects malformed payloads, statuses and ids with 400', async () => {
    const { db } = makeAuditDb()
    const agent = await loggedIn(db)
    const created = await agent.post(listPath).send(payload)
    const auditId = created.body.audit.id as string

    const missingFields = await agent.post(listPath).send({ title: 'X' })
    expect(missingFields.status).toBe(400)
    const shortTitle = await agent.post(listPath).send({ ...payload, title: 'ab' })
    expect(shortTitle.status).toBe(400)
    const emptyPatch = await agent.patch(`${listPath}/${auditId}`).send({})
    expect(emptyPatch.status).toBe(400)
    const badStatus = await agent.post(`${listPath}/${auditId}/status`).send({ status: 'ARCHIVED' })
    expect(badStatus.status).toBe(400)
    const badIds = await agent.get(`/api/processes/${processId}/audits/not-a-cuid/history`)
    expect(badIds.status).toBe(400)
    const badPage = await agent.get(`${listPath}/${auditId}/history?page=0`)
    expect(badPage.status).toBe(400)
    const badFinding = await agent.post(`${listPath}/${auditId}/findings`).send({ title: 'ab', description: 'x', type: 'BAD', severity: 'MINOR' })
    expect(badFinding.status).toBe(400)
    const badEvidence = await agent.post(`${listPath}/${auditId}/evidences`).send({ name: 'ab', description: 'x', url: 'not-a-url' })
    expect(badEvidence.status).toBe(400)
  })

  it('requires authentication for the whole module', async () => {
    const { db } = makeAuditDb()
    const anonymous = request.agent(createApp(db))
    expect((await anonymous.get(listPath)).status).toBe(401)
    expect((await anonymous.post(listPath).send(payload)).status).toBe(401)
  })
})
