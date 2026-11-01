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
    EVIDENCE_STORAGE_PROVIDER: z.enum(['local', 'google-drive']).default('local'),
    // Directorio privado (fuera de la raíz pública y de Vite) donde se guardan los PDF de
    // evidencia de los tickets. En producción debe apuntar a un volumen persistente.
    EVIDENCE_UPLOAD_DIR: z.string().min(1).default('var/evidence'),
    GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
    OAUTH_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
    GOOGLE_DRIVE_SCOPE: z.literal('https://www.googleapis.com/auth/drive.file').default('https://www.googleapis.com/auth/drive.file'),
    GOOGLE_DRIVE_EVIDENCE_ROOT_FOLDER_ID: z.string().trim().min(1).optional(),
    GOOGLE_PICKER_API_KEY: z.string().min(1).optional(),
    GOOGLE_PICKER_APP_ID: z.string().regex(/^\d+$/).optional(),
    EVIDENCE_OPERATION_WORKER_ENABLED: z.coerce.boolean().default(false),
    EVIDENCE_OPERATION_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
    EVIDENCE_OPERATION_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
    TICKET_NOTIFICATION_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production') {
      if (value.DATABASE_URL === DEV_DATABASE_URL) {
        context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'DATABASE_URL must be set explicitly in production' })
      }
      if (value.FRONTEND_URL === DEV_FRONTEND_URL) {
        context.addIssue({ code: 'custom', path: ['FRONTEND_URL'], message: 'FRONTEND_URL must be set explicitly in production' })
      }
    }
    if (value.EVIDENCE_STORAGE_PROVIDER === 'google-drive') {
      if (!value.GOOGLE_OAUTH_CLIENT_ID || !value.GOOGLE_OAUTH_CLIENT_SECRET || !value.GOOGLE_OAUTH_REDIRECT_URI) {
        context.addIssue({ code: 'custom', path: ['GOOGLE_OAUTH_CLIENT_ID'], message: 'Google Drive requires the OAuth client configuration' })
      }
      if (!value.OAUTH_TOKEN_ENCRYPTION_KEY || Buffer.from(value.OAUTH_TOKEN_ENCRYPTION_KEY, 'base64').length !== 32) {
        context.addIssue({ code: 'custom', path: ['OAUTH_TOKEN_ENCRYPTION_KEY'], message: 'OAUTH_TOKEN_ENCRYPTION_KEY must be a base64 encoded 32-byte key' })
      }
    }
  })

export { envSchema }
export const env = envSchema.parse(process.env)
