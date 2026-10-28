import { Readable } from 'node:stream'
import { google, type drive_v3, type oauth2_v2 } from 'googleapis'
import { CodeChallengeMethod } from 'google-auth-library'
import { env } from './env.js'

export type GoogleTokens = {
  refresh_token?: string | null
  access_token?: string | null
  expiry_date?: number | null
  scope?: string | null
}

export type DriveIdentity = {
  subject: string
  email: string | null
}

export type DriveFolder = {
  id: string
  name: string | null
}

export type FolderRootProbe = {
  accessible: boolean
  reason: 'OK' | 'NOT_FOUND' | 'FORBIDDEN' | 'NOT_FOLDER' | 'TRASHED'
  status: number | null
  code: string | null
}

/**
 * Motivo del resultado de la verificación de ascendencia. Solo etiquetas estables: nunca
 * identificadores de carpeta, de archivo ni nombres, aptas para registro diagnóstico.
 */
export type DriveAncestryReason =
  | 'OK'
  | 'FILE_UNREACHABLE'
  | 'ROOT_UNREACHABLE'
  | 'COMPANY_FOLDER_UNREACHABLE'
  | 'ROOT_NOT_REACHED'
  | 'COMPANY_FOLDER_NOT_REACHED'
  | 'ROOT_NOT_FOLDER'
  | 'COMPANY_FOLDER_NOT_FOLDER'
  | 'TRASHED'
  | 'FOREIGN_COMPANY_FOLDER'
  | 'ANCESTRY_LIMIT_REACHED'

export type DriveAncestryVerification = {
  allowed: boolean
  reason: DriveAncestryReason
}

export type DriveFile = {
  id: string
  webViewLink: string | null
}

export type GoogleDriveFileMetadata = {
  id: string
  name: string
  mimeType: string
  size: number | null
  webViewLink: string | null
  trashed: boolean
}

type GoogleDriveNode = {
  id: string
  mimeType: string | null
  parents: string[]
  appProperties: Record<string, string>
  trashed: boolean
}

export class GoogleDriveError extends Error {
  readonly status: number | null
  readonly code: string | null
  readonly retryable: boolean

  constructor(message: string, options: { status?: number | null; code?: string | null; retryable?: boolean } = {}) {
    super(message)
    this.name = 'GoogleDriveError'
    this.status = options.status ?? null
    this.code = options.code ?? null
    this.retryable = options.retryable ?? [429, 500, 502, 503, 504].includes(this.status ?? 0)
  }
}

/**
 * Normaliza el campo `error` de una respuesta de Google a un código string estable. La API de
 * Drive puede devolverlo como string, como objeto con `status` (p. ej. `NOT_FOUND`) o como objeto
 * con `errors[0].reason` (p. ej. `notFound`). Nunca se propaga el objeto crudo: los diagnósticos
 * solo registran el código normalizado, jamás mensajes ni cuerpos completos.
 */
const normalizeGoogleErrorCode = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return null
  const record = value as { status?: unknown; code?: unknown; errors?: unknown }
  if (typeof record.status === 'string') return record.status
  const firstError = Array.isArray(record.errors) ? record.errors[0] : null
  if (firstError && typeof firstError === 'object' && typeof (firstError as { reason?: unknown }).reason === 'string') return (firstError as { reason: string }).reason
  if (typeof record.code === 'number') return `HTTP_${record.code}`
  return null
}

const errorDetails = (error: unknown): { status: number | null; code: string | null; message: string } => {
  const candidate = error as { response?: { status?: number; data?: { error?: unknown; error_description?: unknown } }; code?: unknown; message?: string } | null
  const dataError = candidate?.response?.data?.error
  const dataMessage = dataError && typeof dataError === 'object' ? (dataError as { message?: unknown }).message : null
  return {
    status: candidate?.response?.status ?? null,
    code: normalizeGoogleErrorCode(dataError) ?? normalizeGoogleErrorCode(candidate?.code) ?? null,
    message: typeof dataMessage === 'string' ? dataMessage : typeof candidate?.response?.data?.error_description === 'string' ? candidate.response.data.error_description : candidate?.message ?? 'Google Drive request failed',
  }
}

