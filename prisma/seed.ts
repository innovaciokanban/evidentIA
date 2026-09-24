import 'dotenv/config'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/kanban_consultoria'

const pool = new Pool({
  connectionString,
  max: 3,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  ssl: connectionString.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
})

const COMPANY_UPSERT = {
  find: `SELECT "id" FROM "Company" WHERE "identification" = $1`,
  update: `UPDATE "Company" SET "name" = $2, "industry" = $3, "description" = $4, "updatedAt" = now() WHERE "id" = $1`,
  create: `INSERT INTO "Company" ("id", "name", "identification", "industry", "description", "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, $1, $2, $3, $4, now(), now()) RETURNING "id"`,
}

const USER_UPSERT = {
  find: `SELECT "id" FROM "User" WHERE "email" = $1`,
  update: `UPDATE "User" SET "name" = $2, "passwordHash" = $3, "role" = $4, "companyId" = $5, "updatedAt" = now() WHERE "email" = $1`,
  create: `INSERT INTO "User" ("id", "name", "email", "passwordHash", "role", "companyId", "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, now(), now()) RETURNING "id"`,
}

async function upsertCompany(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> }, name: string, identification: string, industry: string, description: string) {
  const existing = await client.query(COMPANY_UPSERT.find, [identification])
  if (existing.rows[0]) {
    await client.query(COMPANY_UPSERT.update, [existing.rows[0].id, name, industry, description])
    return existing.rows[0].id
  }
  const created = await client.query(COMPANY_UPSERT.create, [name, identification, industry, description])
  return created.rows[0].id
}

async function upsertUser(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> }, name: string, email: string, passwordHash: string, role: string, companyId: string | null) {
  const existing = await client.query(USER_UPSERT.find, [email])
  if (existing.rows[0]) {
    await client.query(USER_UPSERT.update, [existing.rows[0].id, name, passwordHash, role, companyId])
    return existing.rows[0].id
  }
  const created = await client.query(USER_UPSERT.create, [name, email, passwordHash, role, companyId])
  return created.rows[0].id
}

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_PASSWORD) {
    throw new Error('SEED_PASSWORD must be set to seed users in production')
  }

  const password = process.env.SEED_PASSWORD ?? 'CambiarEstaClave123!'
  if (!process.env.SEED_PASSWORD) {
    console.warn('Using the default SEED_PASSWORD. Set SEED_PASSWORD before seeding real environments.')
  }
  const passwordHash = await bcrypt.hash(password, 12)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const companyId = await upsertCompany(
      client,
      'Alimentos Andinos S.A.S.',
      '900123456-7',
      'Alimentos',
      'Empresa de prueba para validación de Kanban Consultoria.',
    )

    await upsertUser(client, 'Admin Kanban', 'admin@kanban.local', passwordHash, 'SUPERUSER', null)
    await upsertUser(client, 'Administrador Empresa', 'empresa@kanban.local', passwordHash, 'COMPANY_ADMIN', companyId)
    await upsertUser(client, 'Usuario Empresa', 'usuario@kanban.local', passwordHash, 'COMPANY_USER', companyId)

    await client.query('COMMIT')
    console.log(
      'Seed completed. Company: Alimentos Andinos S.A.S. | Users: admin, empresa, usuario (password from SEED_PASSWORD).',
    )
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => pool.end())
