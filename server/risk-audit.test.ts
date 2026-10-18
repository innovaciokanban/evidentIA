import bcrypt from 'bcryptjs'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'OUTDATED'
type AcceptanceStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED'
type StoredApproval = { id: string; riskId: string; requestedById: string; status: ApprovalStatus; openKey: string | null; decidedById: string | null; decidedAt: Date | null; comment: string | null; ticketId: string | null; createdAt: Date; updatedAt: Date }
type StoredNotification = { id: string; userId: string; title: string; body: string; link: string; readAt: Date | null; createdAt: Date }
type StoredTicket = { id: string; title: string; description: string; status: string; priority: string; dueDate: Date | null; createdById: string; assignedToId: string | null; actionItemId: string | null; createdAt: Date; updatedAt: Date }
type StoredControl = { id: string; riskId: string; description: string; evaluation: string; createdAt: Date; updatedAt: Date }
type StoredEvidence = { id: string; riskId: string; name: string; description: string; url: string; createdAt: Date; updatedAt: Date }
type StoredRisk = {
  id: string; processId: string; name: string; description: string; riskType: string; code: string | null; bpmnActivity: string
  riskOwnerId: string | null; acceptanceStatus: AcceptanceStatus; treatment: string | null
  mitigationOwnerId: string | null; mitigationStartDate: Date | null; mitigationDueDate: Date | null
  inherentImpact: number; inherentProbability: number; residualImpact: number; residualProbability: number
  controls: StoredControl[]; evidences: StoredEvidence[]; approvals: StoredApproval[]; createdAt: Date; updatedAt: Date
}
type StoredProcess = { id: string; companyId: string; name: string; code: string | null; type: 'MISSIONAL' | 'STRATEGIC' | 'SUPPORT' }
type StoredAuditEvent = { id: string; riskId: string; actorId: string | null; actorName: string | null; actorEmail: string | null; eventType: string; summary: string; changes: unknown; metadata: unknown; occurredAt: Date }

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const processId = 'cmprocess000000000000000001'
const foreignProcessId = 'cmprocess000000000000000002'

const superuser = { id: 'cmsuperuser000000000000001', email: 'super@audit.test', name: 'Ada Super', role: 'SUPERUSER' as Role, companyId }
const admin = { id: 'cmadmin0000000000000000001', email: 'admin@audit.test', name: 'Ben Admin', role: 'COMPANY_ADMIN' as Role, companyId }
const owner = { id: 'cmowner0000000000000000001', email: 'owner@audit.test', name: 'Cleo Dueña', role: 'COMPANY_USER' as Role, companyId }
const member = { id: 'cmmember0000000000000000001', email: 'member@audit.test', name: 'Dana Miembro', role: 'COMPANY_USER' as Role, companyId }
const foreignAdmin = { id: 'cmforeignadmin00000000001', email: 'foreign.admin@audit.test', name: 'Ema Externa', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId }
const foreignOwner = { id: 'cmforeignowner00000000001', email: 'foreign.owner@audit.test', name: 'Fede Externo', role: 'COMPANY_USER' as Role, companyId: otherCompanyId }
const users = [superuser, admin, owner, member, foreignAdmin, foreignOwner]
const passwordHash = bcrypt.hashSync('Password123!', 4)

const riskPayload = {
  name: 'Entrega tardía de información',
  description: 'La información puede llegar después del plazo y afectar la respuesta.',
  bpmnActivity: 'Validar solicitud',
  inherentImpact: 4, inherentProbability: 5, residualImpact: 1, residualProbability: 1,
}

/**
 * Arnés de auditoría: almacén compartido con sesión por token (una instancia de la app por agente)
 * y `$transaction` con clonación + restauración, la misma semántica de rollback que el motor real.
 * `setAuditFailure(true)` inyecta un fallo en la escritura del historial para comprobar que la
 * operación de negocio y su evento quedan atados: o entra todo, o no entra nada.
 */
