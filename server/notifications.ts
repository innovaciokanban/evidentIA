import type { Prisma, PrismaClient } from '@prisma/client'

export type NotificationClient = PrismaClient | Prisma.TransactionClient

type NotificationScope = { companyId: string | null }

type NotificationData = {
  userId: string
  title: string
  body: string
  link: string
}

const lockRecipient = async (client: NotificationClient, userId: string): Promise<void> => {
  if (!('$queryRaw' in client)) return
  await client.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`
}

export const lockNotificationRecipients = async (client: NotificationClient, userIds: string[]): Promise<void> => {
  for (const userId of [...new Set(userIds)].sort()) await lockRecipient(client, userId)
}

const authorizedRecipient = async (client: NotificationClient, userId: string, scope: NotificationScope) => {
  const userDelegate = client.user as PrismaClient['user'] | undefined
  if (!userDelegate || (typeof userDelegate.findFirst !== 'function' && typeof userDelegate.findUnique !== 'function')) return { id: userId }
  await lockRecipient(client, userId)
  const user = typeof userDelegate.findFirst === 'function'
    ? await userDelegate.findFirst({ where: { id: userId }, select: { id: true, companyId: true, role: true, isActive: true } })
    : await userDelegate.findUnique({ where: { id: userId }, select: { id: true, companyId: true, role: true, isActive: true } })
  if (!user || user.isActive === false) return null
  if (scope.companyId === null) return user.role === 'SUPERUSER' ? user : null
  if (user.role !== 'SUPERUSER' && user.companyId !== scope.companyId) return null
  return user
}

export const createNotificationIfAbsent = async (client: NotificationClient, data: NotificationData, scope: NotificationScope): Promise<boolean> => {
  const notification = client.notification
  if (!notification || typeof notification.create !== 'function') return false
  const recipient = await authorizedRecipient(client, data.userId, scope)
  if (!recipient) return false
  const existing = typeof notification.findFirst === 'function'
    ? await notification.findFirst({ where: { userId: recipient.id, link: data.link }, select: { id: true } })
    : null
  if (existing) return false
  await notification.create({ data })
  return true
}
