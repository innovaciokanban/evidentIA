import bcrypt from 'bcryptjs'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
  process.env.GOOGLE_PICKER_API_KEY = 'test-developer-key'
  process.env.GOOGLE_PICKER_APP_ID = '123456789012'
  process.env.GOOGLE_DRIVE_EVIDENCE_ROOT_FOLDER_ID = 'env-root-configured'
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'oauth-client-id@test.local'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'oauth-client-secret'
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:4000/api/google-drive/oauth/callback'
})

import { type PrismaClient, type Role } from '@prisma/client'
import { createApp } from './app.js'
import { GoogleDriveError } from './google-drive.js'
import { encryptOAuthSecret } from './oauth-crypto.js'

const FOLDER_FLOW_TAG = '[google-drive/folder-flow]'
const company = { id: 'cmcompanydriveticket001' }
const user = { id: 'cmadmindriveticket001', email: 'drive-admin@test.local', name: 'Drive Admin', role: 'COMPANY_ADMIN' as Role, companyId: company.id }
const passwordHash = bcrypt.hashSync('Password123!', 4)
const connection = { id: 'cmconnectiondrive0000001', companyId: company.id, encryptedRefreshToken: encryptOAuthSecret('refresh-token-test'), rootFolderId: 'app-created-root', status: 'CONNECTED' }
const ticket = { id: 'tckdrive0000000000000001', createdBy: { companyId: company.id }, assignedTo: null, actionItem: null, riskApprovals: [] }

function makeDriveDb() {
  let sessionActive = false
  let companyDriveFolderId: string | null = null
  const db: Record<string, any> = {
    user: { findUnique: vi.fn(async () => ({ ...user, passwordHash })) },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-drive-1', expiresAt: new Date(Date.now() + 3600_000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-drive-1', expiresAt: new Date(Date.now() + 3600_000), user } : null),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      delete: vi.fn(async () => ({ id: 'session-drive-1' })),
    },
    ticket: { findUnique: vi.fn(async () => ({ ...ticket })) },
    company: {
      findUnique: vi.fn(async () => ({ id: company.id, driveFolderId: companyDriveFolderId })),
      update: vi.fn(async ({ data }: { data: { driveFolderId: string } }) => { companyDriveFolderId = data.driveFolderId; return { id: company.id, ...data } }),
    },
    companyGoogleDriveConnection: { findFirst: vi.fn(async () => ({ ...connection })) },
    ticketDriveReference: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ref-drive-1', createdAt: new Date(), updatedAt: new Date(), ...data, createdBy: { id: user.id, name: user.name } })),
    },
    $transaction: vi.fn(async (operation: (client: unknown) => Promise<unknown>) => operation(db)),
  }
  return {
    db: db as unknown as PrismaClient,
    getDriveFolderId: () => companyDriveFolderId,
    setDriveFolderId: (value: string | null) => { companyDriveFolderId = value },
  }
}

function makeGateway() {
  return {
    authorizationUrl: vi.fn(() => 'https://accounts.google.test/oauth'),
    exchangeCode: vi.fn(),
    identity: vi.fn(),
    ensureRootFolder: vi.fn(),
    revoke: vi.fn(),
    accessToken: vi.fn(async () => 'picker-access-token'),
    probeFolderRoot: vi.fn(async (): Promise<{ accessible: boolean; reason: string; status: number | null; code: string | null }> => ({ accessible: true, reason: 'OK', status: 200, code: null })),
    verifyRootFolder: vi.fn(async () => true),
    verifyFolder: vi.fn(async () => true),
    ensureFolder: vi.fn(async (_token: string, _parentId: string, _properties: Record<string, string>, name: string) => ({ id: 'company-subfolder-new', name })),
    fileMetadata: vi.fn(),
    verifyFileAncestry: vi.fn(async () => ({ allowed: true, reason: 'OK' })),
  }
}

const connectedAgent = async (db: PrismaClient, gateway: ReturnType<typeof makeGateway>) => {
  const agent = request.agent(createApp(db, undefined, undefined, gateway as never))
  await agent.post('/api/auth/login').send({ email: user.email, password: 'Password123!' })
  return agent
}

