import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { env } from './env.js'
import { GoogleDriveError } from './google-drive.js'
import { createLocalEvidenceStorage, type DriveConnectionReference, type EvidenceStorage, type EvidenceStorageReference } from './evidence-provider.js'
import { readEvidenceFile, removeEvidenceFiles } from './evidence-storage.js'

const LEASE_MS = 5 * 60 * 1000
type OperationStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'RETRYABLE' | 'FAILED' | 'CANCELLED'
type EvidenceState = 'PENDING' | 'READY' | 'DELETE_PENDING' | 'FAILED'
type StorageProvider = 'LOCAL' | 'GOOGLE_DRIVE'

export type EvidenceStorageOperationShape = {
  operationType: 'UPLOAD' | 'FILE_DELETE' | 'AUDIT_DELETE'
  auditId?: string | null
  evidenceFileId?: string | null
  connectionId?: string | null
  storageProvider?: StorageProvider
}

export const assertEvidenceStorageOperationShape = (input: EvidenceStorageOperationShape): void => {
  if (!['UPLOAD', 'FILE_DELETE', 'AUDIT_DELETE'].includes(input.operationType)) throw new Error('Unknown evidence storage operation type')
  if (input.operationType === 'UPLOAD' && (!input.auditId || !input.evidenceFileId || !input.connectionId)) {
    throw new Error('UPLOAD operations require an audit, evidence file and Drive connection')
  }
  if (input.operationType === 'FILE_DELETE') {
    if (!input.auditId || !input.evidenceFileId) throw new Error('FILE_DELETE operations require an audit and evidence file')
    if (input.storageProvider === 'GOOGLE_DRIVE' && !input.connectionId) throw new Error('Google Drive FILE_DELETE operations require a connection')
    if (input.storageProvider === 'LOCAL' && input.connectionId) throw new Error('Local FILE_DELETE operations cannot have a Drive connection')
  }
  if (input.operationType === 'AUDIT_DELETE' && (!input.auditId || input.evidenceFileId || input.connectionId)) {
    throw new Error('AUDIT_DELETE operations require only an audit reference')
  }
}

type OperationConnection = DriveConnectionReference & {
  status: 'CONNECTED' | 'REAUTH_REQUIRED' | 'DISCONNECTED'
}

type LoadedOperation = {
  id: string
  companyId: string
  auditId: string | null
  evidenceFileId: string | null
  connectionId: string | null
  operationType: 'UPLOAD' | 'FILE_DELETE' | 'AUDIT_DELETE'
  status: OperationStatus
  idempotencyKey: string
  remoteFileId: string | null
  attemptCount: number
  leaseOwner: string | null
  evidenceFile: ({
    id: string
    auditId: string
    filename: string
    mimeType: string
    storedName: string | null
    stagedName: string | null
    size: number
    storageProvider: 'LOCAL' | 'GOOGLE_DRIVE'
    storageState: EvidenceState
    driveFileId: string | null
    driveUrl: string | null
    driveConnectionId: string | null
  } | null)
  connection: OperationConnection | null
}

const connectionSelect = {
  id: true,
  companyId: true,
  encryptedRefreshToken: true,
  rootFolderId: true,
  status: true,
} as const

const evidenceSelect = {
  id: true,
  auditId: true,
  filename: true,
  mimeType: true,
  storedName: true,
  stagedName: true,
  size: true,
  storageProvider: true,
  storageState: true,
  driveFileId: true,
  driveUrl: true,
  driveConnectionId: true,
} as const

const operationInclude = {
  evidenceFile: { select: evidenceSelect },
  connection: { select: connectionSelect },
} as const

const retryDelay = (attempt: number): number => Math.min(60 * 60 * 1000, 1000 * 2 ** Math.min(attempt, 10))

const isRetryableError = (error: unknown): boolean => error instanceof GoogleDriveError && (error.retryable || error.status === 401 || error.status === 403)
const requiresReauthorization = (error: unknown): boolean => error instanceof GoogleDriveError && (error.code === 'invalid_grant' || error.code === 'DRIVE_REAUTH_REQUIRED' || error.status === 401 || error.status === 403)

