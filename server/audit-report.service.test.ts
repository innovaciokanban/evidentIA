import { describe, expect, it, vi } from 'vitest'
import { auditReportSourceFingerprint, buildAuditReportSnapshot, reportEvidenceFileSnapshot } from './audit-report.service.js'

const reportPdf = {
  id: 'file-report-pdf',
  filename: 'evidence.pdf',
  storageState: 'READY',
  size: 20,
  reportVersion: { id: 'report-version-1' },
}

const realEvidence = {
  id: 'file-real-evidence',
  filename: 'informe-auditoria-v999.pdf',
  storageState: 'READY',
  size: 10,
  reportVersion: null,
}

const makeAuditSource = () => ({
  code: 'AUD-001',
  title: 'Auditoría de prueba',
  auditType: null,
  objectives: null,
  scope: 'Alcance',
  criteria: 'Criterios',
  plannedDate: null,
  startDate: null,
  process: { id: 'process-1', code: 'PROC-1', name: 'Proceso' },
  relatedProcesses: [],
  procedures: [],
  teamMembers: [],
  plan: null,
  checklists: [],
  findings: [],
  evidences: [],
  evidenceFiles: [realEvidence, reportPdf],
})

const sourceClient = (source: ReturnType<typeof makeAuditSource>) => {
  const findUnique = vi.fn().mockResolvedValue(source)
  return { client: { audit: { findUnique } } as never, findUnique }
}

describe('audit report source fingerprint', () => {
  it('excludes report PDFs by relation and keeps similarly named real evidence', () => {
    expect(reportEvidenceFileSnapshot([realEvidence, reportPdf])).toEqual([{
      id: realEvidence.id,
      filename: realEvidence.filename,
      storageState: realEvidence.storageState,
      size: realEvidence.size,
    }])
  })

  it('does not invalidate the historical snapshot when the stored report PDF changes', async () => {
    const source = makeAuditSource()
    const { client } = sourceClient(source)
    const approvedSnapshot = await buildAuditReportSnapshot(client, 'audit-1')
    const approvedSnapshotJson = JSON.stringify(approvedSnapshot)

    source.evidenceFiles[1].size = 999
    source.evidenceFiles[1].filename = 'changed-generated-pdf.bin'

    expect(await auditReportSourceFingerprint(client, 'audit-1')).toBe(approvedSnapshot.sourceFingerprint)
    expect(JSON.stringify(approvedSnapshot)).toBe(approvedSnapshotJson)
  })

  it('invalidates the fingerprint when real audit evidence changes', async () => {
    const source = makeAuditSource()
    const { client } = sourceClient(source)
    const initialFingerprint = await auditReportSourceFingerprint(client, 'audit-1')

    source.evidenceFiles[0].size = 11

    expect(await auditReportSourceFingerprint(client, 'audit-1')).not.toBe(initialFingerprint)
  })
})
