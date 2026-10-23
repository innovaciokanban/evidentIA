const qualityEvidenceDir = vi.hoisted(() => {
  const dir = `var/evidence-quality-test-${globalThis.process.pid}`
  globalThis.process.env.EVIDENCE_UPLOAD_DIR = dir
  return dir
})

import bcrypt from 'bcryptjs'
import { readdir, rm } from 'node:fs/promises'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'
import { evidenceDirectory } from './evidence-storage.js'

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const processId = 'cmprocess000000000000000001'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@quality.test', name: 'Quality Admin', role: 'COMPANY_ADMIN' as Role, companyId }
const companyUser = { id: 'cmuser0000000000000000001', email: 'user@quality.test', name: 'Quality User', role: 'COMPANY_USER' as Role, companyId }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@quality.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId }
const process = { id: processId, companyId, name: 'Gestión Comercial', code: 'PROC-01' }

const createPayload = {
  title: 'Auditoría interna de calidad',
  auditType: 'Interna' as const,
  processId,
  scope: 'Procesos comerciales.',
  criteria: 'Manual de calidad v2.',
  leadAuditorId: admin.id,
  responsibleId: admin.id,
}

// Forma estructural del `where` que envía la API a estos delegados: el arnés no replica Prisma.
type AnyWhere = {
  id?: string | { in?: string[] }
  processId?: string | { in?: string[] }
  procedureId?: string | { in?: string[] }
  actionId?: string
  status?: string | { notIn?: string[] }
  auditId?: string
  findingId?: string
  checklistId?: string
  required?: boolean
  result?: string
  process?: { companyId?: string; id?: string }
  finding?: { auditId?: string }
  checklist?: { auditId?: string }
  code?: { in?: string[] }
  OR?: Array<{ code?: { contains?: string }; title?: { contains?: string } }>
}

