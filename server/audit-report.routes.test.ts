import express from 'express'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import request from './test-request.js'
import { buildAuditReportSnapshot, registerAuditReportRoutes } from './audit-report.service.js'

const storageMocks = vi.hoisted(() => ({
  upload: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('./evidence-provider.js', () => ({
  createEvidenceStorage: () => ({ kind: 'LOCAL', upload: storageMocks.upload, read: storageMocks.read, remove: storageMocks.remove }),
  createLocalEvidenceStorage: () => ({ kind: 'LOCAL', upload: storageMocks.upload, read: storageMocks.read, remove: storageMocks.remove }),
}))

const companyId = 'company-1'
const foreignCompanyId = 'company-2'
const admin = { id: 'admin-1', name: 'Company Admin', email: 'admin@test.local', role: 'COMPANY_ADMIN' as Role, companyId }
const foreignAdmin = { id: 'admin-2', name: 'Foreign Admin', email: 'foreign@test.local', role: 'COMPANY_ADMIN' as Role, companyId: foreignCompanyId }
const member = { id: 'member-1', name: 'Company Member', email: 'member@test.local', role: 'COMPANY_USER' as Role, companyId }

const sourceFor = (auditId: string, sourceCompanyId = companyId) => ({
  id: auditId,
  code: 'AUD-001',
  title: 'Audit report test',
  auditType: 'Internal',
  objectives: 'Validate controls',
  scope: 'Company scope',
  criteria: 'Control criteria',
  plannedDate: new Date('2026-01-01T00:00:00.000Z'),
  startDate: new Date('2026-01-02T00:00:00.000Z'),
  process: { id: 'process-1', code: 'PROC-1', name: 'Process' },
  relatedProcesses: [],
  procedures: [],
  teamMembers: [],
  plan: null,
  checklists: [],
  findings: [],
  evidences: [],
  evidenceFiles: [],
  sourceCompanyId,
})

const makeHarness = async (user = admin) => {
  const source = sourceFor('audit-1')
  const report = {
    id: 'report-1',
    auditId: source.id,
    status: 'IN_REVIEW',
    draftSnapshot: null as unknown,
    createdBy: admin,
    reviewedBy: admin,
    reviewedAt: new Date('2026-01-03T00:00:00.000Z'),
    approvedVersionId: null as string | null,
    versions: [] as Array<Record<string, unknown>>,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-03T00:00:00.000Z'),
  }
  const files: Array<Record<string, unknown>> = []
  const events: Array<Record<string, unknown>> = []
  const audit: Record<string, unknown> = { id: source.id, status: 'IN_PROGRESS', leadAuditorId: admin.id, responsibleId: admin.id }
  const auditView = (selectOnly = false) => selectOnly
    ? { id: source.id, status: audit.status, leadAuditorId: admin.id, responsibleId: admin.id, process: { companyId: source.sourceCompanyId } }
    : source
  let transactionQueue = Promise.resolve()
  const db: Record<string, unknown> = {
    audit: {
      findUnique: vi.fn(async ({ select, include }: { select?: unknown; include?: unknown }) => include ? auditView(false) : select ? auditView(true) : auditView(false)),
    },
    auditReport: {
      findUnique: vi.fn(async () => report),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(report, data, { updatedAt: new Date() }); return report }),
    },
    auditReportVersion: {
      findFirst: vi.fn(async () => report.versions[0] ? report.versions[0] : null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const version = { id: 'version-1', ...data, approvedBy: admin, approvedAt: new Date(), pdfEvidenceFile: files[0] }; report.versions.unshift(version); return version }),
    },
    auditEvidenceFile: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const file = { id: 'file-1', createdAt: new Date(), ...data }; files.push(file); return file }),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const event = { id: `event-${events.length + 1}`, ...data }; events.push(event); return event }),
    },
    $queryRaw: vi.fn(async () => []),
  }
  db.$transaction = vi.fn(<T>(callback: (client: Record<string, unknown>) => Promise<T>) => {
    const result = transactionQueue.then(() => callback(db))
    transactionQueue = result.then(() => undefined, () => undefined)
    return result
  })
  report.draftSnapshot = await buildAuditReportSnapshot(db as unknown as PrismaClient, source.id)
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  registerAuditReportRoutes({
    app,
    db: db as unknown as PrismaClient,
    authMiddleware: (_req, _res, next) => next(),
    adminMiddleware: (req, res, next) => req.user?.role === 'COMPANY_USER' ? res.status(403).json({ error: 'Forbidden' }) : next(),
  })
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => res.headersSent ? next(error) : res.status(500).json({ error: String(error) }))
  return { app, db, report, files, source, events }
}

describe('audit report approval gates', () => {
  it('authorizes approval by company admins and isolates other roles and companies', async () => {
    storageMocks.upload.mockReset().mockResolvedValue({ storedName: 'report.pdf', driveFileId: null, driveUrl: null })
    const own = await makeHarness()
    const approved = await request(own.app).post('/api/audits/audit-1/report/approve')
    expect(approved.status).toBe(200)
    expect(approved.body.report.status).toBe('APPROVED')

    const memberHarness = await makeHarness(member)
    expect((await request(memberHarness.app).post('/api/audits/audit-1/report/approve')).status).toBe(403)

    const foreignHarness = await makeHarness(foreignAdmin)
    expect((await request(foreignHarness.app).post('/api/audits/audit-1/report/approve')).status).toBe(404)
  })

  it('keeps the report in review after storage failure and allows a later retry', async () => {
    storageMocks.upload.mockReset().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValueOnce({ storedName: 'retry.pdf', driveFileId: null, driveUrl: null })
    const harness = await makeHarness()
    const failed = await request(harness.app).post('/api/audits/audit-1/report/approve')
    expect(failed.status).toBe(503)
    expect(failed.body.reason).toBe('REPORT_PDF_STORAGE_FAILED')
    expect(harness.report.status).toBe('IN_REVIEW')
    const retried = await request(harness.app).post('/api/audits/audit-1/report/approve')
    expect(retried.status).toBe(200)
    expect(harness.report.status).toBe('APPROVED')
  })

  it('serializes concurrent approvals so only one version is committed', async () => {
    storageMocks.upload.mockReset().mockResolvedValue({ storedName: 'concurrent.pdf', driveFileId: null, driveUrl: null })
    const harness = await makeHarness()
    const results = await Promise.all([
      request(harness.app).post('/api/audits/audit-1/report/approve'),
      request(harness.app).post('/api/audits/audit-1/report/approve'),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    expect(harness.report.versions).toHaveLength(1)
  })

  it('preserves the approved snapshot and serves the stored PDF after source changes', async () => {
    const pdf = Buffer.from('%PDF-1.7 approved')
    storageMocks.upload.mockReset().mockResolvedValue({ storedName: 'immutable.pdf', driveFileId: null, driveUrl: null })
    storageMocks.read.mockReset().mockResolvedValue(pdf)
    const harness = await makeHarness()
    const approved = await request(harness.app).post('/api/audits/audit-1/report/approve')
    const approvedSnapshot = approved.body.report.versions[0].snapshot
    harness.source.title = 'Changed after approval'
    const current = await request(harness.app).get('/api/audits/audit-1/report')
    expect(current.status).toBe(200)
    expect(current.body.report.versions[0].snapshot).toEqual(approvedSnapshot)
    const pdfResponse = await request(harness.app).get('/api/audits/audit-1/report/versions/version-1/pdf')
    expect(pdfResponse.status).toBe(200)
    expect(pdfResponse.headers['content-type']).toContain('application/pdf')
    expect(pdfResponse.body.toString()).toBe(pdf.toString())
  })
})
