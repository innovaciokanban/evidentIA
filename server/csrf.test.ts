import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { csrfProtection } from './csrf.js'

const trustedOrigin = 'http://localhost:5173'

const runGuard = (input: { method?: string; path?: string; cookie?: boolean; origin?: string; fetchSite?: string; bearer?: boolean }) => {
  const headers = new Map<string, string>()
  if (input.origin !== undefined) headers.set('origin', input.origin)
  if (input.fetchSite !== undefined) headers.set('sec-fetch-site', input.fetchSite)
  if (input.bearer) headers.set('authorization', 'Bearer opaque-token')
  const request = {
    method: input.method ?? 'POST',
    path: input.path ?? '/api/notifications/read-all',
    cookies: input.cookie === false ? {} : { kanban_session: 'opaque-cookie' },
    header: (name: string) => headers.get(name.toLowerCase()),
  } as unknown as Request
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response
  const next = vi.fn() as unknown as NextFunction
  csrfProtection({ trustedOrigins: new Set([trustedOrigin]), sessionCookieName: 'kanban_session' })(request, response, next)
  return { response, next }
}

describe('csrfProtection', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('allows %s with a trusted Origin and cookie', (method) => {
    const result = runGuard({ method, origin: trustedOrigin })
    expect(result.next).toHaveBeenCalledOnce()
    expect(result.response.status).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects %s with an external Origin and cookie', (method) => {
    const result = runGuard({ method, origin: 'https://evil.example' })
    expect(result.response.status).toHaveBeenCalledWith(403)
    expect(result.next).not.toHaveBeenCalled()
  })

  it('rejects missing and null Origin for cookie-authenticated writes', () => {
    for (const origin of [undefined, 'null']) {
      const result = runGuard({ origin })
      expect(result.response.status).toHaveBeenCalledWith(403)
      expect(result.next).not.toHaveBeenCalled()
    }
  })

  it('protects login and logout even before a session cookie exists', () => {
    const login = runGuard({ path: '/api/auth/login', cookie: false })
    const logout = runGuard({ path: '/api/auth/logout', cookie: false, origin: 'https://evil.example' })
    expect(login.response.status).toHaveBeenCalledWith(403)
    expect(logout.response.status).toHaveBeenCalledWith(403)
  })

  it('allows a bearer-only API client without browser Origin credentials', () => {
    const result = runGuard({ cookie: false, bearer: true })
    expect(result.next).toHaveBeenCalledOnce()
    expect(result.response.status).not.toHaveBeenCalled()
  })

  it('does not let Bearer bypass CSRF when a session cookie is also present', () => {
    const result = runGuard({ bearer: true, origin: 'https://evil.example' })
    expect(result.response.status).toHaveBeenCalledWith(403)
    expect(result.next).not.toHaveBeenCalled()
  })

  it('allows cross-site Fetch Metadata when Origin is trusted', () => {
    const result = runGuard({ origin: trustedOrigin, fetchSite: 'cross-site' })
    expect(result.next).toHaveBeenCalledOnce()
    expect(result.response.status).not.toHaveBeenCalled()
  })

  it.each(['/api/auth/login', '/api/auth/logout', '/api/notifications/read-all'])('rejects cross-site %s with an incorrect Origin', (path) => {
    const result = runGuard({ path, origin: 'https://evil.example', fetchSite: 'cross-site' })
    expect(result.response.status).toHaveBeenCalledWith(403)
    expect(result.next).not.toHaveBeenCalled()
  })

  it.each(['/api/auth/login', '/api/auth/logout', '/api/notifications/read-all'])('rejects cross-site %s with a missing or null Origin', (path) => {
    for (const origin of [undefined, 'null']) {
      const result = runGuard({ path, origin, fetchSite: 'cross-site' })
      expect(result.response.status).toHaveBeenCalledWith(403)
      expect(result.next).not.toHaveBeenCalled()
    }
  })

  it('does not apply the unsafe-method guard to the OAuth callback GET', () => {
    const result = runGuard({ method: 'GET', path: '/api/google-drive/oauth/callback', origin: 'https://accounts.google.com' })
    expect(result.next).toHaveBeenCalledOnce()
    expect(result.response.status).not.toHaveBeenCalled()
  })
})