function makeQualityDb(role: Role = 'COMPANY_ADMIN', userCompanyId = companyId) {
  const users = [admin, companyUser, foreignAdmin]
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  let sessionActive = false
  const currentUser = users.find((user) => user.role === role && user.companyId === userCompanyId) ?? { ...admin, role, companyId: userCompanyId }
  const storedAudits: Array<Record<string, unknown>> = []
  const storedFindings: Array<Record<string, unknown>> = []
  const storedEvidences: Array<Record<string, unknown>> = []
  const storedEvents: Array<Record<string, unknown>> = []
  const storedChecklists: Array<Record<string, unknown>> = []
  const storedItems: Array<Record<string, unknown>> = []
  const storedActions: Array<Record<string, unknown>> = []
  const storedProgress: Array<Record<string, unknown>> = []
  const storedFiles: Array<Record<string, unknown>> = []
  const storedAuditProcesses: Array<Record<string, unknown>> = []
  const storedAuditProcedures: Array<Record<string, unknown>> = []
  let auditSeq = 0
  let findingSeq = 0
  let evidenceSeq = 0
  let eventSeq = 0
  let checklistSeq = 0
  let itemSeq = 0
  let actionSeq = 0
  let progressSeq = 0
  let fileSeq = 0

  const userView = (id: unknown) => {
    const user = users.find((item) => item.id === id)
    return user ? { id: user.id, name: user.name } : null
  }
  const findingView = (finding: Record<string, unknown>) => ({
    ...finding,
    responsible: userView(finding.responsibleId),
    verifiedBy: userView(finding.verifiedById),
  })
  const checklistView = (checklist: Record<string, unknown>) => ({
    ...checklist,
    items: storedItems
      .filter((item) => item.checklistId === checklist.id)
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0)),
  })
  const actionView = (action: Record<string, unknown>) => ({
    ...action,
    responsible: userView(action.responsibleId),
    progress: storedProgress
      .filter((entry) => entry.actionId === action.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  })
  const auditView = (audit: Record<string, unknown>) => ({
    ...audit,
    process: { id: processId, companyId: process.companyId, name: process.name, code: process.code },
    leadAuditor: userView(audit.leadAuditorId),
    responsible: userView(audit.responsibleId),
    findings: storedFindings
      .filter((item) => item.auditId === audit.id)
      .map((finding) => ({
        ...findingView(finding),
        actions: storedActions.filter((action) => action.findingId === finding.id).map(actionView),
      })),
    evidences: storedEvidences.filter((item) => item.auditId === audit.id),
    checklists: storedChecklists.filter((item) => item.auditId === audit.id).map(checklistView),
  })

  const auditMatches = (audit: Record<string, unknown>, where?: AnyWhere) => {
    if (typeof where?.id === 'string' && audit.id !== where.id) return false
    if (typeof where?.processId === 'string' && audit.processId !== where.processId) return false
    if (typeof where?.status === 'string' && audit.status !== where.status) return false
    if (where?.process?.companyId && process.companyId !== where.process.companyId) return false
    if (where?.id && typeof where.id === 'object' && Array.isArray(where.id.in) && !where.id.in.includes(audit.id as string)) return false
    if (Array.isArray(where?.code?.in) && !where.code.in.includes(audit.code as string)) return false
    return true
  }
  const findingMatches = (finding: Record<string, unknown>, where?: AnyWhere) => {
    if (typeof where?.id === 'string' && finding.id !== where.id) return false
    if (where?.auditId && finding.auditId !== where.auditId) return false
    if (typeof where?.status === 'string' && finding.status !== where.status) return false
    return true
  }
  const checklistMatches = (checklist: Record<string, unknown>, where?: AnyWhere) => {
    if (typeof where?.id === 'string' && checklist.id !== where.id) return false
    if (where?.auditId && checklist.auditId !== where.auditId) return false
    return true
  }
  const itemMatches = (item: Record<string, unknown>, where?: AnyWhere) => {
    if (typeof where?.id === 'string' && item.id !== where.id) return false
    if (where?.checklistId && item.checklistId !== where.checklistId) return false
    if (where?.required !== undefined && item.required !== where.required) return false
    if (typeof where?.result === 'string' && item.result !== where.result) return false
    if (where?.checklist?.auditId) {
      const checklist = storedChecklists.find((row) => row.id === item.checklistId)
      if (!checklist || checklist.auditId !== where.checklist.auditId) return false
    }
    return true
  }
  const actionMatches = (action: Record<string, unknown>, where?: AnyWhere) => {
    if (typeof where?.id === 'string' && action.id !== where.id) return false
    if (where?.auditId && action.auditId !== where.auditId) return false
    if (where?.findingId && action.findingId !== where.findingId) return false
    if (where?.finding?.auditId) {
      const finding = storedFindings.find((row) => row.id === action.findingId)
      if (!finding || finding.auditId !== where.finding.auditId) return false
    }
    if (where?.required !== undefined && action.required !== where.required) return false
    if (where?.status && typeof where.status === 'object' && where.status.notIn && where.status.notIn.includes(action.status as string)) return false
    return true
  }
  const fileMatches = (file: Record<string, unknown>, where?: AnyWhere) => {
    if (typeof where?.id === 'string' && file.id !== where.id) return false
    if (where?.auditId && file.auditId !== where.auditId) return false
    return true
  }
  const eventMatches = (event: Record<string, unknown>, where?: AnyWhere) => {
    if (where?.auditId && event.auditId !== where.auditId) return false
    return true
  }
  const sortedEvents = (where?: AnyWhere) => storedEvents
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
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-q', expiresAt: new Date(Date.now() + 86400000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-q', expiresAt: new Date(Date.now() + 86400000), user: currentUser } : null),
      deleteMany: vi.fn(async () => { sessionActive = false; return { count: 1 } }),
    },
    process: {
      findUnique: vi.fn(async () => ({ ...process, company: { id: process.companyId } })),
      count: vi.fn(async ({ where }: { where?: { id?: { in?: string[] }; companyId?: string } } = {}) => {
        if (where?.id?.in && where.companyId) return where.id.in.filter((id) => id === processId).length
        return 1
      }),
    },
    procedure: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    audit: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedAudits.filter((audit) => auditMatches(audit, where)).map(auditView)),
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        const found = storedAudits.find((audit) => auditMatches(audit, where))
        return found ? auditView(found) : null
      }),
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
      update: vi.fn(async ({ where, data, include }: { where: { id: string }; data: Record<string, unknown>; include?: unknown }) => {
        const audit = storedAudits.find((item) => item.id === where.id)
        if (!audit) throw new Error('Audit not found')
        Object.assign(audit, data, { updatedAt: new Date() })
        void include
        return auditView(audit)
      }),
      count: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedAudits.filter((audit) => auditMatches(audit, where)).length),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedAudits.findIndex((item) => item.id === where.id)
        if (index >= 0) storedAudits.splice(index, 1)
        return { id: where.id }
      }),
    },
    auditFinding: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedFindings.filter((finding) => findingMatches(finding, where)).map(findingView)),
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        const found = storedFindings.find((finding) => findingMatches(finding, where))
        return found ? findingView(found) : null
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
          itemId: null,
          processId: null,
          procedureId: null,
          efficacyVerification: null,
          efficacyVerifiedById: null,
          efficacyVerifiedAt: null,
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
      count: vi.fn(async () => storedFindings.length),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedFindings.findIndex((item) => item.id === where.id)
        if (index >= 0) storedFindings.splice(index, 1)
        return { id: where.id }
      }),
    },
    auditEvidence: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        evidenceSeq += 1
        const evidence = { id: `cmevidence${String(evidenceSeq).padStart(18, '0')}`, findingId: null, createdAt: new Date(), updatedAt: new Date(), ...data }
        storedEvidences.push(evidence)
        return evidence
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const evidence = storedEvidences.find((item) => item.id === where.id)
        if (!evidence) throw new Error('Evidence not found')
        Object.assign(evidence, data)
        return evidence
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedEvidences.findIndex((item) => item.id === where.id)
        if (index >= 0) storedEvidences.splice(index, 1)
        return { id: where.id }
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        eventSeq += 1
        const event = { id: `cmaevent${String(eventSeq).padStart(20, '0')}`, occurredAt: new Date(Date.now() + eventSeq), changes: null, metadata: null, ...data }
        storedEvents.push(event)
        return event
      }),
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => sortedEvents(where).map((event) => ({ ...event, actor: userView(event.actorId) }))),
      count: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedEvents.filter((event) => eventMatches(event, where)).length),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    auditChecklist: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedChecklists.filter((checklist) => checklistMatches(checklist, where)).map(checklistView)),
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        const found = storedChecklists.find((checklist) => checklistMatches(checklist, where))
        return found ? checklistView(found) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        checklistSeq += 1
        const checklist = { id: `cmchecklist${String(checklistSeq).padStart(17, '0')}`, createdAt: new Date(), updatedAt: new Date(), ...data }
        storedChecklists.push(checklist)
        return checklistView(checklist)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const checklist = storedChecklists.find((item) => item.id === where.id)
        if (!checklist) throw new Error('Checklist not found')
        Object.assign(checklist, data, { updatedAt: new Date() })
        return checklistView(checklist)
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedChecklists.findIndex((item) => item.id === where.id)
        if (index >= 0) storedChecklists.splice(index, 1)
        return { id: where.id }
      }),
    },
    auditChecklistItem: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedItems.filter((item) => itemMatches(item, where))),
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedItems.find((item) => itemMatches(item, where)) ?? null),
      count: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedItems.filter((item) => itemMatches(item, where)).length),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        itemSeq += 1
        const item = { id: `cmitem${String(itemSeq).padStart(21, '0')}`, result: 'PENDING', observations: null, createdAt: new Date(), updatedAt: new Date(), ...data }
        storedItems.push(item)
        return item
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const item = storedItems.find((row) => row.id === where.id)
        if (!item) throw new Error('Item not found')
        Object.assign(item, data, { updatedAt: new Date() })
        return item
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedItems.findIndex((row) => row.id === where.id)
        if (index >= 0) storedItems.splice(index, 1)
        return { id: where.id }
      }),
    },
    auditCorrectiveAction: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedActions.filter((action) => actionMatches(action, where)).map(actionView)),
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        const found = storedActions.find((action) => actionMatches(action, where))
        return found ? actionView(found) : null
      }),
      count: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedActions.filter((action) => actionMatches(action, where)).length),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        actionSeq += 1
        const action = {
          id: `cmaction${String(actionSeq).padStart(19, '0')}`,
          status: 'OPEN',
          priority: 'MEDIUM',
          required: true,
          dueDate: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }
        storedActions.push(action)
        return actionView(action)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const action = storedActions.find((item) => item.id === where.id)
        if (!action) throw new Error('Action not found')
        Object.assign(action, data, { updatedAt: new Date() })
        return actionView(action)
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedActions.findIndex((item) => item.id === where.id)
        if (index >= 0) storedActions.splice(index, 1)
        return { id: where.id }
      }),
    },
    auditActionProgress: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedProgress.filter((entry) => !where?.actionId || entry.actionId === where.actionId)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        progressSeq += 1
        const entry = { id: `cmprogress${String(progressSeq).padStart(18, '0')}`, createdAt: new Date(), ...data }
        storedProgress.push(entry)
        return entry
      }),
    },
    auditEvidenceFile: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedFiles.filter((file) => fileMatches(file, where))),
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedFiles.find((file) => fileMatches(file, where)) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        fileSeq += 1
        const file = { id: `cmfile${String(fileSeq).padStart(22, '0')}`, createdAt: new Date(), updatedAt: new Date(), ...data }
        storedFiles.push(file)
        return file
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const file = storedFiles.find((item) => item.id === where.id)
        if (!file) throw new Error('File not found')
        Object.assign(file, data)
        return file
      }),
      updateMany: vi.fn(async ({ where, data }: { where: AnyWhere; data: Record<string, unknown> }) => {
        let count = 0
        for (const file of storedFiles) {
          if (fileMatches(file, where)) { Object.assign(file, data); count += 1 }
        }
        return { count }
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedFiles.findIndex((item) => item.id === where.id)
        if (index >= 0) storedFiles.splice(index, 1)
        return { id: where.id }
      }),
      deleteMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        const before = storedFiles.length
        for (let index = storedFiles.length - 1; index >= 0; index -= 1) {
          if (fileMatches(storedFiles[index], where)) storedFiles.splice(index, 1)
        }
        return { count: before - storedFiles.length }
      }),
    },
    auditProcess: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedAuditProcesses.filter((row) => !where?.auditId || row.auditId === where.auditId)),
      findFirst: vi.fn(async () => null),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        storedAuditProcesses.push(...data)
        return { count: data.length }
      }),
      deleteMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        const before = storedAuditProcesses.length
        for (let index = storedAuditProcesses.length - 1; index >= 0; index -= 1) {
          const row = storedAuditProcesses[index]
          if (where?.auditId && row.auditId !== where.auditId) continue
          if (where?.processId && typeof where.processId === 'object' && where.processId.in && !where.processId.in.includes(row.processId as string)) continue
          storedAuditProcesses.splice(index, 1)
        }
        return { count: before - storedAuditProcesses.length }
      }),
    },
    auditProcedure: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedAuditProcedures.filter((row) => !where?.auditId || row.auditId === where.auditId)),
      findFirst: vi.fn(async () => null),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        storedAuditProcedures.push(...data)
        return { count: data.length }
      }),
      deleteMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        const before = storedAuditProcedures.length
        for (let index = storedAuditProcedures.length - 1; index >= 0; index -= 1) {
          const row = storedAuditProcedures[index]
          if (where?.auditId && row.auditId !== where.auditId) continue
          if (where?.procedureId && typeof where.procedureId === 'object' && where.procedureId.in && !where.procedureId.in.includes(row.procedureId as string)) continue
          storedAuditProcedures.splice(index, 1)
        }
        return { count: before - storedAuditProcedures.length }
      }),
    },
  }
  db.$queryRaw = vi.fn(async () => [{ locked: true }])
  db.$transaction = vi.fn(async (fn: (client: Record<string, unknown>) => Promise<unknown>) => {
    const collections = [storedAudits, storedFindings, storedEvidences, storedEvents, storedChecklists, storedItems, storedActions, storedProgress, storedFiles, storedAuditProcesses, storedAuditProcedures]
    const snapshots = collections.map((collection) => collection.map((row) => ({ ...row })))
    try {
      return await fn(db)
    } catch (error) {
      collections.forEach((collection, index) => {
        collection.splice(0, collection.length, ...snapshots[index])
      })
      throw error
    }
  })
  return {
    db: db as unknown as PrismaClient,
    storedAudits,
    storedFindings,
    storedChecklists,
    storedItems,
    storedActions,
    storedProgress,
    storedFiles,
    storedEvents,
    storedAuditProcesses,
  }
}

