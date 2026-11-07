const UPSTREAM_ORIGIN = 'https://evidentia-uat-api.onrender.com'
const DEFAULT_FRONTEND_ORIGIN = 'https://evidentia-4z8.pages.dev'
const SESSION_COOKIE_NAME = 'kanban_session'

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const ORIGIN_REQUIRED_PATHS = new Set(['/api/auth/login', '/api/auth/logout'])
const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]
const CLIENT_CONTROLLED_PROXY_HEADERS = [
  'forwarded',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-forwarded-server',
  'x-forwarded-uri',
  'x-real-ip',
  'x-client-ip',
  'x-cluster-client-ip',
  'x-envoy-external-address',
  'x-envoy-original-path',
  'x-original-url',
  'x-rewrite-url',
  'true-client-ip',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
]
const CORS_RESPONSE_HEADERS = [
  'access-control-allow-credentials',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-allow-origin',
  'access-control-expose-headers',
]

const normalizeOrigin = (value) => {
  if (!value) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

const allowedOriginsFor = (env = {}) => new Set([
  DEFAULT_FRONTEND_ORIGIN,
  UPSTREAM_ORIGIN,
  normalizeOrigin(env.FRONTEND_ORIGIN),
  normalizeOrigin(env.RENDER_API_ORIGIN),
].filter(Boolean))

const hasCookie = (request) => {
  const cookieHeader = request.headers.get('cookie') ?? ''
  return new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}=`).test(cookieHeader)
}

const isAuthenticatedRequest = (request) => hasCookie(request) || Boolean(request.headers.get('authorization'))

const appendVaryOrigin = (headers) => {
  const vary = headers.get('vary')
  headers.set('vary', vary ? `${vary}, Origin` : 'Origin')
}

const splitSetCookieHeader = (value) => value.split(/,\s*(?=[^;,=\s]+=[^;,]*)/)

const setCookieValues = (headers) => {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie().flatMap(splitSetCookieHeader)
  const combined = headers.get('set-cookie')
  return combined ? splitSetCookieHeader(combined) : []
}

const responseFor = (status, body, origin) => {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  if (origin) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-credentials', 'true')
    appendVaryOrigin(headers)
  }
  return new Response(JSON.stringify(body), { status, headers })
}

const proxyRequest = async (request, env = {}) => {
  const url = new URL(request.url)
  const allowedOrigins = allowedOriginsFor(env)
  const origin = request.headers.get('origin')
  const trustedOrigin = origin !== null && origin !== 'null' && allowedOrigins.has(origin)
  const requiresOrigin = STATE_CHANGING_METHODS.has(request.method) && (
    hasCookie(request) || ORIGIN_REQUIRED_PATHS.has(url.pathname)
  )

  if (origin !== null && !trustedOrigin || requiresOrigin && !trustedOrigin) {
    return responseFor(403, { error: 'CSRF validation failed' }, trustedOrigin ? origin : undefined)
  }

  const target = new URL(UPSTREAM_ORIGIN)
  target.pathname = url.pathname
  target.search = url.search
  const headers = new Headers(request.headers)
  for (const header of HOP_BY_HOP_HEADERS) headers.delete(header)
  for (const header of CLIENT_CONTROLLED_PROXY_HEADERS) headers.delete(header)

  let upstreamResponse
  try {
    upstreamResponse = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    })
  } catch {
    return responseFor(502, { error: 'Upstream API unavailable' }, trustedOrigin ? origin : undefined)
  }

  if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
    return responseFor(502, { error: 'Upstream redirect rejected' }, trustedOrigin ? origin : undefined)
  }

  const responseHeaders = new Headers(upstreamResponse.headers)
  const cookies = setCookieValues(upstreamResponse.headers)
  responseHeaders.delete('set-cookie')
  for (const header of HOP_BY_HOP_HEADERS) responseHeaders.delete(header)
  for (const header of CORS_RESPONSE_HEADERS) responseHeaders.delete(header)

  if (trustedOrigin) {
    responseHeaders.set('access-control-allow-origin', origin)
    responseHeaders.set('access-control-allow-credentials', 'true')
    appendVaryOrigin(responseHeaders)
  }
  if (isAuthenticatedRequest(request) || cookies.length > 0) responseHeaders.set('cache-control', 'no-store')
  for (const cookie of cookies) responseHeaders.append('set-cookie', cookie)

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  })
}

export const createProxyHandler = (env = {}) => (request) => proxyRequest(request, env)

export const onRequest = ({ request, env }) => proxyRequest(request, env)
