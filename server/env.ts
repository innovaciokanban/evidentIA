import 'dotenv/config'
import { z } from 'zod'

const DEV_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/kanban_consultoria'
const DEV_FRONTEND_URL = 'http://localhost:5173'

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1).default(DEV_DATABASE_URL),
    FRONTEND_URL: z.string().url().default(DEV_FRONTEND_URL),
    SESSION_COOKIE: z.string().min(1).default('kanban_session'),
    SESSION_DAYS: z.coerce.number().int().positive().default(30),
    TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== 'production') return
    if (value.DATABASE_URL === DEV_DATABASE_URL) {
      context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'DATABASE_URL must be set explicitly in production' })
    }
    if (value.FRONTEND_URL === DEV_FRONTEND_URL) {
      context.addIssue({ code: 'custom', path: ['FRONTEND_URL'], message: 'FRONTEND_URL must be set explicitly in production' })
    }
  })

export { envSchema }
export const env = envSchema.parse(process.env)
