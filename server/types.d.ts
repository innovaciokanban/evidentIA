import type { Role } from '@prisma/client'

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        email: string
        name: string
        role: Role
        companyId: string | null
      }
      sessionId?: string
    }
  }
}

export {}