async function loggedIn(db: PrismaClient, email = admin.email) {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent as unknown as ReturnType<typeof request.agent>
}

async function createStartedAudit(agent: ReturnType<typeof request.agent>) {
  const created = await agent.post('/api/audits').send(createPayload)
  const auditId = created.body.audit.id as string
  await agent.post(`/api/audits/${auditId}/status`).send({ status: 'IN_PROGRESS' })
  return auditId
}

async function createFinding(agent: ReturnType<typeof request.agent>, auditId: string, extra: Record<string, unknown> = {}) {
  const created = await agent.post(`/api/audits/${auditId}/findings`).send({
    title: 'Hallazgo de prueba',
    description: 'Descripción del hallazgo.',
    type: 'OBSERVATION',
    severity: 'MINOR',
    ...extra,
  })
  return created.body.finding as { id: string; type: string; status: string }
}

describe('quality assurance API', () => {
  afterEach(async () => {
    await rm(qualityEvidenceDir, { recursive: true, force: true })
  })

  it('creates checklists, evaluates items and blocks closing while required items are pending', async () => {
    const { db, storedItems } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)

    const checklist = await agent.post(`/api/audits/${auditId}/checklists`).send({ name: 'Lista de cumplimiento' })
    expect(checklist.status).toBe(201)
    expect(checklist.body.checklist).toMatchObject({ name: 'Lista de cumplimiento', auditId })
    const checklistId = checklist.body.checklist.id as string

    const requiredItem = await agent.post(`/api/audits/${auditId}/checklists/${checklistId}/items`).send({
      description: '¿Se documenta el proceso?',
      criteria: 'Revisión del manual de calidad.',
      required: true,
    })
    expect(requiredItem.status).toBe(201)
    expect(requiredItem.body.item).toMatchObject({ result: 'PENDING', required: true })
    const itemId = requiredItem.body.item.id as string

    const optionalItem = await agent.post(`/api/audits/${auditId}/checklists/${checklistId}/items`).send({
      description: '¿Se revisa el acta?',
      criteria: 'Acta de la reunión.',
      required: false,
    })
    expect(optionalItem.status).toBe(201)

    // Cerrar bloquea: hay un ítem obligatorio aún en PENDING.
    const blockedClose = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Cierre preliminar.' })
    expect(blockedClose.status).toBe(409)
    expect(blockedClose.body.reason).toBe('CHECKLIST_PENDING')

    // Evaluar el ítem obligatorio desbloquea el cierre.
    const evaluated = await agent.patch(`/api/audits/${auditId}/checklists/${checklistId}/items/${itemId}`).send({ result: 'CONFORM' })
    expect(evaluated.status).toBe(200)
    expect(evaluated.body.item).toMatchObject({ result: 'CONFORM' })
    expect(storedItems.some((item) => item.result === 'CONFORM')).toBe(true)

    const closed = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Checklist completa.' })
    expect(closed.status).toBe(200)
    expect(closed.body.audit).toMatchObject({ status: 'CLOSED' })
  })

  it('manages corrective actions, enforces the status machine and blocks resolve while actions are open', async () => {
    const { db, storedActions } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)

    const action = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/actions`).send({
      title: 'Capacitar al equipo',
      description: 'Dictar una charla de actualización.',
      required: true,
      responsibleId: admin.id,
    })
    expect(action.status).toBe(201)
    expect(action.body.action).toMatchObject({ status: 'OPEN', required: true })
    const actionId = action.body.action.id as string

    // Resolver el hallazgo mientras la acción obligatoria está abierta: 409 ACTIONS_PENDING.
    const blockedResolve = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/status`).send({
      status: 'RESOLVED',
      resolution: 'Se atendió el hallazgo.',
    })
    expect(blockedResolve.status).toBe(409)
    expect(blockedResolve.body.reason).toBe('ACTIONS_PENDING')

    // Transiciones inválidas: OPEN → COMPLETED no existe.
    const skip = await agent.post(`/api/audits/${auditId}/actions/${actionId}/status`).send({ status: 'COMPLETED' })
    expect(skip.status).toBe(409)

    const started = await agent.post(`/api/audits/${auditId}/actions/${actionId}/status`).send({ status: 'IN_PROGRESS' })
    expect(started.status).toBe(200)
    expect(started.body.action).toMatchObject({ status: 'IN_PROGRESS' })

    const progress = await agent.post(`/api/audits/${auditId}/actions/${actionId}/progress`).send({
      note: 'Agendada la charla para el viernes.',
    })
    expect(progress.status).toBe(201)
    expect(progress.body.progress).toMatchObject({ note: 'Agendada la charla para el viernes.' })

    const completed = await agent.post(`/api/audits/${auditId}/actions/${actionId}/status`).send({ status: 'COMPLETED' })
    expect(completed.status).toBe(200)
    expect(completed.body.action).toMatchObject({ status: 'COMPLETED' })
    expect(completed.body.action.completedAt).toBeTruthy()
    expect(storedActions).toHaveLength(1)

    // Sin acciones pendientes, el hallazgo puede resolverse.
    const resolved = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/status`).send({
      status: 'RESOLVED',
      resolution: 'Capacitación impartida y registrada.',
    })
    expect(resolved.status).toBe(200)
    expect(resolved.body.finding).toMatchObject({ status: 'RESOLVED' })

    // Verificar una OBSERVATION no exige eficacia.
    const verified = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/status`).send({ status: 'VERIFIED' })
    expect(verified.status).toBe(200)
    expect(verified.body.finding).toMatchObject({ status: 'VERIFIED' })
  })

  it('requires efficacy verification before verifying a nonconformity', async () => {
    const { db } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId, { type: 'NONCONFORMITY', severity: 'MAJOR' })

    await agent.post(`/api/audits/${auditId}/findings/${finding.id}/status`).send({ status: 'RESOLVED', resolution: 'Se corrigió la no conformidad.' })

    const blocked = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/status`).send({ status: 'VERIFIED' })
    expect(blocked.status).toBe(400)
    expect(blocked.body.error).toContain('efficacy verification')

    const patched = await agent.patch(`/api/audits/${auditId}/findings/${finding.id}`).send({
      efficacyVerification: 'Auditoría de seguimiento confirma la mejora.',
    })
    expect(patched.status).toBe(200)

    const verified = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/status`).send({ status: 'VERIFIED' })
    expect(verified.status).toBe(200)
    expect(verified.body.finding).toMatchObject({ status: 'VERIFIED' })
  })

  it('blocks deleting a finding that still has corrective actions and deletes free findings', async () => {
    const { db, storedFindings } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const withAction = await createFinding(agent, auditId, { title: 'Con acciones' })
    const free = await createFinding(agent, auditId, { title: 'Sin acciones' })

    await agent.post(`/api/audits/${auditId}/findings/${withAction.id}/actions`).send({
      title: 'Acción de prueba',
      description: 'Descripción.',
      required: false,
    })

    const blockedDelete = await agent.delete(`/api/audits/${auditId}/findings/${withAction.id}`)
    expect(blockedDelete.status).toBe(409)

    const deleted = await agent.delete(`/api/audits/${auditId}/findings/${free.id}`)
    expect(deleted.status).toBe(204)
    expect(storedFindings).toHaveLength(1)
  })

  it('lists audits with quality indicators and supports relations on create', async () => {
    const { db, storedAuditProcesses } = makeQualityDb()
    const agent = await loggedIn(db)

    const created = await agent.post('/api/audits').send({ ...createPayload, processIds: [processId, processId] })
    expect(created.status).toBe(201)
    // El proceso principal se deduplica y no se guarda como vínculo.
    expect(storedAuditProcesses).toHaveLength(0)

    const auditId = created.body.audit.id as string
    await agent.post(`/api/audits/${auditId}/status`).send({ status: 'IN_PROGRESS' })
    await createFinding(agent, auditId)
    const checklist = await agent.post(`/api/audits/${auditId}/checklists`).send({ name: 'Lista' })
    await agent.post(`/api/audits/${auditId}/checklists/${checklist.body.checklist.id}/items`).send({
      description: 'Pregunta 1',
      criteria: 'Criterio de la pregunta.',
      required: true,
    })

    const listed = await agent.get('/api/audits')
    expect(listed.status).toBe(200)
    expect(listed.body.audits).toHaveLength(1)
    const entry = listed.body.audits[0]
    expect(entry.indicators).toMatchObject({ findings: 1, openFindings: 1, checklistTotal: 1, checklistRequiredPending: 1 })
  })

  it('deletes an audit and cleans up its evidence files from storage', async () => {
    const { db, storedAudits } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)

    // Simular un archivo de evidencia asociado que el DELETE debe limpiar del disco.
    const { nextStoredName, writeEvidenceFile, readEvidenceFile } = await import('./evidence-storage.js')
    const storedName = nextStoredName()
    const data = Buffer.from('%PDF-1.4 fake')
    await writeEvidenceFile(storedName, data)
    const { db: rawDb } = { db: db as unknown as { auditEvidenceFile: { create: (args: unknown) => Promise<unknown> } } }
    await rawDb.auditEvidenceFile.create({
      data: {
        auditId,
        originalName: 'evidencia-calidad.pdf',
        storedName,
        mimeType: 'application/pdf',
        sizeBytes: data.length,
        uploadedById: admin.id,
      },
    })

    const removed = await agent.delete(`/api/audits/${auditId}`)
    expect(removed.status).toBe(204)
    expect(storedAudits).toHaveLength(0)
    await expect(readEvidenceFile(storedName)).rejects.toThrow()
  })

  it('rejects cross-tenant access to checklists, actions and evidence files', async () => {
    const { db, storedAudits } = makeQualityDb('COMPANY_ADMIN', otherCompanyId)
    storedAudits.push({
      id: 'cmauditforeign000000000001',
      processId,
      status: 'IN_PROGRESS',
      title: 'Auditoría ajena',
      code: 'AUD-999',
      scope: 'Alcance',
      criteria: 'Criterios',
      auditType: 'Interna',
      findings: [],
      evidences: [],
    })
    const agent = await loggedIn(db, foreignAdmin.email)
    const auditId = 'cmauditforeign000000000001'
    const denied = await Promise.all([
      agent.get(`/api/audits/${auditId}/checklists`),
      agent.get(`/api/audits/${auditId}/actions`),
      agent.post(`/api/audits/${auditId}/evidence-files`).attach('file', Buffer.from('%PDF-1.7\nvalid'), { filename: 'evidencia.pdf', contentType: 'application/pdf' }),
    ])
    expect(denied.map((response) => response.status)).toEqual([404, 404, 404])
  })

  it('rejects PDF uploads for terminal audits before touching storage', async () => {
    const { db, storedFiles } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const closed = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Auditoría terminada.' })
    expect(closed.status).toBe(200)

    const rejected = await agent.post(`/api/audits/${auditId}/evidence-files`).attach('file', Buffer.from('%PDF-1.7\nvalid'), { filename: 'evidencia.pdf', contentType: 'application/pdf' })
    expect(rejected.status).toBe(409)
    expect(storedFiles).toHaveLength(0)
    await expect(readdir(evidenceDirectory())).rejects.toThrow()
  })

  it('returns 409 and cleans the stored PDF when the transaction rechecks a terminal audit', async () => {
    const { db, storedAudits, storedFiles } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    // El arnés solo fuerza el recheck terminal; no pretende simular concurrencia de PostgreSQL.
    const transaction = (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction
    transaction.mockImplementationOnce(async (fn: (client: unknown) => Promise<unknown>) => {
      const audit = storedAudits.find((item) => item.id === auditId)
      if (audit) audit.status = 'CLOSED'
      return fn(db)
    })

    const rejected = await agent.post(`/api/audits/${auditId}/evidence-files`).attach('file', Buffer.from('%PDF-1.7\nvalid'), { filename: 'race.pdf', contentType: 'application/pdf' })
    expect(rejected.status).toBe(409)
    expect(storedFiles).toHaveLength(0)
    expect(await readdir(evidenceDirectory())).toHaveLength(0)
  })

  it('accepts a valid multipart PDF and rejects MIME, signature and size violations', async () => {
    const { db, storedFiles } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const valid = await agent.post(`/api/audits/${auditId}/evidence-files`).attach('file', Buffer.from('%PDF-1.7\nvalid'), { filename: 'informe.pdf', contentType: 'application/pdf' })
    expect(valid.status).toBe(201)
    expect(valid.body.file).toMatchObject({ filename: 'informe.pdf', mimeType: 'application/pdf' })
    expect(storedFiles).toHaveLength(1)
    expect(await readdir(evidenceDirectory())).toHaveLength(1)

    const wrongMime = await agent.post(`/api/audits/${auditId}/evidence-files`).attach('file', Buffer.from('%PDF-1.7\nvalid'), { filename: 'informe.pdf', contentType: 'application/octet-stream' })
    const badSignature = await agent.post(`/api/audits/${auditId}/evidence-files`).attach('file', Buffer.from('not a pdf'), { filename: 'informe.pdf', contentType: 'application/pdf' })
    const tooLarge = await agent.post(`/api/audits/${auditId}/evidence-files`).attach('file', Buffer.alloc(10 * 1024 * 1024 + 1, 0x20), { filename: 'informe.pdf', contentType: 'application/pdf' })
    expect(wrongMime.status).toBe(415)
    expect(badSignature.status).toBe(415)
    expect(tooLarge.status).toBe(413)
    expect(storedFiles).toHaveLength(1)
  })

  it('rolls back the file row and removes the PDF when history persistence fails', async () => {
    const { db, storedFiles, storedEvents } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const eventsBefore = storedEvents.length
    const eventCreate = (db as unknown as { auditEvent: { create: ReturnType<typeof vi.fn> } }).auditEvent.create
    eventCreate.mockRejectedValueOnce(new Error('history write failed'))

    const failed = await agent.post(`/api/audits/${auditId}/evidence-files`).attach('file', Buffer.from('%PDF-1.7\nvalid'), { filename: 'rollback.pdf', contentType: 'application/pdf' })
    expect(failed.status).toBe(500)
    expect(storedFiles).toHaveLength(0)
    expect(storedEvents).toHaveLength(eventsBefore)
    expect(await readdir(evidenceDirectory())).toHaveLength(0)
  })
})
