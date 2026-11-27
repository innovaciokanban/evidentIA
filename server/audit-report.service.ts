import { createHash } from 'node:crypto'
import type { Express, Request, RequestHandler } from 'express'
import { AuditReportStatus, AuditFollowUpStatus, AuditEventType, Prisma, PrismaClient, Role } from '@prisma/client'
import { z } from 'zod'
import { createEvidenceStorage, createLocalEvidenceStorage, type EvidenceStorage } from './evidence-provider.js'
import { isEvidenceObjectKeyFor, nextEvidenceObjectKey } from './evidence-keys.js'
import { sanitizeUploadFilename } from './multipart.js'
import { auditReportSnapshotSchema, type AuditReportSnapshot } from './audit-report-contract.js'
import { generateAuditReportPdf } from './audit-report-pdf.js'
import { followUpHasPendingWork } from './audit-follow-up.policy.js'

type AuditClient = PrismaClient | Prisma.TransactionClient
type AuditActor = { id: string; name: string; email: string }

const asyncHandler = (handler: RequestHandler): RequestHandler => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)

const reportDraftUpdateSchema = z.object({
  executiveSummary: z.string().max(20000),
  conclusions: z.string().max(20000),
  recommendations: z.string().max(20000),
}).strict()

const returnToDraftSchema = z.object({ justification: z.string().trim().min(3).max(5000) }).strict()
const followUpSchema = z.object({ scope: z.string().trim().min(3).max(10000), responsibleId: z.string().min(1) }).strict()
const followUpCompleteSchema = z.object({ notes: z.string().trim().min(3).max(10000).optional() }).strict()

const reportSourceInclude = {
  process: { select: { id: true, code: true, name: true } },
  leadAuditor: { select: { id: true, name: true, isActive: true } },
  responsible: { select: { id: true, name: true, isActive: true } },
  teamMembers: {
    orderBy: { assignedAt: 'asc' as const },
    include: { auditor: { select: { id: true, name: true } } },
  },
  relatedProcesses: { include: { process: { select: { id: true, code: true, name: true } } } },
  procedures: { include: { procedure: { select: { id: true, code: true, name: true } } } },
  plan: {
    include: {
      activities: { orderBy: [{ position: 'asc' as const }, { scheduledStart: 'asc' as const }] },
    },
  },
  checklists: {
    orderBy: { createdAt: 'asc' as const },
    include: { items: { orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }] } },
  },
  findings: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      responsible: { select: { id: true, name: true, isActive: true } },
      item: { select: { id: true, description: true } },
      process: { select: { id: true, code: true, name: true } },
      procedure: { select: { id: true, code: true, name: true } },
      evidences: { orderBy: { createdAt: 'asc' as const } },
      evidenceFiles: { select: { id: true, filename: true, storageState: true, size: true, reportVersion: { select: { id: true } } }, orderBy: { createdAt: 'asc' as const } },
      actions: {
        orderBy: { createdAt: 'asc' as const },
        include: {
          responsible: { select: { id: true, name: true, isActive: true } },
          progress: { orderBy: { createdAt: 'asc' as const }, select: { note: true, percent: true, createdAt: true } },
        },
      },
      efficacyEvaluations: {
        orderBy: { createdAt: 'asc' as const },
        include: { responsible: { select: { id: true, name: true, isActive: true } } },
      },
    },
  },
  evidences: { orderBy: { createdAt: 'asc' as const } },
  evidenceFiles: { orderBy: { createdAt: 'asc' as const }, select: { id: true, filename: true, storageState: true, size: true, reportVersion: { select: { id: true } } } },
} satisfies Prisma.AuditInclude

type ReportSource = Prisma.AuditGetPayload<{ include: typeof reportSourceInclude }>

const reportInclude = {
  versions: {
    orderBy: { version: 'desc' as const },
    include: {
      approvedBy: { select: { id: true, name: true, email: true } },
      pdfEvidenceFile: { select: { id: true, filename: true, storageState: true, size: true, createdAt: true } },
    },
  },
  approvedVersion: {
    include: {
      approvedBy: { select: { id: true, name: true, email: true } },
      pdfEvidenceFile: { select: { id: true, filename: true, storageState: true, size: true, createdAt: true } },
    },
  },
  createdBy: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
} as const

const followUpInclude = {
  responsible: { select: { id: true, name: true, isActive: true } },
  enabledBy: { select: { id: true, name: true, email: true } },
  completedBy: { select: { id: true, name: true, email: true } },
} as const

