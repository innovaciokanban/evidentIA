import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tokeninfoMock, generateAuthUrlMock } = vi.hoisted(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'oauth-client-id@test.local'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'oauth-client-secret'
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:4000/api/google-drive/oauth/callback'
  return {
    tokeninfoMock: vi.fn(),
    generateAuthUrlMock: vi.fn((options: { scope?: string[]; access_type?: string; prompt?: string; state?: string; code_challenge?: string }) => {
      void options
      return 'https://accounts.google.test/o/oauth2/v2/auth'
    }),
  }
})

vi.mock('googleapis', () => {
  class OAuth2 {
    generateAuthUrl = generateAuthUrlMock
    revokeToken = vi.fn()
    setCredentials = vi.fn()
    getAccessToken = vi.fn()
  }
  return { google: { auth: { OAuth2 }, oauth2: () => ({ tokeninfo: tokeninfoMock }) } }
})

import { GoogleDriveError, GoogleDriveGateway } from './google-drive.js'

describe('GoogleDriveGateway identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests identity scopes together with the Drive scope', () => {
    new GoogleDriveGateway().authorizationUrl('state-123', 'challenge-456')

    expect(generateAuthUrlMock).toHaveBeenCalledTimes(1)
    const options = generateAuthUrlMock.mock.calls[0]![0]
    expect(options.scope).toEqual(['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'])
    expect(options.access_type).toBe('offline')
    expect(options.prompt).toBe('consent')
    expect(options.state).toBe('state-123')
    expect(options.code_challenge).toBe('challenge-456')
  })

  it('returns the tokeninfo subject and email for a complete identity response', async () => {
    tokeninfoMock.mockResolvedValueOnce({ data: { user_id: 'subject-123', email: 'user@example.test', scope: 'openid email profile https://www.googleapis.com/auth/drive.file' } })

    const identity = await new GoogleDriveGateway().identity({ access_token: 'access-token' })

    expect(identity).toEqual({ subject: 'subject-123', email: 'user@example.test' })
    expect(tokeninfoMock).toHaveBeenCalledWith({ access_token: 'access-token' })
  })

  it('accepts the OIDC sub claim when user_id is absent', async () => {
    tokeninfoMock.mockResolvedValueOnce({ data: { sub: 'subject-456' } })

    const identity = await new GoogleDriveGateway().identity({ access_token: 'access-token' })

    expect(identity).toEqual({ subject: 'subject-456', email: null })
  })

  it('throws OAUTH_IDENTITY_MISSING logging only the endpoint and received field names', async () => {
    tokeninfoMock.mockResolvedValueOnce({ data: { aud: 'audience-value', scope: 'https://www.googleapis.com/auth/drive.file', exp: 1793000000 } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      await expect(new GoogleDriveGateway().identity({ access_token: 'access-token-secret' })).rejects.toMatchObject({ name: 'GoogleDriveError', code: 'OAUTH_IDENTITY_MISSING' })

      expect(warn).toHaveBeenCalledWith('[google-drive/identity]', { endpoint: 'google.oauth2.v2.tokeninfo', fields: ['aud', 'exp', 'scope'] })
      const logged = JSON.stringify(warn.mock.calls)
      expect(logged).not.toContain('access-token-secret')
      expect(logged).not.toContain('audience-value')
    } finally {
      warn.mockRestore()
    }
  })

  it('rejects empty-string identifiers from the identity response', async () => {
    tokeninfoMock.mockResolvedValueOnce({ data: { user_id: '', sub: '' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      await expect(new GoogleDriveGateway().identity({ access_token: 'access-token' })).rejects.toMatchObject({ code: 'OAUTH_IDENTITY_MISSING' })
      expect(warn).toHaveBeenCalledWith('[google-drive/identity]', { endpoint: 'google.oauth2.v2.tokeninfo', fields: ['sub', 'user_id'] })
    } finally {
      warn.mockRestore()
    }
  })

  it('rejects without calling tokeninfo when the access token is missing', async () => {
    await expect(new GoogleDriveGateway().identity({})).rejects.toMatchObject({ code: 'OAUTH_ACCESS_TOKEN_MISSING' })
    expect(tokeninfoMock).not.toHaveBeenCalled()
  })

  it('wraps Google tokeninfo failures without exposing the access token', async () => {
    tokeninfoMock.mockRejectedValueOnce({ response: { status: 401, data: { error: 'invalid_token' } }, message: 'invalid_token: access token expired' })

    const error = await new GoogleDriveGateway().identity({ access_token: 'access-token-secret' }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GoogleDriveError)
    expect(error).toMatchObject({ status: 401, code: 'invalid_token' })
    expect((error as Error).message).not.toContain('access-token-secret')
  })
})
