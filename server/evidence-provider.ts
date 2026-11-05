import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { readEvidenceFile, removeEvidenceFiles, writeEvidenceFile, nextStoredName } from './evidence-storage.js'
import { env } from './env.js'

export type EvidenceStorageKind = 'LOCAL' | 'R2'

export type EvidenceStorageReference = {
  storedName?: string | null
}

export type EvidenceStorageUpload = {
  filename: string
  mimeType: string
  data: Buffer
  objectKey?: string
  idempotencyKey?: string
}

export type EvidenceFolderResult = {
  companyFolderId: string
  auditFolderId: string
  rootFolderId: string
}

export interface EvidenceStorage {
  readonly kind: EvidenceStorageKind
  ensureAuditFolder(input: { companyId: string; auditId: string; existingFolderId?: string | null; existingCompanyFolderId?: string | null }): Promise<EvidenceFolderResult | null>
  upload(input: EvidenceStorageUpload): Promise<{ storedName: string | null; driveFileId: string | null; driveUrl: string | null }>
  read(reference: EvidenceStorageReference): Promise<Buffer>
  remove(reference: EvidenceStorageReference): Promise<void>
}

class LocalEvidenceStorage implements EvidenceStorage {
  readonly kind = 'LOCAL' as const

  async ensureAuditFolder(): Promise<null> {
    return null
  }

  async upload(input: EvidenceStorageUpload): Promise<{ storedName: string; driveFileId: null; driveUrl: null }> {
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

class R2EvidenceStorage implements EvidenceStorage {
  readonly kind = 'R2' as const
  private readonly client: S3Client
  private readonly bucket: string

  constructor() {
    const endpoint = env.R2_ENDPOINT
    const bucket = env.R2_BUCKET
    const accessKeyId = env.R2_ACCESS_KEY_ID
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error('R2 storage is not configured')
    this.bucket = bucket
    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    })
  }

  async ensureAuditFolder(input: { companyId: string; auditId: string }): Promise<EvidenceFolderResult> {
    return {
      rootFolderId: 'r2',
      companyFolderId: `evidentia/${input.companyId}`,
      auditFolderId: `evidentia/${input.companyId}/audits/${input.auditId}`,
    }
  }

  async upload(input: EvidenceStorageUpload) {
    if (!input.objectKey) throw new Error('La carga R2 no tiene una clave de objeto')
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
      Body: input.data,
      ContentType: input.mimeType,
      ContentDisposition: `attachment; filename="${input.filename.replace(/["\r\n]/g, '_')}"`,
    }))
    return { storedName: input.objectKey, driveFileId: null, driveUrl: null }
  }

  async read(reference: EvidenceStorageReference): Promise<Buffer> {
    if (!reference.storedName) throw new Error('La referencia R2 de evidencia no existe')
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: reference.storedName }))
    if (!result.Body) throw new Error('El objeto R2 no tiene contenido')
    return Buffer.from(await result.Body.transformToByteArray())
  }

  async remove(reference: EvidenceStorageReference): Promise<void> {
    if (!reference.storedName) return
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: reference.storedName }))
  }
}

export const createLocalEvidenceStorage = (): EvidenceStorage => new LocalEvidenceStorage()
export const createR2EvidenceStorage = (): EvidenceStorage => new R2EvidenceStorage()

export const createEvidenceStorage = (): EvidenceStorage => {
  if (env.EVIDENCE_STORAGE_PROVIDER === 'r2') return createR2EvidenceStorage()
  return createLocalEvidenceStorage()
}

// Kept as a small compatibility helper for callers that need a private staging name.
export { nextStoredName }
