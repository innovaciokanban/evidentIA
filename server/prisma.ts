import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import type { PoolConfig } from 'pg'
import { env } from './env.js'

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, pipeline: true } as PoolConfig)
export const prisma = new PrismaClient({ adapter })
