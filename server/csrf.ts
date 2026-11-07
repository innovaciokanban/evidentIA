import type { NextFunction, Request, Response } from 'express'

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const ORIGIN_REQUIRED_PATHS = new Set(['/api/auth/login', '/api/auth/logout'])
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'same-site', 'cross-site', 'none'])

type CsrfOptions = {
  trustedOrigins: ReadonlySet<string>
  sessionCookieName: string
}

const reject = (response: Response) => response.status(403).json({ error: 'CSRF validation failed' })

/**
 * Cookie-authenticated state changes require an exact trusted Origin. Bearer-only requests do not
 * carry browser credentials automatically, so they remain usable by non-browser API clients.
 * If both credentials are present, the cookie path wins in auth.ts and this guard still applies.
 */
export const csrfProtection = ({ trustedOrigins, sessionCookieName }: CsrfOptions) => (request: Request, response: Response, next: NextFunction): void => {
  if (!STATE_CHANGING_METHODS.has(request.method)) {
    next()
    return
  }

  const hasSessionCookie = Boolean(request.cookies?.[sessionCookieName])
  const requiresOrigin = hasSessionCookie || ORIGIN_REQUIRED_PATHS.has(request.path)
  if (!requiresOrigin) {
    next()
    return
  }

  const origin = request.header('origin')
  if (!origin || origin === 'null' || !trustedOrigins.has(origin)) {
    reject(response)
    return
  }

  const fetchSite = request.header('sec-fetch-site')?.toLowerCase()
  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) {
    reject(response)
    return
  }

  next()
}
