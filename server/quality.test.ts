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
  status?: string | { in?: string[]; notIn?: string[] }
  outcome?: string | { in?: string[] }
  auditId?: string
  companyId?: string
  findingId?: string
  analysisId?: string
  causeId?: string | { in?: string[] }
  stepId?: string
  isActive?: boolean
  analysis?: { status?: string }
  evidenceId?: string
  evidenceFileId?: string
  evaluationId?: string
  criterionResultId?: string
  efficacyEvaluationId?: string | null
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
  const storedAcceptanceCriteria: Array<Record<string, unknown>> = []
  const storedProgress: Array<Record<string, unknown>> = []
  const storedCorrections: Array<Record<string, unknown>> = []
  const storedRootCauseAnalyses: Array<Record<string, unknown>> = []
  const storedRootCauses: Array<Record<string, unknown>> = []
  const storedFiveWhySteps: Array<Record<string, unknown>> = []
  const storedActionCauseLinks: Array<Record<string, unknown>> = []
  const storedFiles: Array<Record<string, unknown>> = []
  const storedOperations: Array<Record<string, unknown>> = []
  const storedAuditProcesses: Array<Record<string, unknown>> = []
  const storedAuditProcedures: Array<Record<string, unknown>> = []
  const storedFindingActivityLinks: Array<Record<string, unknown>> = []
  const storedEvidenceActivityLinks: Array<Record<string, unknown>> = []
  const storedEvidenceFileActivityLinks: Array<Record<string, unknown>> = []
  const storedAuditPlans: Array<Record<string, unknown>> = []
  const storedAuditActivities: Array<Record<string, unknown>> = []
  const storedEfficacyEvaluations: Array<Record<string, unknown>> = []
  const storedEfficacyCriterionResults: Array<Record<string, unknown>> = []
  const storedEfficacyProgress: Array<Record<string, unknown>> = []
  const storedEfficacyEvidenceLinks: Array<Record<string, unknown>> = []
  const storedEfficacyEvidenceFileLinks: Array<Record<string, unknown>> = []
  const storedAuditCheckySuggestions: Array<Record<string, unknown>> = []
  let auditSeq = 0
  let findingSeq = 0
  let evidenceSeq = 0
  let eventSeq = 0
  let checklistSeq = 0
  let itemSeq = 0
  let actionSeq = 0
  let criterionSeq = 0
  let progressSeq = 0
  let correctionSeq = 0
  let rootCauseAnalysisSeq = 0
  let rootCauseSeq = 0
  let fiveWhyStepSeq = 0
  let actionCauseLinkSeq = 0
  let fileSeq = 0
  let operationSeq = 0
  let efficacyEvaluationSeq = 0
  let efficacyCriterionResultSeq = 0
  let efficacyProgressSeq = 0
  let efficacyEvidenceLinkSeq = 0
  let efficacyEvidenceFileLinkSeq = 0
  let auditCheckySuggestionSeq = 0

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
  const actionView = (action: Record<string, unknown>, include?: { acceptanceCriteria?: { where?: { type?: string } } }) => ({
    ...action,
    responsible: userView(action.responsibleId),
    progress: storedProgress
      .filter((entry) => entry.actionId === action.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    acceptanceCriteria: storedAcceptanceCriteria
      .filter((criterion) => criterion.actionId === action.id && (!include?.acceptanceCriteria?.where?.type || criterion.type === include.acceptanceCriteria.where.type))
      .map((criterion) => ({ ...criterion, createdBy: userView(criterion.createdById), completedBy: userView(criterion.completedById) })),
    evidences: storedEvidences.filter((evidence) => evidence.actionId === action.id),
    evidenceFiles: storedFiles.filter((file) => file.actionId === action.id),
  })
  const correctionView = (correction: Record<string, unknown>) => ({
    ...correction,
    responsible: userView(correction.responsibleId),
    createdBy: userView(correction.createdById),
  })
  const rootCauseView = (cause: Record<string, unknown>) => ({
    ...cause,
    createdBy: userView(cause.createdById),
    confirmedBy: userView(cause.confirmedById),
  })
  const rootCauseAnalysisView = (analysis: Record<string, unknown>) => ({
    ...analysis,
    responsible: userView(analysis.responsibleId),
    createdBy: userView(analysis.createdById),
    confirmedBy: userView(analysis.confirmedById),
    causes: storedRootCauses.filter((cause) => cause.analysisId === analysis.id).sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0)).map(rootCauseView),
    fiveWhySteps: storedFiveWhySteps.filter((step) => step.analysisId === analysis.id).sort((a, b) => Number(a.sequence) - Number(b.sequence)),
  })
  const checkySuggestionView = (suggestion: Record<string, unknown>) => ({
    ...suggestion,
    audit: storedAudits.find((audit) => audit.id === suggestion.auditId) ? auditView(storedAudits.find((audit) => audit.id === suggestion.auditId)!) : null,
    finding: storedFindings.find((finding) => finding.id === suggestion.findingId) ? findingView(storedFindings.find((finding) => finding.id === suggestion.findingId)!) : null,
    requestedBy: userView(suggestion.requestedById),
    acceptedRootCause: suggestion.acceptedRootCauseId ? storedRootCauses.find((cause) => cause.id === suggestion.acceptedRootCauseId) ?? null : null,
    acceptedAnalysis: suggestion.acceptedAnalysisId ? storedRootCauseAnalyses.find((analysis) => analysis.id === suggestion.acceptedAnalysisId) ?? null : null,
    acceptedAction: suggestion.acceptedActionId ? storedActions.find((action) => action.id === suggestion.acceptedActionId) ?? null : null,
  })
  const actionCauseLinkView = (link: Record<string, unknown>) => {
    const cause = storedRootCauses.find((item) => item.id === link.causeId)
    const analysis = cause ? storedRootCauseAnalyses.find((item) => item.id === cause.analysisId) : null
    const action = storedActions.find((item) => item.id === link.actionId)
    return {
      ...link,
      linkedBy: userView(link.linkedById),
      removedBy: userView(link.removedById),
      cause: cause ? { ...rootCauseView(cause), analysis: analysis ? { id: analysis.id, findingId: analysis.findingId, methodology: analysis.methodology, status: analysis.status, origin: analysis.origin, problemDescription: analysis.problemDescription } : null } : null,
      action: action ? actionView(action) : null,
    }
  }
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
    if (where?.efficacyEvaluationId !== undefined && action.efficacyEvaluationId !== where.efficacyEvaluationId) return false
    if (where?.status && typeof where.status === 'object' && where.status.notIn && where.status.notIn.includes(action.status as string)) return false
    if (where?.status && typeof where.status === 'object' && where.status.in && !where.status.in.includes(action.status as string)) return false
    return true
  }
  const actionCauseLinkMatches = (link: Record<string, unknown>, where?: AnyWhere) => {
    if (where?.id && typeof where.id === 'string' && link.id !== where.id) return false
    if (where?.findingId && link.findingId !== where.findingId) return false
    if (where?.actionId && link.actionId !== where.actionId) return false
    if (where?.causeId && link.causeId !== where.causeId && !(typeof where.causeId === 'object' && Array.isArray(where.causeId.in) && where.causeId.in.includes(link.causeId as string))) return false
    if (where?.isActive !== undefined && link.isActive !== where.isActive) return false
    return true
  }
  const correctionMatches = (correction: Record<string, unknown>, where?: AnyWhere) => {
    if (typeof where?.id === 'string' && correction.id !== where.id) return false
    if (where?.findingId && correction.findingId !== where.findingId) return false
    if (where?.finding?.auditId) {
      const finding = storedFindings.find((row) => row.id === correction.findingId)
      if (!finding || finding.auditId !== where.finding.auditId) return false
    }
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

  const evaluationMatches = (evaluation: Record<string, unknown>, where?: AnyWhere) => {
    if (typeof where?.id === 'string' && evaluation.id !== where.id) return false
    if (where?.auditId && evaluation.auditId !== where.auditId) return false
    if (where?.findingId && evaluation.findingId !== where.findingId) return false
    if (where?.actionId && evaluation.actionId !== where.actionId) return false
    if (typeof where?.status === 'string' && evaluation.status !== where.status) return false
    if (where?.status && typeof where.status === 'object' && where.status.in && !where.status.in.includes(evaluation.status as string)) return false
    if (where?.status && typeof where.status === 'object' && where.status.notIn && where.status.notIn.includes(evaluation.status as string)) return false
    if (where?.outcome && typeof where.outcome === 'object' && where.outcome.in && !where.outcome.in.includes(evaluation.outcome as string)) return false
    return true
  }
  const efficacyEvaluationView = (evaluation: Record<string, unknown>) => {
    const finding = storedFindings.find((row) => row.id === evaluation.findingId)
    const action = storedActions.find((row) => row.id === evaluation.actionId)
    return {
      ...evaluation,
      finding: finding ? { id: finding.id, auditId: finding.auditId, status: finding.status, title: finding.title } : null,
      action: action ? { id: action.id, findingId: action.findingId, title: action.title, status: action.status, workflowVersion: action.workflowVersion } : null,
      responsible: userView(evaluation.responsibleId),
      createdBy: userView(evaluation.createdById),
      completedBy: userView(evaluation.completedById),
      criteria: storedEfficacyCriterionResults
        .filter((result) => result.evaluationId === evaluation.id)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .map((result) => {
          const source = storedAcceptanceCriteria.find((criterion) => criterion.id === result.criterionId)
          return {
            ...result,
            criterion: source ? { id: source.id, type: source.type, description: source.description, expectedResult: source.expectedResult, required: source.required } : null,
            evaluatedBy: userView(result.evaluatedById),
          }
        }),
      progress: storedEfficacyProgress
        .filter((entry) => entry.evaluationId === evaluation.id)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .map((entry) => ({ ...entry, createdBy: userView(entry.createdById) })),
      evidenceLinks: storedEfficacyEvidenceLinks
        .filter((link) => link.evaluationId === evaluation.id)
        .sort((a, b) => String(a.linkedAt).localeCompare(String(b.linkedAt)))
        .map((link) => ({ ...link, evidence: storedEvidences.find((evidence) => evidence.id === link.evidenceId), linkedBy: userView(link.linkedById) })),
      evidenceFileLinks: storedEfficacyEvidenceFileLinks
        .filter((link) => link.evaluationId === evaluation.id)
        .sort((a, b) => String(a.linkedAt).localeCompare(String(b.linkedAt)))
        .map((link) => ({ ...link, evidenceFile: storedFiles.find((file) => file.id === link.evidenceFileId), linkedBy: userView(link.linkedById) })),
    }
  }

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
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        if (where?.id && where.id !== process.id) return null
        if (where?.companyId && where.companyId !== process.companyId) return null
        return { ...process }
      }),
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
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        if (where?.id && where.id !== procedure.id) return null
        if (where?.process?.companyId && where.process.companyId !== companyId) return null
        return { ...procedure }
      }),
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
      findMany: vi.fn(async ({ where, include }: { where?: AnyWhere; include?: { acceptanceCriteria?: { where?: { type?: string } } } } = {}) => storedActions.filter((action) => actionMatches(action, where)).map((action) => actionView(action, include))),
      findFirst: vi.fn(async ({ where, include }: { where?: AnyWhere; include?: { acceptanceCriteria?: { where?: { type?: string } } } } = {}) => {
        const found = storedActions.find((action) => actionMatches(action, where))
        return found ? actionView(found, include) : null
      }),
      findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include?: { acceptanceCriteria?: { where?: { type?: string } } } }) => {
        const found = storedActions.find((action) => action.id === where.id)
        return found ? actionView(found, include) : null
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
          progressPercent: 0,
          workflowVersion: 0,
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
    auditActionAcceptanceCriterion: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedAcceptanceCriteria.filter((criterion) => !where?.actionId || criterion.actionId === where.actionId).map((criterion) => ({ ...criterion, createdBy: userView(criterion.createdById), completedBy: userView(criterion.completedById) }))),
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        const criterion = storedAcceptanceCriteria.find((item) => (!where?.id || item.id === where.id) && (!where?.actionId || item.actionId === where.actionId))
        return criterion ? { ...criterion, createdBy: userView(criterion.createdById), completedBy: userView(criterion.completedById) } : null
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const criterion = storedAcceptanceCriteria.find((item) => item.id === where.id)
        return criterion ? { ...criterion, createdBy: userView(criterion.createdById), completedBy: userView(criterion.completedById) } : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        criterionSeq += 1
        const criterion = { id: `cmcriterion${String(criterionSeq).padStart(18, '0')}`, isMet: false, required: true, type: 'IMPLEMENTATION', observations: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data }
        storedAcceptanceCriteria.push(criterion)
        return { ...criterion, createdBy: userView(criterion.createdById), completedBy: userView(criterion.completedById) }
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const criterion = storedAcceptanceCriteria.find((item) => item.id === where.id)
        if (!criterion) throw new Error('Criterion not found')
        Object.assign(criterion, data, { updatedAt: new Date() })
        return { ...criterion, createdBy: userView(criterion.createdById), completedBy: userView(criterion.completedById) }
      }),
    },
    auditEfficacyEvaluation: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedEfficacyEvaluations
        .filter((evaluation) => evaluationMatches(evaluation, where))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map(efficacyEvaluationView)),
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        const found = storedEfficacyEvaluations
          .filter((evaluation) => evaluationMatches(evaluation, where))
          .sort((a, b) => String(b.completedAt ?? b.createdAt).localeCompare(String(a.completedAt ?? a.createdAt)) || String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)))[0]
        return found ? efficacyEvaluationView(found) : null
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = storedEfficacyEvaluations.find((evaluation) => evaluation.id === where.id)
        return found ? efficacyEvaluationView(found) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        efficacyEvaluationSeq += 1
        const evaluation = {
          id: `cmevaluation${String(efficacyEvaluationSeq).padStart(17, '0')}`,
          status: 'PLANNED',
          outcome: 'PENDING',
          methodologyOther: null,
          observationPeriod: null,
          observationStartDate: null,
          observationEndDate: null,
          observations: null,
          conclusion: null,
          recurrenceDetected: false,
          recurrenceDescription: null,
          recurrenceIdentifiedAt: null,
          startedAt: null,
          completedAt: null,
          completedById: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }
        storedEfficacyEvaluations.push(evaluation)
        return evaluation
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const evaluation = storedEfficacyEvaluations.find((row) => row.id === where.id)
        if (!evaluation) throw new Error('Efficacy evaluation not found')
        Object.assign(evaluation, data, { updatedAt: new Date() })
        return efficacyEvaluationView(evaluation)
      }),
      count: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedEfficacyEvaluations.filter((evaluation) => evaluationMatches(evaluation, where)).length),
    },
    auditEfficacyCriterionResult: {
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedEfficacyCriterionResults.find((result) => (!where?.id || result.id === where.id) && (!where?.evaluationId || result.evaluationId === where.evaluationId)) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        efficacyCriterionResultSeq += 1
        const result = { id: `cmresult${String(efficacyCriterionResultSeq).padStart(20, '0')}`, resultObtained: null, measuredValue: null, measurementUnit: null, sampleSize: null, isMet: null, observations: null, evaluatedById: null, evaluatedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data }
        storedEfficacyCriterionResults.push(result)
        return result
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const result = storedEfficacyCriterionResults.find((row) => row.id === where.id)
        if (!result) throw new Error('Efficacy criterion result not found')
        Object.assign(result, data, { updatedAt: new Date() })
        const criterion = storedAcceptanceCriteria.find((row) => row.id === result.criterionId)
        return { ...result, criterion: criterion ? { id: criterion.id, type: criterion.type, description: criterion.description, expectedResult: criterion.expectedResult, required: criterion.required } : null, evaluatedBy: userView(result.evaluatedById) }
      }),
    },
    auditEfficacyEvaluationProgress: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        efficacyProgressSeq += 1
        const progress = { id: `cmefficacyprogress${String(efficacyProgressSeq).padStart(16, '0')}`, createdAt: new Date(), ...data }
        storedEfficacyProgress.push(progress)
        return { ...progress, createdBy: userView(progress.createdById) }
      }),
    },
    auditEfficacyEvaluationEvidence: {
      findUnique: vi.fn(async ({ where }: { where: { evaluationId_evidenceId: { evaluationId: string; evidenceId: string } } }) => storedEfficacyEvidenceLinks.find((link) => link.evaluationId === where.evaluationId_evidenceId.evaluationId && link.evidenceId === where.evaluationId_evidenceId.evidenceId) ?? null),
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedEfficacyEvidenceLinks.find((link) => (!where?.id || link.id === where.id) && (!where?.evaluationId || link.evaluationId === where.evaluationId) && (!where?.evidenceId || link.evidenceId === where.evidenceId)) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        efficacyEvidenceLinkSeq += 1
        const link = { id: `cmefficacyevidencelink${String(efficacyEvidenceLinkSeq).padStart(12, '0')}`, linkedAt: new Date(), ...data }
        storedEfficacyEvidenceLinks.push(link)
        return link
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedEfficacyEvidenceLinks.findIndex((link) => link.id === where.id)
        if (index >= 0) storedEfficacyEvidenceLinks.splice(index, 1)
        return { id: where.id }
      }),
    },
    auditEfficacyEvaluationEvidenceFile: {
      findUnique: vi.fn(async ({ where }: { where: { evaluationId_evidenceFileId: { evaluationId: string; evidenceFileId: string } } }) => storedEfficacyEvidenceFileLinks.find((link) => link.evaluationId === where.evaluationId_evidenceFileId.evaluationId && link.evidenceFileId === where.evaluationId_evidenceFileId.evidenceFileId) ?? null),
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedEfficacyEvidenceFileLinks.find((link) => (!where?.id || link.id === where.id) && (!where?.evaluationId || link.evaluationId === where.evaluationId) && (!where?.evidenceFileId || link.evidenceFileId === where.evidenceFileId)) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        efficacyEvidenceFileLinkSeq += 1
        const link = { id: `cmefficacypdflink${String(efficacyEvidenceFileLinkSeq).padStart(12, '0')}`, linkedAt: new Date(), ...data }
        storedEfficacyEvidenceFileLinks.push(link)
        return link
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedEfficacyEvidenceFileLinks.findIndex((link) => link.id === where.id)
        if (index >= 0) storedEfficacyEvidenceFileLinks.splice(index, 1)
        return { id: where.id }
      }),
    },
    auditImmediateCorrection: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedCorrections.filter((correction) => correctionMatches(correction, where)).map(correctionView)),
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        const found = storedCorrections.find((correction) => correctionMatches(correction, where))
        return found ? correctionView(found) : null
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = storedCorrections.find((correction) => correction.id === where.id)
        return found ? correctionView(found) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        correctionSeq += 1
        const correction = {
          id: `cmcorrection${String(correctionSeq).padStart(17, '0')}`,
          containmentMeasures: null,
          consequencesIdentified: null,
          consequencesTreatment: null,
          responsibleId: null,
          plannedDate: null,
          executedAt: null,
          status: 'OPEN',
          observations: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }
        storedCorrections.push(correction)
        return correctionView(correction)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const correction = storedCorrections.find((item) => item.id === where.id)
        if (!correction) throw new Error('Correction not found')
        Object.assign(correction, data, { updatedAt: new Date() })
        return correctionView(correction)
      }),
    },
    auditRootCauseAnalysis: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedRootCauseAnalyses.filter((analysis) => (!where?.findingId || analysis.findingId === where.findingId)).map(rootCauseAnalysisView)),
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        const found = storedRootCauseAnalyses.find((analysis) => (!where?.id || analysis.id === where.id) && (!where?.findingId || analysis.findingId === where.findingId))
        return found ? rootCauseAnalysisView(found) : null
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = storedRootCauseAnalyses.find((analysis) => analysis.id === where.id)
        return found ? rootCauseAnalysisView(found) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rootCauseAnalysisSeq += 1
        const analysis = {
          id: `cmrootanalysis${String(rootCauseAnalysisSeq).padStart(16, '0')}`,
          status: 'DRAFT',
          origin: 'MANUAL',
          responsibleId: null,
          confirmedById: null,
          confirmedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }
        storedRootCauseAnalyses.push(analysis)
        return rootCauseAnalysisView(analysis)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const analysis = storedRootCauseAnalyses.find((item) => item.id === where.id)
        if (!analysis) throw new Error('Root cause analysis not found')
        Object.assign(analysis, data, { updatedAt: new Date() })
        return rootCauseAnalysisView(analysis)
      }),
    },
    auditRootCause: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedRootCauses
        .filter((cause) => (!where?.id || (typeof where.id === 'string' ? cause.id === where.id : where.id.in?.includes(cause.id as string))) && (!where?.findingId || cause.findingId === where.findingId) && (!where?.status || cause.status === where.status) && (!where?.analysis?.status || storedRootCauseAnalyses.some((analysis) => analysis.id === cause.analysisId && analysis.status === where.analysis?.status)))
        .map((cause) => ({ ...rootCauseView(cause), analysis: storedRootCauseAnalyses.find((analysis) => analysis.id === cause.analysisId) ? { id: cause.analysisId, findingId: cause.findingId, methodology: storedRootCauseAnalyses.find((analysis) => analysis.id === cause.analysisId)!.methodology, status: storedRootCauseAnalyses.find((analysis) => analysis.id === cause.analysisId)!.status, origin: storedRootCauseAnalyses.find((analysis) => analysis.id === cause.analysisId)!.origin, problemDescription: storedRootCauseAnalyses.find((analysis) => analysis.id === cause.analysisId)!.problemDescription } : null }))),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rootCauseSeq += 1
        const cause = { id: `cmrootcause${String(rootCauseSeq).padStart(18, '0')}`, status: 'POTENTIAL', position: 0, confirmedById: null, confirmedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data }
        storedRootCauses.push(cause)
        return rootCauseView(cause)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const cause = storedRootCauses.find((item) => item.id === where.id)
        if (!cause) throw new Error('Root cause not found')
        Object.assign(cause, data, { updatedAt: new Date() })
        return rootCauseView(cause)
      }),
    },
    auditCheckySuggestion: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => storedAuditCheckySuggestions.filter((suggestion) => (!where?.auditId || suggestion.auditId === where.auditId) && (!where?.findingId || suggestion.findingId === where.findingId)).map(checkySuggestionView)),
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const id = typeof where.id === 'string' ? where.id : null
        const composite = where.auditId_dedupeKey as { auditId: string; dedupeKey: string } | undefined
        const found = storedAuditCheckySuggestions.find((suggestion) => id ? suggestion.id === id : Boolean(composite && suggestion.auditId === composite.auditId && suggestion.dedupeKey === composite.dedupeKey))
        return found ? checkySuggestionView(found) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditCheckySuggestionSeq += 1
        const suggestion = { id: `cmsuggestion${String(auditCheckySuggestionSeq).padStart(17, '0')}`, status: 'PENDING', decisionNote: null, decidedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data }
        storedAuditCheckySuggestions.push(suggestion)
        return checkySuggestionView(suggestion)
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
        const suggestion = storedAuditCheckySuggestions.find((item) => item.id === where.id && (!where.status || item.status === where.status))
        if (!suggestion) return { count: 0 }
        Object.assign(suggestion, data, { updatedAt: new Date() })
        return { count: 1 }
      }),
    },
    auditRootCauseFiveWhyStep: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        fiveWhyStepSeq += 1
        const step = { id: `cmfivewhy${String(fiveWhyStepSeq).padStart(20, '0')}`, createdAt: new Date(), updatedAt: new Date(), ...data }
        storedFiveWhySteps.push(step)
        return step
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const step = storedFiveWhySteps.find((item) => item.id === where.id)
        if (!step) throw new Error('Five Whys step not found')
        Object.assign(step, data, { updatedAt: new Date() })
        return step
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = storedFiveWhySteps.findIndex((step) => step.id === where.id)
        if (index >= 0) storedFiveWhySteps.splice(index, 1)
        return { id: where.id }
      }),
    },
    auditCorrectiveActionCause: {
      findMany: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedActionCauseLinks.filter((link) => actionCauseLinkMatches(link, where)).map(actionCauseLinkView)),
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => {
        const found = storedActionCauseLinks.find((link) => actionCauseLinkMatches(link, where))
        return found ? actionCauseLinkView(found) : null
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = storedActionCauseLinks.find((link) => link.id === where.id)
        return found ? actionCauseLinkView(found) : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        actionCauseLinkSeq += 1
        const link = { id: `cmactioncause${String(actionCauseLinkSeq).padStart(16, '0')}`, isActive: true, removedAt: null, removedById: null, ...data }
        storedActionCauseLinks.push(link)
        return actionCauseLinkView(link)
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const link = storedActionCauseLinks.find((item) => item.id === where.id)
        if (!link) throw new Error('Cause link not found')
        Object.assign(link, data)
        return actionCauseLinkView(link)
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
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedAuditProcedures.find((row) => row.auditId === where?.auditId && row.procedureId === where?.procedureId) ?? null),
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
    auditPlanActivityFinding: {
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedFindingActivityLinks.find((row) => row.findingId === where?.findingId) ?? null),
    },
    auditPlanActivityEvidence: {
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedEvidenceActivityLinks.find((row) => row.evidenceId === where?.evidenceId) ?? null),
    },
    auditPlanActivityEvidenceFile: {
      findFirst: vi.fn(async ({ where }: { where?: AnyWhere } = {}) => storedEvidenceFileActivityLinks.find((row) => row.evidenceFileId === where?.evidenceFileId) ?? null),
    },
    auditPlan: {
      findUnique: vi.fn(async ({ where }: { where: { auditId: string } }) => {
        const plan = storedAuditPlans.find((row) => row.auditId === where.auditId)
        if (!plan) return null
        return {
          status: plan.status,
          activities: storedAuditActivities
            .filter((activity) => activity.auditPlanId === plan.id)
            .map((activity) => ({
              id: activity.id,
              type: activity.type,
              title: activity.title,
              description: activity.description,
              status: activity.status,
              processId: activity.processId,
              process: activity.processId
                ? activity.processId === processId
                  ? { ...process, objective: 'Gestionar ventas con trazabilidad.', description: 'Proceso de ventas y seguimiento.' }
                  : null
                : null,
            })),
        }
      }),
    },
  }
  db.$queryRaw = vi.fn(async () => [{ locked: true }])
  db.$transaction = vi.fn(async (fn: (client: Record<string, unknown>) => Promise<unknown>) => {
    const collections = [storedAudits, storedFindings, storedEvidences, storedEvents, storedChecklists, storedItems, storedActions, storedAcceptanceCriteria, storedProgress, storedCorrections, storedRootCauseAnalyses, storedRootCauses, storedFiveWhySteps, storedActionCauseLinks, storedFiles, storedOperations, storedAuditProcesses, storedAuditProcedures, storedAuditPlans, storedAuditActivities, storedEfficacyEvaluations, storedEfficacyCriterionResults, storedEfficacyProgress, storedEfficacyEvidenceLinks, storedEfficacyEvidenceFileLinks, storedAuditCheckySuggestions]
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
    storedEvidences,
    storedChecklists,
    storedItems,
    storedActions,
    storedAcceptanceCriteria,
    storedProgress,
    storedCorrections,
    storedRootCauseAnalyses,
    storedRootCauses,
    storedFiveWhySteps,
    storedActionCauseLinks,
    storedFiles,
    storedOperations,
    storedEvents,
    storedAuditProcesses,
    storedAuditProcedures,
    storedAuditPlans,
    storedAuditActivities,
    storedFindingActivityLinks,
    storedEvidenceActivityLinks,
    storedEvidenceFileActivityLinks,
    storedEfficacyEvaluations,
    storedEfficacyCriterionResults,
    storedEfficacyProgress,
    storedEfficacyEvidenceLinks,
    storedEfficacyEvidenceFileLinks,
    storedAuditCheckySuggestions,
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

function addAuditActivity(
  storedAuditPlans: Array<Record<string, unknown>>,
  storedAuditActivities: Array<Record<string, unknown>>,
  auditId: string,
  overrides: Record<string, unknown> = {},
) {
  const planId = `cmplan${String(storedAuditPlans.length + 1).padStart(22, '0')}`
  const activityId = `cmactivity${String(storedAuditActivities.length + 1).padStart(19, '0')}`
  if (!storedAuditPlans.some((plan) => plan.auditId === auditId)) storedAuditPlans.push({ id: planId, auditId, status: 'APPROVED' })
  const plan = storedAuditPlans.find((candidate) => candidate.auditId === auditId)!
  const activity = {
    id: activityId,
    auditPlanId: plan.id,
    type: 'PROCESS_REVIEW',
    title: 'Revisión del proceso comercial',
    description: 'Verificar la ejecución y eficacia de los controles del proceso.',
    status: 'IN_PROGRESS',
    processId,
    ...overrides,
  }
  storedAuditActivities.push(activity)
  return activityId
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

async function createCompletedAction(agent: ReturnType<typeof request.agent>, auditId: string, findingId: string, title = 'Acción eficaz') {
  const created = await agent.post(`/api/audits/${auditId}/findings/${findingId}/actions`).send({
    title,
    description: 'Implementar y comprobar la acción correctiva.',
    objective: 'Evitar la recurrencia del hallazgo.',
    implementationPlan: 'Aplicar el control y revisar sus resultados.',
    responsibleId: admin.id,
  })
  expect(created.status).toBe(201)
  const actionId = created.body.action.id as string
  const implementation = await agent.post(`/api/audits/${auditId}/actions/${actionId}/acceptance-criteria`).send({
    type: 'IMPLEMENTATION',
    description: 'La acción fue implementada',
    expectedResult: 'El control está vigente y documentado.',
    required: true,
  })
  expect(implementation.status).toBe(201)
  const effectiveness = await agent.post(`/api/audits/${auditId}/actions/${actionId}/acceptance-criteria`).send({
    type: 'EFFECTIVENESS',
    description: 'La recurrencia disminuye',
    expectedResult: 'No se repite el hallazgo en la muestra observada.',
    required: true,
  })
  expect(effectiveness.status).toBe(201)
  expect((await agent.post(`/api/audits/${auditId}/actions/${actionId}/progress`).send({ note: 'Implementación terminada.', percent: 100 })).status).toBe(201)
  expect((await agent.patch(`/api/audits/${auditId}/actions/${actionId}/acceptance-criteria/${implementation.body.criterion.id}`).send({ isMet: true })).status).toBe(200)
  expect((await agent.post(`/api/audits/${auditId}/actions/${actionId}/status`).send({ status: 'COMPLETED', observations: 'Acción implementada y lista para evaluar.' })).status).toBe(200)
  return { actionId, effectivenessCriterionId: effectiveness.body.criterion.id as string }
}

async function createEfficacyEvaluation(agent: ReturnType<typeof request.agent>, auditId: string, findingId: string, actionId: string) {
  const response = await agent.post(`/api/audits/${auditId}/findings/${findingId}/efficacy-evaluations`).send({
    actionId,
    responsibleId: admin.id,
    methodology: 'RECORD_REVIEW',
    observationPeriod: '30 días',
    scope: 'Muestra de ventas del mes posterior a la acción.',
  })
  expect(response.status).toBe(201)
  return response.body.evaluation as { id: string; criteria: Array<{ id: string; criterionId: string }> }
}

async function createConfirmedCause(agent: ReturnType<typeof request.agent>, auditId: string, findingId: string, description = 'Causa confirmada de prueba.') {
  const analysis = await agent.post(`/api/audits/${auditId}/findings/${findingId}/root-cause-analyses`).send({ methodology: 'MANUAL', problemDescription: 'Problema investigado.' })
  const analysisId = analysis.body.analysis.id as string
  const cause = await agent.post(`/api/audits/${auditId}/findings/${findingId}/root-cause-analyses/${analysisId}/causes`).send({ description })
  const causeId = cause.body.cause.id as string
  await agent.post(`/api/audits/${auditId}/findings/${findingId}/root-cause-analyses/${analysisId}/causes/${causeId}/status`).send({ status: 'CONFIRMED' })
  const confirmed = await agent.post(`/api/audits/${auditId}/findings/${findingId}/root-cause-analyses/${analysisId}/status`).send({ status: 'CONFIRMED' })
  expect(confirmed.status).toBe(200)
  return { analysisId, causeId }
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

  it('builds contextual checklist proposals from the validated in-progress activity scope', async () => {
    const { db, storedAuditProcedures, storedChecklists, storedItems, storedAuditPlans, storedAuditActivities } = makeQualityDb()
    const generateAuditChecklist = vi.fn(async (context: { activity?: { id: string; title: string; process: { id: string } | null; requestedDimension: string | null }; processes: Array<{ id: string; sipoc: unknown[]; risks: unknown[] }>; procedures: Array<{ id: string }> }) => ({
      proposals: [],
      missingInformation: context.activity?.requestedDimension ? [] : ['La dimensión no fue definida.'],
    }))
    const agent = request.agent(createApp(db, { generateAuditChecklist } as unknown as AIService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const audit = await agent.post('/api/audits').send(createPayload)
    const auditId = audit.body.audit.id as string
    const activityId = addAuditActivity(storedAuditPlans, storedAuditActivities, auditId)
    storedAuditProcedures.push({ auditId, procedureId })
    const generatedBefore = { checklists: storedChecklists.length, items: storedItems.length }

    const response = await agent.post(`/api/audits/${auditId}/checklists/generate`).send({ maxQuestions: 8, activityId, dimension: 'COMPLIANCE' })

    expect(response.status).toBe(200)
    const context = generateAuditChecklist.mock.calls[0][0]
    expect(context.activity).toMatchObject({ id: activityId, title: 'Revisión del proceso comercial', requestedDimension: 'COMPLIANCE', process: { id: processId } })
    expect(context.processes).toHaveLength(1)
    expect(context.processes[0].id).toBe(processId)
    expect(context.processes[0].sipoc).not.toHaveLength(0)
    expect(context.processes[0].risks).not.toHaveLength(0)
    expect(context.procedures.map((item) => item.id)).toEqual([procedureId])
    expect(storedChecklists.length).toBe(generatedBefore.checklists)
    expect(storedItems.length).toBe(generatedBefore.items)
  })

  it('keeps an activity without a process focused on its purpose and audit criteria', async () => {
    const { db, storedAuditPlans, storedAuditActivities } = makeQualityDb()
    const generateAuditChecklist = vi.fn(async () => ({ proposals: [], missingInformation: [] }))
    const agent = request.agent(createApp(db, { generateAuditChecklist } as unknown as AIService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const auditId = await createStartedAudit(agent)
    const activityId = addAuditActivity(storedAuditPlans, storedAuditActivities, auditId, {
      type: 'OPENING_MEETING',
      title: 'Reunión de apertura',
      description: 'Alinear alcance, criterios y método de trabajo.',
      processId: null,
    })

    const response = await agent.post(`/api/audits/${auditId}/checklists/generate`).send({ activityId })

    expect(response.status).toBe(200)
    const context = generateAuditChecklist.mock.calls[0][0]
    expect(context.activity).toMatchObject({ id: activityId, type: 'OPENING_MEETING', process: null })
    expect(context.processes).toHaveLength(1)
    expect(context.processes[0].sipoc).toEqual([])
    expect(context.processes[0].risks).toEqual([])
    expect(context.procedures).toEqual([])
  })

  it('rejects invalid contextual dimensions, plans and activity states before calling Checky', async () => {
    const { db, storedAuditPlans, storedAuditActivities } = makeQualityDb()
    const generateAuditChecklist = vi.fn(async () => ({ proposals: [], missingInformation: [] }))
    const agent = request.agent(createApp(db, { generateAuditChecklist } as unknown as AIService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const auditId = await createStartedAudit(agent)
    const activityId = addAuditActivity(storedAuditPlans, storedAuditActivities, auditId)

    expect((await agent.post(`/api/audits/${auditId}/checklists/generate`).send({ activityId, dimension: 'INVALID' })).status).toBe(400)
    const plan = storedAuditPlans.find((candidate) => candidate.auditId === auditId)!
    plan.status = 'DRAFT'
    expect((await agent.post(`/api/audits/${auditId}/checklists/generate`).send({ activityId })).status).toBe(409)
    plan.status = 'APPROVED'
    for (const status of ['PLANNED', 'COMPLETED', 'CANCELLED']) {
      storedAuditActivities.find((candidate) => candidate.id === activityId)!.status = status
      expect((await agent.post(`/api/audits/${auditId}/checklists/generate`).send({ activityId })).status).toBe(409)
    }
    expect(generateAuditChecklist).not.toHaveBeenCalled()
  })

  it('rejects contextual activities outside the audit scope without calling Checky', async () => {
    const { db, storedAuditPlans, storedAuditActivities } = makeQualityDb()
    const generateAuditChecklist = vi.fn(async () => ({ proposals: [], missingInformation: [] }))
    const agent = request.agent(createApp(db, { generateAuditChecklist } as unknown as AIService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const auditId = await createStartedAudit(agent)
    const foreignProcessActivityId = addAuditActivity(storedAuditPlans, storedAuditActivities, auditId, { processId: 'cmforeignprocess000000000001' })
    expect((await agent.post(`/api/audits/${auditId}/checklists/generate`).send({ activityId: foreignProcessActivityId })).status).toBe(404)

    const secondAudit = await agent.post('/api/audits').send(createPayload)
    const secondAuditId = secondAudit.body.audit.id as string
    const secondActivityId = addAuditActivity(storedAuditPlans, storedAuditActivities, secondAuditId)
    expect((await agent.post(`/api/audits/${auditId}/checklists/generate`).send({ activityId: secondActivityId })).status).toBe(404)
    expect(generateAuditChecklist).not.toHaveBeenCalled()
  })

  it('keeps the persisted checklist intact during Checky review and saves only explicitly submitted proposals', async () => {
    const { db, storedAuditProcedures, storedChecklists, storedItems } = makeQualityDb()
    const generateAuditChecklist = vi.fn(async (context: { existingQuestions: string[] }) => ({
      proposals: [
        { question: '¿Se revisa la evidencia existente?', expectedEvidence: 'Acta de revisión firmada.', sourceId: procedureId, sourceType: 'PROCEDURE', source: 'PR-01 · Procedimiento comercial', dimension: 'COMPLIANCE' },
        { question: '¿Se validan los registros antes del cierre?', expectedEvidence: 'Registro de validación.', sourceId: processId, sourceType: 'PROCESS', source: 'PROC-01 · Gestión Comercial', dimension: 'EFFECTIVENESS' },
      ],
      missingInformation: context.existingQuestions.length > 0 ? [] : ['No hay preguntas existentes.'],
    }))
    const agent = request.agent(createApp(db, { generateAuditChecklist } as unknown as AIService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const created = await agent.post('/api/audits').send(createPayload)
    const auditId = created.body.audit.id as string
    storedAuditProcedures.push({ auditId, procedureId })

    const checklist = await agent.post(`/api/audits/${auditId}/checklists`).send({ name: 'Lista base' })
    const checklistId = checklist.body.checklist.id as string
    const existing = await agent.post(`/api/audits/${auditId}/checklists/${checklistId}/items`).send({
      description: '¿Se revisa la evidencia existente?',
      criteria: 'Criterio manual original.',
      required: true,
    })
    const existingItemId = existing.body.item.id as string
    const checklistsBeforeGeneration = storedChecklists.map((item) => ({ ...item }))
    const itemsBeforeGeneration = storedItems.map((item) => ({ ...item }))

    const generated = await agent.post(`/api/audits/${auditId}/checklists/generate`).send({})
    expect(generated.status).toBe(200)
    expect(generateAuditChecklist.mock.calls[0][0].existingQuestions).toEqual(['¿Se revisa la evidencia existente?'])
    expect(storedChecklists).toEqual(checklistsBeforeGeneration)
    expect(storedItems).toEqual(itemsBeforeGeneration)

    const selectedProposal = generated.body.proposals.find((proposal: { question: string }) => proposal.question.includes('validan los registros'))
    const saved = await agent.post(`/api/audits/${auditId}/checklists/${checklistId}/items`).send({
      description: selectedProposal.question,
      criteria: `Evidencia esperada: ${selectedProposal.expectedEvidence}\nFuente: ${selectedProposal.source}\nDimensión: ${selectedProposal.dimension}`,
      required: true,
    })
    expect(saved.status).toBe(201)
    expect(storedItems).toHaveLength(2)
    expect(storedItems.some((item) => item.description === '¿Se revisa la evidencia existente?' && item.id !== existingItemId)).toBe(false)

    const manualEdit = await agent.patch(`/api/audits/${auditId}/checklists/${checklistId}/items/${existingItemId}`).send({
      description: '¿Se revisa y aprueba la evidencia existente?',
      criteria: 'Evidencia esperada: Acta de revisión aprobada.\nFuente: Procedimiento comercial.',
    })
    expect(manualEdit.status).toBe(200)
    expect(manualEdit.body.item).toMatchObject({
      description: '¿Se revisa y aprueba la evidencia existente?',
      criteria: 'Evidencia esperada: Acta de revisión aprobada.\nFuente: Procedimiento comercial.',
    })
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

    await agent.post(`/api/audits/${auditId}/actions/${actionId}/progress`).send({ note: 'Implementación finalizada.', percent: 100 })
    const completed = await agent.post(`/api/audits/${auditId}/actions/${actionId}/status`).send({ status: 'COMPLETED', observations: 'Se completó la capacitación y se verificó el resultado.' })
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
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(409)
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

    // La finalización directa de una acción integral todavía debe superar sus requisitos.
    const skip = await agent.post(`/api/audits/${auditId}/actions/${actionId}/status`).send({ status: 'COMPLETED' })
    expect(skip.status).toBe(409)
    expect(skip.body.reason).toBe('ACTION_COMPLETION_REQUIREMENTS')

    const started = await agent.post(`/api/audits/${auditId}/actions/${actionId}/status`).send({ status: 'IN_PROGRESS' })
    expect(started.status).toBe(200)
    expect(started.body.action).toMatchObject({ status: 'IN_PROGRESS' })

    const progress = await agent.post(`/api/audits/${auditId}/actions/${actionId}/progress`).send({
      note: 'Agendada la charla para el viernes.',
      percent: 100,
    })
    expect(progress.status).toBe(201)
    expect(progress.body.progress).toMatchObject({ note: 'Agendada la charla para el viernes.' })

    const completed = await agent.post(`/api/audits/${auditId}/actions/${actionId}/status`).send({ status: 'COMPLETED', observations: 'La charla fue impartida y quedó registrada.' })
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

  it('manages integral action planning, criteria, progress, evidence and explicit completion', async () => {
    const { db, storedActions, storedFindings, storedProgress, storedAcceptanceCriteria, storedEvidences, storedFiles, storedEvents } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)

    const created = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/actions`).send({
      title: 'Actualizar procedimiento',
      description: 'Implementar el procedimiento controlado.',
      objective: 'Eliminar la recurrencia del hallazgo.',
      implementationPlan: 'Aprobar, comunicar y verificar el procedimiento.',
      resources: 'Responsable de calidad y registro documental.',
      responsibleId: admin.id,
      evidenceRequired: true,
    })
    expect(created.status).toBe(201)
    expect(created.body.action).toMatchObject({ workflowVersion: 1, progressPercent: 0, objective: 'Eliminar la recurrencia del hallazgo.' })
    const actionId = created.body.action.id as string

    const criterion = await agent.post(`/api/audits/${auditId}/actions/${actionId}/acceptance-criteria`).send({
      type: 'IMPLEMENTATION',
      description: 'Procedimiento aprobado',
      expectedResult: 'Existe una versión aprobada y vigente.',
      required: true,
    })
    expect(criterion.status).toBe(201)
    const criterionId = criterion.body.criterion.id as string
    const effectiveness = await agent.post(`/api/audits/${auditId}/actions/${actionId}/acceptance-criteria`).send({
      type: 'EFFECTIVENESS',
      description: 'La recurrencia disminuye',
      expectedResult: 'No se repite el hallazgo en la siguiente auditoría.',
    })
    expect(effectiveness.status).toBe(201)
    expect(effectiveness.body.criterion).toMatchObject({ type: 'EFFECTIVENESS', isMet: false })

    const firstProgress = await agent.post(`/api/audits/${auditId}/actions/${actionId}/progress`).send({ activities: 'Actualizar el documento.', results: 'Borrador revisado.', percent: 60 })
    expect(firstProgress.status).toBe(201)
    expect(firstProgress.body.progress.activities).toBe('Actualizar el documento.')
    const secondProgress = await agent.post(`/api/audits/${auditId}/actions/${actionId}/progress`).send({ note: 'Aprobación final.', percent: 100 })
    expect(secondProgress.status).toBe(201)
    const thirdProgress = await agent.post(`/api/audits/${auditId}/actions/${actionId}/progress`).send({ note: 'Seguimiento sin cambio de porcentaje.' })
    expect(thirdProgress.status).toBe(201)
    expect(thirdProgress.body.progressPercent).toBe(100)
    expect(storedProgress).toHaveLength(3)

    const beforeCriterion = await agent.post(`/api/audits/${auditId}/actions/${actionId}/status`).send({ status: 'COMPLETED', observations: 'Listo.' })
    expect(beforeCriterion.status).toBe(409)
    expect(beforeCriterion.body.reason).toBe('ACTION_COMPLETION_REQUIREMENTS')

    const completedCriterion = await agent.patch(`/api/audits/${auditId}/actions/${actionId}/acceptance-criteria/${criterionId}`).send({ isMet: true, observations: 'Documento aprobado por calidad.' })
    expect(completedCriterion.status).toBe(200)
    expect(storedAcceptanceCriteria[0]).toMatchObject({ isMet: true })

    const withoutEvidence = await agent.post(`/api/audits/${auditId}/actions/${actionId}/status`).send({ status: 'COMPLETED', observations: 'Implementación terminada.' })
    expect(withoutEvidence.status).toBe(409)

    const evidence = await agent.post(`/api/audits/${auditId}/evidences`).send({ name: 'Procedimiento aprobado', description: 'Documento oficial vigente.', url: 'https://example.test/procedimiento', findingId: finding.id, actionId })
    expect(evidence.status).toBe(201)
    expect(evidence.body.evidence).toMatchObject({ actionId, findingId: finding.id })
    expect(storedEvidences).toHaveLength(1)

    const pdfEvidence = await agent.post(`/api/audits/${auditId}/evidence-files`)
      .field('actionId', actionId)
      .attach('file', Buffer.from('%PDF-1.7\nimplementation'), { filename: 'procedimiento.pdf', contentType: 'application/pdf' })
    expect(pdfEvidence.status).toBe(201)
    expect(pdfEvidence.body.file).toMatchObject({ actionId, findingId: null })
    expect(storedFiles).toHaveLength(1)

    const completed = await agent.post(`/api/audits/${auditId}/actions/${actionId}/status`).send({ status: 'COMPLETED', observations: 'Implementación terminada y documentada.' })
    expect(completed.status).toBe(200)
    expect(completed.body.action).toMatchObject({ status: 'COMPLETED', progressPercent: 100, observations: 'Implementación terminada y documentada.' })
    expect(storedActions[0]).toMatchObject({ workflowVersion: 1, status: 'COMPLETED', progressPercent: 100 })
    expect(storedAcceptanceCriteria.find((criterion) => criterion.type === 'EFFECTIVENESS')).toMatchObject({ isMet: false })
    expect(storedEvents.at(-1)).toMatchObject({ eventType: 'ACTION_STATUS_CHANGED' })
    expect(storedEvents.at(-1)?.metadata).toMatchObject({ previousStatus: 'OPEN', newStatus: 'COMPLETED', actionId })
    expect(storedFindings[0]).toMatchObject({ id: finding.id, status: 'OPEN' })

    const terminalPdf = await agent.post(`/api/audits/${auditId}/evidence-files`)
      .field('actionId', actionId)
      .attach('file', Buffer.from('%PDF-1.7\nblocked'), { filename: 'bloqueado.pdf', contentType: 'application/pdf' })
    expect(terminalPdf.status).toBe(409)
    expect(storedFiles).toHaveLength(1)
  })

  it('manages immediate corrections without changing the finding lifecycle', async () => {
    const { db, storedCorrections, storedEvents, storedFindings } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)

    const created = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/corrections`).send({
      description: 'Contener el registro incompleto.',
      containmentMeasures: 'Revisión manual del expediente.',
      consequencesIdentified: 'Riesgo de información incompleta.',
      consequencesTreatment: 'Validación del expediente antes de continuar.',
      responsibleId: admin.id,
      plannedDate: '2026-12-01T00:00:00.000Z',
      observations: 'Corrección preparada.',
    })
    expect(created.status).toBe(201)
    expect(created.body.correction).toMatchObject({ status: 'OPEN', findingId: finding.id, responsible: { id: admin.id }, createdBy: { id: admin.id } })
    const correctionId = created.body.correction.id as string
    expect(storedEvents.at(-1)).toMatchObject({ eventType: 'IMMEDIATE_CORRECTION_CREATED' })
    expect((await agent.delete(`/api/audits/${auditId}/findings/${finding.id}/corrections/${correctionId}`)).status).toBe(404)

    expect((await agent.get(`/api/audits/${auditId}/findings/${finding.id}/corrections`)).status).toBe(200)
    expect((await agent.get(`/api/audits/${auditId}/findings/${finding.id}/corrections/${correctionId}`)).status).toBe(200)

    const edited = await agent.patch(`/api/audits/${auditId}/findings/${finding.id}/corrections/${correctionId}`).send({ observations: 'Corrección lista para ejecutarse.' })
    expect(edited.status).toBe(200)
    expect(edited.body.correction.observations).toBe('Corrección lista para ejecutarse.')
    expect(storedEvents.at(-1)).toMatchObject({ eventType: 'IMMEDIATE_CORRECTION_UPDATED' })

    const invalidComplete = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/corrections/${correctionId}/complete`).send({ observations: 'No se puede completar todavía.' })
    expect(invalidComplete.status).toBe(409)
    expect(invalidComplete.body.error).toContain('transition')

    const started = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/corrections/${correctionId}/start`).send({})
    expect(started.status).toBe(200)
    const completed = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/corrections/${correctionId}/complete`).send({ observations: 'La contención fue ejecutada y verificada.' })
    expect(completed.status).toBe(200)
    expect(completed.body.correction).toMatchObject({ status: 'COMPLETED', observations: 'La contención fue ejecutada y verificada.' })
    expect(completed.body.correction.executedAt).toBeTruthy()
    expect(storedFindings[0]).toMatchObject({ status: 'OPEN' })
    expect(storedEvents.filter((event) => String(event.eventType).startsWith('IMMEDIATE_CORRECTION_'))).toHaveLength(4)

    const terminalEdit = await agent.patch(`/api/audits/${auditId}/findings/${finding.id}/corrections/${correctionId}`).send({ observations: 'Cambio posterior.' })
    expect(terminalEdit.status).toBe(409)
    expect(storedCorrections).toHaveLength(1)
  })

  it('cancels immediate corrections with a justification and does not duplicate events', async () => {
    const { db, storedEvents } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)
    const created = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/corrections`).send({ description: 'Contención que no aplica.' })
    const correctionId = created.body.correction.id as string

    const cancelled = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/corrections/${correctionId}/cancel`).send({ justification: 'El riesgo desapareció antes de ejecutar la contención.' })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.correction).toMatchObject({ status: 'CANCELLED' })
    expect(cancelled.body.correction.observations).toContain('Justificación de cancelación')
    const eventCount = storedEvents.length
    const repeated = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/corrections/${correctionId}/cancel`).send({ justification: 'Repetida.' })
    expect(repeated.status).toBe(409)
    expect(storedEvents).toHaveLength(eventCount)
  })

  it('requires execution observations and an active responsible before completion', async () => {
    const { db } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)
    const created = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/corrections`).send({ description: 'Contención sin responsable.' })
    const correctionId = created.body.correction.id as string
    expect((await agent.post(`/api/audits/${auditId}/findings/${finding.id}/corrections/${correctionId}/start`).send({})).status).toBe(200)

    const missingObservation = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/corrections/${correctionId}/complete`).send({})
    expect(missingObservation.status).toBe(400)
    const missingResponsible = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/corrections/${correctionId}/complete`).send({ observations: 'Ejecución registrada.' })
    expect(missingResponsible.status).toBe(400)
  })

  it('blocks correction writes after an audit becomes closed or cancelled', async () => {
    const { db } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)
    expect((await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CLOSED', summary: 'Auditoría cerrada.' })).status).toBe(200)
    const closedCreate = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/corrections`).send({ description: 'No debe crearse.' })
    expect(closedCreate.status).toBe(409)

    const cancelledDb = makeQualityDb()
    const cancelledAgent = await loggedIn(cancelledDb.db)
    const cancelledAuditId = await createStartedAudit(cancelledAgent)
    const cancelledFinding = await createFinding(cancelledAgent, cancelledAuditId)
    expect((await cancelledAgent.post(`/api/audits/${cancelledAuditId}/status`).send({ status: 'CANCELLED' })).status).toBe(200)
    const cancelledCreate = await cancelledAgent.post(`/api/audits/${cancelledAuditId}/findings/${cancelledFinding.id}/corrections`).send({ description: 'No debe crearse.' })
    expect(cancelledCreate.status).toBe(409)
  })

  it('enforces correction validation, tenant boundaries and read-only users', async () => {
    const { db, storedCorrections, storedAudits, storedFindings } = makeQualityDb('COMPANY_USER')
    const auditId = 'cmauditcorrectionreadonly0001'
    const findingId = 'cmfindingcorrectionreadonly01'
    const correctionId = 'cmcorrectionreadonly0001'
    storedAudits.push({ id: auditId, processId, status: 'IN_PROGRESS', title: 'Auditoría de lectura', code: 'AUD-997', scope: 'Alcance', criteria: 'Criterios', auditType: 'Interna', summary: null })
    storedFindings.push({ id: findingId, auditId, title: 'Hallazgo de lectura', status: 'OPEN' })
    storedCorrections.push({ id: correctionId, findingId, description: 'Corrección existente', status: 'OPEN', responsibleId: null, createdById: admin.id, observations: null })
    const agent = await loggedIn(db, companyUser.email)

    expect((await agent.get(`/api/audits/${auditId}/findings/${findingId}/corrections`)).status).toBe(200)
    expect((await agent.post(`/api/audits/${auditId}/findings/${findingId}/corrections`).send({ description: 'No debe escribir.' })).status).toBe(403)

    const invalid = await agent.get(`/api/audits/${auditId}/findings/${findingId}/corrections/not-an-id`)
    expect(invalid.status).toBe(404)

    const foreignDb = makeQualityDb('COMPANY_ADMIN', otherCompanyId)
    foreignDb.storedAudits.push({ id: 'cmauditforeigncorrection0001', processId, status: 'IN_PROGRESS', title: 'Auditoría ajena', code: 'AUD-998', scope: 'Alcance', criteria: 'Criterios', auditType: 'Interna', summary: null })
    foreignDb.storedFindings.push({ id: 'cmfindingforeigncorrection01', auditId: 'cmauditforeigncorrection0001', title: 'Hallazgo ajeno', status: 'OPEN' })
    const foreignAgent = await loggedIn(foreignDb.db, foreignAdmin.email)
    expect((await foreignAgent.get('/api/audits/cmauditforeigncorrection0001/findings/cmfindingforeigncorrection01/corrections')).status).toBe(404)

    const ownerDb = makeQualityDb()
    const ownerAgent = await loggedIn(ownerDb.db)
    const ownerAuditId = await createStartedAudit(ownerAgent)
    const ownerFinding = await createFinding(ownerAgent, ownerAuditId)
    const responsibleDenied = await ownerAgent.post(`/api/audits/${ownerAuditId}/findings/${ownerFinding.id}/corrections`).send({ description: 'Responsable ajeno.', responsibleId: foreignAdmin.id })
    expect(responsibleDenied.status).toBe(403)
  })

  it('rolls back correction creation and rechecks concurrent finding changes', async () => {
    const { db, storedCorrections, storedEvents, storedFindings } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)
    const eventCreate = (db as unknown as { auditEvent: { create: ReturnType<typeof vi.fn> } }).auditEvent.create
    eventCreate.mockRejectedValueOnce(new Error('event write failed'))

    const failed = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/corrections`).send({ description: 'Debe revertirse.' })
    expect(failed.status).toBe(500)
    expect(storedCorrections).toHaveLength(0)
    expect(storedEvents).toHaveLength(3)

    const transaction = (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction
    transaction.mockImplementationOnce(async (fn: (client: unknown) => Promise<unknown>) => {
      const current = storedFindings.find((item) => item.id === finding.id)
      if (current) current.status = 'VERIFIED'
      return fn(db)
    })
    const concurrent = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/corrections`).send({ description: 'Debe rechazarse por carrera.' })
    expect(concurrent.status).toBe(409)
    expect(concurrent.body.reason).toBe('FINDING_VERIFIED')
    expect(storedCorrections).toHaveLength(0)
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
    const { db, storedFindings, storedFindingActivityLinks } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const withAction = await createFinding(agent, auditId, { title: 'Con acciones' })
    const linked = await createFinding(agent, auditId, { title: 'Vinculado a actividad' })
    const free = await createFinding(agent, auditId, { title: 'Sin acciones' })

    await agent.post(`/api/audits/${auditId}/findings/${withAction.id}/actions`).send({
      title: 'Acción de prueba',
      description: 'Descripción.',
      required: false,
    })

    const blockedDelete = await agent.delete(`/api/audits/${auditId}/findings/${withAction.id}`)
    expect(blockedDelete.status).toBe(409)

    // El vínculo histórico también protege el hallazgo: nunca se borra la trazabilidad de ejecución.
    storedFindingActivityLinks.push({ id: 'activity-finding-link', findingId: linked.id, isActive: false })
    const blockedHistoricalLink = await agent.delete(`/api/audits/${auditId}/findings/${linked.id}`)
    expect(blockedHistoricalLink.status).toBe(409)
    expect(blockedHistoricalLink.body.reason).toBe('FINDING_LINKED_TO_ACTIVITY')

    const deleted = await agent.delete(`/api/audits/${auditId}/findings/${free.id}`)
    expect(deleted.status).toBe(204)
    expect(storedFindings).toHaveLength(2)
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
    await createFinding(agent, auditId, { processId, procedureId })
    storedAuditProcedures.splice(0, 1)
    const unlinkedProcedureFinding = await agent.post(`/api/audits/${auditId}/findings`).send({
      title: 'Procedimiento no vinculado',
      description: 'No debe aceptarse fuera de AuditProcedure.',
      type: 'OBSERVATION',
      severity: 'MINOR',
      procedureId,
    })
    expect(unlinkedProcedureFinding.status).toBe(404)
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
    const closed = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CANCELLED' })
    expect(closed.status, JSON.stringify(closed.body)).toBe(200)

    const rejected = await agent.post(`/api/audits/${auditId}/evidence-files`).attach('file', Buffer.from('%PDF-1.7\nvalid'), { filename: 'evidencia.pdf', contentType: 'application/pdf' })
    expect(rejected.status).toBe(409)
    expect(storedFiles).toHaveLength(0)
    await expect(readdir(evidenceDirectory())).rejects.toThrow()
  })

  it('does not delete a terminal audit without findings', async () => {
    const { db, storedAudits } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const closed = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CANCELLED' })
    expect(closed.status, JSON.stringify(closed.body)).toBe(200)

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

  it('preserves official evidence linked to an audit activity', async () => {
    const { db, storedEvidences, storedFiles, storedEvidenceActivityLinks, storedEvidenceFileActivityLinks } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)

    const evidenceResponse = await agent.post(`/api/audits/${auditId}/evidences`).send({
      name: 'Acta de entrevista',
      description: 'Registro asociado a la actividad ejecutada.',
      url: 'https://example.test/acta',
    })
    expect(evidenceResponse.status).toBe(201)
    const evidenceId = evidenceResponse.body.evidence.id as string
    storedEvidenceActivityLinks.push({ id: 'activity-evidence-link', evidenceId, isActive: false })

    const evidenceDelete = await agent.delete(`/api/audits/${auditId}/evidences/${evidenceId}`)
    expect(evidenceDelete.status).toBe(409)
    expect(evidenceDelete.body.reason).toBe('EVIDENCE_LINKED_TO_ACTIVITY')
    expect(storedEvidences.some((evidence) => evidence.id === evidenceId)).toBe(true)

    const fileResponse = await agent.post(`/api/audits/${auditId}/evidence-files`).attach('file', Buffer.from('%PDF-1.7\nlinked'), { filename: 'acta.pdf', contentType: 'application/pdf' })
    expect(fileResponse.status).toBe(201)
    const evidenceFileId = fileResponse.body.file.id as string
    storedEvidenceFileActivityLinks.push({ id: 'activity-evidence-file-link', evidenceFileId, isActive: true })

    const fileDelete = await agent.delete(`/api/audits/${auditId}/evidence-files/${evidenceFileId}`)
    expect(fileDelete.status).toBe(409)
    expect(fileDelete.body.reason).toBe('EVIDENCE_FILE_LINKED_TO_ACTIVITY')
    expect(storedFiles.some((file) => file.id === evidenceFileId)).toBe(true)
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

  it('supports a Five Whys draft and makes it immutable after confirmation', async () => {
    const { db, storedEvents } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)

    const created = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses`).send({
      methodology: 'FIVE_WHYS',
      problemDescription: 'El registro de la venta quedó incompleto.',
    })
    expect(created.status).toBe(201)
    expect(created.body.analysis).toMatchObject({ methodology: 'FIVE_WHYS', status: 'DRAFT', origin: 'MANUAL', causes: [], fiveWhySteps: [] })
    const analysisId = created.body.analysis.id as string

    const step = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/five-why-steps`).send({
      sequence: 1,
      question: '¿Por qué quedó incompleto?',
      answer: 'Porque no se revisó el formulario antes de cerrar la venta.',
    })
    expect(step.status).toBe(201)

    const cause = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/causes`).send({
      description: 'No existe una revisión independiente del formulario.',
    })
    expect(cause.status).toBe(201)
    const causeId = cause.body.cause.id as string
    const confirmedCause = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/causes/${causeId}/status`).send({ status: 'CONFIRMED' })
    expect(confirmedCause.status).toBe(200)

    const confirmed = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/status`).send({ status: 'CONFIRMED' })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.analysis.status).toBe('CONFIRMED')
    expect(storedEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'ROOT_CAUSE_ANALYSIS_CREATED',
      'ROOT_CAUSE_FIVE_WHY_STEP_CREATED',
      'ROOT_CAUSE_CREATED',
      'ROOT_CAUSE_STATUS_CHANGED',
      'ROOT_CAUSE_ANALYSIS_STATUS_CHANGED',
    ]))

    const edit = await agent.patch(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}`).send({ problemDescription: 'Cambio posterior.' })
    const newStep = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/five-why-steps`).send({ sequence: 2, question: '¿Por qué?', answer: 'No se configuró el control.' })
    expect(edit.status).toBe(409)
    expect(newStep.status).toBe(409)
  })

  it('requires Ishikawa categories and rejects duplicate Five Whys sequences', async () => {
    const { db } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)

    const ishikawa = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses`).send({ methodology: 'ISHIKAWA', problemDescription: 'Problema de calidad.' })
    expect(ishikawa.status).toBe(201)
    const missingCategory = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${ishikawa.body.analysis.id}/causes`).send({ description: 'Causa sin categoria.' })
    expect(missingCategory.status).toBe(400)

    const fiveWhys = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses`).send({ methodology: 'FIVE_WHYS', problemDescription: 'Segundo problema.' })
    const analysisId = fiveWhys.body.analysis.id as string
    const first = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/five-why-steps`).send({ sequence: 1, question: '¿Por qué?', answer: 'Por falta de revisión.' })
    expect(first.status).toBe(201)
    const duplicate = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/five-why-steps`).send({ sequence: 1, question: '¿Por qué otra vez?', answer: 'Porque el control no existe.' })
    expect(duplicate.status).toBe(409)
  })

  it('protects every root cause write for verified findings while preserving reads and transaction revalidation', async () => {
    const { db, storedEvents, storedFindings, storedRootCauseAnalyses, storedRootCauses, storedFiveWhySteps } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)
    const analysisResponse = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses`).send({ methodology: 'FIVE_WHYS', problemDescription: 'Problema verificado.' })
    expect(analysisResponse.status).toBe(201)
    const analysisId = analysisResponse.body.analysis.id as string
    const stepResponse = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/five-why-steps`).send({ sequence: 1, question: '¿Por qué?', answer: 'Porque faltó revisión.' })
    expect(stepResponse.status).toBe(201)
    const stepId = stepResponse.body.step.id as string
    const causeResponse = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/causes`).send({ description: 'Falta de revisión independiente.' })
    expect(causeResponse.status).toBe(201)
    const causeId = causeResponse.body.cause.id as string

    const findingRow = storedFindings.find((row) => row.id === finding.id)
    if (!findingRow) throw new Error('Finding fixture not found')
    findingRow.status = 'VERIFIED'
    const eventsBefore = storedEvents.length
    const analysesBefore = storedRootCauseAnalyses.length
    const causesBefore = storedRootCauses.length
    const stepsBefore = storedFiveWhySteps.length

    const readableTopLevel = await agent.get(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses`)
    const readableNested = await agent.get(`/api/processes/${processId}/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}`)
    expect(readableTopLevel.status).toBe(200)
    expect(readableNested.status).toBe(200)
    expect(readableNested.body.analysis.fiveWhySteps).toHaveLength(1)

    const writes = [
      agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses`).send({ methodology: 'MANUAL', problemDescription: 'No debe crearse.' }),
      agent.patch(`/api/processes/${processId}/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}`).send({ problemDescription: 'No debe editarse.' }),
      agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/status`).send({ status: 'CONFIRMED' }),
      agent.post(`/api/processes/${processId}/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/causes`).send({ description: 'No debe crearse.' }),
      agent.patch(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/causes/${causeId}`).send({ description: 'No debe editarse.' }),
      agent.post(`/api/processes/${processId}/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/causes/${causeId}/status`).send({ status: 'CONFIRMED' }),
      agent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/five-why-steps`).send({ sequence: 2, question: '¿Por qué?', answer: 'No debe crearse.' }),
      agent.patch(`/api/processes/${processId}/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/five-why-steps/${stepId}`).send({ sequence: 2 }),
      agent.delete(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${analysisId}/five-why-steps/${stepId}`),
    ]
    const results = await Promise.all(writes)
    for (const result of results) {
      expect(result.status).toBe(409)
      expect(result.body).toMatchObject({ reason: 'FINDING_VERIFIED' })
    }
    expect(storedEvents).toHaveLength(eventsBefore)
    expect(storedRootCauseAnalyses).toHaveLength(analysesBefore)
    expect(storedRootCauses).toHaveLength(causesBefore)
    expect(storedFiveWhySteps).toHaveLength(stepsBefore)

    const raceDb = makeQualityDb()
    const raceAgent = await loggedIn(raceDb.db)
    const raceAuditId = await createStartedAudit(raceAgent)
    const raceFinding = await createFinding(raceAgent, raceAuditId)
    const raceEventsBefore = raceDb.storedEvents.length
    const findingUnique = (raceDb.db as unknown as { auditFinding: { findUnique: ReturnType<typeof vi.fn> } }).auditFinding.findUnique
    findingUnique.mockImplementationOnce(async ({ where }: { where: { id: string } }) => {
      const row = raceDb.storedFindings.find((candidate) => candidate.id === where.id)
      if (row) row.status = 'VERIFIED'
      return row ? { id: row.id, title: row.title, status: row.status, auditId: row.auditId } : null
    })
    const raced = await raceAgent.post(`/api/audits/${raceAuditId}/findings/${raceFinding.id}/root-cause-analyses`).send({ methodology: 'MANUAL', problemDescription: 'Debe bloquearse dentro de la transacción.' })
    expect(raced.status).toBe(409)
    expect(raced.body).toMatchObject({ reason: 'FINDING_VERIFIED' })
    expect(raceDb.storedEvents).toHaveLength(raceEventsBefore)
    expect(raceDb.storedRootCauseAnalyses).toHaveLength(0)
  })

  it('keeps root cause writes admin-only and rolls back when history fails', async () => {
    const { db, storedRootCauseAnalyses, storedEvents } = makeQualityDb()
    const adminAgent = await loggedIn(db)
    const auditId = await createStartedAudit(adminAgent)
    const finding = await createFinding(adminAgent, auditId)
    const reader = makeQualityDb('COMPANY_USER')
    const readOnlyAgent = await loggedIn(reader.db)
    const readerAuditId = 'cmauditreadonly00000000001'
    const readerFindingId = 'cmfindingreadonly0000000001'
    reader.storedAudits.push({ id: readerAuditId, processId, status: 'IN_PROGRESS', title: 'Auditoría visible' })
    reader.storedFindings.push({ id: readerFindingId, auditId: readerAuditId, title: 'Hallazgo visible', status: 'OPEN' })

    const readable = await readOnlyAgent.get(`/api/audits/${readerAuditId}/findings/${readerFindingId}/root-cause-analyses`)
    const denied = await readOnlyAgent.post(`/api/audits/${readerAuditId}/findings/${readerFindingId}/root-cause-analyses`).send({ methodology: 'MANUAL', problemDescription: 'No debe escribir.' })
    expect(readable.status).toBe(200)
    expect(denied.status).toBe(403)

    const eventsBefore = storedEvents.length
    const eventCreate = (db as unknown as { auditEvent: { create: ReturnType<typeof vi.fn> } }).auditEvent.create
    eventCreate.mockRejectedValueOnce(new Error('history write failed'))
    const failed = await adminAgent.post(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses`).send({ methodology: 'MANUAL', problemDescription: 'Debe revertirse.' })
    expect(failed.status).toBe(500)
    expect(storedRootCauseAnalyses).toHaveLength(0)
    expect(storedEvents).toHaveLength(eventsBefore)
  })

  it('links confirmed causes to multiple actions, supports history and reuses the link on relink', async () => {
    const { db, storedActionCauseLinks, storedEvents } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)
    const firstAction = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/actions`).send({ title: 'Primera acción', description: 'Aplicar revisión independiente.' })
    const secondAction = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/actions`).send({ title: 'Segunda acción', description: 'Actualizar control operativo.' })
    const firstCause = await createConfirmedCause(agent, auditId, finding.id, 'Falta de revisión independiente.')
    const secondCause = await createConfirmedCause(agent, auditId, finding.id, 'El control no tiene responsable.')

    const linked = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/actions/${firstAction.body.action.id}/causes`).send({ causeIds: [firstCause.causeId, secondCause.causeId] })
    expect(linked.status).toBe(201)
    expect(linked.body.associations).toHaveLength(2)
    expect((await agent.get(`/api/audits/${auditId}/findings/${finding.id}/actions/${firstAction.body.action.id}/causes`)).body.associations).toHaveLength(2)
    expect((await agent.get(`/api/audits/${auditId}/findings/${finding.id}/eligible-root-causes`)).body.causes).toHaveLength(2)

    const inverse = await agent.get(`/api/audits/${auditId}/findings/${finding.id}/root-cause-analyses/${firstCause.analysisId}/causes/${firstCause.causeId}/actions`)
    expect(inverse.status).toBe(200)
    expect(inverse.body.associations).toHaveLength(1)

    const linkedToSecondAction = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/actions/${secondAction.body.action.id}/causes`).send({ causeIds: [firstCause.causeId] })
    expect(linkedToSecondAction.status, JSON.stringify(linkedToSecondAction.body)).toBe(201)
    const duplicate = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/actions/${firstAction.body.action.id}/causes`).send({ causeIds: [firstCause.causeId] })
    expect(duplicate.status).toBe(409)

    const unlinked = await agent.delete(`/api/audits/${auditId}/findings/${finding.id}/actions/${firstAction.body.action.id}/causes/${firstCause.causeId}`)
    expect(unlinked.status).toBe(200)
    expect(unlinked.body.association.isActive).toBe(false)
    const history = await agent.get(`/api/audits/${auditId}/findings/${finding.id}/actions/${firstAction.body.action.id}/causes?history=true`)
    expect(history.status).toBe(200)
    expect(history.body.associations).toHaveLength(2)
    expect(history.body.associations.find((item: { causeId: string }) => item.causeId === firstCause.causeId).isActive).toBe(false)

    const relinked = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/actions/${firstAction.body.action.id}/causes`).send({ causeIds: [firstCause.causeId] })
    expect(relinked.status).toBe(201)
    expect(relinked.body.associations[0].id).toBe(unlinked.body.association.id)
    expect(relinked.body.associations[0].isActive).toBe(true)
    expect(storedActionCauseLinks).toHaveLength(3)
    expect(storedEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining(['CORRECTIVE_ACTION_CAUSE_LINKED', 'CORRECTIVE_ACTION_CAUSE_UNLINKED']))

    const deletion = await agent.delete(`/api/audits/${auditId}/actions/${firstAction.body.action.id}`)
    expect(deletion.status).toBe(409)
  })

  it('rejects potential, discarded, cross-finding and terminal cause links', async () => {
    const { db } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const firstFinding = await createFinding(agent, auditId, { title: 'Primer hallazgo' })
    const secondFinding = await createFinding(agent, auditId, { title: 'Segundo hallazgo' })
    const action = await agent.post(`/api/audits/${auditId}/findings/${firstFinding.id}/actions`).send({ title: 'Acción de prueba', description: 'Validar la causa.' })

    const draft = await agent.post(`/api/audits/${auditId}/findings/${firstFinding.id}/root-cause-analyses`).send({ methodology: 'MANUAL', problemDescription: 'Análisis pendiente.' })
    const draftCause = await agent.post(`/api/audits/${auditId}/findings/${firstFinding.id}/root-cause-analyses/${draft.body.analysis.id}/causes`).send({ description: 'Causa pendiente.' })
    const potentialLink = await agent.post(`/api/audits/${auditId}/findings/${firstFinding.id}/actions/${action.body.action.id}/causes`).send({ causeIds: [draftCause.body.cause.id] })
    expect(potentialLink.status).toBe(409)

    const otherFindingCause = await createConfirmedCause(agent, auditId, secondFinding.id, 'Causa del segundo hallazgo.')
    const crossFindingLink = await agent.post(`/api/audits/${auditId}/findings/${firstFinding.id}/actions/${action.body.action.id}/causes`).send({ causeIds: [otherFindingCause.causeId] })
    expect(crossFindingLink.status).toBe(409)

    const discardedAnalysis = await agent.post(`/api/audits/${auditId}/findings/${firstFinding.id}/root-cause-analyses`).send({ methodology: 'MANUAL', problemDescription: 'Análisis descartado.' })
    const discardedCause = await agent.post(`/api/audits/${auditId}/findings/${firstFinding.id}/root-cause-analyses/${discardedAnalysis.body.analysis.id}/causes`).send({ description: 'Causa descartada.' })
    await agent.post(`/api/audits/${auditId}/findings/${firstFinding.id}/root-cause-analyses/${discardedAnalysis.body.analysis.id}/causes/${discardedCause.body.cause.id}/status`).send({ status: 'DISCARDED' })
    const discardedLink = await agent.post(`/api/audits/${auditId}/findings/${firstFinding.id}/actions/${action.body.action.id}/causes`).send({ causeIds: [discardedCause.body.cause.id] })
    expect(discardedLink.status).toBe(409)

    const closed = await agent.post(`/api/audits/${auditId}/status`).send({ status: 'CANCELLED' })
    expect(closed.status, JSON.stringify(closed.body)).toBe(200)
    const terminalLink = await agent.post(`/api/audits/${auditId}/findings/${firstFinding.id}/actions/${action.body.action.id}/causes`).send({ causeIds: [otherFindingCause.causeId] })
    expect(terminalLink.status).toBe(409)
  })

  it('plans efficacy only for completed actions and snapshots EFFECTIVENESS criteria', async () => {
    const { db, storedActions, storedAcceptanceCriteria, storedEfficacyEvaluations, storedEfficacyCriterionResults, storedEvents } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId, { type: 'NONCONFORMITY', severity: 'MAJOR' })
    const open = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/actions`).send({ title: 'Acción pendiente', description: 'Todavía no está completada.', responsibleId: admin.id })
    const openActionId = open.body.action.id as string
    const eventsBefore = storedEvents.length
    const notCompleted = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/efficacy-evaluations`).send({ actionId: openActionId, responsibleId: admin.id, methodology: 'RECORD_REVIEW', scope: 'Muestra posterior.' })
    expect(notCompleted.status).toBe(409)
    expect(notCompleted.body.reason).toBe('ACTION_NOT_COMPLETED')
    expect(storedEfficacyEvaluations).toHaveLength(0)
    expect(storedEvents).toHaveLength(eventsBefore)

    const secondFinding = await createFinding(agent, auditId, { title: 'Otro hallazgo' })
    const unrelatedAction = await agent.post(`/api/audits/${auditId}/findings/${secondFinding.id}/actions`).send({ title: 'Acción no relacionada', description: 'Pertenece a otro hallazgo.', responsibleId: admin.id })
    const invalidRelation = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/efficacy-evaluations`).send({ actionId: unrelatedAction.body.action.id, responsibleId: admin.id, methodology: 'RECORD_REVIEW', scope: 'Muestra posterior.' })
    expect(invalidRelation.status).toBe(404)
    expect(storedEvents).toHaveLength(eventsBefore + 2)

    const { actionId, effectivenessCriterionId } = await createCompletedAction(agent, auditId, finding.id)
    const evaluation = await createEfficacyEvaluation(agent, auditId, finding.id, actionId)
    expect(evaluation.criteria).toHaveLength(1)
    expect(evaluation.criteria[0]).toMatchObject({ criterionId: effectivenessCriterionId, description: 'La recurrencia disminuye', expectedResult: 'No se repite el hallazgo en la muestra observada.', required: true, isMet: null })
    expect(storedEfficacyCriterionResults).toHaveLength(1)
    expect(storedAcceptanceCriteria.filter((criterion) => criterion.actionId === actionId && criterion.type === 'EFFECTIVENESS')).toHaveLength(1)
    expect(storedActions.find((action) => action.id === actionId)).toMatchObject({ status: 'COMPLETED' })
    expect(storedEvents.at(-1)).toMatchObject({ eventType: 'EFFICACY_EVALUATION_CREATED' })
  })

  it('starts efficacy, records progress and results, and links coherent URL/PDF evidence', async () => {
    const { db, storedEfficacyProgress, storedEfficacyCriterionResults, storedEfficacyEvidenceLinks, storedEfficacyEvidenceFileLinks, storedEvidences, storedFiles, storedEvents } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)
    const { actionId } = await createCompletedAction(agent, auditId, finding.id)
    const evaluation = await createEfficacyEvaluation(agent, auditId, finding.id, actionId)

    const started = await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/status`).send({ status: 'IN_PROGRESS' })
    expect(started.status).toBe(200)
    expect(started.body.evaluation).toMatchObject({ status: 'IN_PROGRESS', startedAt: expect.anything() })
    const progress = await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/progress`).send({ note: 'Se revisó la muestra posterior.', results: 'Sin recurrencia observable.', percent: 60 })
    expect(progress.status).toBe(201)
    expect(progress.body.progress).toMatchObject({ note: 'Se revisó la muestra posterior.', percent: 60 })
    const result = await agent.patch(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/criteria/${evaluation.criteria[0].id}`).send({ resultObtained: 'No hubo recurrencia.', measuredValue: '0', measurementUnit: 'casos', sampleSize: 20, isMet: true })
    expect(result.status).toBe(200)
    expect(result.body.criterion).toMatchObject({ isMet: true, resultObtained: 'No hubo recurrencia.', measuredValue: '0' })
    expect(storedEfficacyProgress).toHaveLength(1)
    expect(storedEfficacyCriterionResults[0]).toMatchObject({ isMet: true, evaluatedById: admin.id })

    const urlEvidence = await agent.post(`/api/audits/${auditId}/evidences`).send({ name: 'Informe de seguimiento', description: 'Informe oficial posterior a la acción.', url: 'https://example.test/seguimiento', findingId: finding.id })
    expect(urlEvidence.status).toBe(201)
    const urlLink = await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/evidences`).send({ evidenceId: urlEvidence.body.evidence.id })
    expect(urlLink.status).toBe(201)
    expect(storedEfficacyEvidenceLinks).toHaveLength(1)

    const foreignAnchor = await createFinding(agent, auditId, { title: 'Hallazgo fuera de la evaluación' })
    const incoherentEvidence = await agent.post(`/api/audits/${auditId}/evidences`).send({ name: 'Evidencia incoherente', description: 'Está anclada a otro hallazgo.', url: 'https://example.test/otra', findingId: foreignAnchor.id })
    const eventsBeforeRejectedLink = storedEvents.length
    const rejectedLink = await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/evidences`).send({ evidenceId: incoherentEvidence.body.evidence.id })
    expect(rejectedLink.status).toBe(409)
    expect(rejectedLink.body.reason).toBe('EVIDENCE_SCOPE_MISMATCH')
    expect(storedEfficacyEvidenceLinks).toHaveLength(1)
    expect(storedEvents).toHaveLength(eventsBeforeRejectedLink)

    const pdf = await agent.post(`/api/audits/${auditId}/evidence-files`).attach('file', Buffer.from('%PDF-1.7\nefficacy'), { filename: 'seguimiento.pdf', contentType: 'application/pdf' })
    expect(pdf.status).toBe(201)
    expect(pdf.body.file).toMatchObject({ findingId: null, actionId: null, storageState: 'READY' })
     const pdfLink = await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/evidence-files`).send({ evidenceFileId: pdf.body.file.id })
     expect(pdfLink.status).toBe(201)
     expect(storedEfficacyEvidenceFileLinks).toHaveLength(1)
     const protectedPdfDelete = await agent.delete(`/api/audits/${auditId}/evidence-files/${pdf.body.file.id}`)
     expect(protectedPdfDelete.status).toBe(409)
     expect(protectedPdfDelete.body.reason).toBe('EVIDENCE_FILE_LINKED_TO_EFFICACY_EVALUATION')
     expect(storedEvidences).toHaveLength(2)
    expect(storedFiles).toHaveLength(1)
  })

  it('enforces effective, partial and ineffective completion requirements and treatment rules', async () => {
    const { db, storedEfficacyEvaluations, storedEfficacyEvidenceLinks } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)
     const { actionId } = await createCompletedAction(agent, auditId, finding.id)
     const effective = await createEfficacyEvaluation(agent, auditId, finding.id, actionId)
     await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${effective.id}/status`).send({ status: 'IN_PROGRESS' })
     await agent.patch(`/api/audits/${auditId}/efficacy-evaluations/${effective.id}/criteria/${effective.criteria[0].id}`).send({ resultObtained: 'Se mantiene el control.', isMet: false })
     await agent.patch(`/api/audits/${auditId}/efficacy-evaluations/${effective.id}/criteria/${effective.criteria[0].id}`).send({ isMet: true })
     const missingEvidence = await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${effective.id}/status`).send({ status: 'COMPLETED', outcome: 'EFFECTIVE', conclusion: 'El control fue eficaz.' })
     expect(missingEvidence.status).toBe(409)
     expect(missingEvidence.body.error).toContain('objective')
     await agent.patch(`/api/audits/${auditId}/efficacy-evaluations/${effective.id}/criteria/${effective.criteria[0].id}`).send({ isMet: false })
     const evidence = await agent.post(`/api/audits/${auditId}/evidences`).send({ name: 'Seguimiento eficaz', description: 'URL objetiva.', url: 'https://example.test/eficacia', findingId: finding.id })
     await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${effective.id}/evidences`).send({ evidenceId: evidence.body.evidence.id })
     const unmet = await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${effective.id}/status`).send({ status: 'COMPLETED', outcome: 'EFFECTIVE', conclusion: 'La acción no fue suficiente.' })
     expect(unmet.status).toBe(409)
     expect(unmet.body.reason).toBe('EFFICACY_COMPLETION_REQUIREMENTS')
     await agent.patch(`/api/audits/${auditId}/efficacy-evaluations/${effective.id}/criteria/${effective.criteria[0].id}`).send({ isMet: true })
     const completed = await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${effective.id}/status`).send({ status: 'COMPLETED', outcome: 'EFFECTIVE', conclusion: 'El control fue eficaz.' })
     expect(completed.status).toBe(200)
     expect(completed.body.evaluation).toMatchObject({ status: 'COMPLETED', outcome: 'EFFECTIVE' })
     expect(storedEfficacyEvidenceLinks).toHaveLength(1)
     const protectedUpdate = await agent.patch(`/api/audits/${auditId}/evidences/${evidence.body.evidence.id}`).send({ name: 'No debe cambiar' })
     const protectedDelete = await agent.delete(`/api/audits/${auditId}/evidences/${evidence.body.evidence.id}`)
     expect(protectedUpdate.status).toBe(409)
     expect(protectedUpdate.body.reason).toBe('EVIDENCE_LINKED_TO_EFFICACY_EVALUATION')
     expect(protectedDelete.status).toBe(409)
     expect(protectedDelete.body.reason).toBe('EVIDENCE_LINKED_TO_EFFICACY_EVALUATION')

    for (const outcome of ['PARTIALLY_EFFECTIVE', 'INEFFECTIVE'] as const) {
      const next = await createEfficacyEvaluation(agent, auditId, finding.id, actionId)
      await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${next.id}/status`).send({ status: 'IN_PROGRESS' })
      await agent.patch(`/api/audits/${auditId}/efficacy-evaluations/${next.id}/criteria/${next.criteria[0].id}`).send({ resultObtained: 'Resultado medido.', isMet: outcome === 'PARTIALLY_EFFECTIVE' })
      const nextEvidence = await agent.post(`/api/audits/${auditId}/evidences`).send({ name: `Evidencia ${outcome}`, description: 'URL objetiva.', url: `https://example.test/${outcome.toLowerCase()}`, findingId: finding.id })
      await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${next.id}/evidences`).send({ evidenceId: nextEvidence.body.evidence.id })
      const missingTreatment = await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${next.id}/status`).send({ status: 'COMPLETED', outcome, conclusion: 'Se requiere seguimiento adicional.' })
      expect(missingTreatment.status).toBe(409)
      expect(missingTreatment.body.reason).toBe('EFFICACY_COMPLETION_REQUIREMENTS')
       const treatment = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/actions`).send({ title: `Tratamiento ${outcome}`, description: 'Tratamiento adicional derivado del resultado.', responsibleId: admin.id, efficacyEvaluationId: next.id })
       expect(treatment.status).toBe(201)
      const treated = await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${next.id}/status`).send({ status: 'COMPLETED', outcome, conclusion: 'Se requiere seguimiento adicional.' })
      expect(treated.status).toBe(200)
      expect(storedEfficacyEvaluations.find((evaluation) => evaluation.id === next.id)).toMatchObject({ outcome, status: 'COMPLETED' })
    }
  })

  it('blocks premature and recurring effective conclusions', async () => {
    const { db, storedEfficacyEvaluations } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)
    const { actionId } = await createCompletedAction(agent, auditId, finding.id)
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const planned = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/efficacy-evaluations`).send({ actionId, responsibleId: admin.id, methodology: 'RECORD_REVIEW', observationEndDate: tomorrow, scope: 'Periodo futuro.' })
    expect(planned.status).toBe(201)
    const evaluation = planned.body.evaluation
    await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/status`).send({ status: 'IN_PROGRESS' })
    await agent.patch(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/criteria/${evaluation.criteria[0].id}`).send({ resultObtained: 'Resultado estable.', isMet: true })
    const evidence = await agent.post(`/api/audits/${auditId}/evidences`).send({ name: 'Evidencia de periodo', description: 'Seguimiento objetivo.', url: 'https://example.test/periodo', findingId: finding.id })
    await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/evidences`).send({ evidenceId: evidence.body.evidence.id })
    const premature = await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/status`).send({ status: 'COMPLETED', outcome: 'EFFECTIVE', conclusion: 'Conclusión prematura.' })
    expect(premature.status).toBe(409)
    expect(premature.body.error).toContain('observation period')
    storedEfficacyEvaluations.find((item) => item.id === evaluation.id)!.observationEndDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const recurring = await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/status`).send({ status: 'COMPLETED', outcome: 'EFFECTIVE', conclusion: 'Se detectó recurrencia.', recurrenceDetected: true, recurrenceDescription: 'El hallazgo reapareció en la muestra.' })
    expect(recurring.status).toBe(409)
    expect(recurring.body.error).toContain('recurring issue')
  })

  it('records cancellation justification and keeps terminal efficacy evaluations immutable', async () => {
    const { db, storedEvents, storedEfficacyEvaluations } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId)
    const { actionId } = await createCompletedAction(agent, auditId, finding.id)
    const evaluation = await createEfficacyEvaluation(agent, auditId, finding.id, actionId)
    const beforeInvalidCancel = storedEvents.length
    const missingJustification = await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/status`).send({ status: 'CANCELLED' })
    expect(missingJustification.status).toBe(400)
    expect(storedEvents).toHaveLength(beforeInvalidCancel)
    const cancelled = await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/status`).send({ status: 'CANCELLED', justification: 'La muestra dejó de estar disponible.' })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.evaluation).toMatchObject({ status: 'CANCELLED' })
    expect(cancelled.body.evaluation.observations).toContain('La muestra dejó de estar disponible.')
    const eventsAfterCancel = storedEvents.length
    const terminalWrites = await Promise.all([
      agent.patch(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}`).send({ scope: 'No debe editarse.' }),
      agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/status`).send({ status: 'CANCELLED', justification: 'Otra justificación.' }),
      agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/progress`).send({ note: 'No debe registrarse.' }),
    ])
    expect(terminalWrites.map((response) => response.status)).toEqual([409, 409, 409])
    expect(storedEvents).toHaveLength(eventsAfterCancel)
    expect(storedEfficacyEvaluations[0]).toMatchObject({ status: 'CANCELLED' })
  })

  it('uses the legacy gate only without a structured workflow and requires efficacy before verification', async () => {
    const { db, storedEvents, storedFindings } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId, { type: 'NONCONFORMITY', severity: 'MAJOR' })
    const { actionId } = await createCompletedAction(agent, auditId, finding.id)
    const evaluation = await createEfficacyEvaluation(agent, auditId, finding.id, actionId)
    const beforeLegacyWrite = storedEvents.length
    const legacyWrite = await agent.patch(`/api/audits/${auditId}/findings/${finding.id}`).send({ efficacyVerification: 'Texto legacy no permitido.' })
    expect(legacyWrite.status).toBe(409)
    expect(legacyWrite.body.reason).toBe('STRUCTURED_EFFICACY_REQUIRED')
    expect(storedEvents).toHaveLength(beforeLegacyWrite)
    storedFindings.find((row) => row.id === finding.id)!.efficacyVerification = 'Compatibilidad legacy previa.'
    expect((await agent.post(`/api/audits/${auditId}/findings/${finding.id}/status`).send({ status: 'RESOLVED', resolution: 'La acción fue implementada.' })).status).toBe(200)
    const blockedVerification = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/status`).send({ status: 'VERIFIED' })
    expect(blockedVerification.status).toBe(409)
    expect(blockedVerification.body.reason).toBe('EFFICACY_EVALUATION_PENDING')
    expect(storedEvents.at(-1)).toMatchObject({ eventType: 'FINDING_STATUS_CHANGED' })
    await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/status`).send({ status: 'IN_PROGRESS' })
    await agent.patch(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/criteria/${evaluation.criteria[0].id}`).send({ resultObtained: 'No recurrencia.', isMet: true })
    const evidence = await agent.post(`/api/audits/${auditId}/evidences`).send({ name: 'Evidencia final', description: 'Resultado del seguimiento.', url: 'https://example.test/final', findingId: finding.id })
    await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/evidences`).send({ evidenceId: evidence.body.evidence.id })
    expect((await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluation.id}/status`).send({ status: 'COMPLETED', outcome: 'EFFECTIVE', conclusion: 'La acción fue eficaz.' })).status).toBe(200)
    const verified = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/status`).send({ status: 'VERIFIED' })
    expect(verified.status).toBe(200)
    expect(verified.body.finding).toMatchObject({ status: 'VERIFIED' })
  })

  it('uses the latest completed evaluation across multiple evaluations and actions', async () => {
    const { db, storedActions, storedEfficacyEvaluations } = makeQualityDb()
    const agent = await loggedIn(db)
    const auditId = await createStartedAudit(agent)
    const finding = await createFinding(agent, auditId, { type: 'NONCONFORMITY', severity: 'MAJOR' })
    const { actionId } = await createCompletedAction(agent, auditId, finding.id)
    const first = await createEfficacyEvaluation(agent, auditId, finding.id, actionId)
    await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${first.id}/status`).send({ status: 'IN_PROGRESS' })
    await agent.patch(`/api/audits/${auditId}/efficacy-evaluations/${first.id}/criteria/${first.criteria[0].id}`).send({ resultObtained: 'Sin recurrencia.', isMet: true })
    const firstEvidence = await agent.post(`/api/audits/${auditId}/evidences`).send({ name: 'Primera evaluación', description: 'Resultado eficaz.', url: 'https://example.test/primera', findingId: finding.id })
    await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${first.id}/evidences`).send({ evidenceId: firstEvidence.body.evidence.id })
    expect((await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${first.id}/status`).send({ status: 'COMPLETED', outcome: 'EFFECTIVE', conclusion: 'La primera evaluación fue eficaz.' })).status).toBe(200)

    const second = await createEfficacyEvaluation(agent, auditId, finding.id, actionId)
    await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${second.id}/status`).send({ status: 'IN_PROGRESS' })
    await agent.patch(`/api/audits/${auditId}/efficacy-evaluations/${second.id}/criteria/${second.criteria[0].id}`).send({ resultObtained: 'Se repite en la nueva muestra.', isMet: false })
    const secondEvidence = await agent.post(`/api/audits/${auditId}/evidences`).send({ name: 'Segunda evaluación', description: 'Resultado desfavorable.', url: 'https://example.test/segunda', findingId: finding.id })
    await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${second.id}/evidences`).send({ evidenceId: secondEvidence.body.evidence.id })
    const treatment = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/actions`).send({ title: 'Tratamiento posterior', description: 'Corregir la recurrencia observada.', responsibleId: admin.id, efficacyEvaluationId: second.id })
    expect(treatment.status).toBe(201)
    expect((await agent.post(`/api/audits/${auditId}/efficacy-evaluations/${second.id}/status`).send({ status: 'COMPLETED', outcome: 'INEFFECTIVE', conclusion: 'La segunda evaluación exige nuevo tratamiento.' })).status).toBe(200)

    storedActions.find((row) => row.id === treatment.body.action.id)!.status = 'COMPLETED'
    const resolved = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/status`).send({ status: 'RESOLVED', resolution: 'Se implementó el tratamiento posterior.' })
    expect(resolved.status).toBe(200)
    expect(storedEfficacyEvaluations.map((evaluation) => evaluation.outcome)).toEqual(['EFFECTIVE', 'INEFFECTIVE'])
    expect(storedActions.filter((action) => action.findingId === finding.id && action.efficacyEvaluationId === null).map((action) => ({ status: action.status, workflowVersion: action.workflowVersion }))).toEqual([{ status: 'COMPLETED', workflowVersion: 1 }])
    const blocked = await agent.post(`/api/audits/${auditId}/findings/${finding.id}/status`).send({ status: 'VERIFIED' })
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(409)
    expect(blocked.body.reason).toBe('EFFICACY_NOT_SATISFACTORY')
  })

  it('keeps efficacy reads tenant-scoped and writes admin-only, without events on rejection', async () => {
    const reader = makeQualityDb('COMPANY_USER')
    const auditId = 'cmauditefficacyreadonly0001'
    const findingId = 'cmfindingefficacyreadonly01'
    const actionId = 'cmactionefficacyreadonly01'
    const evaluationId = 'cmevaluationreadonly000001'
    reader.storedAudits.push({ id: auditId, processId, status: 'IN_PROGRESS', title: 'Auditoría de lectura', code: 'AUD-READ', scope: 'Alcance', criteria: 'Criterios', auditType: 'Interna', summary: null })
    reader.storedFindings.push({ id: findingId, auditId, title: 'Hallazgo visible', status: 'OPEN' })
    reader.storedActions.push({ id: actionId, findingId, title: 'Acción visible', status: 'COMPLETED', workflowVersion: 1 })
    reader.storedEfficacyEvaluations.push({ id: evaluationId, auditId, findingId, actionId, status: 'PLANNED', outcome: 'PENDING', responsibleId: admin.id, createdById: admin.id, scope: 'Lectura' })
    const readerAgent = await loggedIn(reader.db, companyUser.email)
    expect((await readerAgent.get(`/api/audits/${auditId}/findings/${findingId}/efficacy-evaluations`)).status).toBe(200)
    const eventsBefore = reader.storedEvents.length
    const forbidden = await readerAgent.post(`/api/audits/${auditId}/efficacy-evaluations/${evaluationId}/status`).send({ status: 'IN_PROGRESS' })
    expect(forbidden.status).toBe(403)
    expect(reader.storedEvents).toHaveLength(eventsBefore)

    const foreign = makeQualityDb('COMPANY_ADMIN', otherCompanyId)
    foreign.storedAudits.push({ id: 'cmauditefficacyforeign0001', processId, status: 'IN_PROGRESS', title: 'Auditoría ajena', code: 'AUD-FOR', scope: 'Alcance', criteria: 'Criterios', auditType: 'Interna', summary: null })
    foreign.storedFindings.push({ id: 'cmfindingefficacyforeign01', auditId: 'cmauditefficacyforeign0001', title: 'Hallazgo ajeno', status: 'OPEN' })
    foreign.storedActions.push({ id: 'cmactionefficacyforeign01', findingId: 'cmfindingefficacyforeign01', title: 'Acción ajena', status: 'COMPLETED', workflowVersion: 1 })
    foreign.storedEfficacyEvaluations.push({ id: 'cmevaluationforeign000001', auditId: 'cmauditefficacyforeign0001', findingId: 'cmfindingefficacyforeign01', actionId: 'cmactionefficacyforeign01', status: 'PLANNED', outcome: 'PENDING', responsibleId: foreignAdmin.id, createdById: foreignAdmin.id, scope: 'Ajena' })
    const foreignAgent = await loggedIn(foreign.db, foreignAdmin.email)
    const foreignRead = await foreignAgent.get('/api/audits/cmauditefficacyforeign0001/findings/cmfindingefficacyforeign01/efficacy-evaluations')
    expect(foreignRead.status).toBe(404)
  })

  it('keeps Checky proposals separate until explicit acceptance', async () => {
    const { db, storedAudits, storedFindings, storedRootCauseAnalyses, storedEvents, storedAuditCheckySuggestions } = makeQualityDb()
    const auditId = 'cmauditcheckysuggestion0001'
    const findingId = 'cmfindingcheckysuggestion01'
    storedAudits.push({ id: auditId, processId, status: 'IN_PROGRESS', title: 'Auditoría de Checky', code: 'AUD-CHECKY', scope: 'Alcance', objectives: null, criteria: 'Criterios', auditType: 'Interna', summary: null })
    storedFindings.push({ id: findingId, auditId, title: 'Hallazgo documentado', description: 'Falta consistencia en el registro.', type: 'NONCONFORMITY', severity: 'MAJOR', status: 'OPEN' })
    const aiService = { suggestAuditFindingFollowUp: vi.fn(async () => ({ suggestions: [{ kind: 'ROOT_CAUSE_ANALYSIS', payload: { kind: 'ROOT_CAUSE_ANALYSIS', methodology: 'FIVE_WHYS', problemDescription: 'Investigar la falta de consistencia.', responsibleId: null }, evidenceIds: [] }], missingInformation: [] })) } as unknown as AIService
    const agent = request.agent(createApp(db, aiService, createLocalEvidenceStorage()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const generated = await agent.post(`/api/audits/${auditId}/findings/${findingId}/checky/suggestions`).send({ kinds: ['ROOT_CAUSE_ANALYSIS'] })
    expect(generated.status).toBe(201)
    expect(generated.body.suggestions[0]).toMatchObject({ status: 'PENDING', kind: 'ROOT_CAUSE_ANALYSIS' })
    expect(storedRootCauseAnalyses).toHaveLength(0)
    const suggestionId = generated.body.suggestions[0].id as string

    const edited = await agent.patch(`/api/audit-checky-suggestions/${suggestionId}`).send({ editablePayload: { kind: 'ROOT_CAUSE_ANALYSIS', methodology: 'FIVE_WHYS', problemDescription: 'Investigar la falta de consistencia con el equipo.', responsibleId: null } })
    expect(edited.status).toBe(200)
    expect(edited.body.suggestion.editablePayload.problemDescription).toContain('con el equipo')
    expect(edited.body.suggestion.originalPayload.problemDescription).toBe('Investigar la falta de consistencia.')

    const accepted = await agent.post(`/api/audit-checky-suggestions/${suggestionId}/accept`).send({})
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201)
    expect(accepted.body.analysis).toMatchObject({ status: 'DRAFT', origin: 'CHECKY' })
    expect(storedRootCauseAnalyses).toHaveLength(1)
    expect(storedAuditCheckySuggestions[0]).toMatchObject({ status: 'ACCEPTED', acceptedAnalysisId: storedRootCauseAnalyses[0].id })
    expect(storedEvents.some((event) => event.eventType === 'CHECKY_SUGGESTION_CREATED')).toBe(true)
    expect(storedEvents.some((event) => event.eventType === 'CHECKY_SUGGESTION_ACCEPTED')).toBe(true)
    expect((await agent.post(`/api/audit-checky-suggestions/${suggestionId}/accept`).send({})).status).toBe(409)
  })

  it('accepts a Checky corrective action with criteria and confirmed cause links', async () => {
    const { db, storedAudits, storedFindings, storedRootCauseAnalyses, storedRootCauses, storedActions, storedAcceptanceCriteria, storedActionCauseLinks, storedAuditCheckySuggestions, storedEfficacyEvaluations } = makeQualityDb()
    const auditId = 'cmauditcheckyaction00001'
    const findingId = 'cmfindingcheckyaction0001'
    const analysisId = 'cmanalysischeckyaction01'
    const causeId = 'cmrootcausecheckyaction01'
    storedAudits.push({ id: auditId, processId, status: 'IN_PROGRESS', title: 'Auditoría de acciones Checky', code: 'AUD-CHECKY-ACTION', scope: 'Alcance', objectives: null, criteria: 'Criterios', auditType: 'Interna', summary: null })
    storedFindings.push({ id: findingId, auditId, title: 'Hallazgo accionable', description: 'Falta un control documentado.', type: 'NONCONFORMITY', severity: 'MAJOR', status: 'OPEN' })
    storedRootCauseAnalyses.push({ id: analysisId, findingId, methodology: 'FIVE_WHYS', status: 'CONFIRMED', origin: 'MANUAL', problemDescription: 'El control no está formalizado.', responsibleId: null, createdById: admin.id })
    storedRootCauses.push({ id: causeId, analysisId, findingId, status: 'CONFIRMED', description: 'No existe una revisión periódica documentada.', justification: null, supportingEvidence: null, position: 0, createdById: admin.id })
    const aiService = { suggestAuditFindingFollowUp: vi.fn(async () => ({ suggestions: [{ kind: 'CORRECTIVE_ACTION', payload: { kind: 'CORRECTIVE_ACTION', title: 'Formalizar revisión periódica', description: 'Crear y aprobar el control de revisión.', objective: 'Evitar la recurrencia del hallazgo.', implementationPlan: 'Diseñar, aprobar y comunicar el control.', resources: null, observations: null, responsibleId: null, priority: 'HIGH', required: true, evidenceRequired: false, dueDate: null, acceptanceCriteria: [{ type: 'IMPLEMENTATION', description: 'El control queda aprobado.', expectedResult: 'Existe una versión vigente aprobada.', required: true }, { type: 'EFFECTIVENESS', description: 'El control se ejecuta durante el periodo observado.', expectedResult: 'No se repite el hallazgo durante 30 días.', required: true }], causeIds: [causeId], methodology: 'RECORD_REVIEW', observationPeriod: '30 días' }, evidenceIds: [] }], missingInformation: [] })) } as unknown as AIService
    const agent = request.agent(createApp(db, aiService, createLocalEvidenceStorage()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const generated = await agent.post(`/api/audits/${auditId}/findings/${findingId}/checky/suggestions`).send({ kinds: ['CORRECTIVE_ACTION'] })
    expect(generated.status).toBe(201)
    const suggestionId = generated.body.suggestions[0].id as string
    expect(generated.body.suggestions[0].editablePayload).toMatchObject({ methodology: 'RECORD_REVIEW', observationPeriod: '30 días' })

    const accepted = await agent.post(`/api/audit-checky-suggestions/${suggestionId}/accept`).send({})
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201)
    expect(accepted.body.action).toMatchObject({ workflowVersion: 1, status: 'OPEN' })
    expect(storedActions[0]).toMatchObject({ workflowVersion: 1 })
    expect(storedAcceptanceCriteria).toHaveLength(2)
    expect(storedAcceptanceCriteria.map((criterion) => criterion.type)).toEqual(['IMPLEMENTATION', 'EFFECTIVENESS'])
    expect(storedActionCauseLinks).toHaveLength(1)
    expect(storedActionCauseLinks[0]).toMatchObject({ causeId, isActive: true })
    expect(storedAuditCheckySuggestions[0]).toMatchObject({ status: 'ACCEPTED', acceptedActionId: storedActions[0].id })
    expect(storedEfficacyEvaluations).toHaveLength(0)
  })
})