const wrapDriveError = (error: unknown): GoogleDriveError => {
  const details = errorDetails(error)
  return new GoogleDriveError(details.message, {
    status: details.status,
    code: details.code,
  })
}

const requireOAuthConfig = () => {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GOOGLE_OAUTH_REDIRECT_URI) {
    throw new GoogleDriveError('Google OAuth is not configured', { code: 'OAUTH_NOT_CONFIGURED' })
  }
}

const escapeQueryValue = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

const driveOptions = { supportsAllDrives: false } as const

export class GoogleDriveGateway {
  private oauthClient() {
    requireOAuthConfig()
    return new google.auth.OAuth2(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET, env.GOOGLE_OAUTH_REDIRECT_URI)
  }

  authorizationUrl(state: string, codeChallenge: string): string {
    const oauth = this.oauthClient()
    return oauth.generateAuthUrl({
      access_type: 'offline',
      include_granted_scopes: true,
      prompt: 'consent',
      scope: ['openid', 'email', 'profile', env.GOOGLE_DRIVE_SCOPE],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    })
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<GoogleTokens> {
    try {
      const response = await this.oauthClient().getToken({ code, codeVerifier })
      return response.tokens
    } catch (error) {
      throw wrapDriveError(error)
    }
  }

  async identity(tokens: GoogleTokens): Promise<DriveIdentity> {
    try {
      if (!tokens.access_token) throw new GoogleDriveError('Google OAuth did not return an access token', { code: 'OAUTH_ACCESS_TOKEN_MISSING' })
      const profile = await google.oauth2({ version: 'v2' }).tokeninfo({ access_token: tokens.access_token })
      const data = profile.data as oauth2_v2.Schema$Tokeninfo & { user_id?: string; sub?: string }
      const subject = typeof data.user_id === 'string' && data.user_id ? data.user_id : typeof data.sub === 'string' && data.sub ? data.sub : null
      if (!subject) {
        console.warn('[google-drive/identity]', { endpoint: 'google.oauth2.v2.tokeninfo', fields: Object.keys(data).sort() })
        throw new GoogleDriveError('Google OAuth did not return a user subject', { code: 'OAUTH_IDENTITY_MISSING' })
      }
      return { subject, email: data.email ?? null }
    } catch (error) {
      if (error instanceof GoogleDriveError) throw error
      throw wrapDriveError(error)
    }
  }

  async revoke(refreshToken: string): Promise<void> {
    try {
      await this.oauthClient().revokeToken(refreshToken)
    } catch (error) {
      const wrapped = wrapDriveError(error)
      if (wrapped.status !== 400 && wrapped.status !== 404) throw wrapped
    }
  }

  private driveForRefreshToken(refreshToken: string): drive_v3.Drive {
    const oauth = this.oauthClient()
    oauth.setCredentials({ refresh_token: refreshToken })
    return google.drive({ version: 'v3', auth: oauth })
  }

  async accessToken(refreshToken: string): Promise<string> {
    try {
      const oauth = this.oauthClient()
      oauth.setCredentials({ refresh_token: refreshToken })
      const token = (await oauth.getAccessToken()).token
      if (!token) throw new GoogleDriveError('Google OAuth did not return an access token', { code: 'OAUTH_ACCESS_TOKEN_MISSING' })
      return token
    } catch (error) {
      if (error instanceof GoogleDriveError) throw error
      throw wrapDriveError(error)
    }
  }

  async fileMetadata(refreshToken: string, fileId: string): Promise<GoogleDriveFileMetadata> {
    try {
      const response = await this.driveForRefreshToken(refreshToken).files.get({
        ...driveOptions,
        fileId,
        fields: 'id,name,mimeType,size,webViewLink,trashed',
      })
      const file = response.data
      if (!file.id || !file.name || !file.mimeType || file.trashed === true) {
        throw new GoogleDriveError('Google Drive returned an invalid file reference', { code: 'DRIVE_FILE_REFERENCE_INVALID' })
      }
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size ? Number(file.size) : null,
        webViewLink: file.webViewLink ?? null,
        trashed: false,
      }
    } catch (error) {
      if (error instanceof GoogleDriveError) throw error
      throw wrapDriveError(error)
    }
  }

