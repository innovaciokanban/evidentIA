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

import { GoogleDriveGateway } from './google-drive.js'

const FOLDER = 'application/vnd.google-apps.folder'
type Fixture = { id: string; mimeType: string; parents: string[]; appProperties: Record<string, string>; trashed: boolean }

const nodes: Record<string, Fixture> = {
  'file-ok': { id: 'file-ok', mimeType: 'application/pdf', parents: ['company-1'], appProperties: {}, trashed: false },
  'company-1': { id: 'company-1', mimeType: FOLDER, parents: ['root-1'], appProperties: { evidentiaType: 'company-folder', evidentiaCompanyId: 'company-x' }, trashed: false },
  'root-1': { id: 'root-1', mimeType: FOLDER, parents: ['my-drive-root'], appProperties: { evidentiaType: 'root', evidentiaCompanyId: 'company-x' }, trashed: false },
  'file-sub': { id: 'file-sub', mimeType: 'application/pdf', parents: ['subfolder-1'], appProperties: {}, trashed: false },
  'subfolder-1': { id: 'subfolder-1', mimeType: FOLDER, parents: ['company-1'], appProperties: {}, trashed: false },
  'file-out': { id: 'file-out', mimeType: 'application/pdf', parents: ['outside-1'], appProperties: {}, trashed: false },
  'outside-1': { id: 'outside-1', mimeType: FOLDER, parents: [], appProperties: {}, trashed: false },
  'file-foreign': { id: 'file-foreign', mimeType: 'application/pdf', parents: ['company-y-folder'], appProperties: {}, trashed: false },
  'company-y-folder': { id: 'company-y-folder', mimeType: FOLDER, parents: ['root-1'], appProperties: { evidentiaType: 'company-folder', evidentiaCompanyId: 'company-y' }, trashed: false },
  'file-old': { id: 'file-old', mimeType: 'application/pdf', parents: ['company-old'], appProperties: {}, trashed: false },
  'company-old': { id: 'company-old', mimeType: FOLDER, parents: ['root-old'], appProperties: { evidentiaType: 'company-folder', evidentiaCompanyId: 'company-x' }, trashed: false },
  'root-old': { id: 'root-old', mimeType: FOLDER, parents: ['my-drive-root'], appProperties: { evidentiaType: 'root', evidentiaCompanyId: 'company-x' }, trashed: false },
  'file-root-only': { id: 'file-root-only', mimeType: 'application/pdf', parents: ['root-1'], appProperties: {}, trashed: false },
  'file-bad-root': { id: 'file-bad-root', mimeType: 'application/pdf', parents: ['root-gone'], appProperties: {}, trashed: false },
}

const notFound = () => ({ response: { status: 404, data: { error: { code: 404, message: 'File not found.', status: 'NOT_FOUND' } } } })

describe('GoogleDriveGateway file ancestry verification', () => {
  const gateway = new GoogleDriveGateway()

  beforeEach(() => {
    vi.clearAllMocks()
    filesGetMock.mockImplementation(async ({ fileId }: { fileId: string }) => {
      if (fileId === 'my-drive-root' || fileId === 'root-gone' || fileId === 'file-gone') throw notFound()
      const node = nodes[fileId]
      if (!node) throw notFound()
      return { data: node }
    })
  })

  it('accepts a PDF inside the company folder even though the My Drive root above the connection root answers 404', async () => {
    await expect(gateway.verifyFileAncestry('refresh-token', 'file-ok', 'root-1', 'company-1', 'company-x')).resolves.toEqual({ allowed: true, reason: 'OK' })
  })

  it('accepts a PDF inside an authorized subfolder of the company folder', async () => {
    await expect(gateway.verifyFileAncestry('refresh-token', 'file-sub', 'root-1', 'company-1', 'company-x')).resolves.toEqual({ allowed: true, reason: 'OK' })
  })

  it('rejects a file outside the effective root', async () => {
    await expect(gateway.verifyFileAncestry('refresh-token', 'file-out', 'root-1', 'company-1', 'company-x')).resolves.toEqual({ allowed: false, reason: 'ROOT_NOT_REACHED' })
  })

  it('rejects a file inside another company folder without reaching the authorized one', async () => {
    await expect(gateway.verifyFileAncestry('refresh-token', 'file-foreign', 'root-1', 'company-1', 'company-x')).resolves.toEqual({ allowed: false, reason: 'FOREIGN_COMPANY_FOLDER' })
  })

  it('rejects when the file metadata cannot be read with the drive.file scope', async () => {
    await expect(gateway.verifyFileAncestry('refresh-token', 'file-gone', 'root-1', 'company-1', 'company-x')).resolves.toEqual({ allowed: false, reason: 'FILE_UNREACHABLE' })
  })

  it('reports a company folder that is not under the effective root as the wrong root', async () => {
    await expect(gateway.verifyFileAncestry('refresh-token', 'file-old', 'root-1', 'company-old', 'company-x')).resolves.toEqual({ allowed: false, reason: 'ROOT_NOT_REACHED' })
  })

  it('reports a root that cannot be read as unreachable', async () => {
    await expect(gateway.verifyFileAncestry('refresh-token', 'file-bad-root', 'root-gone', 'company-1', 'company-x')).resolves.toEqual({ allowed: false, reason: 'ROOT_UNREACHABLE' })
  })

  it('rejects a file directly under the root when it is not inside the company folder', async () => {
    await expect(gateway.verifyFileAncestry('refresh-token', 'file-root-only', 'root-1', 'company-1', 'company-x')).resolves.toEqual({ allowed: false, reason: 'COMPANY_FOLDER_NOT_REACHED' })
  })
})
