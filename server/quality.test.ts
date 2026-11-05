const qualityEvidenceDir = vi.hoisted(() => {
  const dir = `var/evidence-quality-test-${globalThis.process.pid}`
  globalThis.process.env.EVIDENCE_UPLOAD_DIR = dir
  return dir
})

import bcrypt from 'bcryptjs'
import { readdir, rm } from 'node:fs/promises'
import request from './test-request.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'
import type { AIService } from './ai-service.js'
import { AIServiceError } from './ai-service.js'
import { evidenceDirectory } from './evidence-storage.js'
import { createLocalEvidenceStorage, type EvidenceStorage } from './evidence-provider.js'

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const processId = 'cmprocess000000000000000001'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@quality.test', name: 'Quality Admin', role: 'COMPANY_ADMIN' as Role, companyId }
const companyUser = { id: 'cmuser0000000000000000001', email: 'user@quality.test', name: 'Quality User', role: 'COMPANY_USER' as Role, companyId }
const foreignAdmin = { id: 'cmforeign00000000000000001', email: 'foreign@quality.test', name: 'Foreign Admin', role: 'COMPANY_ADMIN' as Role, companyId: otherCompanyId }
const process = { id: processId, companyId, name: 'Gestión Comercial', code: 'PROC-01' }
const procedureId = 'cmprocedure0000000000000001'
const procedure = { id: procedureId, processId, code: 'PR-01', name: 'Procedimiento comercial', objective: 'Gestionar ventas', scope: 'Desde la solicitud hasta el cierre.', description: 'Registrar y revisar cada actividad comercial.', status: 'APPROVED', version: '1.0', process: { id: processId, companyId, name: process.name, code: process.code } }

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
  companyId?: string
  findingId?: string
  checklistId?: string
  required?: boolean
  result?: string
  itemId?: string
  storageProvider?: string
  storageState?: string
  type?: string
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
  const storedOperations: Array<Record<string, unknown>> = []
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
  let operationSeq = 0

  const userView = (id: unknown) => {
    const user = users.find((item) => item.id === id)
    return user ? { id: user.id, name: user.name } : null
  }
  const findingView = (finding: Record<string, unknown>) => ({
    ...finding,
    responsible: userView(finding.responsibleId),
    verifiedBy: userView(finding.verifiedById),
    efficacyVerifiedBy: userView(finding.efficacyVerifiedById),
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
    process: { id: processId, companyId: process.companyId, name: process.name, code: process.code, company: { id: process.companyId, driveFolderId: null } },
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
    if (where?.itemId && finding.itemId !== where.itemId) return false
    if (typeof where?.status === 'string' && finding.status !== where.status) return false
    if (typeof where?.type === 'string' && finding.type !== where.type) return false
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
    if (where?.storageProvider && (file.storageProvider ?? 'LOCAL') !== where.storageProvider) return false
    if (where?.storageState && file.storageState !== where.storageState) return false
    return true
  }
  const operationView = (operation: Record<string, unknown>) => ({
    ...operation,
    evidenceFile: storedFiles.find((file) => file.id === operation.evidenceFileId) ?? null,
    connection: operation.connectionId ? { id: operation.connectionId, companyId, encryptedRefreshToken: 'test-token', rootFolderId: 'drive-company-folder', status: 'CONNECTED' } : null,
  })
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
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        const ids = where?.id && typeof where.id === 'object' ? where.id.in ?? [] : []
        if (ids.length > 0 && !ids.includes(process.id)) return []
        if (where?.companyId && where.companyId !== process.companyId) return []
        return [{ ...process, objective: 'Gestionar ventas con trazabilidad.', description: 'Proceso de ventas y seguimiento.', sipocSuppliers: [{ id: 'cmsupplier000000000000001', description: 'Proveedores comerciales' }], sipocInputs: [{ id: 'cminput00000000000000001', description: 'Solicitud del cliente' }], sipocProcesses: [{ id: 'cmsipocprocess0000000000001', description: 'Validación y registro' }], sipocOutputs: [{ id: 'cmoutput0000000000000001', description: 'Venta registrada' }], sipocCustomers: [{ id: 'cmcustomer000000000000001', description: 'Cliente' }], risks: [{ id: 'cmrisk00000000000000001', code: 'R-01', name: 'Registro incompleto', description: 'Puede faltar información.', riskType: 'OPERATIVO', bpmnActivity: 'Registrar venta', controls: [{ id: 'cmcontrol000000000000001', description: 'Revisión de datos', evaluation: 'PENDING' }] }] }]
      }),
      count: vi.fn(async ({ where }: { where?: { id?: { in?: string[] }; companyId?: string } } = {}) => {
        if (where?.id?.in && where.companyId) return where.id.in.filter((id) => id === processId).length
        return 1
      }),
    },
    company: {
      findUnique: vi.fn(async () => ({ driveFolderId: null })),
      update: vi.fn(async () => ({ driveFolderId: 'drive-company-folder' })),
    },
    companyGoogleDriveConnection: {
      findFirst: vi.fn(async () => ({ id: 'drive-connection', companyId, encryptedRefreshToken: 'test-token', rootFolderId: 'drive-company-folder', status: 'CONNECTED' })),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === 'drive-connection' ? ({ id: 'drive-connection', companyId, encryptedRefreshToken: 'test-token', rootFolderId: 'drive-company-folder', status: 'CONNECTED' }) : null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, companyId, encryptedRefreshToken: 'test-token', rootFolderId: data.rootFolderId ?? 'drive-company-folder', status: 'CONNECTED' })),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'drive-connection', ...data })),
    },
    procedure: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        const ids = where?.id && typeof where.id === 'object' ? where.id.in ?? [] : []
        if (ids.length > 0 && !ids.includes(procedure.id)) return []
        if (where?.process?.companyId && where.process.companyId !== companyId) return []
        return [{ ...procedure }]
      }),
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
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedEvidences.filter((evidence) => (!where?.auditId || evidence.auditId === where.auditId))),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => storedEvidences.find((evidence) => evidence.id === where.id) ?? null),
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedEvidences.find((evidence) => (!where?.id || evidence.id === where.id) && (!where?.auditId || evidence.auditId === where.auditId)) ?? null),
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
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = storedActions.find((action) => action.id === where.id)
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
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => storedFiles.find((file) => file.id === where.id) ?? null),
      count: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedFiles.filter((file) => fileMatches(file, where)).length),
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
    evidenceStorageOperation: {
      findMany: vi.fn(async () => storedOperations.map(operationView)),
      findFirst: vi.fn(async ({ where }: { where: { id?: string; idempotencyKey?: string } }) => {
        const found = storedOperations.find((operation) => (where.id ? operation.id === where.id : true) && (where.idempotencyKey ? operation.idempotencyKey === where.idempotencyKey : true))
        return found ? operationView(found) : null
      }),
      findUnique: vi.fn(async ({ where }: { where: { id?: string; idempotencyKey?: string } }) => {
        const found = storedOperations.find((operation) => (where.id ? operation.id === where.id : true) && (where.idempotencyKey ? operation.idempotencyKey === where.idempotencyKey : true))
        return found ? operationView(found) : null
      }),
      create: vi.fn(async ({ data, select }: { data: Record<string, unknown>; select?: unknown }) => {
        operationSeq += 1
        const operation = { id: `cmoperation${String(operationSeq).padStart(20, '0')}`, status: 'PENDING', attemptCount: 0, nextAttemptAt: null, leaseUntil: null, ...data }
        storedOperations.push(operation)
        return select ? { id: operation.id } : operationView(operation)
      }),
      upsert: vi.fn(async ({ where, create, update, select }: { where: { idempotencyKey: string }; create: Record<string, unknown>; update: Record<string, unknown>; select?: unknown }) => {
        let operation = storedOperations.find((candidate) => candidate.idempotencyKey === where.idempotencyKey)
        if (!operation) {
          operationSeq += 1
          operation = { id: `cmoperation${String(operationSeq).padStart(20, '0')}`, status: 'PENDING', attemptCount: 0, nextAttemptAt: null, leaseUntil: null, ...create }
          storedOperations.push(operation)
        } else Object.assign(operation, update)
        return select ? { id: operation.id } : operationView(operation)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const operation = storedOperations.find((candidate) => candidate.id === where.id)
        if (!operation) throw new Error('Operation not found')
        for (const [key, value] of Object.entries(data)) operation[key] = typeof value === 'object' && value !== null && 'increment' in value ? Number(operation[key] ?? 0) + Number((value as { increment: number }).increment) : value
        return operationView(operation)
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id?: string }; data: Record<string, unknown> }) => {
        const operation = storedOperations.find((candidate) => !where.id || candidate.id === where.id)
        if (!operation) return { count: 0 }
        for (const [key, value] of Object.entries(data)) operation[key] = typeof value === 'object' && value !== null && 'increment' in value ? Number(operation[key] ?? 0) + Number((value as { increment: number }).increment) : value
        return { count: 1 }
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedOperations.findIndex((operation) => operation.id === where.id)
        if (index >= 0) storedOperations.splice(index, 1)
        return { id: where.id }
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
    const collections = [storedAudits, storedFindings, storedEvidences, storedEvents, storedChecklists, storedItems, storedActions, storedProgress, storedFiles, storedOperations, storedAuditProcesses, storedAuditProcedures]
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
    storedOperations,
    storedEvents,
    storedAuditProcesses,
    storedAuditProcedures,
  }
}