const errorDetails = (error: unknown): { code: string; message: string } => {
  if (error instanceof GoogleDriveError) return { code: error.code ?? `HTTP_${error.status ?? 'UNKNOWN'}`, message: error.message }
  return { code: 'STORAGE_OPERATION_FAILED', message: error instanceof Error ? error.message.slice(0, 500) : 'Storage operation failed' }
}

export class EvidenceOperationService {
  private readonly localStorage = createLocalEvidenceStorage()
  private readonly db: PrismaClient
  private readonly storage: EvidenceStorage

  constructor(db: PrismaClient, storage: EvidenceStorage) {
    this.db = db
    this.storage = storage
  }

  async enqueueUpload(input: { companyId: string; auditId: string; evidenceFileId: string; connectionId: string }): Promise<{ id: string }> {
    assertEvidenceStorageOperationShape({ operationType: 'UPLOAD', auditId: input.auditId, evidenceFileId: input.evidenceFileId, connectionId: input.connectionId })
    return this.db.evidenceStorageOperation.upsert({
      where: { idempotencyKey: `upload:${input.evidenceFileId}` },
      create: {
        companyId: input.companyId,
        auditId: input.auditId,
        evidenceFileId: input.evidenceFileId,
        connectionId: input.connectionId,
        operationType: 'UPLOAD',
        idempotencyKey: `upload:${input.evidenceFileId}`,
      },
      update: {},
      select: { id: true },
    })
  }

  async enqueueFileDelete(input: { companyId: string; auditId: string; evidenceFileId: string; connectionId?: string | null; storageProvider: StorageProvider }): Promise<{ id: string }> {
    assertEvidenceStorageOperationShape({ operationType: 'FILE_DELETE', auditId: input.auditId, evidenceFileId: input.evidenceFileId, connectionId: input.connectionId, storageProvider: input.storageProvider })
    return this.db.evidenceStorageOperation.upsert({
      where: { idempotencyKey: `file-delete:${input.evidenceFileId}` },
      create: {
        companyId: input.companyId,
        auditId: input.auditId,
        evidenceFileId: input.evidenceFileId,
        connectionId: input.connectionId,
        operationType: 'FILE_DELETE',
        idempotencyKey: `file-delete:${input.evidenceFileId}`,
      },
      update: { status: 'PENDING', nextAttemptAt: null, leaseOwner: null, leaseUntil: null },
      select: { id: true },
    })
  }

  async enqueueAuditDelete(input: { companyId: string; auditId: string }): Promise<{ id: string }> {
    assertEvidenceStorageOperationShape({ operationType: 'AUDIT_DELETE', auditId: input.auditId })
    return this.db.evidenceStorageOperation.upsert({
      where: { idempotencyKey: `audit-delete:${input.auditId}` },
      create: { companyId: input.companyId, auditId: input.auditId, operationType: 'AUDIT_DELETE', idempotencyKey: `audit-delete:${input.auditId}` },
      update: { status: 'PENDING', nextAttemptAt: null, leaseOwner: null, leaseUntil: null },
      select: { id: true },
    })
  }

  async runOperation(operationId: string): Promise<OperationStatus | null> {
    const operation = await this.claim(operationId)
    if (!operation) return null
    try {
      if (operation.operationType === 'UPLOAD') await this.processUpload(operation)
      else if (operation.operationType === 'FILE_DELETE') await this.processFileDelete(operation)
      else await this.processAuditDelete(operation)
      return 'SUCCEEDED'
    } catch (error) {
      await this.recordFailure(operation, error)
      return isRetryableError(error) && operation.attemptCount + 1 < env.EVIDENCE_OPERATION_MAX_ATTEMPTS ? 'RETRYABLE' : 'FAILED'
    }
  }