const iso = (value: Date | null | undefined): string | null => value ? value.toISOString() : null
const person = (value: { id: string; name: string; isActive: boolean } | null | undefined) => value ? { id: value.id, name: value.name, isActive: value.isActive } : null

const stableValue = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]))
  return value
}

const hashSnapshot = (value: unknown): string => createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')

type ReportEvidenceFile = {
  id: string
  filename: string
  storageState: string
  size: number
  reportVersion: { id: string } | null
}

export const reportEvidenceFileSnapshot = (files: readonly ReportEvidenceFile[]) => files
  .filter((file) => file.reportVersion === null)
  .map((file) => ({ id: file.id, filename: file.filename, storageState: file.storageState, size: file.size }))

const officialFromSource = (source: ReportSource) => {
  const processes = [source.process, ...source.relatedProcesses.map((link) => link.process)]
  const checklists = source.checklists.map((checklist) => ({
    id: checklist.id,
    name: checklist.name,
    items: checklist.items.map((item) => ({ id: item.id, description: item.description, criteria: item.criteria, result: item.result, observations: item.observations, required: item.required })),
  }))
  const findings = source.findings.map((finding) => ({
    id: finding.id,
    title: finding.title,
    description: finding.description,
    type: finding.type,
    severity: finding.severity,
    status: finding.status,
    dueDate: iso(finding.dueDate),
    responsible: person(finding.responsible),
    resolution: finding.resolution,
    checklistItem: finding.item ? { id: finding.item.id, description: finding.item.description } : null,
    process: finding.process ? { id: finding.process.id, code: finding.process.code, name: finding.process.name } : null,
    procedure: finding.procedure ? { id: finding.procedure.id, code: finding.procedure.code, name: finding.procedure.name } : null,
    evidences: finding.evidences.map((evidence) => ({ id: evidence.id, name: evidence.name, description: evidence.description, url: evidence.url })),
      evidenceFiles: reportEvidenceFileSnapshot(finding.evidenceFiles),
    actions: finding.actions.map((action) => ({
      id: action.id,
      title: action.title,
      description: action.description,
      objective: action.objective,
      implementationPlan: action.implementationPlan,
      responsible: person(action.responsible),
      priority: action.priority,
      status: action.status,
      required: action.required,
      dueDate: iso(action.dueDate),
      completedAt: iso(action.completedAt),
      progressPercent: action.progressPercent,
      followUpId: action.followUpId,
      followUpReason: action.followUpReason,
      followUpJustification: action.followUpJustification,
      progress: action.progress.map((entry) => ({ note: entry.note, percent: entry.percent, createdAt: entry.createdAt.toISOString() })),
    })),
    efficacyEvaluations: finding.efficacyEvaluations.map((evaluation) => ({
      id: evaluation.id,
      status: evaluation.status,
      outcome: evaluation.outcome,
      responsible: person(evaluation.responsible),
      scope: evaluation.scope,
      conclusion: evaluation.conclusion,
      recurrenceDetected: evaluation.recurrenceDetected,
      completedAt: iso(evaluation.completedAt),
    })),
  }))
  const checklistItems = source.checklists.flatMap((checklist) => checklist.items)
  return {
    identification: { code: source.code, title: source.title, auditType: source.auditType, process: source.process },
    objectives: source.objectives,
    scope: source.scope,
    criteria: source.criteria,
    dates: { plannedDate: iso(source.plannedDate), startDate: iso(source.startDate) },
    team: source.teamMembers.map((member) => ({
      id: member.id,
      auditorId: member.auditorId,
      name: member.auditor.name,
      role: member.role,
      isActive: member.isActive,
      independenceStatus: member.independenceStatus,
      independenceDeclaration: member.independenceDeclaration,
      conflictDescription: member.conflictDescription,
      mitigationMeasures: member.mitigationMeasures,
    })),
    processes,
    procedures: source.procedures.map((link) => link.procedure),
    plan: source.plan ? {
      methodology: source.plan.methodology,
      samplingMethod: source.plan.samplingMethod,
      resources: source.plan.resources,
      status: source.plan.status,
      activities: source.plan.activities.map((activity) => ({
        id: activity.id,
        title: activity.title,
        type: activity.type,
        status: activity.status,
        scheduledStart: activity.scheduledStart.toISOString(),
        scheduledEnd: activity.scheduledEnd.toISOString(),
        executionResult: activity.executionResult,
        executionObservations: activity.executionObservations,
      })),
    } : null,
    checklists,
    results: {
      checklistTotal: checklistItems.length,
      checklistEvaluated: checklistItems.filter((item) => item.result !== 'PENDING').length,
      conform: checklistItems.filter((item) => item.result === 'CONFORM').length,
      nonConform: checklistItems.filter((item) => item.result === 'NON_CONFORM').length,
      findingsTotal: findings.length,
      findingsOpen: findings.filter((finding) => finding.status !== 'VERIFIED').length,
    },
    findings,
    evidences: source.evidences.map((evidence) => ({ id: evidence.id, name: evidence.name, description: evidence.description, url: evidence.url })),
    evidenceFiles: reportEvidenceFileSnapshot(source.evidenceFiles),
  }
}

