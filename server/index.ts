import { createApp } from './app.js'
import { env } from './env.js'
import { prisma } from './prisma.js'

const server = createApp().listen(env.PORT, () => console.log(`API listening on port ${env.PORT}`))

const shutdown = async () => {
  console.log('Shutting down...')
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
