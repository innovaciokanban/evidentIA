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
type StoredRisk = {
  id: string; processId: string; name: string; description: string; riskType: string; code: string | null; bpmnActivity: string
  riskOwnerId: string | null; acceptanceStatus: AcceptanceStatus; treatment: string | null
  mitigationOwnerId: string | null; mitigationStartDate: Date | null; mitigationDueDate: Date | null
  inherentImpact: number; inherentProbability: number; residualImpact: number; residualProbability: number
  controls: StoredControl[]; evidences: never[]; approvals: StoredApproval[]; createdAt: Date; updatedAt: Date
}
type StoredProcess = { id: string; companyId: string; name: string; code: string | null; type: 'MISSIONAL' | 'STRATEGIC' | 'SUPPORT' }
type StoredAuditEvent = { id: string; riskId: string; actorId: string | null; actorName: string | null; actorEmail: string | null; eventType: string; summary: string; changes: unknown; metadata: unknown; occurredAt: Date }

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const processId = 'cmprocess000000000000000001'
const foreignProcessId = 'cmprocess000000000000000002'

const superuser = { id: 'cmsuperuser000000000000001', email: 'super@approval.test', name: 'Ada Super', role: 'SUPERUSER' as Role, companyId }
const admin = { id: 'cmadmin0000000000000000001', email: 'admin@approval.test', name: 'Ben Admin', role: 'COMPANY_ADMIN' as Role, companyId }
const owner = { id: 'cmowner0000000000000000001', email: 'owner@approval.test', name: 'Cleo Dueña', role: 'COMPANY_USER' as Role, companyId }
const member = { id: 'cmmember0000000000000000001', email: 'member@approval.test', name: 'Dana Miembro', role: 'COMPANY_USER' as Role, companyId }
const foreignAdmin = { id: 'cmforeignadmin00000000001', email: 'foreign.admin@approval.test', name: 'Ema Externa', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId }
const foreignOwner = { id: 'cmforeignowner00000000001', email: 'foreign.owner@approval.test', name: 'Fede Externo', role: 'COMPANY_USER' as Role, companyId: otherCompanyId }
const users = [superuser, admin, owner, member, foreignAdmin, foreignOwner]
const passwordHash = bcrypt.hashSync('Password123!', 4)

const riskPayload = {
  name: 'Entrega tardía de información',
  description: 'La información puede llegar después del plazo y afectar la respuesta.',
  bpmnActivity: 'Validar solicitud',
  inherentImpact: 4, inherentProbability: 5, residualImpact: 1, residualProbability: 1,
}

/**
 * Arnés con almacén compartido y sesión por token: todas las instancias de la aplicación (una por
 * agente de prueba) leen y escriben los mismos riesgos, ciclos, tickets y notificaciones. El
 * `$transaction` clona el estado antes de ejecutar y lo restaura si la operación falla, para poder
 * verificar que una decisión con ticket caído revierte completa y puede reintentarse.
 */
function makeApprovalDb() {
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
  let nextAudit = 1
  let clock = Date.parse('2026-10-01T08:00:00.000Z')
  let failTicketCreation = false

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
  const ticketFor = (id: string) => storedTickets.find((item) => item.id === id) ?? null

  const ticketWithInclude = (ticket: StoredTicket) => ({
    ...ticket,
    createdBy: publicUserView(ticket.createdById),
    assignedTo: publicUserView(ticket.assignedToId),
    actionItem: null,
    // RiskApproval.ticketId es único: como mucho hay un ciclo por ticket.
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
          treatment: (data.treatment as string | null) ?? null,
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
    riskApproval: {
      create: vi.fn(async ({ data }: { data: { riskId: string; requestedById: string; openKey: string | null } }) => {
        // El índice único de openKey es lo que impide dos ciclos abiertos para el mismo riesgo.
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
          .filter((event) => (!args.where?.riskId || event.riskId === args.where.riskId)
            && (!args.where?.eventType || event.eventType === args.where.eventType)
            && (!args.where?.occurredAt?.gte || event.occurredAt >= args.where.occurredAt.gte)
            && (!args.where?.occurredAt?.lte || event.occurredAt <= args.where.occurredAt.lte))
          .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id))
        const sliced = rows.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? rows.length))
        return sliced.map((event) => {
          const actor = users.find((user) => user.id === event.actorId)
          return { ...event, actor: actor ? { id: actor.id, name: actor.name } : null }
        })
      }),
      count: vi.fn(async (args: { where?: Record<string, any> } = {}) => storedAuditEvents
        .filter((event) => (!args.where?.riskId || event.riskId === args.where.riskId)
          && (!args.where?.eventType || event.eventType === args.where.eventType)
          && (!args.where?.occurredAt?.gte || event.occurredAt >= args.where.occurredAt.gte)
          && (!args.where?.occurredAt?.lte || event.occurredAt <= args.where.occurredAt.lte)).length),
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
        if (failTicketCreation) throw new Error('ticket store unavailable')
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
    },
    // La transacción clona el estado y lo restaura si la operación falla: misma semántica de
    // rollback que el motor real, necesaria para probar la reintenta de una decisión fallida.
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
    setTicketFailure: (value: boolean) => { failTicketCreation = value },
  }
}

