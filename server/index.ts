import { createApp } from './app.js'
import { env } from './env.js'
import { prisma } from './prisma.js'
import { TicketNotificationWorker } from './ticket-notifications.js'

const server = createApp().listen(env.PORT, () => console.log(`API listening on port ${env.PORT}`))
const ticketNotificationWorker = new TicketNotificationWorker(prisma, { intervalMs: env.TICKET_NOTIFICATION_INTERVAL_MS })
ticketNotificationWorker.start()

const shutdown = async () => {
  console.log('Shutting down...')
  ticketNotificationWorker.stop()
  server.close()
  server.closeIdleConnections?.()
  const forceExit = setTimeout(() => process.exit(1), 10_000)
  forceExit.unref()
  try {
    await prisma.$disconnect()
  } catch (error) {
    console.error('Error disconnecting database:', error)
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