export const buildAuditReportSnapshot = async (client: AuditClient, auditId: string, editable = { executiveSummary: '', conclusions: '', recommendations: '' }): Promise<AuditReportSnapshot> => {
  const source = await client.audit.findUnique({ where: { id: auditId }, include: reportSourceInclude })
  if (!source) throw new Error('Audit not found')
  const official = officialFromSource(source)
  return auditReportSnapshotSchema.parse({ schemaVersion: 1, generatedAt: new Date().toISOString(), sourceFingerprint: hashSnapshot(official), official, editable })
}

export const auditReportSourceFingerprint = async (client: AuditClient, auditId: string): Promise<string> => (await buildAuditReportSnapshot(client, auditId)).sourceFingerprint

const auditActor = (request: Request): AuditActor | null => request.user ? { id: request.user.id, name: request.user.name, email: request.user.email } : null
const auditEvent = (client: AuditClient, auditId: string, eventType: AuditEventType, summary: string, request: Request, metadata?: Record<string, unknown>) => client.auditEvent.create({ data: { auditId, eventType, summary, actorId: request.user?.id ?? null, actorName: request.user?.name ?? null, actorEmail: request.user?.email ?? null, ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}) } })

const reportView = (report: Prisma.AuditReportGetPayload<{ include: typeof reportInclude }>) => ({
  id: report.id,
  auditId: report.auditId,
  status: report.status,
  draftSnapshot: auditReportSnapshotSchema.parse(report.draftSnapshot),
  createdBy: report.createdBy,
  reviewedBy: report.reviewedBy,
  reviewedAt: report.reviewedAt,
  approvedVersionId: report.approvedVersionId,
  versions: report.versions.map((version) => ({ id: version.id, version: version.version, snapshot: auditReportSnapshotSchema.parse(version.snapshot), snapshotHash: version.snapshotHash, approvedBy: version.approvedBy, approvedAt: version.approvedAt, pdfEvidenceFile: version.pdfEvidenceFile })),
  createdAt: report.createdAt,
  updatedAt: report.updatedAt,
})

const followUpView = (followUp: Prisma.AuditFollowUpGetPayload<{ include: typeof followUpInclude }>) => ({
  id: followUp.id,
  auditId: followUp.auditId,
  status: followUp.status,
  scope: followUp.scope,
  responsible: followUp.responsible,
  enabledBy: followUp.enabledBy,
  enabledAt: followUp.enabledAt,
  completedBy: followUp.completedBy,
  completedAt: followUp.completedAt,
  notes: followUp.notes,
  createdAt: followUp.createdAt,
  updatedAt: followUp.updatedAt,
})

const auditAccess = async (db: PrismaClient, request: Request, auditId: string) => {
  const audit = await db.audit.findUnique({ where: { id: auditId }, select: { id: true, status: true, process: { select: { companyId: true } }, leadAuditorId: true, responsibleId: true } })
  if (!audit || !request.user || (request.user.role !== Role.SUPERUSER && audit.process.companyId !== request.user.companyId)) return null
  return audit
}

const canPrepareReport = (request: Request, audit: { leadAuditorId: string | null; responsibleId: string | null }): boolean => Boolean(request.user && (request.user.role === Role.SUPERUSER || request.user.role === Role.COMPANY_ADMIN || request.user.id === audit.leadAuditorId || request.user.id === audit.responsibleId))
const canApproveReport = (request: Request): boolean => request.user?.role === Role.SUPERUSER || request.user?.role === Role.COMPANY_ADMIN
const lockAudit = async (tx: Prisma.TransactionClient, auditId: string) => {
  await tx.$queryRaw`SELECT "id" FROM "Audit" WHERE "id" = ${auditId} FOR UPDATE`
  return tx.audit.findUnique({ where: { id: auditId }, select: { id: true, status: true, process: { select: { companyId: true } }, responsibleId: true } })
}