  async verifyFolderRoot(refreshToken: string, folderId: string): Promise<boolean> {
    return (await this.probeFolderRoot(refreshToken, folderId)).accessible
  }

  /**
   * Sonda de solo lectura de la carpeta raíz que distingue por qué no está disponible: 404 (ID
   * incorrecto, carpeta inexistente o no visible para la app porque el scope `drive.file` solo
   * alcanza archivos creados o abiertos con ella), 403 (falta de permisos o alcance insuficiente)
   * y fallos estructurales (no es carpeta, está en la papelera o el ID no coincide). Otros
   * errores de Google se propagan envueltos para que la capa superior registre etapa y estado.
   */
  async probeFolderRoot(refreshToken: string, folderId: string): Promise<FolderRootProbe> {
    try {
      const response = await this.driveForRefreshToken(refreshToken).files.get({ ...driveOptions, fileId: folderId, fields: 'id,mimeType,trashed' })
      const file = response.data
      if (file.id !== folderId) return { accessible: false, reason: 'NOT_FOUND', status: 200, code: null }
      if (file.mimeType !== 'application/vnd.google-apps.folder') return { accessible: false, reason: 'NOT_FOLDER', status: 200, code: null }
      if (file.trashed === true) return { accessible: false, reason: 'TRASHED', status: 200, code: null }
      return { accessible: true, reason: 'OK', status: 200, code: null }
    } catch (error) {
      const wrapped = wrapDriveError(error)
      if (wrapped.status === 404) return { accessible: false, reason: 'NOT_FOUND', status: 404, code: wrapped.code }
      if (wrapped.status === 403) return { accessible: false, reason: 'FORBIDDEN', status: 403, code: wrapped.code }
      throw wrapped
    }
  }