function makeAuditDb() {
  const sessions = new Map<string, string>()
  const storedProcesses: StoredProcess[] = [
    { id: processId, companyId, name: 'Proceso misional', code: 'PROC-01', type: 'MISSIONAL' },
    { id: foreignProcessId, companyId: otherCompanyId, name: 'Proceso externo', code: 'PROC-90', type: 'MISSIONAL' },
  ]
  const storedRisks: StoredRisk[] = []
  const storedNotifications: StoredNotification[] = []
  const storedTickets: StoredTicket[] = []
  const storedAuditEvents: StoredAuditEvent[] = []
  const codeSequences: Record<string, number> = {}
  let nextRisk = 1
  let nextApproval = 1
  let nextNotification = 1
  let nextTicket = 1
  let nextControl = 1
  let nextEvidence = 1
  let nextAudit = 1
  let clock = Date.parse('2026-10-01T08:00:00.000Z')
  let failAuditWrites = false

  // Cada registro avanza el reloj para que los órdenes por fecha sean deterministas en los tests.
  const stamp = () => new Date((clock += 60_000))
  const userView = (id: string | null) => {
    const user = users.find((item) => item.id === id)
    return user ? { id: user.id, name: user.name } : null
  }
  const publicUserView = (id: string | null) => {
    const user = users.find((item) => item.id === id)
    return user ? { id: user.id, email: user.email, name: user.name, role: user.role, companyId: user.companyId } : null
  }
  const riskFor = (id: string) => storedRisks.find((item) => item.id === id) ?? null
  const processFor = (id: string) => storedProcesses.find((item) => item.id === id) ?? null
  const allApprovals = () => storedRisks.flatMap((risk) => risk.approvals)
  const allControls = () => storedRisks.flatMap((risk) => risk.controls)
  const allEvidences = () => storedRisks.flatMap((risk) => risk.evidences)
  const ticketFor = (id: string) => storedTickets.find((item) => item.id === id) ?? null

  const ticketWithInclude = (ticket: StoredTicket) => ({
    ...ticket,
    createdBy: publicUserView(ticket.createdById),
    assignedTo: publicUserView(ticket.assignedToId),
    actionItem: null,
    riskApprovals: allApprovals().filter((approval) => approval.ticketId === ticket.id).map((approval) => {
      const risk = riskFor(approval.riskId)!
      return { id: approval.id, riskId: approval.riskId, risk: { id: risk.id, code: risk.code, name: risk.name, processId: risk.processId } }
    }),
  })
  const approvalDetail = (approval: StoredApproval) => {
    const risk = riskFor(approval.riskId)!
    const process = processFor(risk.processId)!
    return {
      ...approval,
      requestedBy: userView(approval.requestedById),
      decidedBy: userView(approval.decidedById),
      ticket: approval.ticketId ? ticketFor(approval.ticketId) : null,
      risk: {
        ...risk,
        riskOwner: userView(risk.riskOwnerId),
        mitigationOwner: userView(risk.mitigationOwnerId),
        controls: risk.controls,
        process: { id: process.id, name: process.name, code: process.code, companyId: process.companyId },
      },
    }
  }
  const riskWithInclude = (risk: StoredRisk) => ({
    ...risk,
    riskOwner: userView(risk.riskOwnerId),
    mitigationOwner: userView(risk.mitigationOwnerId),
    controls: risk.controls,
    evidences: risk.evidences,
    approvals: [...risk.approvals].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 1)
      .map((approval) => ({ ...approval, decidedBy: userView(approval.decidedById) })),
  })

  const matchesApprovalWhere = (approval: StoredApproval, where: Record<string, any> = {}) => {
    const risk = riskFor(approval.riskId)
    if (where.id && approval.id !== where.id) return false
    if (where.riskId && approval.riskId !== where.riskId) return false
    if (where.status && approval.status !== where.status) return false
    if (where.openKey && approval.openKey !== where.openKey) return false
    if (where.risk?.riskOwnerId && risk?.riskOwnerId !== where.risk.riskOwnerId) return false
    if (where.risk?.process?.companyId && processFor(risk!.processId)?.companyId !== where.risk.process.companyId) return false
    return true
  }
  const byCreatedAtDesc = (a: StoredApproval, b: StoredApproval) => b.createdAt.getTime() - a.createdAt.getTime()
  const matchesAuditWhere = (event: StoredAuditEvent, where: Record<string, any> = {}) => {
    if (where.riskId && event.riskId !== where.riskId) return false
    if (where.eventType && event.eventType !== where.eventType) return false
    if (where.occurredAt?.gte && event.occurredAt < where.occurredAt.gte) return false
    if (where.occurredAt?.lte && event.occurredAt > where.occurredAt.lte) return false
    return true
  }

  const snapshot = () => ({
    risks: structuredClone(storedRisks),
    tickets: structuredClone(storedTickets),
    notifications: structuredClone(storedNotifications),
    auditEvents: structuredClone(storedAuditEvents),
  })
  const restore = (state: ReturnType<typeof snapshot>) => {
    storedRisks.splice(0, storedRisks.length, ...state.risks)
    storedTickets.splice(0, storedTickets.length, ...state.tickets)
    storedNotifications.splice(0, storedNotifications.length, ...state.notifications)
    storedAuditEvents.splice(0, storedAuditEvents.length, ...state.auditEvents)
  }

  const db = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id)
        return user ? { ...user, passwordHash } : null
      }),
    },
    session: {
      create: vi.fn(async ({ data }: { data: { tokenHash: string; userId: string; expiresAt: Date } }) => {
        sessions.set(data.tokenHash, data.userId)
        return { id: `cmsession${sessions.size}`, expiresAt: data.expiresAt }
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const user = users.find((item) => item.id === sessions.get(where.tokenHash))
        return user ? { id: 'cmsessionactive0000000001', expiresAt: new Date(Date.now() + 3600_000), user: { ...user } } : null
      }),
      delete: vi.fn(async () => ({ id: 'cmsessionactive0000000001' })),
      deleteMany: vi.fn(async () => { sessions.clear(); return { count: 1 } }),
    },
    company: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
    },
    process: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const process = processFor(where.id)
        return process ? { ...process, company: { id: process.companyId } } : null
      }),
    },
    riskCodeSequence: {
      upsert: vi.fn(async ({ where }: { where: { category: string } }) => {
        const next = codeSequences[where.category] === undefined ? 1 : codeSequences[where.category] + 1
        codeSequences[where.category] = next
        return { category: where.category, next }
      }),
    },
    risk: {
      findMany: vi.fn(async ({ where }: { where?: { processId?: string } } = {}) => storedRisks.filter((risk) => !where?.processId || risk.processId === where.processId).map(riskWithInclude)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const risk = riskFor(where.id); return risk ? riskWithInclude(risk) : null }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const risk: StoredRisk = {
          id: `cmriskcreated${String(nextRisk).padStart(10, '0')}`,
          processId: String(data.processId),
          name: String(data.name),
          description: String(data.description),
          riskType: String(data.riskType),
          code: data.code == null ? null : String(data.code),
          bpmnActivity: String(data.bpmnActivity ?? 'No especificada'),
          riskOwnerId: (data.riskOwnerId as string | null) ?? null,
          acceptanceStatus: ((data.acceptanceStatus as AcceptanceStatus) ?? 'PENDING'),
          treatment: ((data.treatment as string | null) ?? null),
          mitigationOwnerId: (data.mitigationOwnerId as string | null) ?? null,
          mitigationStartDate: (data.mitigationStartDate as Date | null) ?? null,
          mitigationDueDate: (data.mitigationDueDate as Date | null) ?? null,
          inherentImpact: Number(data.inherentImpact),
          inherentProbability: Number(data.inherentProbability),
          residualImpact: Number(data.residualImpact),
          residualProbability: Number(data.residualProbability),
          controls: [], evidences: [], approvals: [],
          createdAt: stamp(), updatedAt: stamp(),
        }
        nextRisk += 1
        storedRisks.push(risk)
        return riskWithInclude(risk)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const risk = riskFor(where.id)
        if (!risk) throw new Error('Record to update not found.')
        for (const [key, value] of Object.entries(data)) (risk as unknown as Record<string, unknown>)[key] = value
        risk.updatedAt = stamp()
        return riskWithInclude(risk)
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedRisks.findIndex((risk) => risk.id === where.id)
        if (index >= 0) storedRisks.splice(index, 1)
        return { id: where.id }
      }),
    },
    riskControl: {
      // Copia en findUnique: si devolviera la fila viva, el update posterior mutaría también el
      // `existing` de la ruta y la diferencia campo a campo (y su evento) desaparecería.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const control = allControls().find((item) => item.id === where.id)
        return control ? { ...control } : null
      }),
      create: vi.fn(async ({ data }: { data: { riskId: string; description: string; evaluation: string } }) => {
        const control: StoredControl = { id: `cmcontrol${String(nextControl).padStart(10, '0')}`, ...data, createdAt: stamp(), updatedAt: stamp() }
        nextControl += 1
        riskFor(data.riskId)!.controls.push(control)
        return { ...control }
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<StoredControl> }) => {
        const control = allControls().find((item) => item.id === where.id)
        if (!control) throw new Error('Record to update not found.')
        Object.assign(control, data, { updatedAt: stamp() })
        return { ...control }
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        for (const risk of storedRisks) {
          const index = risk.controls.findIndex((item) => item.id === where.id)
          if (index >= 0) return risk.controls.splice(index, 1)[0]
        }
        return null
      }),
    },
    riskEvidence: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const evidence = allEvidences().find((item) => item.id === where.id)
        return evidence ? { ...evidence } : null
      }),
      create: vi.fn(async ({ data }: { data: { riskId: string; name: string; description: string; url: string } }) => {
        const evidence: StoredEvidence = { id: `cmevidence${String(nextEvidence).padStart(10, '0')}`, ...data, createdAt: stamp(), updatedAt: stamp() }
        nextEvidence += 1
        riskFor(data.riskId)!.evidences.push(evidence)
        return { ...evidence }
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<StoredEvidence> }) => {
        const evidence = allEvidences().find((item) => item.id === where.id)
        if (!evidence) throw new Error('Record to update not found.')
        Object.assign(evidence, data, { updatedAt: stamp() })
        return { ...evidence }
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        for (const risk of storedRisks) {
          const index = risk.evidences.findIndex((item) => item.id === where.id)
          if (index >= 0) return risk.evidences.splice(index, 1)[0]
        }
        return null
      }),
    },
    riskApproval: {
      create: vi.fn(async ({ data }: { data: { riskId: string; requestedById: string; openKey: string | null } }) => {
        if (data.openKey && allApprovals().some((approval) => approval.openKey === data.openKey)) {
          throw Object.assign(new Error('Unique constraint failed on openKey'), { code: 'P2002' })
        }
        const approval: StoredApproval = {
          id: `cmapproval${String(nextApproval).padStart(10, '0')}`,
          riskId: data.riskId,
          requestedById: data.requestedById,
          status: 'PENDING',
          openKey: data.openKey,
          decidedById: null,
          decidedAt: null,
          comment: null,
          ticketId: null,
          createdAt: stamp(),
          updatedAt: stamp(),
        }
        nextApproval += 1
        riskFor(data.riskId)!.approvals.push(approval)
        return { ...approval }
      }),
      findMany: vi.fn(async (args: { where?: Record<string, any> } = {}) => {
        const rows = allApprovals().filter((approval) => matchesApprovalWhere(approval, args.where ?? {})).sort(byCreatedAtDesc)
        return rows.map(approvalDetail)
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const approval = allApprovals().find((item) => item.id === where.id)
        return approval ? approvalDetail(approval) : null
      }),
      findFirst: vi.fn(async (args: { where?: Record<string, any> } = {}) => {
        const found = allApprovals().filter((approval) => matchesApprovalWhere(approval, args.where ?? {})).sort(byCreatedAtDesc)[0]
        return found ? approvalDetail(found) : null
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const approval = allApprovals().find((item) => item.id === where.id)
        if (!approval) throw new Error('Record to update not found.')
        if (data.ticketId != null && allApprovals().some((item) => item.id !== approval.id && item.ticketId === data.ticketId)) {
          throw Object.assign(new Error('Unique constraint failed on ticketId'), { code: 'P2002' })
        }
        for (const [key, value] of Object.entries(data)) (approval as unknown as Record<string, unknown>)[key] = value
        approval.updatedAt = stamp()
        return approvalDetail(approval)
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id?: string; status?: ApprovalStatus }; data: Record<string, unknown> }) => {
        const targets = allApprovals().filter((approval) => (!where.id || approval.id === where.id) && (!where.status || approval.status === where.status))
        for (const approval of targets) {
          for (const [key, value] of Object.entries(data)) (approval as unknown as Record<string, unknown>)[key] = value
          approval.updatedAt = stamp()
        }
        return { count: targets.length }
      }),
    },
    riskAuditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (failAuditWrites) throw new Error('audit store unavailable')
        // El reloj no avanza aquí (new Date(clock)) para no alterar los sellos existentes; los
        // empates se resuelven por id, igual que en el backend (occurredAt desc, id desc).
        const event: StoredAuditEvent = {
          id: `cmaudit${String(nextAudit).padStart(10, '0')}`,
          riskId: String(data.riskId),
          actorId: (data.actorId as string | null) ?? null,
          actorName: (data.actorName as string | null) ?? null,
          actorEmail: (data.actorEmail as string | null) ?? null,
          eventType: String(data.eventType),
          summary: String(data.summary),
          changes: data.changes ?? null,
          metadata: data.metadata ?? null,
          occurredAt: new Date(clock),
        }
        nextAudit += 1
        storedAuditEvents.push(event)
        return { ...event }
      }),
      findMany: vi.fn(async (args: { where?: Record<string, any>; skip?: number; take?: number } = {}) => {
        const rows = storedAuditEvents
          .filter((event) => matchesAuditWhere(event, args.where ?? {}))
          .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id))
        const sliced = rows.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? rows.length))
        return sliced.map((event) => {
          const actor = users.find((user) => user.id === event.actorId)
          return { ...event, actor: actor ? { id: actor.id, name: actor.name } : null }
        })
      }),
      count: vi.fn(async (args: { where?: Record<string, any> } = {}) => storedAuditEvents.filter((event) => matchesAuditWhere(event, args.where ?? {})).length),
    },
    notification: {
      create: vi.fn(async ({ data }: { data: { userId: string; title: string; body: string; link: string } }) => {
        const notification: StoredNotification = { id: `cmnotification${String(nextNotification).padStart(10, '0')}`, ...data, readAt: null, createdAt: stamp() }
        nextNotification += 1
        storedNotifications.push(notification)
        return { ...notification }
      }),
      findMany: vi.fn(async ({ where }: { where?: { userId?: string } } = {}) => storedNotifications
        .filter((item) => !where?.userId || item.userId === where.userId)
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 30)
        .map((item) => ({ ...item }))),
      count: vi.fn(async ({ where }: { where: { userId: string; readAt: null } }) => storedNotifications.filter((item) => item.userId === where.userId && item.readAt === null).length),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const item = storedNotifications.find((row) => row.id === where.id); return item ? { ...item } : null }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { readAt: Date } }) => {
        const item = storedNotifications.find((row) => row.id === where.id)
        if (!item) throw new Error('Record to update not found.')
        Object.assign(item, data)
        return { ...item }
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { userId: string; readAt: null }; data: { readAt: Date } }) => {
        const targets = storedNotifications.filter((item) => item.userId === where.userId && item.readAt === null)
        for (const item of targets) Object.assign(item, data)
        return { count: targets.length }
      }),
    },
    ticket: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const ticket = ticketFor(where.id); return ticket ? ticketWithInclude(ticket) : null }),
      create: vi.fn(async ({ data }: { data: { title: string; description: string; status: string; priority: string; createdById: string; assignedToId: string | null } }) => {
        const ticket: StoredTicket = {
          id: `cmticket${String(nextTicket).padStart(10, '0')}`,
          title: data.title,
          description: data.description,
          status: data.status,
          priority: data.priority,
          dueDate: null,
          createdById: data.createdById,
          assignedToId: data.assignedToId ?? null,
          actionItemId: null,
          createdAt: stamp(),
          updatedAt: stamp(),
        }
        nextTicket += 1
        storedTickets.push(ticket)
        return ticketWithInclude(ticket)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const ticket = ticketFor(where.id)
        if (!ticket) throw new Error('Record to update not found.')
        for (const [key, value] of Object.entries(data)) (ticket as unknown as Record<string, unknown>)[key] = value
        ticket.updatedAt = stamp()
        return ticketWithInclude(ticket)
      }),
    },
    $transaction: vi.fn(async (operation: (client: unknown) => Promise<unknown>) => {
      const backup = snapshot()
      try {
        return await operation(db)
      } catch (error) {
        restore(backup)
        throw error
      }
    }),
  }

  return {
    db: db as unknown as PrismaClient,
    state: { storedRisks, storedNotifications, storedTickets, storedAuditEvents },
    setAuditFailure: (value: boolean) => { failAuditWrites = value },
  }
}

