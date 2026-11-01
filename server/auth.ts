import { createHash, randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { Prisma, PrismaClient, Role } from '@prisma/client'
import { env } from './env.js'

type AuthUser = { id: string; email: string; name: string; role: Role; companyId: string | null; isActive?: boolean }

export const publicUser = (user: AuthUser) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  companyId: user.companyId,
  isActive: user.isActive !== false,
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

export const revokeUserSessions = async (db: PrismaClient | Prisma.TransactionClient, userId: string): Promise<number> => {
  const result = await db.session.deleteMany({ where: { userId } })
  return result.count
}

export type CreatedSession = { token: string; expiresAt: Date }

/**
 * Authentication lifecycle transactions lock the User row before changing isActive or sessions.
 * Login and deactivation use this exact lock so the winner of the row lock defines the outcome.
 */
export const lockUserForUpdate = async (db: Prisma.TransactionClient, userId: string): Promise<void> => {
  if (typeof db.$queryRaw !== 'function') return
  await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`
}

const setSessionCookie = (response: Response, token: string, expiresAt: Date) => {
  response.cookie(env.SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: env.NODE_ENV === 'production',
    expires: expiresAt,
    path: '/',
  })
}

export const createSession = async (db: PrismaClient | Prisma.TransactionClient, userId: string, response?: Response): Promise<CreatedSession> => {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + env.SESSION_DAYS * 24 * 60 * 60 * 1000)
  await db.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } })
  if (response) setSessionCookie(response, token, expiresAt)
  return { token, expiresAt }
}

export { setSessionCookie }

const runAuthTransaction = async <T>(db: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
  // PrismaClient always exposes $transaction. The fallback keeps lightweight unit-test doubles
  // compatible with the existing app test harness without changing production semantics.
  if (typeof db.$transaction === 'function') return db.$transaction(operation)
  return operation(db as unknown as Prisma.TransactionClient)
}

export const createSessionForActiveUser = async (db: PrismaClient, userId: string) => runAuthTransaction(db, async (tx) => {
  await lockUserForUpdate(tx, userId)
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, role: true, companyId: true, isActive: true } })
  if (!user || user.isActive === false) return null
  const session = await createSession(tx, user.id)
  return { user, session }
})

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
    const expired = Boolean(session && session.expiresAt <= new Date())
    const inactive = session?.user.isActive === false
    if (!session || expired || inactive) {
      // An inactive user's token must not become valid again if the account is later reactivated.
      if (session && (expired || inactive)) await db.session.delete({ where: { id: session.id } }).catch(() => undefined)
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
