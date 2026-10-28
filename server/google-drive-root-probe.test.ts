import { beforeEach, describe, expect, it, vi } from 'vitest'

const { filesGetMock } = vi.hoisted(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'oauth-client-id@test.local'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'oauth-client-secret'
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:4000/api/google-drive/oauth/callback'
  return { filesGetMock: vi.fn() }
})

vi.mock('googleapis', () => {
  class OAuth2 {
    setCredentials = vi.fn()
    getAccessToken = vi.fn()
  }
  return {
    google: {
      auth: { OAuth2 },
      drive: () => ({ files: { get: filesGetMock } }),
      oauth2: () => ({ tokeninfo: vi.fn() }),
    },
  }
})

import { GoogleDriveError, GoogleDriveGateway } from './google-drive.js'

describe('GoogleDriveGateway folder root probe', () => {
  const gateway = new GoogleDriveGateway()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports an accessible configured root folder', async () => {
    filesGetMock.mockResolvedValue({ data: { id: 'root-1', mimeType: 'application/vnd.google-apps.folder', trashed: false } })

    await expect(gateway.probeFolderRoot('refresh-token', 'root-1')).resolves.toEqual({ accessible: true, reason: 'OK', status: 200, code: null })
    await expect(gateway.verifyFolderRoot('refresh-token', 'root-1')).resolves.toBe(true)
  })

  it('distinguishes a missing or not-visible folder (404)', async () => {
    filesGetMock.mockRejectedValue({ response: { status: 404, data: { error: { code: 404, message: 'File not found.', status: 'NOT_FOUND' } } } })

    await expect(gateway.probeFolderRoot('refresh-token', 'missing-root')).resolves.toEqual({ accessible: false, reason: 'NOT_FOUND', status: 404, code: 'NOT_FOUND' })
    await expect(gateway.verifyFolderRoot('refresh-token', 'missing-root')).resolves.toBe(false)
  })

  it('distinguishes missing permissions or insufficient OAuth scope (403)', async () => {
    filesGetMock.mockRejectedValue({ response: { status: 403, data: { error: { code: 403, message: 'The user does not have sufficient permissions.', errors: [{ reason: 'insufficientPermissions' }] } } } })

    await expect(gateway.probeFolderRoot('refresh-token', 'shared-root')).resolves.toEqual({ accessible: false, reason: 'FORBIDDEN', status: 403, code: 'insufficientPermissions' })
    await expect(gateway.verifyFolderRoot('refresh-token', 'shared-root')).resolves.toBe(false)
  })

  it('normalizes a plain-string Google error code', async () => {
    filesGetMock.mockRejectedValue({ response: { status: 404, data: { error: 'notFound' } } })

    await expect(gateway.probeFolderRoot('refresh-token', 'root-1')).resolves.toEqual({ accessible: false, reason: 'NOT_FOUND', status: 404, code: 'notFound' })
  })

  it('rejects an id that does not match the returned file', async () => {
    filesGetMock.mockResolvedValue({ data: { id: 'other-id', mimeType: 'application/vnd.google-apps.folder', trashed: false } })

    await expect(gateway.probeFolderRoot('refresh-token', 'root-1')).resolves.toEqual({ accessible: false, reason: 'NOT_FOUND', status: 200, code: null })
  })

  it('rejects a non-folder id and a trashed folder', async () => {
    filesGetMock.mockResolvedValueOnce({ data: { id: 'file-1', mimeType: 'application/pdf', trashed: false } })
    await expect(gateway.probeFolderRoot('refresh-token', 'file-1')).resolves.toEqual({ accessible: false, reason: 'NOT_FOLDER', status: 200, code: null })

    filesGetMock.mockResolvedValueOnce({ data: { id: 'root-1', mimeType: 'application/vnd.google-apps.folder', trashed: true } })
    await expect(gateway.probeFolderRoot('refresh-token', 'root-1')).resolves.toEqual({ accessible: false, reason: 'TRASHED', status: 200, code: null })
  })

  it('propagates Google server errors (500) instead of treating the root as unavailable', async () => {
    filesGetMock.mockRejectedValue({ response: { status: 500, data: { error: { status: 'INTERNAL', message: 'Backend error' } } } })

    const probeError = await gateway.probeFolderRoot('refresh-token', 'root-1').catch((caught: unknown) => caught)
    expect(probeError).toBeInstanceOf(GoogleDriveError)
    expect(probeError).toMatchObject({ status: 500, code: 'INTERNAL' })
    await expect(gateway.verifyFolderRoot('refresh-token', 'root-1')).rejects.toBeInstanceOf(GoogleDriveError)
  })
})
