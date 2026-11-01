import { describe, expect, it } from 'vitest'
import { assertEvidenceStorageOperationShape } from './evidence-operations.js'

describe('evidence storage operation invariants', () => {
  it('allows a local file deletion without a Drive connection', () => {
    expect(() => assertEvidenceStorageOperationShape({ operationType: 'FILE_DELETE', auditId: 'audit-a', evidenceFileId: 'file-a', storageProvider: 'LOCAL' })).not.toThrow()
  })

  it('requires the Drive connection for uploads and Drive deletions', () => {
    expect(() => assertEvidenceStorageOperationShape({ operationType: 'UPLOAD', auditId: 'audit-a', evidenceFileId: 'file-a' })).toThrow()
    expect(() => assertEvidenceStorageOperationShape({ operationType: 'FILE_DELETE', auditId: 'audit-a', evidenceFileId: 'file-a', storageProvider: 'GOOGLE_DRIVE' })).toThrow()
  })

  it('rejects mismatched operation shapes', () => {
    expect(() => assertEvidenceStorageOperationShape({ operationType: 'LOCAL' as never })).toThrow()
    expect(() => assertEvidenceStorageOperationShape({ operationType: 'AUDIT_DELETE', auditId: 'audit-a', evidenceFileId: 'file-a' })).toThrow()
    expect(() => assertEvidenceStorageOperationShape({ operationType: 'FILE_DELETE', auditId: 'audit-a', evidenceFileId: 'file-a', connectionId: 'connection-a', storageProvider: 'LOCAL' })).toThrow()
  })
})
