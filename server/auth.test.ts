import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { createSessionForActiveUser, revokeUserSessions } from './auth.js'

type FakeTransaction = {
  $queryRaw: (...args: unknown[]) => Promise<unknown>
  user: { findUnique: () => Promise<{ id: string; email: string; name: string; role: 'COMPANY_USER'; companyId: string; isActive: boolean }> }
  session: {
    create: (args: unknown) => Promise<{ id: string; expiresAt: Date }>
    deleteMany: (args: unknown) => Promise<{ count: number }>
  }
}

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}

const makeAuthConcurrencyHarness = (initiallyActive = true) => {
  const user = { id: 'user-1', email: 'user@example.test', name: 'User', role: 'COMPANY_USER' as const, companyId: 'company-1' }
  let active = initiallyActive
  let sessionCount = 0
  let lockHeld = false
  const waiters: Array<() => void> = []
  let pauseNextLock = false
  let lockAcquired = deferred()
  let releasePausedLock = deferred()

  const acquireLock = async () => {
    if (lockHeld) await new Promise<void>((resolve) => waiters.push(resolve))
    lockHeld = true
  }

  const releaseLock = () => {
    const next = waiters.shift()
    if (next) next()
    else lockHeld = false
  }

  const db = {
    $transaction: vi.fn(async (operation: (tx: FakeTransaction) => Promise<unknown>) => {
      let ownsLock = false
      const tx: FakeTransaction = {
        $queryRaw: async (..._args: unknown[]) => {
          void _args
          await acquireLock()
          ownsLock = true
          lockAcquired.resolve()
          if (pauseNextLock) {
            pauseNextLock = false
            await releasePausedLock.promise
          }
          return []
        },
        user: { findUnique: async () => ({ ...user, isActive: active }) },
        session: {
          create: async (args: unknown) => {
            void args
            sessionCount += 1
            return { id: `session-${sessionCount}`, expiresAt: new Date(Date.now() + 86_400_000) }
          },
          deleteMany: async (args: unknown) => {
            void args
            const count = sessionCount
            sessionCount = 0
            return { count }
          },
        },
      }
      try {
        return await operation(tx)
      } finally {
        if (ownsLock) releaseLock()
      }
    }),
  } as unknown as PrismaClient

  const pauseFirstLock = () => {
    pauseNextLock = true
    lockAcquired = deferred()
    releasePausedLock = deferred()
    return { lockAcquired: lockAcquired.promise, release: releasePausedLock.resolve }
  }

  const deactivate = () => db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`
    active = false
    await tx.session.deleteMany({ where: { userId: user.id } })
  })

  return { db, user, getActive: () => active, getSessionCount: () => sessionCount, pauseFirstLock, deactivate }
}

describe('authentication session helpers', () => {
  it('revokes every session for a user and returns the affected count', async () => {
    const deleteMany = vi.fn(async () => ({ count: 3 }))
    const count = await revokeUserSessions({ session: { deleteMany } } as never, 'user-1')

    expect(count).toBe(3)
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
  })

  it('rejects login when deactivation acquires the user lock first', async () => {
    const harness = makeAuthConcurrencyHarness()
    const paused = harness.pauseFirstLock()
    const deactivation = harness.deactivate()
    await paused.lockAcquired

    const login = createSessionForActiveUser(harness.db, harness.user.id)
    paused.release()

    await deactivation
    await expect(login).resolves.toBeNull()
    expect(harness.getActive()).toBe(false)
    expect(harness.getSessionCount()).toBe(0)
  })

  it('lets login commit first and then revokes that session during deactivation', async () => {
    const harness = makeAuthConcurrencyHarness()
    const paused = harness.pauseFirstLock()
    const login = createSessionForActiveUser(harness.db, harness.user.id)
    await paused.lockAcquired

    const deactivation = harness.deactivate()
    paused.release()

    await expect(login).resolves.toMatchObject({ user: { id: harness.user.id }, session: { token: expect.any(String) } })
    await deactivation
    expect(harness.getActive()).toBe(false)
    expect(harness.getSessionCount()).toBe(0)
  })

  it('serializes concurrent login retries through the user lock', async () => {
    const harness = makeAuthConcurrencyHarness()
    const sessions = await Promise.all([
      createSessionForActiveUser(harness.db, harness.user.id),
      createSessionForActiveUser(harness.db, harness.user.id),
      createSessionForActiveUser(harness.db, harness.user.id),
    ])

    expect(sessions).toHaveLength(3)
    expect(sessions.every((session) => session !== null)).toBe(true)
    expect(harness.getSessionCount()).toBe(3)
  })
})
