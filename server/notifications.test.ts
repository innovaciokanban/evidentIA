import { describe, expect, it, vi } from 'vitest'
import { createNotificationIfAbsent } from './notifications.js'

const makeClient = (user: { id: string; companyId: string | null; role: string; isActive: boolean } | null, existing = false) => {
  const notification = {
    findFirst: vi.fn(async () => existing ? { id: 'existing' } : null),
    create: vi.fn(async ({ data }: { data: Record<string, string> }) => data),
  }
  return {
    user: { findFirst: vi.fn(async () => user) },
    notification,
    $queryRaw: vi.fn(async () => []),
  }
}

const data = { userId: 'user-1', title: 'Title', body: 'Body', link: '/notifications/1' }

describe('createNotificationIfAbsent', () => {
  it('does not notify an inactive recipient', async () => {
    const client = makeClient({ id: 'user-1', companyId: 'company-1', role: 'COMPANY_USER', isActive: false })

    await expect(createNotificationIfAbsent(client as never, data, { companyId: 'company-1' })).resolves.toBe(false)
    expect(client.notification.create).not.toHaveBeenCalled()
  })

  it('does not cross company boundaries', async () => {
    const client = makeClient({ id: 'user-1', companyId: 'company-2', role: 'COMPANY_USER', isActive: true })

    await expect(createNotificationIfAbsent(client as never, data, { companyId: 'company-1' })).resolves.toBe(false)
    expect(client.notification.create).not.toHaveBeenCalled()
  })

  it('preserves deduplication and locks the recipient before checking', async () => {
    const client = makeClient({ id: 'user-1', companyId: 'company-1', role: 'COMPANY_USER', isActive: true }, true)

    await expect(createNotificationIfAbsent(client as never, data, { companyId: 'company-1' })).resolves.toBe(false)
    expect(client.$queryRaw).toHaveBeenCalledTimes(1)
    expect(client.notification.findFirst).toHaveBeenCalledTimes(1)
    expect(client.notification.create).not.toHaveBeenCalled()
  })

  it('does not fail when a lightweight service client has no notification delegate', async () => {
    const client = { user: { findFirst: vi.fn() }, notification: undefined }

    await expect(createNotificationIfAbsent(client as never, data, { companyId: 'company-1' })).resolves.toBe(false)
    expect(client.user.findFirst).not.toHaveBeenCalled()
  })
})