async function loggedIn(db: PrismaClient, email = admin.email) {
  const agent = request.agent(createApp(db, undefined, createLocalEvidenceStorage()))
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

  it('only records checklist responses while the audit is in progress and blocks them after closing', async () => {
    const { db } = makeQualityDb()
    const agent = await loggedIn(db)
    const created = await agent.post('/api/audits').send(createPayload)
    const auditId = created.body.audit.id as string
    const checklist = await agent.post(`/api/audits/${auditId}/checklists`).send({ name: 'Preparación' })
    const checklistId = checklist.body.checklist.id as string
    const item = await agent.post(`/api/audits/${auditId}/checklists/${checklistId}/items`).send({
      description: 'Pregunta preparada',
      criteria: 'Criterio preparado',
      required: true,
    })
    const itemId = item.body.item.id as string

    const plannedResult = await agent.patch(`/api/audits/${auditId}/checklists/${checklistId}/items/${itemId}`).send({ result: 'CONFORM' })
    expect(plannedResult.status).toBe(409)
    expect(plannedResult.body.reason).toBe('AUDIT_NOT_IN_PROGRESS')

    const prepared = await agent.patch(`/api/audits/${auditId}/checklists/${checklistId}/items/${itemId}`).send({ description: 'Pregunta revisada' })
    expect(prepared.status).toBe(200)

    expect((await agent.post(`/api/audits/${auditId}/status`).send({ status: 'IN_PROGRESS' })).status).toBe(200)
    expect((await agent.patch(`/api/audits/${auditId}/checklists/${checklistId}/items/${itemId}`).send({ result: 'CONFORM' })).status).toBe(200)
    expect((await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Checklist evaluada.' })).status).toBe(200)

    const closedObservation = await agent.patch(`/api/audits/${auditId}/checklists/${checklistId}/items/${itemId}`).send({ observations: 'Cambio posterior' })
    expect(closedObservation.status).toBe(409)
  })

  it('enforces checklist response RBAC and tenant isolation', async () => {
    const readOnly = makeQualityDb('COMPANY_USER')
    readOnly.storedAudits.push({ id: 'cmauditreadonlychecklist0001', processId, status: 'IN_PROGRESS', title: 'Auditoría de solo lectura', code: 'AUD-996', scope: 'Alcance', criteria: 'Criterios', auditType: 'Interna', summary: null })
    readOnly.storedChecklists.push({ id: 'cmchecklistreadonly0001', auditId: 'cmauditreadonlychecklist0001', name: 'Lista' })
    readOnly.storedItems.push({ id: 'cmitemreadonly00000000001', checklistId: 'cmchecklistreadonly0001', description: 'Pregunta', criteria: 'Criterio', result: 'PENDING', observations: null, required: true, position: 0 })
    const userAgent = await loggedIn(readOnly.db, companyUser.email)
    const forbidden = await userAgent.patch('/api/audits/cmauditreadonlychecklist0001/checklists/cmchecklistreadonly0001/items/cmitemreadonly00000000001').send({ result: 'CONFORM' })
    expect(forbidden.status).toBe(403)
    expect(readOnly.storedItems[0]).toMatchObject({ result: 'PENDING' })

    const foreign = makeQualityDb('COMPANY_ADMIN', otherCompanyId)
    foreign.storedAudits.push({ id: 'cmauditforeignchecklist0001', processId, status: 'IN_PROGRESS', title: 'Auditoría ajena', code: 'AUD-995', scope: 'Alcance', criteria: 'Criterios', auditType: 'Interna', summary: null })
    const foreignAgent = await loggedIn(foreign.db, foreignAdmin.email)
    const notFound = await foreignAgent.patch('/api/audits/cmauditforeignchecklist0001/checklists/cmchecklist0001/items/cmitem0000000000000000001').send({ result: 'CONFORM' })
    expect(notFound.status).toBe(404)
  })

  it('requires a confirmed linked finding for NON_CONFORM and rejects duplicate findings', async () => {
    const { db, storedFindings, storedItems } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const checklist = await agent.post(`/api/audits/${auditId}/checklists`).send({ name: 'No conformidades' })
    const checklistId = checklist.body.checklist.id as string
    const item = await agent.post(`/api/audits/${auditId}/checklists/${checklistId}/items`).send({
      description: '¿Existe evidencia?',
      criteria: 'Debe existir evidencia objetiva.',
    })
    const itemId = item.body.item.id as string

    const withoutFinding = await agent.patch(`/api/audits/${auditId}/checklists/${checklistId}/items/${itemId}`).send({ result: 'NON_CONFORM' })
    expect(withoutFinding.status).toBe(409)
    expect(withoutFinding.body.reason).toBe('NON_CONFORMITY_FINDING_REQUIRED')
    expect(storedItems[0]).toMatchObject({ result: 'PENDING' })

    const finding = await agent.post(`/api/audits/${auditId}/findings`).send({
      title: 'Evidencia objetiva ausente',
      description: 'No se encontró el registro requerido durante la revisión.',
      type: 'NONCONFORMITY',
      severity: 'MAJOR',
      itemId,
    })
    expect(finding.status).toBe(201)
    expect(finding.body.finding).toMatchObject({ itemId, type: 'NONCONFORMITY' })

    const evaluated = await agent.patch(`/api/audits/${auditId}/checklists/${checklistId}/items/${itemId}`).send({ result: 'NON_CONFORM' })
    expect(evaluated.status).toBe(200)
    expect(evaluated.body.item).toMatchObject({ result: 'NON_CONFORM' })

    const duplicate = await agent.post(`/api/audits/${auditId}/findings`).send({
      title: 'Segundo hallazgo duplicado',
      description: 'Otra descripción para el mismo criterio.',
      type: 'NONCONFORMITY',
      severity: 'MAJOR',
      itemId,
    })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.reason).toBe('DUPLICATE_NON_CONFORMITY_FINDING')
    expect(storedFindings).toHaveLength(1)
  })

  it('updates an evidence finding link when the PATCH only changes findingId', async () => {
    const { db, storedEvents } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const firstFinding = await createFinding(agent, auditId, { title: 'Primer hallazgo' })
    const secondFinding = await createFinding(agent, auditId, { title: 'Segundo hallazgo' })

    const created = await agent.post(`/api/audits/${auditId}/evidences`).send({
      name: 'Registro de prueba',
      description: 'Documento que demuestra el control.',
      url: 'https://example.test/registro',
      findingId: firstFinding.id,
    })
    expect(created.status).toBe(201)

    const updated = await agent.patch(`/api/audits/${auditId}/evidences/${created.body.evidence.id}`).send({ findingId: secondFinding.id })
    expect(updated.status).toBe(200)
    expect(updated.body.evidence).toMatchObject({ findingId: secondFinding.id })
    expect(storedEvents.at(-1)).toMatchObject({ eventType: 'EVIDENCE_UPDATED' })
    expect(storedEvents.at(-1)?.changes).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'findingId' })]))
  })

  it('generates authorized checklist proposals for a planned audit without a checklist', async () => {
    const { db, storedAuditProcedures, storedChecklists, storedItems } = makeQualityDb()
    const generateAuditChecklist = vi.fn(async (context: { processes: Array<{ sipoc: unknown[] }>; procedures: Array<{ id: string }>; sources: Array<{ id: string; type: string }>; existingQuestions: string[] }) => ({
      proposals: [{ question: '¿Se revisa el registro de la venta?', expectedEvidence: 'Registro y revisión trazable.', sourceId: procedureId, sourceType: 'PROCEDURE', source: 'PR-01 · Procedimiento comercial', dimension: 'COMPLIANCE' }],
      missingInformation: context.procedures.length === 0 ? ['No hay procedimientos vinculados.'] : [],
    }))
    const agent = request.agent(createApp(db, { generateAuditChecklist } as unknown as AIService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const created = await agent.post('/api/audits').send(createPayload)
    expect(created.status).toBe(201)
    expect(created.body.audit.status).toBe('PLANNED')
    const auditId = created.body.audit.id as string
    storedAuditProcedures.push({ auditId, procedureId })

    const response = await agent.post(`/api/audits/${auditId}/checklists/generate`).send({})
    expect(response.status).toBe(200)
    expect(response.body.proposals).toHaveLength(1)
    expect(generateAuditChecklist).toHaveBeenCalledOnce()
    const context = generateAuditChecklist.mock.calls[0][0]
    expect(context.processes[0].sipoc).not.toHaveLength(0)
    expect(context.procedures.map((item) => item.id)).toEqual([procedureId])
    expect(context.sources).toEqual(expect.arrayContaining([expect.objectContaining({ id: procedureId, type: 'PROCEDURE' })]))
    expect(storedChecklists).toHaveLength(0)
    expect(storedItems).toHaveLength(0)
  })

  it('blocks checklist generation for read-only and foreign users', async () => {
    const generateAuditChecklist = vi.fn(async () => ({ proposals: [], missingInformation: [] }))
    const reader = request.agent(createApp(makeQualityDb('COMPANY_USER').db, { generateAuditChecklist } as unknown as AIService))
    await reader.post('/api/auth/login').send({ email: companyUser.email, password: 'Password123!' })
    expect((await reader.post('/api/audits/cmaudit000000000000000001/checklists/generate').send({})).status).toBe(403)

    const foreign = request.agent(createApp(makeQualityDb('COMPANY_ADMIN', otherCompanyId).db, { generateAuditChecklist } as unknown as AIService))
    await foreign.post('/api/auth/login').send({ email: foreignAdmin.email, password: 'Password123!' })
    expect((await foreign.post('/api/audits/cmaudit000000000000000001/checklists/generate').send({})).status).toBe(404)
    expect(generateAuditChecklist).not.toHaveBeenCalled()
  })

  it('returns controlled errors and enforces the existing AI rate limit for checklist generation', async () => {
    const db = makeQualityDb().db
    const failing = vi.fn(async () => { throw new AIServiceError('INVALID_RESPONSE') })
    const agent = request.agent(createApp(db, { generateAuditChecklist: failing } as unknown as AIService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const auditId = await createStartedAudit(agent)
    const invalid = await agent.post(`/api/audits/${auditId}/checklists/generate`).send({ maxQuestions: 21 })
    expect(invalid.status).toBe(400)
    const failed = await agent.post(`/api/audits/${auditId}/checklists/generate`).send({})
    expect(failed.status).toBe(502)
    expect(failed.body).toEqual({ error: 'Checky returned invalid checklist proposals' })

    const quotaService = { generateAuditChecklist: vi.fn(async () => { throw new AIServiceError('PROVIDER_QUOTA') }) }
    const quotaAgent = request.agent(createApp(makeQualityDb().db, quotaService as unknown as AIService))
    await quotaAgent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const quotaAuditId = await createStartedAudit(quotaAgent)
    const quotaResponse = await quotaAgent.post(`/api/audits/${quotaAuditId}/checklists/generate`).send({})
    expect(quotaResponse.status).toBe(503)
    expect(quotaResponse.body).toEqual({ error: 'Checky no tiene créditos disponibles para generar propuestas' })

    const limitedService = { generateAuditChecklist: vi.fn(async () => ({ proposals: [], missingInformation: [] })) }
    const limitedAgent = request.agent(createApp(makeQualityDb().db, limitedService as unknown as AIService))
    await limitedAgent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const limitedAuditId = await createStartedAudit(limitedAgent)
    for (let index = 0; index < 15; index += 1) {
      expect((await limitedAgent.post(`/api/audits/${limitedAuditId}/checklists/generate`).send({})).status).toBe(200)
    }
    expect((await limitedAgent.post(`/api/audits/${limitedAuditId}/checklists/generate`).send({})).status).toBe(429)
    expect(limitedService.generateAuditChecklist).toHaveBeenCalledTimes(15)
  })

  it('blocks closing while required corrective actions are open and closes after they finish', async () => {
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
    const actionId = action.body.action.id as string

    // Cerrar bloquea: la auditoría tiene una acción obligatoria sin estado final.
    const blockedClose = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Cierre preliminar.' })
    expect(blockedClose.status).toBe(409)
    expect(blockedClose.body.reason).toBe('ACTIONS_PENDING')
    expect(blockedClose.body.pending).toBe(1)
    expect(blockedClose.body.error).toContain('corrective action')

    await agent.post(`/api/audits/${auditId}/actions/${actionId}/status`).send({ status: 'IN_PROGRESS' })
    const stillBlocked = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Cierre preliminar.' })
    expect(stillBlocked.status).toBe(409)
    expect(stillBlocked.body.reason).toBe('ACTIONS_PENDING')

    const completed = await agent.post(`/api/audits/${auditId}/actions/${actionId}/status`).send({ status: 'COMPLETED' })
    expect(completed.status).toBe(200)
    expect(storedActions[0]).toMatchObject({ status: 'COMPLETED' })

    const closed = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Acciones completadas.' })
    expect(closed.status).toBe(200)
    expect(closed.body.audit).toMatchObject({ status: 'CLOSED' })
  })

  it('blocks closing until resolved nonconformities record an efficacy verification', async () => {
    const { db, storedFindings } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const nonconformity = await createFinding(agent, auditId, { type: 'NONCONFORMITY', severity: 'MAJOR' })
    const observation = await createFinding(agent, auditId, { type: 'OBSERVATION', title: 'Observación resuelta' })

    await agent.post(`/api/audits/${auditId}/findings/${nonconformity.id}/status`).send({ status: 'RESOLVED', resolution: 'Se corrigió la no conformidad.' })
    await agent.post(`/api/audits/${auditId}/findings/${observation.id}/status`).send({ status: 'RESOLVED', resolution: 'Se ordenó el archivo.' })
    expect(storedFindings.every((row) => row.status === 'RESOLVED')).toBe(true)

    // Solo cuenta la NO CONFORMIDAD: la observación resuelta no exige eficacia.
    const blockedClose = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Cierre preliminar.' })
    expect(blockedClose.status).toBe(409)
    expect(blockedClose.body.reason).toBe('EFFICACY_PENDING')
    expect(blockedClose.body.pending).toBe(1)
    expect(blockedClose.body.error).toContain('efficacy verification')

    const patched = await agent.patch(`/api/audits/${auditId}/findings/${nonconformity.id}`).send({
      efficacyVerification: 'Auditoría de seguimiento confirma la mejora.',
    })
    expect(patched.status).toBe(200)

    const closed = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Eficacia verificada.' })
    expect(closed.status).toBe(200)
    expect(closed.body.audit).toMatchObject({ status: 'CLOSED' })
  })

  it('blocks closing when a NON_CONFORM checklist item has no valid linked finding', async () => {
    const { db, storedItems } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const checklist = await agent.post(`/api/audits/${auditId}/checklists`).send({ name: 'Consistencia' })
    const item = await agent.post(`/api/audits/${auditId}/checklists/${checklist.body.checklist.id}/items`).send({ description: 'Pregunta no conforme', criteria: 'Criterio', required: true })
    storedItems.find((row) => row.id === item.body.item.id)!.result = 'NON_CONFORM'

    const blocked = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Cierre bloqueado.' })
    expect(blocked.status).toBe(409)
    expect(blocked.body.reason).toBe('CHECKLIST_FINDING_MISSING')
  })

  it('protects the last valid NONCONFORMITY finding linked to a NON_CONFORM item', async () => {
    const { db, storedItems, storedFindings } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const checklist = await agent.post(`/api/audits/${auditId}/checklists`).send({ name: 'Consistencia' })
    const item = await agent.post(`/api/audits/${auditId}/checklists/${checklist.body.checklist.id}/items`).send({ description: 'Pregunta no conforme', criteria: 'Criterio', required: true })
    const finding = await createFinding(agent, auditId, { type: 'NONCONFORMITY', itemId: item.body.item.id })
    const evaluated = await agent.patch(`/api/audits/${auditId}/checklists/${checklist.body.checklist.id}/items/${item.body.item.id}`).send({ result: 'NON_CONFORM' })
    expect(evaluated.status).toBe(200)

    const deleted = await agent.delete(`/api/audits/${auditId}/findings/${finding.id}`)
    expect(deleted.status).toBe(409)
    expect(deleted.body.reason).toBe('NON_CONFORMITY_FINDING_REQUIRED')
    const retyped = await agent.patch(`/api/audits/${auditId}/findings/${finding.id}`).send({ type: 'OBSERVATION' })
    expect(retyped.status).toBe(409)
    expect(retyped.body.reason).toBe('NON_CONFORMITY_FINDING_REQUIRED')
    expect(storedFindings).toHaveLength(1)
    expect(storedItems[0]).toMatchObject({ result: 'NON_CONFORM' })
  })

  it('requires explicit finding review when changing NON_CONFORM to CONFORM or NOT_APPLICABLE', async () => {
    const { db } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const checklist = await agent.post(`/api/audits/${auditId}/checklists`).send({ name: 'Revisión' })
    const checklistId = checklist.body.checklist.id as string
    const firstItem = await agent.post(`/api/audits/${auditId}/checklists/${checklistId}/items`).send({ description: 'Pregunta conforme', criteria: 'Criterio' })
    const secondItem = await agent.post(`/api/audits/${auditId}/checklists/${checklistId}/items`).send({ description: 'Pregunta no aplicable', criteria: 'Criterio' })
    await createFinding(agent, auditId, { type: 'NONCONFORMITY', itemId: firstItem.body.item.id })
    await createFinding(agent, auditId, { type: 'NONCONFORMITY', itemId: secondItem.body.item.id })
    expect((await agent.patch(`/api/audits/${auditId}/checklists/${checklistId}/items/${firstItem.body.item.id}`).send({ result: 'NON_CONFORM' })).status).toBe(200)
    expect((await agent.patch(`/api/audits/${auditId}/checklists/${checklistId}/items/${firstItem.body.item.id}`).send({ result: 'CONFORM' })).body.reason).toBe('FINDING_REVIEW_REQUIRED')
    expect((await agent.patch(`/api/audits/${auditId}/checklists/${checklistId}/items/${firstItem.body.item.id}`).send({ result: 'CONFORM', findingReviewConfirmed: true })).status).toBe(200)
    expect((await agent.patch(`/api/audits/${auditId}/checklists/${checklistId}/items/${secondItem.body.item.id}`).send({ result: 'NON_CONFORM' })).status).toBe(200)
    expect((await agent.patch(`/api/audits/${auditId}/checklists/${checklistId}/items/${secondItem.body.item.id}`).send({ result: 'NOT_APPLICABLE' })).body.reason).toBe('FINDING_REVIEW_REQUIRED')
    expect((await agent.patch(`/api/audits/${auditId}/checklists/${checklistId}/items/${secondItem.body.item.id}`).send({ result: 'NOT_APPLICABLE', findingReviewConfirmed: true })).status).toBe(200)
  })

  it.each(['PENDING', 'FAILED', 'DELETE_PENDING'] as const)('blocks closing while evidence storage is %s', async (storageState) => {
    const { db, storedFiles } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    storedFiles.push({ id: `file-${storageState}`, auditId, storageProvider: 'GOOGLE_DRIVE', storageState })

    const blocked = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Cierre bloqueado.' })
    expect(blocked.status).toBe(409)
    expect(blocked.body.reason).toBe(storageState === 'PENDING' ? 'EVIDENCE_PENDING' : storageState === 'FAILED' ? 'EVIDENCE_FAILED' : 'EVIDENCE_DELETE_PENDING')
  })

  it('allows closing when evidence files are READY', async () => {
    const { db, storedFiles } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    storedFiles.push({ id: 'file-ready', auditId, storageProvider: 'GOOGLE_DRIVE', storageState: 'READY' })

    const closed = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Cierre con evidencia disponible.' })
    expect(closed.status).toBe(200)
    expect(closed.body.audit).toMatchObject({ status: 'CLOSED' })
  })

  it('rejects status changes from company users and from other tenants', async () => {
    // COMPANY_USER: la sesión del arnés toma el rol configurado; la escritura se rechaza con 403
    // en la guarda de rol antes de tocar la auditoría (misma guarda que audita server/audit.test.ts).
    const readOnly = makeQualityDb('COMPANY_USER')
    readOnly.storedAudits.push({
      id: 'cmauditreadonly0000000001',
      processId,
      status: 'IN_PROGRESS',
      title: 'Auditoría de solo lectura',
      code: 'AUD-997',
      scope: 'Alcance',
      criteria: 'Criterios',
      auditType: 'Interna',
      summary: null,
      findings: [],
      evidences: [],
    })
    const userAgent = await loggedIn(readOnly.db, companyUser.email)
    const asUser = await userAgent.post('/api/audits/cmauditreadonly0000000001/status').send({ status: 'CLOSED', summary: 'Cierre indebido.' })
    expect(asUser.status).toBe(403)
    expect(readOnly.storedAudits[0]).toMatchObject({ status: 'IN_PROGRESS' })

    // Otra empresa: la auditoría existe pero su proceso pertenece a una empresa ajena → 404.
    const foreignDb = makeQualityDb('COMPANY_ADMIN', otherCompanyId)
    foreignDb.storedAudits.push({
      id: 'cmauditforeign000000000003',
      processId,
      status: 'IN_PROGRESS',
      title: 'Auditoría ajena',
      code: 'AUD-998',
      scope: 'Alcance',
      criteria: 'Criterios',
      auditType: 'Interna',
      summary: null,
      findings: [],
      evidences: [],
    })
    const foreignAgent = await loggedIn(foreignDb.db, foreignAdmin.email)
    const asForeign = await foreignAgent.post('/api/audits/cmauditforeign000000000003/status').send({ status: 'CLOSED', summary: 'Cierre ajeno.' })
    expect(asForeign.status).toBe(404)
    expect(foreignDb.storedAudits[0]).toMatchObject({ status: 'IN_PROGRESS' })
  })

  it('returns 409 when the transaction rechecks a terminal audit on status change', async () => {
    const { db, storedAudits } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    // El arnés solo fuerza el recheck terminal dentro de la transacción; no simula concurrencia real.
    const transaction = (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction
    transaction.mockImplementationOnce(async (fn: (client: unknown) => Promise<unknown>) => {
      const audit = storedAudits.find((item) => item.id === auditId)
      if (audit) audit.status = 'CLOSED'
      return fn(db)
    })

    const rejected = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Carrera concurrente.' })
    expect(rejected.status).toBe(409)
    expect(rejected.body.error).toContain('closed')
    expect(storedAudits.find((item) => item.id === auditId)).toMatchObject({ status: 'CLOSED', summary: null })
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
    expect(verified.body.finding.efficacyVerifiedBy).toMatchObject({ id: admin.id, name: admin.name })
    expect(verified.body.finding.efficacyVerifiedAt).toBeTruthy()
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
    const { db, storedAuditProcesses, storedAuditProcedures } = makeQualityDb()
    const agent = await loggedIn(db)

    const created = await agent.post('/api/audits').send({ ...createPayload, processIds: [processId, processId], procedureIds: [procedureId] })
    expect(created.status).toBe(201)
    // El proceso principal se deduplica y no se guarda como vínculo.
    expect(storedAuditProcesses).toHaveLength(0)
    expect(storedAuditProcedures).toHaveLength(1)
    expect(storedAuditProcedures[0]).toMatchObject({ auditId: created.body.audit.id, procedureId })

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

  it('does not delete a terminal audit without findings', async () => {
    const { db, storedAudits } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const closed = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Auditoría terminada.' })
    expect(closed.status).toBe(200)

    const rejected = await agent.delete(`/api/audits/${auditId}`)
    expect(rejected.status).toBe(409)
    expect(rejected.body.error).toContain('closed')
    expect(storedAudits).toHaveLength(1)
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

  it('rechecks child state transitions after locking the audit', async () => {
    const { db, storedAudits, storedFindings, storedActions } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)
    const action = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/actions`).send({
      title: 'Acción concurrente',
      description: 'Validar la transición dentro del lock.',
      required: false,
    })
    const actionId = action.body.action.id as string

    const transaction = (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction
    transaction.mockImplementationOnce(async (fn: (client: unknown) => Promise<unknown>) => {
      storedActions[0].status = 'CANCELLED'
      return fn(db)
    })
    const staleAction = await agent.post(`/api/audits/${auditId}/actions/${actionId}/status`).send({ status: 'IN_PROGRESS' })
    expect(staleAction.status).toBe(409)
    expect(staleAction.body.error).toContain('changed before')

    transaction.mockImplementationOnce(async (fn: (client: unknown) => Promise<unknown>) => {
      storedFindings[0].status = 'VERIFIED'
      return fn(db)
    })
    const staleFinding = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/status`).send({ status: 'RESOLVED', resolution: 'Resolución concurrente.' })
    expect(staleFinding.status).toBe(409)
    expect(staleFinding.body.error).toContain('changed before')

    transaction.mockImplementationOnce(async (fn: (client: unknown) => Promise<unknown>) => {
      storedAudits[0].status = 'PLANNED'
      return fn(db)
    })
    const staleAudit = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Cierre concurrente.' })
    expect(staleAudit.status).toBe(409)
    expect(staleAudit.body.error).toBe('Invalid audit status transition')
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

  it('uses the injected private R2 provider without exposing its object key', async () => {
    const { db, storedFiles, storedOperations } = makeQualityDb()
    const remote = new Map<string, Buffer>()
    const read = vi.fn(async ({ storedName }: { storedName?: string | null }) => remote.get(storedName ?? '') ?? Buffer.alloc(0))
    const remove = vi.fn(async ({ storedName }: { storedName?: string | null }) => { if (storedName) remote.delete(storedName) })
    const r2Storage: EvidenceStorage = {
      kind: 'R2',
      ensureAuditFolder: vi.fn(async () => ({ auditFolderId: 'r2-audit-folder', companyFolderId: 'r2-company-folder', rootFolderId: 'r2' })),
      upload: vi.fn(async ({ data, objectKey }) => {
        remote.set(objectKey ?? 'r2-object-1', data)
        return { storedName: objectKey ?? 'r2-object-1', driveFileId: null, driveUrl: null }
      }),
      read,
      remove,
    }
    const agent = request.agent(createApp(db, undefined, r2Storage))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const auditId = await createStartedAudit(agent)

    const uploaded = await agent.post(`/api/audits/${auditId}/evidence-files`).attach('file', Buffer.from('%PDF-1.7\ndrive'), { filename: 'drive.pdf', contentType: 'application/pdf' })
    expect(uploaded.status).toBe(201)
    expect(uploaded.body.file).toMatchObject({ storageProvider: 'R2', storageState: 'READY', filename: 'drive.pdf' })
    expect(uploaded.body.file).not.toHaveProperty('driveFileId')
    expect(storedFiles[0]).toMatchObject({ storedName: expect.stringContaining('audits/'), storageProvider: 'R2' })
    expect(storedOperations).toHaveLength(0)

    const validStoredName = storedFiles[0]!.storedName as string
    storedFiles[0]!.storedName = 'evidentia/cmcompany00000000000000002/audits/other-resource/00000000-0000-0000-0000-000000000000.pdf'
    const invalidDownload = await agent.get(`/api/audits/${auditId}/evidence-files/${uploaded.body.file.id}`)
    expect(invalidDownload.status).toBe(422)
    expect(read).not.toHaveBeenCalled()
    const invalidDelete = await agent.delete(`/api/audits/${auditId}/evidence-files/${uploaded.body.file.id}`)
    expect(invalidDelete.status).toBe(422)
    expect(remove).not.toHaveBeenCalled()
    expect(storedFiles).toHaveLength(1)
    storedFiles[0]!.storedName = validStoredName

    const downloaded = await agent.get(`/api/audits/${auditId}/evidence-files/${uploaded.body.file.id}`)
    expect(downloaded.status).toBe(200)
    expect(downloaded.body.toString()).toContain('%PDF-1.7')
    const removed = await agent.delete(`/api/audits/${auditId}/evidence-files/${uploaded.body.file.id}`)
    expect(removed.status).toBe(204)
    expect(remote.size).toBe(0)
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