describe('ticket Google Drive evidence selection', () => {
  it('serves the configured root when it is accessible and reuses a valid company subfolder', async () => {
    const harness = makeDriveDb()
    harness.setDriveFolderId('existing-company-subfolder')
    const gateway = makeGateway()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      const agent = await connectedAgent(harness.db, gateway)
      const response = await agent.get(`/api/tickets/${ticket.id}/google-drive/picker-config`)

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ accessToken: 'picker-access-token', developerKey: 'test-developer-key', appId: '123456789012', rootFolderId: 'env-root-configured', companyFolderId: 'existing-company-subfolder' })
      expect(gateway.probeFolderRoot).toHaveBeenCalledWith('refresh-token-test', 'env-root-configured')
      expect(gateway.verifyFolder).toHaveBeenCalledWith('refresh-token-test', 'existing-company-subfolder', 'env-root-configured', { evidentiaType: 'company-folder', evidentiaCompanyId: company.id })
      expect(gateway.ensureFolder).not.toHaveBeenCalled()
      expect(warn.mock.calls.filter((call) => call[0] === FOLDER_FLOW_TAG)).toHaveLength(0)
      expect(info).toHaveBeenCalledWith(FOLDER_FLOW_TAG, expect.objectContaining({ stage: 'VERIFY_CONFIGURED_ROOT', source: 'configured', reason: 'OK', googleStatus: 200, correlationId: expect.any(String) }))
    } finally {
      warn.mockRestore()
      info.mockRestore()
    }
  })

  it('falls back to the connection root when the configured root is not visible to the app (404)', async () => {
    const harness = makeDriveDb()
    const gateway = makeGateway()
    gateway.probeFolderRoot
      .mockResolvedValueOnce({ accessible: false, reason: 'NOT_FOUND', status: 404, code: 'fileNotVisibleToApp' })
      .mockResolvedValueOnce({ accessible: true, reason: 'OK', status: 200, code: null })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      const agent = await connectedAgent(harness.db, gateway)
      const response = await agent.get(`/api/tickets/${ticket.id}/google-drive/picker-config`)

      expect(response.status).toBe(200)
      expect(response.body.rootFolderId).toBe('app-created-root')
      expect(response.body.companyFolderId).toBe('company-subfolder-new')
      expect(gateway.verifyRootFolder).toHaveBeenCalledWith('refresh-token-test', 'app-created-root', company.id)
      expect(gateway.ensureFolder).toHaveBeenCalledWith('refresh-token-test', 'app-created-root', { evidentiaType: 'company-folder', evidentiaCompanyId: company.id }, `Empresa ${company.id}`)
      expect(warn).toHaveBeenCalledWith(FOLDER_FLOW_TAG, expect.objectContaining({ stage: 'VERIFY_CONFIGURED_ROOT', source: 'configured', reason: 'NOT_FOUND', googleStatus: 404, googleCode: 'fileNotVisibleToApp', correlationId: expect.any(String) }))
      expect(info).toHaveBeenCalledWith(FOLDER_FLOW_TAG, expect.objectContaining({ stage: 'VERIFY_CONNECTION_ROOT', source: 'connection', reason: 'OK', googleStatus: 200, correlationId: expect.any(String) }))
      expect(harness.getDriveFolderId()).toBe('company-subfolder-new')
    } finally {
      warn.mockRestore()
      info.mockRestore()
    }
  })

  it('keeps the generic 503 when neither the configured nor the connection root is available', async () => {
    const harness = makeDriveDb()
    const gateway = makeGateway()
    gateway.probeFolderRoot.mockResolvedValue({ accessible: false, reason: 'NOT_FOUND', status: 404, code: null })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const agent = await connectedAgent(harness.db, gateway)
      const response = await agent.get(`/api/tickets/${ticket.id}/google-drive/picker-config`)

      expect(response.status).toBe(503)
      expect(response.body.error).toBe('La carpeta raíz o la subcarpeta de la empresa no está disponible en Google Drive')
      expect(gateway.verifyRootFolder).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(FOLDER_FLOW_TAG, expect.objectContaining({ stage: 'VERIFY_CONNECTION_ROOT', source: 'connection', reason: 'NOT_FOUND', googleStatus: 404, correlationId: expect.any(String) }))
    } finally {
      warn.mockRestore()
    }
  })

  it('distinguishes missing permissions (403) when validating the connection root', async () => {
    const harness = makeDriveDb()
    const gateway = makeGateway()
    gateway.probeFolderRoot
      .mockResolvedValueOnce({ accessible: false, reason: 'FORBIDDEN', status: 403, code: 'insufficientPermissions' })
      .mockResolvedValueOnce({ accessible: true, reason: 'OK', status: 200, code: null })
    gateway.verifyRootFolder.mockRejectedValueOnce(new GoogleDriveError('denied', { status: 403, code: 'insufficientPermissions' }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const agent = await connectedAgent(harness.db, gateway)
      const response = await agent.get(`/api/tickets/${ticket.id}/google-drive/picker-config`)

      expect(response.status).toBe(502)
      expect(response.body.error).toBe('No se pudo preparar Google Picker')
      expect(warn).toHaveBeenCalledWith(FOLDER_FLOW_TAG, expect.objectContaining({ stage: 'VERIFY_CONFIGURED_ROOT', reason: 'FORBIDDEN', googleStatus: 403, correlationId: expect.any(String) }))
      expect(warn).toHaveBeenCalledWith(FOLDER_FLOW_TAG, expect.objectContaining({ stage: 'VERIFY_CONNECTION_ROOT', googleStatus: 403, googleCode: 'insufficientPermissions', correlationId: expect.any(String) }))
    } finally {
      warn.mockRestore()
    }
  })

  it('reports Google server errors (500) by stage with correlation id', async () => {
    const harness = makeDriveDb()
    const gateway = makeGateway()
    gateway.probeFolderRoot.mockRejectedValueOnce(new GoogleDriveError('backend error', { status: 500, code: 'internalError' }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const agent = await connectedAgent(harness.db, gateway)
      const response = await agent.get(`/api/tickets/${ticket.id}/google-drive/picker-config`)

      expect(response.status).toBe(503)
      expect(response.body.error).toBe('No se pudo preparar Google Picker')
      expect(warn).toHaveBeenCalledWith(FOLDER_FLOW_TAG, expect.objectContaining({ stage: 'VERIFY_CONFIGURED_ROOT', googleStatus: 500, googleCode: 'internalError', correlationId: expect.any(String) }))
    } finally {
      warn.mockRestore()
    }
  })

  it('associates a PDF after validating root, subfolder and file ancestry', async () => {
    const harness = makeDriveDb()
    harness.setDriveFolderId('existing-company-subfolder')
    const gateway = makeGateway()
    gateway.fileMetadata.mockResolvedValueOnce({ id: 'file-123', name: 'evidence.pdf', mimeType: 'application/pdf', size: 1024, webViewLink: 'https://drive.google.com/file/d/file-123/view', trashed: false })
    try {
      const agent = await connectedAgent(harness.db, gateway)
      const response = await agent.post(`/api/tickets/${ticket.id}/drive-evidence`).send({ driveFileId: 'file-123' })

      expect(response.status).toBe(201)
      expect(response.body.reference).toMatchObject({ driveFileId: 'file-123', filename: 'evidence.pdf', mimeType: 'application/pdf', size: 1024, driveUrl: 'https://drive.google.com/file/d/file-123/view' })
      expect(gateway.verifyFileAncestry).toHaveBeenCalledWith('refresh-token-test', 'file-123', 'env-root-configured', 'existing-company-subfolder', company.id)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('rejects a file outside the authorized folder ancestry', async () => {
    const harness = makeDriveDb()
    harness.setDriveFolderId('existing-company-subfolder')
    const gateway = makeGateway()
    gateway.fileMetadata.mockResolvedValueOnce({ id: 'file-456', name: 'outside.pdf', mimeType: 'application/pdf', size: 2048, webViewLink: null, trashed: false })
    gateway.verifyFileAncestry.mockResolvedValueOnce({ allowed: false, reason: 'ROOT_NOT_REACHED' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const agent = await connectedAgent(harness.db, gateway)
      const response = await agent.post(`/api/tickets/${ticket.id}/drive-evidence`).send({ driveFileId: 'file-456' })

      expect(response.status).toBe(422)
      expect(response.body.error).toBe('El archivo debe pertenecer a la carpeta raíz de EvidentIA y a la subcarpeta autorizada de la empresa')
      expect(warn).toHaveBeenCalledWith(FOLDER_FLOW_TAG, expect.objectContaining({ stage: 'VERIFY_FILE_ANCESTRY', reason: 'ROOT_NOT_REACHED', correlationId: expect.any(String) }))
    } finally {
      warn.mockRestore()
    }
  })

  it('logs the metadata stage when Google cannot resolve the selected file', async () => {
    const harness = makeDriveDb()
    harness.setDriveFolderId('existing-company-subfolder')
    const gateway = makeGateway()
    gateway.fileMetadata.mockRejectedValueOnce(new GoogleDriveError('gone', { status: 404, code: 'notFound' }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const agent = await connectedAgent(harness.db, gateway)
      const response = await agent.post(`/api/tickets/${ticket.id}/drive-evidence`).send({ driveFileId: 'file-789' })

      expect(response.status).toBe(422)
      expect(response.body.error).toBe('El archivo no está disponible para la conexión Google Drive de la empresa')
      expect(warn).toHaveBeenCalledWith(FOLDER_FLOW_TAG, expect.objectContaining({ stage: 'FETCH_FILE_METADATA', googleStatus: 404, googleCode: 'notFound', correlationId: expect.any(String) }))
    } finally {
      warn.mockRestore()
    }
  })
})
