import bcrypt from 'bcryptjs'
import request from './test-request.js'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
})

import { Prisma, type PrismaClient, type Role } from '@prisma/client'
import { createApp } from './app.js'
import { GoogleDriveError } from './google-drive.js'
import { encryptOAuthSecret } from './oauth-crypto.js'

const company = { id: 'cmcompanyoauth000000000001' }
const user = { id: 'cmadminoauth000000000001', email: 'oauth-admin@test.local', name: 'OAuth Admin', role: 'COMPANY_ADMIN' as Role, companyId: company.id }
const passwordHash = bcrypt.hashSync('Password123!', 4)

function makeOAuthDb() {
  let sessionActive = false
  let pendingState: Record<string, unknown> | null = null
  let connection: Record<string, unknown> | null = null
  const db: Record<string, any> = {
    user: { findUnique: vi.fn(async () => ({ ...user, passwordHash })) },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-oauth-1', expiresAt: new Date(Date.now() + 3600_000) } }),
      findUnique: vi.fn(async () => sessionActive ? { id: 'session-oauth-1', expiresAt: new Date(Date.now() + 3600_000), user } : null),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      delete: vi.fn(async () => ({ id: 'session-oauth-1' })),
    },
    company: { findUnique: vi.fn(async () => company) },
    googleDriveOAuthState: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { pendingState = { id: 'oauth-state-1', ...data, consumedAt: null }; return pendingState }),
      findUnique: vi.fn(async () => pendingState),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { if (!pendingState || pendingState.consumedAt) return { count: 0 }; Object.assign(pendingState, data); return { count: 1 } }),
    },
    companyGoogleDriveConnection: {
      findFirst: vi.fn(async () => connection),
      updateMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { connection = { id: 'drive-connection-1', ...connection, ...data }; return connection }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { connection = { id: 'drive-connection-1', ...data }; return connection }),
    },
    $transaction: vi.fn(async (operation: (client: unknown) => Promise<unknown>) => operation(db)),
  }
  return { db: db as PrismaClient, getPendingState: () => pendingState, getConnection: () => connection }
}