async function loggedIn(db: PrismaClient, email: string) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

const historyPath = (riskId: string) => `/api/processes/${processId}/risks/${riskId}/history`
const eventsOfType = (body: { events: Array<{ eventType: string; [key: string]: unknown }> }, eventType: string) =>
  body.events.filter((event) => event.eventType === eventType)

describe('risk audit history', () => {
  it('registra la creación con el actor de la sesión y jamás con el del cuerpo', async () => {
    const { db } = makeAuditDb()
    const agent = await loggedIn(db, admin.email)
    // El cuerpo intenta atribuir la operación a otra persona: el backend solo mira la sesión.
    const created = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, actorId: owner.id, actorEmail: 'injected@audit.test' })
    expect(created.status).toBe(201)
    const riskId = created.body.risk.id

    const history = await agent.get(historyPath(riskId))
    expect(history.status).toBe(200)
    expect(history.body).toMatchObject({ total: 1, page: 1, pageSize: 20 })
    const [event] = history.body.events
    expect(event).toMatchObject({
      eventType: 'RISK_CREATED',
      summary: `Riesgo ${created.body.risk.code} creado`,
      actorId: admin.id,
      actorName: admin.name,
      actorEmail: admin.email,
    })
    expect(event.actor).toEqual({ id: admin.id, name: admin.name })
    expect(event.metadata).toBeNull()
    expect(event.changes).toEqual(expect.arrayContaining([
      { field: 'code', label: 'Código', previousValue: null, newValue: created.body.risk.code },
      { field: 'name', label: 'Nombre', previousValue: null, newValue: riskPayload.name },
      { field: 'riskOwnerId', label: 'Dueño del riesgo', previousValue: null, newValue: null },
    ]))
  })

  it('registra controles y evidencias con sus diferencias campo a campo', async () => {
    const { db, state } = makeAuditDb()
    const agent = await loggedIn(db, admin.email)
    const created = await agent.post(`/api/processes/${processId}/risks`).send(riskPayload)
    const riskId = created.body.risk.id

    const control = await agent.post(`/api/processes/${processId}/risks/${riskId}/controls`).send({ description: 'Revisión del plazo de entrega', evaluation: 'PARTIAL' })
    expect(control.status).toBe(201)
    const edited = await agent.patch(`/api/processes/${processId}/risks/${riskId}/controls/${control.body.control.id}`).send({ evaluation: 'EFFECTIVE' })
    expect(edited.status).toBe(200)
    // Una edición que repite el valor guardado no genera evento de ruido.
    const echo = await agent.patch(`/api/processes/${processId}/risks/${riskId}/controls/${control.body.control.id}`).send({ description: 'Revisión del plazo de entrega' })
    expect(echo.status).toBe(200)
    expect((await agent.delete(`/api/processes/${processId}/risks/${riskId}/controls/${control.body.control.id}`)).status).toBe(204)

    const evidence = await agent.post(`/api/processes/${processId}/risks/${riskId}/evidences`).send({ name: 'Acta de revisión', description: 'Reunión con el dueño.', url: 'https://evidencia.test/acta.pdf' })
    expect(evidence.status).toBe(201)
    const renamed = await agent.patch(`/api/processes/${processId}/risks/${riskId}/evidences/${evidence.body.evidence.id}`).send({ name: 'Acta de cierre' })
    expect(renamed.status).toBe(200)

    const history = await agent.get(historyPath(riskId))
    expect(history.body.events.map((event: { eventType: string }) => event.eventType)).toEqual([
      'EVIDENCE_UPDATED', 'EVIDENCE_CREATED', 'CONTROL_DELETED', 'CONTROL_UPDATED', 'CONTROL_CREATED', 'RISK_CREATED',
    ])
    const byType = (type: string) => eventsOfType(history.body, type)[0]
    expect(byType('CONTROL_CREATED').summary).toBe('Control agregado')
    expect(byType('CONTROL_CREATED').changes).toEqual([
      { field: 'description', label: 'Descripción del control', previousValue: null, newValue: 'Revisión del plazo de entrega' },
      { field: 'evaluation', label: 'Evaluación de efectividad', previousValue: null, newValue: 'PARTIAL' },
    ])
    expect(byType('CONTROL_CREATED').metadata).toEqual({ controlId: control.body.control.id })
    expect(byType('CONTROL_UPDATED').changes).toEqual([
      { field: 'evaluation', label: 'Evaluación de efectividad', previousValue: 'PARTIAL', newValue: 'EFFECTIVE' },
    ])
    expect(byType('CONTROL_DELETED').changes).toEqual([
      { field: 'description', label: 'Descripción del control', previousValue: 'Revisión del plazo de entrega', newValue: null },
      { field: 'evaluation', label: 'Evaluación de efectividad', previousValue: 'EFFECTIVE', newValue: null },
    ])
    expect(byType('EVIDENCE_CREATED').summary).toBe('Evidencia agregada')
    expect(byType('EVIDENCE_UPDATED').changes).toEqual([
      { field: 'name', label: 'Nombre de la evidencia', previousValue: 'Acta de revisión', newValue: 'Acta de cierre' },
    ])
    expect(state.storedRisks[0].controls).toHaveLength(0)
    expect(state.storedRisks[0].evidences).toHaveLength(1)
  })

  it('registra la solicitud, la aprobación con comentario y el ticket vinculado', async () => {
    const { db, state } = makeAuditDb()
    const adminAgent = await loggedIn(db, admin.email)
    const created = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    expect(created.status).toBe(201)
    const riskId = created.body.risk.id
    const approvalId = created.body.risk.approval.id

    const ownerAgent = await loggedIn(db, owner.email)
    const decision = await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'APPROVE', comment: 'Aprobado con revisión documental.' })
    expect(decision.status).toBe(200)

    const history = await adminAgent.get(historyPath(riskId))
    expect(history.body.total).toBe(4)
    const requested = eventsOfType(history.body, 'APPROVAL_REQUESTED')[0]
    expect(requested).toMatchObject({ summary: 'Enviado a aprobación', metadata: { approvalId }, actorId: admin.id })
    const decided = eventsOfType(history.body, 'APPROVAL_DECIDED')[0]
    expect(decided).toMatchObject({
      summary: 'Riesgo aprobado',
      actorId: owner.id,
      actorName: owner.name,
      metadata: { approvalId, decision: 'APPROVED', comment: 'Aprobado con revisión documental.' },
    })
    const ticketEvent = eventsOfType(history.body, 'TICKET_CREATED')[0]
    expect(ticketEvent).toMatchObject({
      summary: 'Ticket de seguimiento creado',
      actorId: owner.id,
      metadata: { ticketId: decision.body.ticket.id, approvalId },
    })
    expect(state.storedTickets).toHaveLength(1)
    expect(state.storedAuditEvents.map((event) => event.eventType)).toEqual([
      'RISK_CREATED', 'APPROVAL_REQUESTED', 'APPROVAL_DECIDED', 'TICKET_CREATED',
    ])
  })

  it('registra el rechazo con su motivo y sin ticket', async () => {
    const { db, state } = makeAuditDb()
    const adminAgent = await loggedIn(db, admin.email)
    const created = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    const ownerAgent = await loggedIn(db, owner.email)
    const decision = await ownerAgent.post(`/api/approvals/${created.body.risk.approval.id}/decision`).send({ decision: 'REJECT', comment: 'Falta documentar el control clave.' })
    expect(decision.status).toBe(200)

    const history = await adminAgent.get(historyPath(created.body.risk.id))
    const rejected = eventsOfType(history.body, 'APPROVAL_DECIDED')[0]
    expect(rejected).toMatchObject({
      summary: 'Riesgo rechazado',
      metadata: { approvalId: created.body.risk.approval.id, decision: 'REJECTED', comment: 'Falta documentar el control clave.' },
    })
    expect(eventsOfType(history.body, 'TICKET_CREATED')).toHaveLength(0)
    expect(state.storedTickets).toHaveLength(0)
    expect(state.storedRisks[0].acceptanceStatus).toBe('PENDING')
  })

  it('marca OUTDATED con su evento al cambiar campos relevantes, no en los cosméticos', async () => {
    const { db } = makeAuditDb()
    const adminAgent = await loggedIn(db, admin.email)
    const created = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    const riskId = created.body.risk.id
    const approvalId = created.body.risk.approval.id
    const ownerAgent = await loggedIn(db, owner.email)
    await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'APPROVE' })

    const cosmetic = await adminAgent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ treatment: 'MITIGATE' })
    expect(cosmetic.status).toBe(200)
    expect(cosmetic.body.risk.approval.status).toBe('APPROVED')
    const beforeRelevant = await adminAgent.get(historyPath(riskId))
    expect(eventsOfType(beforeRelevant.body, 'APPROVAL_OUTDATED')).toHaveLength(0)
    const cosmeticEvent = eventsOfType(beforeRelevant.body, 'RISK_UPDATED')[0]
    expect(cosmeticEvent.changes).toEqual([
      { field: 'treatment', label: 'Tratamiento', previousValue: null, newValue: 'MITIGATE' },
    ])

    const relevant = await adminAgent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ name: 'Entrega tardía de información crítica' })
    expect(relevant.status).toBe(200)
    expect(relevant.body.risk.approval.status).toBe('OUTDATED')
    const after = await adminAgent.get(historyPath(riskId))
    const outdated = eventsOfType(after.body, 'APPROVAL_OUTDATED')[0]
    expect(outdated).toMatchObject({ summary: 'Aprobación marcada para nueva revisión', metadata: { approvalId, previousStatus: 'APPROVED' } })
    const nameEvent = eventsOfType(after.body, 'RISK_UPDATED')[0]
    expect(nameEvent.changes).toEqual(expect.arrayContaining([
      { field: 'name', label: 'Nombre', previousValue: riskPayload.name, newValue: 'Entrega tardía de información crítica' },
    ]))
    // Decisión, comentario y ticket sobreviven al marcado OUTDATED.
    const decided = eventsOfType(after.body, 'APPROVAL_DECIDED')[0]
    expect(decided.metadata).toMatchObject({ decision: 'APPROVED' })
    expect(eventsOfType(after.body, 'TICKET_CREATED')).toHaveLength(1)
  })

  it('registra el cambio de estado del ticket de origen y no el de un ticket ajeno', async () => {
    const { db, state } = makeAuditDb()
    const adminAgent = await loggedIn(db, admin.email)
    const created = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    const riskId = created.body.risk.id
    const ownerAgent = await loggedIn(db, owner.email)
    const decision = await ownerAgent.post(`/api/approvals/${created.body.risk.approval.id}/decision`).send({ decision: 'APPROVE' })
    const originTicketId = decision.body.ticket.id as string

    const advanced = await adminAgent.patch(`/api/tickets/${originTicketId}`).send({ status: 'IN_PROGRESS' })
    expect(advanced.status).toBe(200)
    const history = await adminAgent.get(historyPath(riskId))
    const statusEvent = eventsOfType(history.body, 'TICKET_STATUS_CHANGED')[0]
    expect(statusEvent).toMatchObject({
      summary: 'Estado del ticket: En curso',
      actorId: admin.id,
      metadata: {
        ticketId: originTicketId,
        approvalId: created.body.risk.approval.id,
        previousStatus: 'OPEN',
        status: 'IN_PROGRESS',
      },
    })

    // Un ticket sin ciclo de origen (creado directamente) no escribe en ningún historial.
    state.storedTickets.push({
      id: 'cmticketstandalone001', title: 'Tarea interna', description: 'Trabajo sin riesgo asociado.',
      status: 'OPEN', priority: 'MEDIUM', dueDate: null, createdById: admin.id, assignedToId: null,
      actionItemId: null, createdAt: new Date(clockNow()), updatedAt: new Date(clockNow()),
    })
    const standalone = await adminAgent.patch('/api/tickets/cmticketstandalone001').send({ status: 'CLOSED' })
    expect(standalone.status).toBe(200)
    expect(state.storedAuditEvents.filter((event) => event.eventType === 'TICKET_STATUS_CHANGED')).toHaveLength(1)
  })

  it('ordena el historial de más reciente a más antiguo, pagina y filtra por tipo', async () => {
    const { db } = makeAuditDb()
    const agent = await loggedIn(db, admin.email)
    const created = await agent.post(`/api/processes/${processId}/risks`).send(riskPayload)
    const riskId = created.body.risk.id
    await agent.post(`/api/processes/${processId}/risks/${riskId}/controls`).send({ description: 'Control de trazabilidad' })
    await agent.patch(`/api/processes/${processId}/risks/${riskId}`).send({ name: 'Entrega tardía de información (revisado)' })

    const firstPage = await agent.get(`${historyPath(riskId)}?page=1&pageSize=2`)
    expect(firstPage.status).toBe(200)
    expect(firstPage.body.total).toBe(3)
    expect(firstPage.body.page).toBe(1)
    expect(firstPage.body.pageSize).toBe(2)
    expect(firstPage.body.events.map((event: { eventType: string }) => event.eventType)).toEqual(['RISK_UPDATED', 'CONTROL_CREATED'])

    const secondPage = await agent.get(`${historyPath(riskId)}?page=2&pageSize=2`)
    expect(secondPage.body.events.map((event: { eventType: string }) => event.eventType)).toEqual(['RISK_CREATED'])
    expect(secondPage.body.total).toBe(3)

    const filtered = await agent.get(`${historyPath(riskId)}?eventType=CONTROL_CREATED`)
    expect(filtered.body.total).toBe(1)
    expect(filtered.body.events[0].eventType).toBe('CONTROL_CREATED')

    const emptyRange = await agent.get(`${historyPath(riskId)}?from=2030-01-01`)
    expect(emptyRange.body).toMatchObject({ events: [], total: 0 })

    const badType = await agent.get(`${historyPath(riskId)}?eventType=NOT_AN_EVENT`)
    expect(badType.status).toBe(400)
    const badPage = await agent.get(`${historyPath(riskId)}?page=0`)
    expect(badPage.status).toBe(400)
  })

  it('exige sesión e identificadores válidos y solo admite lectura sobre /history', async () => {
    const { db, state } = makeAuditDb()
    const agent = await loggedIn(db, admin.email)
    const created = await agent.post(`/api/processes/${processId}/risks`).send(riskPayload)
    const riskId = created.body.risk.id as string

    const anonymous = request.agent(createApp(db))
    expect((await anonymous.get(historyPath(riskId))).status).toBe(401)

    const badProcess = await agent.get(`/api/processes/not-a-valid-id/risks/${riskId}/history`)
    expect(badProcess.status).toBe(400)
    expect(badProcess.body.error).toBe('Invalid process id')
    const badRisk = await agent.get(`/api/processes/${processId}/risks/not-a-valid-id/history`)
    expect(badRisk.status).toBe(400)

    const missingRisk = await agent.get(`/api/processes/${processId}/risks/cmrisksimpossible0000000001/history`)
    expect(missingRisk.status).toBe(404)

    const before = state.storedAuditEvents.length
    expect((await agent.post(historyPath(riskId)).send({ eventType: 'RISK_CREATED', summary: 'forzado' })).status).toBe(404)
    expect((await agent.patch(historyPath(riskId)).send({ summary: 'alterado' })).status).toBe(404)
    expect((await agent.delete(historyPath(riskId))).status).toBe(404)
    expect(state.storedAuditEvents).toHaveLength(before)
  })

  it('aisla el historial por empresa y por proceso', async () => {
    const { db, state } = makeAuditDb()
    const adminAgent = await loggedIn(db, admin.email)
    const own = await adminAgent.post(`/api/processes/${processId}/risks`).send(riskPayload)
    const ownRiskId = own.body.risk.id as string

    const foreignAgent = await loggedIn(db, foreignAdmin.email)
    const foreign = await foreignAgent.post(`/api/processes/${foreignProcessId}/risks`).send({ ...riskPayload, name: 'Riesgo externo', riskOwnerId: foreignOwner.id })
    expect(foreign.status).toBe(201)
    const foreignRiskId = foreign.body.risk.id as string
    const eventsBefore = state.storedAuditEvents.length

    // Empresa ajena: el proceso ni siquiera es visible (404 sin delatar existencia).
    expect((await foreignAgent.get(historyPath(ownRiskId))).status).toBe(404)
    // Riesgo existente pero de otro proceso bajo una ruta accesible: 404.
    expect((await foreignAgent.get(`/api/processes/${foreignProcessId}/risks/${ownRiskId}/history`)).status).toBe(404)
    // Escritura sobre el riesgo ajeno: 404 y ningún evento añadido.
    const writeForeign = await foreignAgent.post(`/api/processes/${processId}/risks/${ownRiskId}/controls`).send({ description: 'Intento de escritura ajena' })
    expect(writeForeign.status).toBe(404)
    expect(state.storedAuditEvents).toHaveLength(eventsBefore)

    // Cada empresa lee solo su propio historial (el miembro también puede consultarlo).
    const ownHistory = await adminAgent.get(historyPath(ownRiskId))
    expect(ownHistory.status).toBe(200)
    expect(ownHistory.body.events.every((event: { riskId: string }) => event.riskId === ownRiskId)).toBe(true)
    const memberAgent = await loggedIn(db, member.email)
    expect((await memberAgent.get(historyPath(ownRiskId))).status).toBe(200)
    const foreignHistory = await foreignAgent.get(`/api/processes/${foreignProcessId}/risks/${foreignRiskId}/history`)
    expect(foreignHistory.status).toBe(200)
    expect(foreignHistory.body.events.some((event: { riskId: string }) => event.riskId === ownRiskId)).toBe(false)
    const superAgent = await loggedIn(db, superuser.email)
    expect((await superAgent.get(historyPath(ownRiskId))).status).toBe(200)
  })

  it('revierte operación y evento juntos cuando la escritura de auditoría falla', async () => {
    const { db, state, setAuditFailure } = makeAuditDb()
    const agent = await loggedIn(db, admin.email)

    setAuditFailure(true)
    const failedRisk = await agent.post(`/api/processes/${processId}/risks`).send(riskPayload)
    expect(failedRisk.status).toBe(500)
    expect(state.storedRisks).toHaveLength(0)
    expect(state.storedAuditEvents).toHaveLength(0)

    setAuditFailure(false)
    const created = await agent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    expect(created.status).toBe(201)
    const riskId = created.body.risk.id as string
    const approvalId = created.body.risk.approval.id as string
    const eventsAfterCreate = state.storedAuditEvents.length

    // Control: el evento es posterior al alta del control; si falla, la transacción revierte todo.
    setAuditFailure(true)
    const failedControl = await agent.post(`/api/processes/${processId}/risks/${riskId}/controls`).send({ description: 'Control que no debe persistir' })
    expect(failedControl.status).toBe(500)
    expect(state.storedRisks[0].controls).toHaveLength(0)
    expect(state.storedAuditEvents).toHaveLength(eventsAfterCreate)

    // Decisión: si el evento no entra, la decisión tampoco (ciclo sigue PENDING, sin ticket).
    const ownerAgent = await loggedIn(db, owner.email)
    const failedDecision = await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'APPROVE' })
    expect(failedDecision.status).toBe(500)
    expect(failedDecision.body.error).toBe('The approval decision could not be saved; it can be retried')
    expect(state.storedRisks[0].approvals[0].status).toBe('PENDING')
    expect(state.storedTickets).toHaveLength(0)
    expect(state.storedAuditEvents).toHaveLength(eventsAfterCreate)

    // Con la auditoría restaurada, el reintento confirma operación y eventos en conjunto.
    setAuditFailure(false)
    const retried = await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'APPROVE' })
    expect(retried.status).toBe(200)
    expect(state.storedRisks[0].approvals[0].status).toBe('APPROVED')
    expect(state.storedTickets).toHaveLength(1)
    const history = await agent.get(historyPath(riskId))
    expect(eventsOfType(history.body, 'APPROVAL_DECIDED')).toHaveLength(1)
    expect(eventsOfType(history.body, 'TICKET_CREATED')).toHaveLength(1)

    // El control sigue sin existir: la escritura fallida no dejó residuos.
    const controlAfter = await agent.post(`/api/processes/${processId}/risks/${riskId}/controls`).send({ description: 'Control definitivo' })
    expect(controlAfter.status).toBe(201)
    expect(eventsOfType((await agent.get(historyPath(riskId))).body, 'CONTROL_CREATED')).toHaveLength(1)
  })

  it('sanea los campos sensibles de la metadata al servir el historial', async () => {
    const { db, state } = makeAuditDb()
    const agent = await loggedIn(db, admin.email)
    const created = await agent.post(`/api/processes/${processId}/risks`).send(riskPayload)
    const riskId = created.body.risk.id as string

    // Evento con metadata hipotéticamente contaminada por un error futuro del backend.
    state.storedAuditEvents.push({
      id: 'cmauditinjected000001', riskId, actorId: admin.id, actorName: admin.name, actorEmail: admin.email,
      eventType: 'RISK_UPDATED', summary: 'Evento con metadata sensible', changes: null,
      metadata: { controlId: 'cmcontrol0000000001', password: 'Secreto123', sessionToken: 'tok_abc', clientSecret: 's3cr3t' },
      occurredAt: new Date(Date.parse('2026-10-02T09:00:00.000Z')),
    })

    const history = await agent.get(historyPath(riskId))
    const injected = history.body.events.find((event: { id: string }) => event.id === 'cmauditinjected000001')
    expect(injected.metadata).toEqual({ controlId: 'cmcontrol0000000001' })
    expect(injected.metadata).not.toHaveProperty('password')
    expect(injected.metadata).not.toHaveProperty('sessionToken')
    expect(injected.metadata).not.toHaveProperty('clientSecret')
  })
})

// Reloj auxiliar para filas inyectadas fuera del flujo normal del arnés.
function clockNow() {
  return Date.parse('2026-10-01T09:00:00.000Z')
}