const cleanupStored = async (storage: EvidenceStorage, stored: { storedName: string | null; driveFileId: string | null; driveUrl: string | null }, objectKeyContext: { companyId: string; module: 'audits'; resourceId: string } | undefined) => {
  try { await storage.remove({ storedName: stored.storedName, objectKeyContext }) } catch (error) { console.error('[audit-report] failed to clean generated PDF', { stored, error }) }
}

export const registerAuditReportRoutes = ({ app, db, authMiddleware, adminMiddleware }: { app: Express; db: PrismaClient; authMiddleware: RequestHandler; adminMiddleware: RequestHandler }) => {
  const evidenceStorage = createEvidenceStorage()
  const localEvidenceStorage = createLocalEvidenceStorage()

  app.get('/api/audits/:auditId/report', authMiddleware, asyncHandler(async (request, response) => {
    const audit = await auditAccess(db, request, String(request.params.auditId))
    if (!audit) { response.status(404).json({ error: 'Audit not found' }); return }
    const report = await db.auditReport.findUnique({ where: { auditId: audit.id }, include: reportInclude })
    response.json({ report: report ? reportView(report) : null, currentSourceFingerprint: await auditReportSourceFingerprint(db, audit.id) })
  }))

  app.post('/api/audits/:auditId/report/draft', authMiddleware, asyncHandler(async (request, response) => {
    const audit = await auditAccess(db, request, String(request.params.auditId))
    if (!audit) { response.status(404).json({ error: 'Audit not found' }); return }
    if (!canPrepareReport(request, audit)) { response.status(403).json({ error: 'Only an authorized audit participant can prepare this report' }); return }
    if (audit.status === 'CLOSED' || audit.status === 'CANCELLED') { response.status(409).json({ error: 'A terminal audit cannot create a report draft' }); return }
    const actor = auditActor(request)
    const report = await db.$transaction(async (tx) => {
      const locked = await lockAudit(tx, audit.id)
      if (!locked || locked.status === 'CLOSED' || locked.status === 'CANCELLED') return null
      const existing = await tx.auditReport.findUnique({ where: { auditId: audit.id } })
      if (existing?.status === AuditReportStatus.APPROVED) return null
      const previousEditable = existing ? auditReportSnapshotSchema.safeParse(existing.draftSnapshot).data?.editable : undefined
      const snapshot = await buildAuditReportSnapshot(tx, audit.id, previousEditable ?? { executiveSummary: '', conclusions: '', recommendations: '' })
      if (existing) {
        const updated = await tx.auditReport.update({ where: { id: existing.id }, data: { draftSnapshot: snapshot as unknown as Prisma.InputJsonValue, status: AuditReportStatus.DRAFT, reviewedById: null, reviewedAt: null }, include: reportInclude })
        await auditEvent(tx, audit.id, AuditEventType.AUDIT_REPORT_UPDATED, 'Borrador de informe regenerado desde el expediente oficial', request, { reportId: updated.id, sourceFingerprint: snapshot.sourceFingerprint })
        return updated
      }
      const created = await tx.auditReport.create({ data: { auditId: audit.id, status: AuditReportStatus.DRAFT, draftSnapshot: snapshot as unknown as Prisma.InputJsonValue, createdById: request.user!.id }, include: reportInclude })
      await auditEvent(tx, audit.id, AuditEventType.AUDIT_REPORT_CREATED, 'Borrador de informe creado desde el expediente oficial', request, { reportId: created.id, sourceFingerprint: snapshot.sourceFingerprint })
      return created
    })
    if (!report) { response.status(409).json({ error: 'The report is already approved or the audit became terminal' }); return }
    response.status(201).json({ report: reportView(report), actor })
  }))

  app.patch('/api/audits/:auditId/report', authMiddleware, asyncHandler(async (request, response) => {
    const audit = await auditAccess(db, request, String(request.params.auditId))
    const parsed = reportDraftUpdateSchema.safeParse(request.body)
    if (!parsed.success) { response.status(400).json({ error: 'Invalid report draft', details: parsed.error.issues }); return }
    if (!audit) { response.status(404).json({ error: 'Audit not found' }); return }
    if (!canPrepareReport(request, audit)) { response.status(403).json({ error: 'Only an authorized audit participant can edit this report' }); return }
    const report = await db.auditReport.findUnique({ where: { auditId: audit.id }, include: reportInclude })
    if (!report) { response.status(404).json({ error: 'Report draft not found' }); return }
    if (report.status !== AuditReportStatus.DRAFT) { response.status(409).json({ error: 'Only a draft report can be edited' }); return }
    const currentSnapshot = auditReportSnapshotSchema.parse(report.draftSnapshot)
    const snapshot = auditReportSnapshotSchema.parse({ ...currentSnapshot, editable: parsed.data })
    const updated = await db.$transaction(async (tx) => {
      const locked = await lockAudit(tx, audit.id)
      if (!locked || locked.status === 'CLOSED' || locked.status === 'CANCELLED') return null
      const current = await tx.auditReport.findUnique({ where: { id: report.id }, include: reportInclude })
      if (!current || current.status !== AuditReportStatus.DRAFT) return null
      const saved = await tx.auditReport.update({ where: { id: current.id }, data: { draftSnapshot: snapshot as unknown as Prisma.InputJsonValue }, include: reportInclude })
      await auditEvent(tx, audit.id, AuditEventType.AUDIT_REPORT_UPDATED, 'Informe de auditoría actualizado', request, { reportId: saved.id })
      return saved
    })
    if (!updated) { response.status(409).json({ error: 'The audit or report changed before the draft was saved' }); return }
    response.json({ report: reportView(updated) })
  }))

  app.post('/api/audits/:auditId/report/submit', authMiddleware, asyncHandler(async (request, response) => {
    const audit = await auditAccess(db, request, String(request.params.auditId))
    if (!audit) { response.status(404).json({ error: 'Audit not found' }); return }
    if (!canPrepareReport(request, audit)) { response.status(403).json({ error: 'Only an authorized audit participant can submit this report' }); return }
    const result = await db.$transaction(async (tx) => {
      const locked = await lockAudit(tx, audit.id)
      if (!locked || locked.status === 'CLOSED' || locked.status === 'CANCELLED') return { conflict: 'The audit is terminal' as const }
      const current = await tx.auditReport.findUnique({ where: { auditId: audit.id }, include: reportInclude })
      if (!current || current.status !== AuditReportStatus.DRAFT) return { conflict: 'Only a draft report can be submitted' as const }
      const snapshot = auditReportSnapshotSchema.parse(current.draftSnapshot)
      const currentSource = await buildAuditReportSnapshot(tx, audit.id, snapshot.editable)
      if (currentSource.sourceFingerprint !== snapshot.sourceFingerprint) return { stale: true as const }
      const saved = await tx.auditReport.update({ where: { id: current.id }, data: { status: AuditReportStatus.IN_REVIEW, reviewedById: request.user!.id, reviewedAt: new Date() }, include: reportInclude })
      await auditEvent(tx, audit.id, AuditEventType.AUDIT_REPORT_SUBMITTED, 'Informe enviado a revisión humana', request, { reportId: saved.id, sourceFingerprint: snapshot.sourceFingerprint })
      await auditEvent(tx, audit.id, AuditEventType.AUDIT_REPORT_REVIEWED, 'Informe revisado y pendiente de aprobación', request, { reportId: saved.id })
      return { report: saved }
    })
    if ('stale' in result) { response.status(409).json({ error: 'The report is out of date; regenerate the draft from the current audit data', reason: 'REPORT_STALE' }); return }
    if ('conflict' in result) { response.status(409).json({ error: result.conflict }); return }
    response.json({ report: reportView(result.report) })
  }))

  app.post('/api/audits/:auditId/report/return-to-draft', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = returnToDraftSchema.safeParse(request.body)
    if (!parsed.success) { response.status(400).json({ error: 'A return justification is required', details: parsed.error.issues }); return }
    const audit = await auditAccess(db, request, String(request.params.auditId))
    if (!audit) { response.status(404).json({ error: 'Audit not found' }); return }
    if (!canPrepareReport(request, audit)) { response.status(403).json({ error: 'Only an authorized reviewer can return this report' }); return }
    const updated = await db.$transaction(async (tx) => {
      const locked = await lockAudit(tx, audit.id)
      if (!locked || locked.status === 'CLOSED' || locked.status === 'CANCELLED') return null
      const report = await tx.auditReport.findUnique({ where: { auditId: audit.id }, include: reportInclude })
      if (!report || report.status !== AuditReportStatus.IN_REVIEW) return null
      const saved = await tx.auditReport.update({ where: { id: report.id }, data: { status: AuditReportStatus.DRAFT, reviewedById: request.user!.id, reviewedAt: new Date() }, include: reportInclude })
      await auditEvent(tx, audit.id, AuditEventType.AUDIT_REPORT_REVIEWED, 'Informe devuelto a borrador', request, { reportId: report.id, justification: parsed.data.justification })
      return saved
    })
    if (!updated) { response.status(409).json({ error: 'Only an in-review report on an open audit can be returned to draft' }); return }
    response.json({ report: reportView(updated) })
  }))

  app.post('/api/audits/:auditId/report/approve', authMiddleware, adminMiddleware, asyncHandler(async (request, response) => {
    const audit = await auditAccess(db, request, String(request.params.auditId))
    if (!audit) { response.status(404).json({ error: 'Audit not found' }); return }
    if (!canApproveReport(request)) { response.status(403).json({ error: 'Only COMPANY_ADMIN or SUPERUSER can approve an audit report' }); return }
    const report = await db.auditReport.findUnique({ where: { auditId: audit.id }, include: reportInclude })
    if (!report || report.status !== AuditReportStatus.IN_REVIEW) { response.status(409).json({ error: 'Only an in-review report can be approved' }); return }
    const snapshot = auditReportSnapshotSchema.parse(report.draftSnapshot)
    const current = await buildAuditReportSnapshot(db, audit.id, snapshot.editable)
    if (current.sourceFingerprint !== snapshot.sourceFingerprint) { response.status(409).json({ error: 'The report is out of date; regenerate and review it again', reason: 'REPORT_STALE' }); return }
    const version = (report.versions[0]?.version ?? 0) + 1
    const pdf = generateAuditReportPdf(snapshot, version)
    const objectKeyContext = evidenceStorage.kind === 'R2' ? { companyId: audit.process.companyId, module: 'audits' as const, resourceId: audit.id } : undefined
    let stored: { storedName: string | null; driveFileId: string | null; driveUrl: string | null }
    try {
      stored = await evidenceStorage.upload({ filename: sanitizeUploadFilename(`${audit.id}-informe-auditoria-v${version}.pdf`), mimeType: 'application/pdf', data: pdf, objectKey: objectKeyContext ? nextEvidenceObjectKey(objectKeyContext) : undefined, idempotencyKey: `${report.id}:${version}` })
    } catch (error) {
      console.error('[audit-report] PDF generation/storage failed', { auditId: audit.id, error })
      response.status(503).json({ error: 'The official PDF could not be stored; no report version was approved', reason: 'REPORT_PDF_STORAGE_FAILED' })
      return
    }
    let committed = false
    try {
      const result = await db.$transaction(async (tx) => {
        const lockedAudit = await lockAudit(tx, audit.id)
        const lockedReport = await tx.auditReport.findUnique({ where: { id: report.id }, include: reportInclude })
        if (!lockedAudit || lockedAudit.status === 'CLOSED' || lockedAudit.status === 'CANCELLED' || !lockedReport || lockedReport.status !== AuditReportStatus.IN_REVIEW || lockedReport.approvedVersionId) return { conflict: true as const }
        const lockedSnapshot = auditReportSnapshotSchema.parse(lockedReport.draftSnapshot)
        if (hashSnapshot(lockedSnapshot) !== hashSnapshot(snapshot)) return { stale: true as const }
        const lockedCurrent = await buildAuditReportSnapshot(tx, audit.id, lockedSnapshot.editable)
        if (lockedCurrent.sourceFingerprint !== lockedSnapshot.sourceFingerprint) return { stale: true as const }
        const previous = await tx.auditReportVersion.findFirst({ where: { reportId: lockedReport.id }, orderBy: { version: 'desc' }, select: { version: true } })
        const nextVersion = (previous?.version ?? 0) + 1
        if (nextVersion !== version) return { conflict: true as const }
        const file = await tx.auditEvidenceFile.create({ data: { auditId: audit.id, filename: `${audit.id}-informe-auditoria-v${version}.pdf`, storedName: stored.storedName, mimeType: 'application/pdf', size: pdf.length, uploadedById: request.user!.id, storageProvider: evidenceStorage.kind, storageState: 'READY', driveFileId: stored.driveFileId, driveUrl: stored.driveUrl } })
        const createdVersion = await tx.auditReportVersion.create({ data: { reportId: lockedReport.id, version, snapshot: lockedSnapshot as unknown as Prisma.InputJsonValue, snapshotHash: hashSnapshot(lockedSnapshot), approvedById: request.user!.id, pdfEvidenceFileId: file.id } })
        const saved = await tx.auditReport.update({ where: { id: lockedReport.id }, data: { status: AuditReportStatus.APPROVED, approvedVersionId: createdVersion.id, reviewedById: request.user!.id, reviewedAt: new Date() }, include: reportInclude })
        await auditEvent(tx, audit.id, AuditEventType.AUDIT_REPORT_VERSION_CREATED, `Versión ${version} del informe creada`, request, { reportId: saved.id, version, versionId: createdVersion.id, snapshotHash: createdVersion.snapshotHash, evidenceFileId: file.id })
        await auditEvent(tx, audit.id, AuditEventType.AUDIT_REPORT_PDF_GENERATED, `PDF oficial de la versión ${version} almacenado`, request, { reportId: saved.id, version, versionId: createdVersion.id, evidenceFileId: file.id })
        await auditEvent(tx, audit.id, AuditEventType.AUDIT_REPORT_APPROVED, `Informe de auditoría aprobado en versión ${version}`, request, { reportId: saved.id, version, versionId: createdVersion.id, snapshotHash: createdVersion.snapshotHash })
        return { report: saved }
      })
      if ('stale' in result) { response.status(409).json({ error: 'The report changed while the PDF was being prepared; generate it again', reason: 'REPORT_STALE' }); return }
      if ('conflict' in result) { response.status(409).json({ error: 'The report was approved by another request or the audit became terminal' }); return }
      committed = true
      response.json({ report: reportView(result.report) })
    } finally {
      if (!committed) await cleanupStored(evidenceStorage, stored, objectKeyContext)
    }
  }))

  app.get('/api/audits/:auditId/report/versions/:versionId/pdf', authMiddleware, asyncHandler(async (request, response) => {
    const audit = await auditAccess(db, request, String(request.params.auditId))
    if (!audit) { response.status(404).json({ error: 'Audit not found' }); return }
    const version = await db.auditReportVersion.findFirst({ where: { id: String(request.params.versionId), report: { auditId: audit.id } }, include: { pdfEvidenceFile: true } })
    const file = version?.pdfEvidenceFile
    if (!file || file.storageState !== 'READY') { response.status(404).json({ error: 'Official report PDF not found' }); return }
    const objectKeyContext = file.storageProvider === 'R2' ? { companyId: audit.process.companyId, module: 'audits' as const, resourceId: audit.id } : undefined
    if (file.storageProvider === 'R2' && (!evidenceStorage || evidenceStorage.kind !== 'R2' || !isEvidenceObjectKeyFor(file.storedName, objectKeyContext!))) { response.status(503).json({ error: 'The report storage provider is not configured' }); return }
    const provider = file.storageProvider === 'LOCAL' ? localEvidenceStorage : evidenceStorage
    const data = await provider.read({ storedName: file.storedName, objectKeyContext })
    response.setHeader('Content-Type', 'application/pdf')
    response.setHeader('Content-Length', String(data.length))
    response.setHeader('Content-Disposition', `attachment; filename="${sanitizeUploadFilename(file.filename)}"`)
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.send(data)
  }))

  app.get('/api/audits/:auditId/follow-up', authMiddleware, asyncHandler(async (request, response) => {
    const audit = await auditAccess(db, request, String(request.params.auditId))
    if (!audit) { response.status(404).json({ error: 'Audit not found' }); return }
    const followUp = await db.auditFollowUp.findUnique({ where: { auditId: audit.id }, include: followUpInclude })
    response.json({ followUp: followUp ? followUpView(followUp) : null })
  }))

  app.post('/api/audits/:auditId/follow-up', authMiddleware, adminMiddleware, asyncHandler(async (request, response) => {
    const parsed = followUpSchema.safeParse(request.body)
    if (!parsed.success) { response.status(400).json({ error: 'Invalid CAPA follow-up data', details: parsed.error.issues }); return }
    const audit = await auditAccess(db, request, String(request.params.auditId))
    if (!audit) { response.status(404).json({ error: 'Audit not found' }); return }
    if (audit.status === 'CANCELLED') { response.status(409).json({ error: 'A cancelled audit cannot have an active follow-up' }); return }
    const responsible = await db.user.findFirst({ where: { id: parsed.data.responsibleId, companyId: audit.process.companyId, isActive: true }, select: { id: true } })
    if (!responsible) { response.status(400).json({ error: 'The follow-up responsible must be an active user in the audit company' }); return }
    const followUp = await db.$transaction(async (tx) => {
      const locked = await lockAudit(tx, audit.id)
      if (!locked || locked.status === 'CANCELLED') return null
      const existing = await tx.auditFollowUp.findUnique({ where: { auditId: audit.id } })
      if (existing && (existing.status === AuditFollowUpStatus.COMPLETED || existing.status === AuditFollowUpStatus.CANCELLED)) return null
      const saved = existing
        ? await tx.auditFollowUp.update({ where: { id: existing.id }, data: { scope: parsed.data.scope, responsibleId: parsed.data.responsibleId, status: existing.status === AuditFollowUpStatus.COMPLETED ? AuditFollowUpStatus.COMPLETED : AuditFollowUpStatus.ENABLED, enabledById: request.user!.id, enabledAt: new Date(), completedById: existing.status === AuditFollowUpStatus.COMPLETED ? existing.completedById : null, completedAt: existing.status === AuditFollowUpStatus.COMPLETED ? existing.completedAt : null }, include: followUpInclude })
        : await tx.auditFollowUp.create({ data: { auditId: audit.id, scope: parsed.data.scope, responsibleId: parsed.data.responsibleId, enabledById: request.user!.id }, include: followUpInclude })
       await auditEvent(tx, audit.id, existing ? AuditEventType.AUDIT_FOLLOW_UP_UPDATED : AuditEventType.AUDIT_FOLLOW_UP_ENABLED, existing ? 'Seguimiento CAPA actualizado' : 'Seguimiento CAPA habilitado', request, { followUpId: saved.id, responsibleId: saved.responsibleId })
      return saved
    })
    if (!followUp) { response.status(409).json({ error: 'The audit changed before the CAPA follow-up could be enabled' }); return }
    response.status(201).json({ followUp: followUpView(followUp) })
  }))

  app.post('/api/audits/:auditId/follow-up/complete', authMiddleware, adminMiddleware, asyncHandler(async (request, response) => {
    const parsed = followUpCompleteSchema.safeParse(request.body ?? {})
    if (!parsed.success) { response.status(400).json({ error: 'Invalid follow-up completion data', details: parsed.error.issues }); return }
    const audit = await auditAccess(db, request, String(request.params.auditId))
    if (!audit) { response.status(404).json({ error: 'Audit not found' }); return }
    if (audit.status !== 'CLOSED') { response.status(409).json({ error: 'A CAPA follow-up can only be completed after the audit is closed' }); return }
    const result = await db.$transaction(async (tx) => {
      const locked = await lockAudit(tx, audit.id)
      if (!locked) return null
      const followUp = await tx.auditFollowUp.findUnique({ where: { auditId: audit.id }, include: followUpInclude })
      if (!followUp || followUp.status === AuditFollowUpStatus.COMPLETED || followUp.status === AuditFollowUpStatus.CANCELLED) return null
      const pendingFindings = await tx.auditFinding.count({ where: { auditId: audit.id, status: { not: 'VERIFIED' } } })
      const pendingActions = await tx.auditCorrectiveAction.count({ where: { finding: { auditId: audit.id }, required: true, status: { notIn: ['COMPLETED', 'CANCELLED'] } } })
      const pendingEvaluations = await tx.auditEfficacyEvaluation.count({ where: { auditId: audit.id, status: { in: ['PLANNED', 'IN_PROGRESS'] } } })
       if (followUpHasPendingWork({ pendingFindings, pendingActions, pendingEvaluations })) return { blocked: true as const, pendingFindings, pendingActions, pendingEvaluations }
      const saved = await tx.auditFollowUp.update({ where: { id: followUp.id }, data: { status: AuditFollowUpStatus.COMPLETED, completedById: request.user!.id, completedAt: new Date(), notes: parsed.data.notes ?? followUp.notes }, include: followUpInclude })
      await auditEvent(tx, audit.id, AuditEventType.AUDIT_FOLLOW_UP_COMPLETED, 'Seguimiento CAPA finalizado', request, { followUpId: saved.id })
      return { followUp: saved }
    })
    if (!result) { response.status(409).json({ error: 'The CAPA follow-up is unavailable or already final' }); return }
    if ('blocked' in result) { response.status(409).json({ error: 'The CAPA follow-up still has pending findings, actions or efficacy evaluations', reason: 'FOLLOW_UP_PENDING', pending: result }); return }
    response.json({ followUp: followUpView(result.followUp) })
  }))
}