async function loggedIn(db: PrismaClient, email: string) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

describe('risk approval flow', () => {
  it('abre el ciclo y notifica al dueño cuando el riesgo nace con dueño', async () => {
    const { db, state } = makeApprovalDb()
    const adminAgent = await loggedIn(db, admin.email)
    const created = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    expect(created.status).toBe(201)
    expect(created.body.risk.code).toBe('MIS-R1')
    expect(created.body.risk.approval.status).toBe('PENDING')
    const note = state.storedNotifications.find((item) => item.userId === owner.id)
    expect(note).toBeTruthy()
    expect(note!.title).toBe('Riesgo MIS-R1 pendiente de tu revisión')
    expect(note!.body).toContain('«Entrega tardía de información»')
    expect(note!.body).toContain('Nivel inherente: Alto (20)')
    expect(note!.link).toBe(`approvals/${created.body.risk.approval.id}`)
  })

  it('no abre ciclo ni notifica cuando el riesgo nace sin dueño', async () => {
    const { db, state } = makeApprovalDb()
    const adminAgent = await loggedIn(db, admin.email)
    const created = await adminAgent.post(`/api/processes/${processId}/risks`).send(riskPayload)
    expect(created.status).toBe(201)
    expect(created.body.risk.approval).toBeNull()
    expect(state.storedNotifications).toHaveLength(0)
    expect(state.storedRisks[0].approvals).toHaveLength(0)
  })

  it('rechaza pedir aprobación sin dueño asignado y con el ciclo ya abierto', async () => {
    const { db, state } = makeApprovalDb()
    const adminAgent = await loggedIn(db, admin.email)
    const withoutOwner = await adminAgent.post(`/api/processes/${processId}/risks`).send(riskPayload)
    const blocked = await adminAgent.post(`/api/processes/${processId}/risks/${withoutOwner.body.risk.id}/approvals`)
    expect(blocked.status).toBe(400)
    expect(blocked.body.error).toBe('Assign a risk owner before requesting approval')

    const withOwner = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Riesgo con dueño', riskOwnerId: owner.id })
    const ownerAgent = await loggedIn(db, owner.email)
    const duplicated = await ownerAgent.post(`/api/processes/${processId}/risks/${withOwner.body.risk.id}/approvals`)
    expect(duplicated.status).toBe(409)
    expect(duplicated.body.error).toBe('This risk already has a pending approval')
    expect(state.storedRisks.flatMap((risk) => risk.approvals)).toHaveLength(1)
  })

  it('aprueba el riesgo: lo acepta, genera ticket único asignado al dueño y notifica al solicitante', async () => {
    const { db, state } = makeApprovalDb()
    const adminAgent = await loggedIn(db, admin.email)
    const created = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    const riskId = created.body.risk.id
    const approvalId = created.body.risk.approval.id

    const ownerAgent = await loggedIn(db, owner.email)
    const decision = await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'APPROVE' })
    expect(decision.status).toBe(200)
    expect(decision.body.approval.status).toBe('APPROVED')
    expect(decision.body.approval.decidedBy).toEqual({ id: owner.id, name: owner.name })
    expect(decision.body.approval.decidedAt).toBeTruthy()

    const ticket = decision.body.ticket
    expect(ticket.title).toBe('MIS-R1 · Entrega tardía de información')
    expect(ticket.status).toBe('OPEN')
    expect(ticket.priority).toBe('HIGH')
    expect(ticket.assignedTo.id).toBe(owner.id)
    expect(ticket.createdBy.id).toBe(owner.id)
    expect(ticket.description).toContain(`Referencia: riesgo ${riskId} del proceso ${processId}`)
    expect(ticket.riskApprovals).toHaveLength(1)
    expect(ticket.riskApprovals[0].risk.id).toBe(riskId)

    // "Aprobar y aceptar": el veredicto formal del riesgo pasa a ACCEPTED en la misma decisión.
    const risks = await adminAgent.get(`/api/processes/${processId}/risks`)
    expect(risks.body.risks[0].acceptanceStatus).toBe('ACCEPTED')

    const requesterNote = state.storedNotifications.find((item) => item.userId === admin.id && item.title.includes('aprobado'))
    expect(requesterNote).toBeTruthy()
    expect(requesterNote!.body).toContain('se generó un ticket de seguimiento')
    expect(state.storedTickets).toHaveLength(1)
  })

  it('exige motivo en el rechazo, no genera ticket y permite reenviar conservando el historial', async () => {
    const { db, state } = makeApprovalDb()
    const adminAgent = await loggedIn(db, admin.email)
    const created = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    const riskId = created.body.risk.id
    const approvalId = created.body.risk.approval.id
    const ownerAgent = await loggedIn(db, owner.email)

    const missingReason = await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'REJECT' })
    expect(missingReason.status).toBe(400)
    expect(missingReason.body.error).toBe('Invalid approval decision')

    const rejected = await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'REJECT', comment: 'Falta documentar el control clave.' })
    expect(rejected.status).toBe(200)
    expect(rejected.body.approval.status).toBe('REJECTED')
    expect(rejected.body.approval.comment).toBe('Falta documentar el control clave.')
    expect(rejected.body.ticket).toBeNull()
    expect(state.storedTickets).toHaveLength(0)
    // El rechazo no toca el veredicto formal: la aceptación sigue pendiente.
    const risks = await adminAgent.get(`/api/processes/${processId}/risks`)
    expect(risks.body.risks[0].acceptanceStatus).toBe('PENDING')
    const requesterNote = state.storedNotifications.find((item) => item.userId === admin.id && item.title.includes('rechazado'))
    expect(requesterNote!.body).toContain('Motivo: Falta documentar el control clave.')

    const resent = await ownerAgent.post(`/api/processes/${processId}/risks/${riskId}/approvals`)
    expect(resent.status).toBe(201)
    expect(resent.body.approval.status).toBe('PENDING')

    const superAgent = await loggedIn(db, superuser.email)
    const history = await superAgent.get('/api/approvals')
    const historyForRisk = history.body.approvals.filter((item: { riskId: string }) => item.riskId === riskId)
    expect(historyForRisk).toHaveLength(2)
    expect(historyForRisk.map((item: { status: string }) => item.status)).toEqual(['PENDING', 'REJECTED'])
    expect(historyForRisk[1].comment).toBe('Falta documentar el control clave.')
    // Segundo reenvío con un ciclo abierto: nunca puede haber dos PENDING a la vez.
    const duplicated = await ownerAgent.post(`/api/processes/${processId}/risks/${riskId}/approvals`)
    expect(duplicated.status).toBe(409)
  })

  it('no permite decidir dos veces ni duplicar el ticket', async () => {
    const { db, state } = makeApprovalDb()
    const adminAgent = await loggedIn(db, admin.email)
    const created = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    const approvalId = created.body.risk.approval.id
    const ownerAgent = await loggedIn(db, owner.email)

    const first = await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'APPROVE' })
    expect(first.status).toBe(200)
    const second = await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'REJECT', comment: 'Intento tardío de cambio.' })
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('This approval was already decided')
    expect(state.storedTickets).toHaveLength(1)
    expect(state.storedRisks[0].approvals[0].status).toBe('APPROVED')
  })

  it('marca OUTDATED al cambiar campos relevantes conservando la decisión y el ticket', async () => {
    const { db, state } = makeApprovalDb()
    const adminAgent = await loggedIn(db, admin.email)
    const created = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    const approvalId = created.body.risk.approval.id
    const ownerAgent = await loggedIn(db, owner.email)
    await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'APPROVE', comment: 'Aprobado con observación menor.' })
    const decisionBefore = { ...state.storedRisks[0].approvals[0] }

    const cosmetic = await adminAgent.patch(`/api/processes/${processId}/risks/${created.body.risk.id}`).send({ treatment: 'MITIGATE' })
    expect(cosmetic.status).toBe(200)
    expect(state.storedRisks[0].approvals[0].status).toBe('APPROVED')

    const relevant = await adminAgent.patch(`/api/processes/${processId}/risks/${created.body.risk.id}`).send({ name: 'Entrega tardía de información crítica' })
    expect(relevant.status).toBe(200)
    expect(relevant.body.risk.approval.status).toBe('OUTDATED')
    const outdated = state.storedRisks[0].approvals[0]
    expect(outdated.status).toBe('OUTDATED')
    expect(outdated.decidedById).toBe(decisionBefore.decidedById)
    expect(outdated.decidedAt?.getTime()).toBe(decisionBefore.decidedAt?.getTime())
    expect(outdated.comment).toBe('Aprobado con observación menor.')
    expect(outdated.ticketId).toBe(decisionBefore.ticketId)
    expect(state.storedTickets).toHaveLength(1)
  })

  it('revierte la transacción si el ticket falla y el reintento no duplica nada', async () => {
    const { db, state, setTicketFailure } = makeApprovalDb()
    const adminAgent = await loggedIn(db, admin.email)
    const created = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    const approvalId = created.body.risk.approval.id
    const ownerAgent = await loggedIn(db, owner.email)

    setTicketFailure(true)
    const failed = await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'APPROVE' })
    expect(failed.status).toBe(500)
    expect(failed.body.error).toBe('The approval decision could not be saved; it can be retried')
    // Rollback completo: el ciclo sigue PENDING, el riesgo sin aceptar y sin tickets huérfanos.
    expect(state.storedRisks[0].approvals[0].status).toBe('PENDING')
    expect(state.storedRisks[0].approvals[0].ticketId).toBeNull()
    expect(state.storedRisks[0].acceptanceStatus).toBe('PENDING')
    expect(state.storedTickets).toHaveLength(0)

    setTicketFailure(false)
    const retried = await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'APPROVE' })
    expect(retried.status).toBe(200)
    expect(retried.body.approval.status).toBe('APPROVED')
    expect(retried.body.ticket).toBeTruthy()
    expect(state.storedTickets).toHaveLength(1)
    expect(state.storedRisks[0].approvals[0].ticketId).toBe(state.storedTickets[0].id)
  })

  it('aisla la visibilidad de la bandeja por empresa y por dueño', async () => {
    const { db } = makeApprovalDb()
    const adminAgent = await loggedIn(db, admin.email)
    const own = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    expect(own.status).toBe(201)
    const foreignAgent = await loggedIn(db, foreignAdmin.email)
    const foreign = await foreignAgent.post(`/api/processes/${foreignProcessId}/risks`).send({ ...riskPayload, name: 'Riesgo externo', riskOwnerId: foreignOwner.id })
    expect(foreign.status).toBe(201)

    const ownerAgent = await loggedIn(db, owner.email)
    const ownerList = await ownerAgent.get('/api/approvals')
    expect(ownerList.body.approvals).toHaveLength(1)
    expect(ownerList.body.approvals[0].risk.riskOwner).toEqual({ id: owner.id, name: owner.name })

    const memberAgent = await loggedIn(db, member.email)
    const memberList = await memberAgent.get('/api/approvals')
    expect(memberList.body.approvals).toHaveLength(0)

    const foreignList = await foreignAgent.get('/api/approvals')
    expect(foreignList.body.approvals).toHaveLength(1)
    expect(foreignList.body.approvals[0].risk.name).toBe('Riesgo externo')

    const superAgent = await loggedIn(db, superuser.email)
    const superList = await superAgent.get('/api/approvals')
    expect(superList.body.approvals).toHaveLength(2)
  })

  it('autoriza la decisión: dueño y admin sí, miembros y empresas ajenas no', async () => {
    const { db, state } = makeApprovalDb()
    const adminAgent = await loggedIn(db, admin.email)
    const created = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    const approvalId = created.body.risk.approval.id

    const memberAgent = await loggedIn(db, member.email)
    const invisible = await memberAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'APPROVE' })
    expect(invisible.status).toBe(404)
    const resendByMember = await memberAgent.post(`/api/processes/${processId}/risks/${created.body.risk.id}/approvals`)
    expect(resendByMember.status).toBe(403)
    expect(resendByMember.body.error).toBe('Only the risk owner or a company admin can request approval')

    const foreignAgent = await loggedIn(db, foreignAdmin.email)
    const foreignDecision = await foreignAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'APPROVE' })
    expect(foreignDecision.status).toBe(404)

    // El administrador de la empresa decide en nombre de un dueño ausente.
    const adminDecision = await adminAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'APPROVE' })
    expect(adminDecision.status).toBe(200)
    expect(adminDecision.body.approval.decidedBy).toEqual({ id: admin.id, name: admin.name })
    expect(state.storedTickets).toHaveLength(1)
  })

  it('valida la decisión inválida y filtra la bandeja por estado', async () => {
    const { db } = makeApprovalDb()
    const adminAgent = await loggedIn(db, admin.email)
    const created = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    const approvalId = created.body.risk.approval.id
    const ownerAgent = await loggedIn(db, owner.email)

    const invalidDecision = await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'MAYBE' })
    expect(invalidDecision.status).toBe(400)
    expect(invalidDecision.body.error).toBe('Invalid approval decision')
    const tooShort = await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'REJECT', comment: 'x' })
    expect(tooShort.status).toBe(400)

    await ownerAgent.post(`/api/approvals/${approvalId}/decision`).send({ decision: 'APPROVE' })
    const superAgent = await loggedIn(db, superuser.email)
    const pending = await superAgent.get('/api/approvals?status=PENDING')
    expect(pending.body.approvals).toHaveLength(0)
    const approved = await superAgent.get('/api/approvals?status=APPROVED')
    expect(approved.body.approvals).toHaveLength(1)
    const invalidFilter = await superAgent.get('/api/approvals?status=DONE')
    expect(invalidFilter.status).toBe(400)
  })

  it('sirve las notificaciones del usuario: lista, marcado de leída y read-all', async () => {
    const { db } = makeApprovalDb()
    const adminAgent = await loggedIn(db, admin.email)
    const created = await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, riskOwnerId: owner.id })
    await adminAgent.post(`/api/processes/${processId}/risks`).send({ ...riskPayload, name: 'Segundo riesgo', riskOwnerId: owner.id })

    const ownerAgent = await loggedIn(db, owner.email)
    const list = await ownerAgent.get('/api/notifications')
    expect(list.status).toBe(200)
    expect(list.body.unread).toBe(2)
    expect(list.body.notifications.every((item: { userId: string }) => item.userId === owner.id)).toBe(true)

    const firstId = list.body.notifications[0].id
    const read = await ownerAgent.patch(`/api/notifications/${firstId}`)
    expect(read.status).toBe(200)
    expect(read.body.notification.readAt).toBeTruthy()
    expect((await ownerAgent.get('/api/notifications')).body.unread).toBe(1)

    const readAll = await ownerAgent.post('/api/notifications/read-all')
    expect(readAll.status).toBe(204)
    expect((await ownerAgent.get('/api/notifications')).body.unread).toBe(0)

    // Una notificación ajena simplemente no existe para el usuario.
    const foreignAgent = await loggedIn(db, foreignAdmin.email)
    const foreignPatch = await foreignAgent.patch(`/api/notifications/${firstId}`)
    expect(foreignPatch.status).toBe(404)
    expect((await foreignAgent.get('/api/notifications')).body.notifications).toHaveLength(0)
    expect(created.status).toBe(201)
  })
})