  /**
   * Verifies the complete parent chain from the file up to the effective root and the company
   * folder, including files nested in authorized subfolders. Picker's initial folder is only a UI
   * hint, so this check is deliberately server-side. With the `drive.file` scope, ancestors above
   * the verified chain (for example the My Drive root that owns the connection root) are not
   * readable and answer 404/403: that only fails verification while the required chain has not
   * been fully confirmed. Returns a stable reason label without exposing any folder identifier.
   */
  async verifyFileAncestry(refreshToken: string, fileId: string, rootFolderId: string, authorizedFolderId: string, companyId: string): Promise<DriveAncestryVerification> {
    const drive = this.driveForRefreshToken(refreshToken)
    const pending = [fileId]
    const visited = new Set<string>()
    let reachedRoot = false
    let reachedAuthorizedFolder = rootFolderId === authorizedFolderId
    let attempted = 0
    const verdict = (): DriveAncestryVerification => ({
      allowed: reachedRoot && reachedAuthorizedFolder,
      reason: reachedRoot && reachedAuthorizedFolder ? 'OK' : !reachedRoot ? 'ROOT_NOT_REACHED' : 'COMPANY_FOLDER_NOT_REACHED',
    })
    try {
      while (pending.length > 0 && visited.size < 100) {
        const currentId = pending.shift()!
        if (visited.has(currentId)) continue
        visited.add(currentId)
        attempted += 1
        let file: drive_v3.Schema$File
        try {
          const response = await drive.files.get({ ...driveOptions, fileId: currentId, fields: 'id,mimeType,parents,appProperties,trashed' })
          file = response.data
        } catch (error) {
          const wrapped = wrapDriveError(error)
          if (![403, 404].includes(wrapped.status ?? 0)) throw wrapped
          if (currentId === rootFolderId) return { allowed: false, reason: 'ROOT_UNREACHABLE' }
          if (currentId === authorizedFolderId) return { allowed: false, reason: 'COMPANY_FOLDER_UNREACHABLE' }
          if (attempted === 1) return { allowed: false, reason: 'FILE_UNREACHABLE' }
          return reachedRoot && reachedAuthorizedFolder ? { allowed: true, reason: 'OK' } : verdict()
        }
        const node: GoogleDriveNode = {
          id: file.id ?? currentId,
          mimeType: file.mimeType ?? null,
          parents: file.parents ?? [],
          appProperties: file.appProperties ?? {},
          trashed: file.trashed === true,
        }
        if (node.trashed) return { allowed: false, reason: 'TRASHED' }
        if (node.id === rootFolderId) {
          if (node.mimeType !== 'application/vnd.google-apps.folder') return { allowed: false, reason: 'ROOT_NOT_FOLDER' }
          reachedRoot = true
        }
        if (node.id === authorizedFolderId) {
          if (node.mimeType !== 'application/vnd.google-apps.folder') return { allowed: false, reason: 'COMPANY_FOLDER_NOT_FOLDER' }
          reachedAuthorizedFolder = true
        }
        const taggedCompanyId = node.appProperties.evidentiaCompanyId
        if (node.id !== rootFolderId && taggedCompanyId && taggedCompanyId !== companyId) return { allowed: false, reason: 'FOREIGN_COMPANY_FOLDER' }
        for (const parentId of node.parents) {
          if (!visited.has(parentId)) pending.push(parentId)
        }
      }
      if (pending.length > 0) return { allowed: false, reason: 'ANCESTRY_LIMIT_REACHED' }
      return verdict()
    } catch (error) {
      if (error instanceof GoogleDriveError) throw error
      throw wrapDriveError(error)
    }
  }

  private async listByProperties(drive: drive_v3.Drive, parentId: string | null, properties: Record<string, string>): Promise<drive_v3.Schema$File[]> {
    const clauses = Object.entries(properties).map(([key, value]) => `appProperties has { key='${escapeQueryValue(key)}' and value='${escapeQueryValue(value)}' }`)
    if (parentId) clauses.push(`'${escapeQueryValue(parentId)}' in parents`)
    clauses.push("trashed = false")
    try {
      const response = await drive.files.list({
        ...driveOptions,
        q: clauses.join(' and '),
        fields: 'files(id,name,parents,mimeType,webViewLink,appProperties)',
        spaces: 'drive',
        pageSize: 10,
      })
      return response.data.files ?? []
    } catch (error) {
      throw wrapDriveError(error)
    }
  }

  async ensureRootFolder(refreshToken: string, companyId: string): Promise<DriveFolder> {
    const drive = this.driveForRefreshToken(refreshToken)
    const properties = { evidentiaType: 'root', evidentiaCompanyId: companyId }
    const existing = await this.listByProperties(drive, null, properties)
    if (existing[0]?.id) return { id: existing[0].id, name: existing[0].name ?? null }
    try {
      const created = await drive.files.create({
        ...driveOptions,
        requestBody: { name: `EvidentIA - ${companyId}`, mimeType: 'application/vnd.google-apps.folder', appProperties: properties },
        fields: 'id,name',
      })
      if (!created.data.id) throw new GoogleDriveError('Google Drive did not return the root folder id', { code: 'DRIVE_ID_MISSING' })
      return { id: created.data.id, name: created.data.name ?? null }
    } catch (error) {
      if (error instanceof GoogleDriveError) throw error
      throw wrapDriveError(error)
    }
  }