  async runOnce(limit = 10): Promise<number> {
    const now = new Date()
    const candidates = await this.db.evidenceStorageOperation.findMany({
      where: {
        OR: [
          { status: { in: ['PENDING', 'RETRYABLE'] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          { status: 'IN_PROGRESS', leaseUntil: { lt: now } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    })
    for (const candidate of candidates) await this.runOperation(candidate.id)
    return candidates.length
  }

  startWorker(): () => void {
    if (!env.EVIDENCE_OPERATION_WORKER_ENABLED) return () => undefined
    const timer = setInterval(() => { void this.runOnce().catch((error) => console.error('[evidence-operations] reconciliation failed', error)) }, env.EVIDENCE_OPERATION_INTERVAL_MS)
    timer.unref()
    void this.runOnce().catch((error) => console.error('[evidence-operations] initial reconciliation failed', error))
    return () => clearInterval(timer)
  }

  private async claim(operationId: string): Promise<LoadedOperation | null> {
    const leaseOwner = randomUUID()
    const now = new Date()
    const claimed = await this.db.evidenceStorageOperation.updateMany({
      where: {
        id: operationId,
        OR: [
          { status: { in: ['PENDING', 'RETRYABLE'] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          { status: 'IN_PROGRESS', leaseUntil: { lt: now } },
        ],
      },
      data: { status: 'IN_PROGRESS', leaseOwner, leaseUntil: new Date(now.getTime() + LEASE_MS), lastAttemptAt: now, attemptCount: { increment: 1 } },
    })
    if (claimed.count !== 1) return null
    return this.db.evidenceStorageOperation.findUnique({ where: { id: operationId }, include: operationInclude }) as unknown as Promise<LoadedOperation | null>
  }

  private async processUpload(operation: LoadedOperation): Promise<void> {
    const evidence = operation.evidenceFile
    const connection = operation.connection
    if (!evidence || evidence.storageProvider !== 'GOOGLE_DRIVE' || !connection) throw new Error('La operación de carga no tiene evidencia o conexión Drive')
    if (connection.status !== 'CONNECTED') throw new GoogleDriveError('La conexión Drive requiere reautorización', { code: 'DRIVE_REAUTH_REQUIRED' })
    if (evidence.storageState === 'READY' && evidence.driveFileId) {
      await this.removeStagedFile(evidence.stagedName)
      await this.db.auditEvidenceFile.update({ where: { id: evidence.id }, data: { stagedName: null } })
      await this.markSucceeded(operation)
      return
    }
    if (!evidence.stagedName) throw new Error('La carga Drive no tiene archivo de staging')
    const data = await readEvidenceFile(evidence.stagedName)
    const folder = await this.ensureFolders(operation, connection)
    const uploaded = await this.storage.upload({
      filename: evidence.filename,
      mimeType: evidence.mimeType,
      data,
      folderId: folder.auditFolderId,
      idempotencyKey: operation.idempotencyKey,
      connection,
    })
    await this.db.$transaction(async (tx) => {
      const lease = await tx.evidenceStorageOperation.updateMany({ where: { id: operation.id, leaseOwner: operation.leaseOwner, status: 'IN_PROGRESS' }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } })
      if (lease.count !== 1) throw new Error('Se perdió el lease de la operación')
      await tx.auditEvidenceFile.update({
        where: { id: evidence.id },
        data: { driveFileId: uploaded.driveFileId, driveUrl: uploaded.driveUrl, storageState: 'READY', storageError: null, storageErrorCode: null },
      })
      await tx.evidenceStorageOperation.updateMany({ where: { id: operation.id, leaseOwner: operation.leaseOwner, status: 'IN_PROGRESS' }, data: { status: 'SUCCEEDED', remoteFileId: uploaded.driveFileId, leaseOwner: null, leaseUntil: null, lastError: null, lastErrorCode: null } })
      await tx.auditEvent.create({ data: { auditId: evidence.auditId, eventType: 'EVIDENCE_FILE_STORAGE_READY', summary: `Evidencia «${evidence.filename}» disponible`, metadata: { evidenceFileId: evidence.id, operationId: operation.id } } })
    })
    await this.removeStagedFile(evidence.stagedName)
    await this.db.auditEvidenceFile.update({ where: { id: evidence.id }, data: { stagedName: null } })
  }

  private async processFileDelete(operation: LoadedOperation): Promise<void> {
    const evidence = operation.evidenceFile
    if (!evidence) {
      await this.markSucceeded(operation)
      return
    }
    if (operation.auditId !== evidence.auditId || (operation.connection && operation.connection.companyId !== operation.companyId)) {
      throw new Error('La operación no coincide con la empresa o auditoría de la evidencia')
    }
    const reference: EvidenceStorageReference = { storedName: evidence.storedName ?? evidence.stagedName, driveFileId: evidence.driveFileId, connection: operation.connection }
    const provider = evidence.storageProvider === 'LOCAL' ? this.localStorage : this.storage
    await provider.remove(reference)
    await this.db.$transaction(async (tx) => {
      const lease = await tx.evidenceStorageOperation.updateMany({ where: { id: operation.id, leaseOwner: operation.leaseOwner, status: 'IN_PROGRESS' }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } })
      if (lease.count !== 1) throw new Error('Se perdió el lease de la operación')
      const current = await tx.auditEvidenceFile.findUnique({ where: { id: evidence.id }, select: { id: true, auditId: true, filename: true, storageState: true } })
      if (current) {
        await tx.evidenceStorageOperation.delete({ where: { id: operation.id } })
        await tx.auditEvidenceFile.delete({ where: { id: evidence.id } })
        await tx.auditEvent.create({ data: { auditId: current.auditId, eventType: 'EVIDENCE_FILE_DELETED', summary: `Evidencia «${current.filename}» eliminada`, metadata: { evidenceFileId: current.id, operationId: operation.id } } })
      }
    })
  }

  private async processAuditDelete(operation: LoadedOperation): Promise<void> {
    if (!operation.auditId) throw new Error('La operación de eliminación no tiene auditoría')
    const audit = await this.db.audit.findUnique({ where: { id: operation.auditId }, select: { id: true, process: { select: { companyId: true } } } })
    if (!audit || audit.process.companyId !== operation.companyId) throw new Error('La operación no coincide con la empresa de la auditoría')
    const pendingFiles = await this.db.auditEvidenceFile.findMany({ where: { auditId: operation.auditId } })
    if (pendingFiles.length > 0) {
      for (const file of pendingFiles) {
        await this.db.auditEvidenceFile.update({ where: { id: file.id }, data: { storageState: 'DELETE_PENDING' } })
        if (file.storageProvider === 'GOOGLE_DRIVE' && !file.driveConnectionId) {
          throw new GoogleDriveError('La evidencia Drive heredada no tiene conexión recuperable', { code: 'DRIVE_CONNECTION_REQUIRED' })
        }
        const key = `file-delete:${file.id}`
        const existing = await this.db.evidenceStorageOperation.findUnique({ where: { idempotencyKey: key }, select: { id: true, status: true } })
        const child = existing ?? await this.enqueueFileDelete({ companyId: operation.companyId, auditId: operation.auditId, evidenceFileId: file.id, connectionId: file.driveConnectionId, storageProvider: file.storageProvider })
        if (existing && (existing.status === 'FAILED' || existing.status === 'RETRYABLE' || existing.status === 'SUCCEEDED')) {
          await this.db.evidenceStorageOperation.update({ where: { id: existing.id }, data: { status: 'PENDING', nextAttemptAt: null, leaseOwner: null, leaseUntil: null } })
        }
        if (file.storageProvider === 'LOCAL' && existing?.status !== 'IN_PROGRESS') await this.runOperation(child.id)
      }
      const remainingFiles = await this.db.auditEvidenceFile.count({ where: { auditId: operation.auditId } })
      if (remainingFiles > 0) {
        await this.defer(operation, 'Waiting for evidence files to be deleted')
        return
      }
    }
    await this.db.$transaction(async (tx) => {
      const lease = await tx.evidenceStorageOperation.updateMany({ where: { id: operation.id, leaseOwner: operation.leaseOwner, status: 'IN_PROGRESS' }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } })
      if (lease.count !== 1) throw new Error('Se perdió el lease de la operación')
      await tx.evidenceStorageOperation.deleteMany({ where: { auditId: operation.auditId! } })
      await tx.audit.delete({ where: { id: operation.auditId! } })
    })
  }

  private async ensureFolders(operation: LoadedOperation, connection: OperationConnection) {
    if (!operation.auditId) throw new Error('La carga no tiene auditoría')
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${operation.companyId} FOR UPDATE`
      await tx.$queryRaw`SELECT "id" FROM "Audit" WHERE "id" = ${operation.auditId!} FOR UPDATE`
      const audit = await tx.audit.findUnique({ where: { id: operation.auditId! }, select: { id: true, driveFolderId: true, process: { select: { companyId: true, company: { select: { driveFolderId: true } } } } } })
      if (!audit || audit.process.companyId !== operation.companyId) throw new Error('La auditoría no pertenece a la empresa de la operación')
      const folders = await this.storage.ensureAuditFolder({ connection, companyId: operation.companyId, auditId: audit.id, existingFolderId: audit.driveFolderId, existingCompanyFolderId: audit.process.company.driveFolderId })
      if (!folders) throw new Error('El proveedor no devolvió carpetas Drive')
      await tx.audit.update({ where: { id: audit.id }, data: { driveFolderId: folders.auditFolderId } })
      await tx.company.update({ where: { id: operation.companyId }, data: { driveFolderId: folders.companyFolderId } })
      await tx.companyGoogleDriveConnection.update({ where: { id: connection.id }, data: { rootFolderId: folders.rootFolderId } })
      return folders
    })
  }

  private async recordFailure(operation: LoadedOperation, error: unknown): Promise<void> {
    const details = errorDetails(error)
    const retryable = isRetryableError(error) && operation.attemptCount < env.EVIDENCE_OPERATION_MAX_ATTEMPTS
    const status: OperationStatus = retryable ? 'RETRYABLE' : 'FAILED'
    await this.db.$transaction(async (tx) => {
      const claimed = await tx.evidenceStorageOperation.updateMany({ where: { id: operation.id, leaseOwner: operation.leaseOwner, status: 'IN_PROGRESS' }, data: { status, nextAttemptAt: retryable ? new Date(Date.now() + retryDelay(operation.attemptCount)) : null, leaseOwner: null, leaseUntil: null, lastErrorCode: details.code, lastError: details.message } })
      if (claimed.count !== 1) return
      if (operation.connectionId && requiresReauthorization(error)) {
        await tx.companyGoogleDriveConnection.update({ where: { id: operation.connectionId }, data: { status: 'REAUTH_REQUIRED', lastErrorCode: details.code, lastError: details.message } })
      }
      if (operation.evidenceFileId) {
        await tx.auditEvidenceFile.updateMany({ where: { id: operation.evidenceFileId }, data: { storageState: 'FAILED', storageErrorCode: details.code, storageError: details.message, lastAttemptAt: new Date() } })
      }
      if (operation.auditId) {
        await tx.auditEvent.create({ data: { auditId: operation.auditId, eventType: 'EVIDENCE_FILE_STORAGE_FAILED', summary: 'Operación de almacenamiento pendiente de recuperación', metadata: { operationId: operation.id, errorCode: details.code } } }).catch(() => undefined)
      }
    })
  }

  private async markSucceeded(operation: LoadedOperation): Promise<void> {
    await this.db.evidenceStorageOperation.updateMany({ where: { id: operation.id, leaseOwner: operation.leaseOwner, status: 'IN_PROGRESS' }, data: { status: 'SUCCEEDED', leaseOwner: null, leaseUntil: null } })
  }

  private async defer(operation: LoadedOperation, message: string): Promise<void> {
    await this.db.evidenceStorageOperation.updateMany({ where: { id: operation.id, leaseOwner: operation.leaseOwner, status: 'IN_PROGRESS' }, data: { status: 'RETRYABLE', nextAttemptAt: new Date(Date.now() + 1000), leaseOwner: null, leaseUntil: null, lastErrorCode: 'WAITING_DEPENDENCY', lastError: message } })
  }

  private async removeStagedFile(stagedName: string | null): Promise<void> {
    if (!stagedName) return
    const result = await removeEvidenceFiles([stagedName])
    if (result.failed.length > 0) throw new Error('No se pudo limpiar el staging local')
  }
}
