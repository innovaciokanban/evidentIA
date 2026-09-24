import { createHash, randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { PrismaClient, Role } from '@prisma/client'
import { env } from './env.js'

export const publicUser = (user: { id: string; email: string; name: string; role: Role; companyId: string | null }) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  companyId: user.companyId,
})

export const requireAuth = (db: PrismaClient) => authenticate(db)

export const requireRole = (...roles: Role[]) => (request: Request, response: Response, next: NextFunction) => {
  if (!request.user || !roles.includes(request.user.role)) {
    response.status(403).json({ error: 'Insufficient permissions' })
    return
  }
  next()
}

export const authorize = requireRole

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export const createSession = async (db: PrismaClient, userId: string, response: Response) => {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + env.SESSION_DAYS * 24 * 60 * 60 * 1000)
  const session = await db.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } })
  response.cookie(env.SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: env.NODE_ENV === 'production',
    expires: session.expiresAt,
    path: '/',
  })
}

export const authenticate = (db: PrismaClient) => async (request: Request, response: Response, next: NextFunction) => {
  try {
    const cookieToken = request.cookies?.[env.SESSION_COOKIE]
    const authorization = request.header('authorization')
    const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
    const token = cookieToken ?? bearerToken
    if (!token) {
      response.status(401).json({ error: 'Authentication required' })
      return
    }

    const session = await db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    })
    if (!session || session.expiresAt <= new Date()) {
      if (session) await db.session.delete({ where: { id: session.id } }).catch(() => undefined)
      clearSessionCookie(response)
      response.status(401).json({ error: 'Authentication required' })
      return
    }

    request.user = publicUser(session.user)
    request.sessionId = session.id
    next()
  } catch {
    response.status(401).json({ error: 'Authentication required' })
  }
}

export const clearSessionCookie = (response: Response) => response.clearCookie(env.SESSION_COOKIE, { httpOnly: true, sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax', secure: env.NODE_ENV === 'production', path: '/' })