  async verifyRootFolder(refreshToken: string, folderId: string, companyId: string): Promise<boolean> {
    try {
      const response = await this.driveForRefreshToken(refreshToken).files.get({ ...driveOptions, fileId: folderId, fields: 'id,mimeType,appProperties,trashed' })
      const file = response.data
      return file.id === folderId && file.mimeType === 'application/vnd.google-apps.folder' && file.trashed !== true && file.appProperties?.evidentiaType === 'root' && file.appProperties.evidentiaCompanyId === companyId
    } catch (error) {
      const wrapped = wrapDriveError(error)
      if (wrapped.status === 404) return false
      throw wrapped
    }
  }

  async ensureFolder(refreshToken: string, parentId: string, properties: Record<string, string>, name: string): Promise<DriveFolder> {
    const drive = this.driveForRefreshToken(refreshToken)
    const existing = await this.listByProperties(drive, parentId, properties)
    if (existing[0]?.id) return { id: existing[0].id, name: existing[0].name ?? null }
    try {
      const created = await drive.files.create({
        ...driveOptions,
        requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId], appProperties: properties },
        fields: 'id,name',
      })
      if (!created.data.id) throw new GoogleDriveError('Google Drive did not return a folder id', { code: 'DRIVE_ID_MISSING' })
      return { id: created.data.id, name: created.data.name ?? null }
    } catch (error) {
      if (error instanceof GoogleDriveError) throw error
      throw wrapDriveError(error)
    }
  }

  async verifyFolder(refreshToken: string, folderId: string, parentId: string, properties: Record<string, string>): Promise<boolean> {
    const drive = this.driveForRefreshToken(refreshToken)
    try {
      const response = await drive.files.get({ ...driveOptions, fileId: folderId, fields: 'id,mimeType,parents,appProperties,trashed' })
      const file = response.data
      return file.id === folderId && file.mimeType === 'application/vnd.google-apps.folder' && file.trashed !== true && file.parents?.includes(parentId) === true && Object.entries(properties).every(([key, value]) => file.appProperties?.[key] === value)
    } catch (error) {
      const wrapped = wrapDriveError(error)
      if (wrapped.status === 404) return false
      throw wrapped
    }
  }

  async upload(refreshToken: string, folderId: string, input: { filename: string; mimeType: string; data: Buffer; idempotencyKey: string }): Promise<DriveFile> {
    const drive = this.driveForRefreshToken(refreshToken)
    const existing = await this.listByProperties(drive, folderId, { evidentiaType: 'evidence-file', evidentiaOperationId: input.idempotencyKey })
    if (existing[0]?.id) return { id: existing[0].id, webViewLink: existing[0].webViewLink ?? null }
    try {
      const created = await drive.files.create({
        ...driveOptions,
        requestBody: {
          name: input.filename,
          mimeType: input.mimeType,
          parents: [folderId],
          appProperties: { evidentiaType: 'evidence-file', evidentiaOperationId: input.idempotencyKey },
        },
        media: { mimeType: input.mimeType, body: Readable.from(input.data) },
        fields: 'id,webViewLink',
      })
      if (!created.data.id) throw new GoogleDriveError('Google Drive did not return a file id', { code: 'DRIVE_ID_MISSING' })
      return { id: created.data.id, webViewLink: created.data.webViewLink ?? null }
    } catch (error) {
      if (error instanceof GoogleDriveError) throw error
      throw wrapDriveError(error)
    }
  }

  async read(refreshToken: string, fileId: string): Promise<Buffer> {
    try {
      const response = await this.driveForRefreshToken(refreshToken).files.get({ ...driveOptions, fileId, alt: 'media' }, { responseType: 'arraybuffer' })
      return Buffer.from(response.data as ArrayBuffer)
    } catch (error) {
      throw wrapDriveError(error)
    }
  }

  async remove(refreshToken: string, fileId: string): Promise<void> {
    try {
      await this.driveForRefreshToken(refreshToken).files.delete({ ...driveOptions, fileId })
    } catch (error) {
      const wrapped = wrapDriveError(error)
      if (wrapped.status !== 404) throw wrapped
    }
  }
}
