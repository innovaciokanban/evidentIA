import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProxyHandler } from '../functions/api/[[path]].js'

const frontendOrigin = 'https://frontend.example'
const requestFor = (path, init = {}) => new Request(`https://frontend.example${path}`, init)

describe('Pages API proxy', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards the path, query, cookie and request body to the fixed Render API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
    const request = requestFor('/api/tickets?status=open', {
      method: 'POST',
      headers: {
        Origin: frontendOrigin,
        Cookie: 'kanban_session=session-value',
        'Content-Type': 'application/json',
      },
      body: '{"title":"Ticket"}',
    })

    const response = await createProxyHandler({ FRONTEND_ORIGIN: frontendOrigin })(request)
    const [target, init] = fetchMock.mock.calls[0]

    expect(response.status).toBe(200)
    expect(target.toString()).toBe('https://evidentia-uat-api.onrender.com/api/tickets?status=open')
    expect(init.method).toBe('POST')
    expect(init.headers.get('cookie')).toBe('kanban_session=session-value')
    expect(await new Response(init.body).text()).toBe('{"title":"Ticket"}')
  })

  it('rejects an untrusted Origin before contacting the upstream', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const request = requestFor('/api/auth/login', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
      body: '{}',
    })

    const response = await createProxyHandler({ FRONTEND_ORIGIN: frontendOrigin })(request)

    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves multiple Set-Cookie headers and disables caching for authenticated responses', async () => {
    const upstreamHeaders = new Headers({ 'cache-control': 'public, max-age=3600' })
    upstreamHeaders.append('set-cookie', 'first=one; Path=/')
    upstreamHeaders.append('set-cookie', 'second=two; Path=/; HttpOnly')
    const upstream = new Response('private', {
      status: 200,
      headers: upstreamHeaders,
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstream)
    const request = requestFor('/api/me', {
      headers: {
        Origin: frontendOrigin,
        Cookie: 'kanban_session=session-value',
      },
    })

    const response = await createProxyHandler({ FRONTEND_ORIGIN: frontendOrigin })(request)

    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.getSetCookie()).toEqual(['first=one; Path=/', 'second=two; Path=/; HttpOnly'])
  })

  it('does not follow or expose an upstream redirect', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example' },
    }))

    const response = await createProxyHandler({ FRONTEND_ORIGIN: frontendOrigin })(requestFor('/api/auth/session'))

    expect(response.status).toBe(502)
    expect(response.headers.get('location')).toBeNull()
  })

  it('never uses a request-controlled URL as the upstream destination', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))

    await createProxyHandler({ FRONTEND_ORIGIN: frontendOrigin })(requestFor('/api/https://evil.example/data'))

    expect(fetchMock.mock.calls[0][0].toString()).toBe('https://evidentia-uat-api.onrender.com/api/https://evil.example/data')
  })

  it('does not forward client-supplied proxy trust headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    const request = requestFor('/api/me', {
      headers: {
        Origin: frontendOrigin,
        'X-Forwarded-For': '10.0.0.1',
        'X-Forwarded-Proto': 'http',
        'X-Real-IP': '10.0.0.1',
        'CF-Connecting-IP': '10.0.0.1',
        Forwarded: 'for=10.0.0.1;proto=http;host=evil.example',
      },
    })

    await createProxyHandler({ FRONTEND_ORIGIN: frontendOrigin })(request)

    const forwardedHeaders = fetchMock.mock.calls[0][1].headers
    expect(forwardedHeaders.get('x-forwarded-for')).toBeNull()
    expect(forwardedHeaders.get('x-forwarded-proto')).toBeNull()
    expect(forwardedHeaders.get('x-real-ip')).toBeNull()
    expect(forwardedHeaders.get('cf-connecting-ip')).toBeNull()
    expect(forwardedHeaders.get('forwarded')).toBeNull()
  })
})
