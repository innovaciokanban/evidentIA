import { readEvidenceFile, removeEvidenceFiles, writeEvidenceFile, nextStoredName } from './evidence-storage.js'
import { GoogleDriveError, GoogleDriveGateway } from './google-drive.js'
import { decryptOAuthSecret } from './oauth-crypto.js'
import { env } from './env.js'

export type EvidenceStorageKind = 'LOCAL' | 'GOOGLE_DRIVE'

export type DriveConnectionReference = {
  id: string
  companyId: string
  encryptedRefreshToken: string
  rootFolderId: string | null
}

export type EvidenceStorageReference = {
  storedName?: string | null
  driveFileId?: string | null
  connection?: DriveConnectionReference | null
}

export type EvidenceStorageUpload = {
  filename: string
  mimeType: string
  data: Buffer
  folderId?: string | null
  idempotencyKey?: string
  connection?: DriveConnectionReference | null
}

export type EvidenceFolderResult = {
  companyFolderId: string
  auditFolderId: string
  rootFolderId: string
}

export interface EvidenceStorage {
  readonly kind: EvidenceStorageKind
  ensureAuditFolder(input: { connection?: DriveConnectionReference | null; companyId: string; auditId: string; existingFolderId?: string | null; existingCompanyFolderId?: string | null }): Promise<EvidenceFolderResult | null>
  upload(input: EvidenceStorageUpload): Promise<{ storedName: string | null; driveFileId: string | null; driveUrl: string | null }>
  read(reference: EvidenceStorageReference): Promise<Buffer>
  remove(reference: EvidenceStorageReference): Promise<void>
}

const requireConnection = (connection: DriveConnectionReference | null | undefined): DriveConnectionReference => {
  if (!connection) throw new GoogleDriveError('No hay una conexión Google Drive activa para la empresa', { code: 'DRIVE_CONNECTION_REQUIRED' })
  return connection
}

const requireDriveFile = (reference: EvidenceStorageReference): { connection: DriveConnectionReference; fileId: string } => {
  const connection = requireConnection(reference.connection)
  if (!reference.driveFileId) throw new GoogleDriveError('La evidencia Drive no tiene driveFileId', { code: 'DRIVE_REFERENCE_INVALID' })
  return { connection, fileId: reference.driveFileId }
}

const refreshToken = (connection: DriveConnectionReference): string => decryptOAuthSecret(connection.encryptedRefreshToken)

class LocalEvidenceStorage implements EvidenceStorage {
  readonly kind = 'LOCAL' as const

  async ensureAuditFolder(): Promise<null> {
    return null
  }

  async upload(input: EvidenceStorageUpload) {
    const storedName = nextStoredName()
    await writeEvidenceFile(storedName, input.data)
    return { storedName, driveFileId: null, driveUrl: null }
  }

  async read(reference: EvidenceStorageReference): Promise<Buffer> {
    if (!reference.storedName) throw new Error('La referencia local de evidencia no existe')
    return readEvidenceFile(reference.storedName)
  }

  async remove(reference: EvidenceStorageReference): Promise<void> {
    if (!reference.storedName) return
    const result = await removeEvidenceFiles([reference.storedName])
    if (result.failed.length > 0) throw new Error('No se pudo retirar el archivo local de evidencia')
  }
}

export class GoogleDriveEvidenceStorage implements EvidenceStorage {
  readonly kind = 'GOOGLE_DRIVE' as const
  private readonly gateway: GoogleDriveGateway

  constructor(gateway: GoogleDriveGateway = new GoogleDriveGateway()) {
    this.gateway = gateway
  }

  async ensureAuditFolder(input: { connection?: DriveConnectionReference | null; companyId: string; auditId: string; existingFolderId?: string | null; existingCompanyFolderId?: string | null }): Promise<EvidenceFolderResult> {
    const connection = requireConnection(input.connection)
    if (connection.companyId !== input.companyId) throw new GoogleDriveError('La conexión Drive no pertenece a la empresa de la auditoría', { code: 'DRIVE_TENANT_MISMATCH' })
    const token = refreshToken(connection)
    const configuredRootId = env.GOOGLE_DRIVE_EVIDENCE_ROOT_FOLDER_ID
    const rootIsValid = configuredRootId
      ? await this.gateway.verifyFolderRoot(token, configuredRootId)
      : connection.rootFolderId
        ? await this.gateway.verifyRootFolder(token, connection.rootFolderId, input.companyId)
        : false
    if (configuredRootId && !rootIsValid) {
      throw new GoogleDriveError('La carpeta raíz configurada de evidencias no está disponible', { code: 'DRIVE_EVIDENCE_ROOT_INVALID' })
    }
    const root = configuredRootId
      ? { id: configuredRootId, name: null }
      : rootIsValid
        ? { id: connection.rootFolderId!, name: null }
        : await this.gateway.ensureRootFolder(token, input.companyId)
    const companyProperties = { evidentiaType: 'company-folder', evidentiaCompanyId: input.companyId }
    const existingCompanyValid = input.existingCompanyFolderId
      ? await this.gateway.verifyFolder(refreshToken(connection), input.existingCompanyFolderId, root.id, companyProperties)
      : false
    const companyFolder = existingCompanyValid
      ? { id: input.existingCompanyFolderId!, name: null }
      : await this.gateway.ensureFolder(refreshToken(connection), root.id, companyProperties, `Empresa ${input.companyId}`)
    const properties = { evidentiaType: 'audit-folder', evidentiaCompanyId: input.companyId, evidentiaAuditId: input.auditId }
    const existingValid = input.existingFolderId
      ? await this.gateway.verifyFolder(refreshToken(connection), input.existingFolderId, companyFolder.id, properties)
      : false
    const auditFolder = existingValid
      ? { id: input.existingFolderId!, name: null }
      : await this.gateway.ensureFolder(refreshToken(connection), companyFolder.id, properties, `Auditoría ${input.auditId}`)
    return { companyFolderId: companyFolder.id, auditFolderId: auditFolder.id, rootFolderId: root.id }
  }

  async upload(input: EvidenceStorageUpload) {
    const connection = requireConnection(input.connection)
    if (!input.folderId || !input.idempotencyKey) throw new GoogleDriveError('La carga Drive no tiene carpeta o idempotencyKey', { code: 'DRIVE_UPLOAD_REFERENCE_INVALID' })
    const uploaded = await this.gateway.upload(refreshToken(connection), input.folderId, {
      filename: input.filename,
      mimeType: input.mimeType,
      data: input.data,
      idempotencyKey: input.idempotencyKey,
    })
    return { storedName: null, driveFileId: uploaded.id, driveUrl: uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view` }
  }

  async read(reference: EvidenceStorageReference): Promise<Buffer> {
    const { connection, fileId } = requireDriveFile(reference)
    return this.gateway.read(refreshToken(connection), fileId)
  }

  async remove(reference: EvidenceStorageReference): Promise<void> {
    const { connection, fileId } = requireDriveFile(reference)
    await this.gateway.remove(refreshToken(connection), fileId)
  }
}

export const createLocalEvidenceStorage = (): EvidenceStorage => new LocalEvidenceStorage()

export const createEvidenceStorage = (gateway?: GoogleDriveGateway): EvidenceStorage => env.EVIDENCE_STORAGE_PROVIDER === 'google-drive'
  ? new GoogleDriveEvidenceStorage(gateway)
  : createLocalEvidenceStorage()