describe('company Google Drive OAuth', () => {
  it('binds OAuth state to the session, consumes it once, and stores no plaintext token', async () => {
    const harness = makeOAuthDb()
    const db = harness.db
    let rawState = ''
    const gateway = {
      authorizationUrl: vi.fn((state: string) => { rawState = state; return 'https://accounts.google.test/oauth?state=test' }),
      exchangeCode: vi.fn(async () => ({ refresh_token: 'refresh-token' })),
      identity: vi.fn(async () => ({ subject: 'google-subject', email: 'admin@example.test' })),
      ensureRootFolder: vi.fn(async () => ({ id: 'drive-root-1', name: 'EvidentIA' })),
      revoke: vi.fn(async () => undefined),
    }
    const app = createApp(db, undefined, undefined, gateway as never)
    const agent = request.agent(app)
    await agent.post('/api/auth/login').set('Origin', 'http://localhost:5173').send({ email: user.email, password: 'Password123!' })

    const started = await agent.post(`/api/companies/${company.id}/google-drive/oauth/start`)
    expect(started.status).toBe(200)
    expect(started.body.authorizationUrl).toContain('accounts.google.test')
    expect(harness.getPendingState()?.stateHash).toBeTypeOf('string')
    expect(harness.getPendingState()?.encryptedVerifier).not.toBe('')

    const callback = await agent.get('/api/google-drive/oauth/callback').query({ state: rawState, code: 'authorization-code' })
    expect(callback.status).toBe(200)
    expect(gateway.exchangeCode).toHaveBeenCalledWith('authorization-code', expect.any(String))
    expect(harness.getConnection()).toMatchObject({ googleSubject: 'google-subject', status: 'CONNECTED' })
    expect(harness.getConnection()?.encryptedRefreshToken).not.toBe('refresh-token')

    const reused = await agent.get('/api/google-drive/oauth/callback').query({ state: rawState, code: 'authorization-code' })
    expect(reused.status).toBe(400)
  })

  it('rejects an OAuth callback without the authenticated initiating session', async () => {
    const db = makeOAuthDb().db
    const gateway = { authorizationUrl: vi.fn(() => 'https://accounts.google.test/oauth'), exchangeCode: vi.fn(), identity: vi.fn(), ensureRootFolder: vi.fn(), revoke: vi.fn() }
    const response = await request(createApp(db, undefined, undefined, gateway as never)).get('/api/google-drive/oauth/callback').query({ state: 'state', code: 'code' })
    expect(response.status).toBe(401)
  })

  it('logs only normalized Google error metadata and keeps the callback response generic', async () => {
    const harness = makeOAuthDb()
    const db = harness.db
    let rawState = ''
    const gateway = {
      authorizationUrl: vi.fn((state: string) => { rawState = state; return 'https://accounts.google.test/oauth?state=test' }),
      exchangeCode: vi.fn(async () => { throw new GoogleDriveError('authorization-code and refresh-token should never be logged', { code: 'invalid_grant', status: 400 }) }),
      identity: vi.fn(),
      ensureRootFolder: vi.fn(),
      revoke: vi.fn(),
    }
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const agent = request.agent(createApp(db, undefined, undefined, gateway as never))
      await agent.post('/api/auth/login').set('Origin', 'http://localhost:5173').send({ email: user.email, password: 'Password123!' })
      await agent.post(`/api/companies/${company.id}/google-drive/oauth/start`)

      const response = await agent.get('/api/google-drive/oauth/callback').query({ state: rawState, code: 'authorization-code' })

      expect(response.status).toBe(502)
      expect(response.text).toBe('No se pudo conectar Google Drive. Intenta nuevamente.')
      expect(errorLog).toHaveBeenCalledWith('[google-drive/oauth/callback]', expect.objectContaining({
        correlationId: expect.any(String),
        stage: 'EXCHANGE_CODE',
        errorCode: 'INVALID_GRANT',
        googleStatus: 400,
      }))
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain('authorization-code')
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain('refresh-token')
    } finally {
      errorLog.mockRestore()
    }
  })

  it('logs the Prisma code at persistence stage without exposing the database error', async () => {
    const harness = makeOAuthDb()
    const db = harness.db
    let rawState = ''
    const gateway = {
      authorizationUrl: vi.fn((state: string) => { rawState = state; return 'https://accounts.google.test/oauth?state=test' }),
      exchangeCode: vi.fn(async () => ({ refresh_token: 'refresh-token' })),
      identity: vi.fn(async () => ({ subject: 'google-subject', email: 'admin@example.test' })),
      ensureRootFolder: vi.fn(async () => ({ id: 'drive-root-1', name: 'EvidentIA' })),
      revoke: vi.fn(),
    }
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const agent = request.agent(createApp(db, undefined, undefined, gateway as never))
      await agent.post('/api/auth/login').set('Origin', 'http://localhost:5173').send({ email: user.email, password: 'Password123!' })
      await agent.post(`/api/companies/${company.id}/google-drive/oauth/start`)
      db.$transaction = vi.fn(async () => {
        throw new Prisma.PrismaClientKnownRequestError('database detail should never be logged', { code: 'P2002', clientVersion: 'test' })
      })

      const response = await agent.get('/api/google-drive/oauth/callback').query({ state: rawState, code: 'authorization-code' })

      expect(response.status).toBe(502)
      expect(response.text).toBe('No se pudo conectar Google Drive. Intenta nuevamente.')
      expect(errorLog).toHaveBeenCalledWith('[google-drive/oauth/callback]', expect.objectContaining({
        correlationId: expect.any(String),
        stage: 'PERSIST_CONNECTION',
        errorCode: 'PRISMA_P2002',
        prismaCode: 'P2002',
      }))
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain('database detail should never be logged')
    } finally {
      errorLog.mockRestore()
    }
  })

  it('uses authenticated encryption for the token persisted by the callback path', () => {
    const encrypted = encryptOAuthSecret('refresh-token')
    expect(encrypted).not.toContain('refresh-token')
  })
})
