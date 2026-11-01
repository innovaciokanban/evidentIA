import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'

const migrationName = '20261025000000_add_company_drive_oauth_operations'

const expectTenantViolation = async (client: Client, text: string, values: unknown[]) => {
  await client.query('SAVEPOINT tenant_violation')
  try {
    await expect(client.query(text, values)).rejects.toMatchObject({ code: '23514' })
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT tenant_violation')
    await client.query('RELEASE SAVEPOINT tenant_violation')
  }
}

const expectDatabaseViolation = async (client: Client, text: string, values: unknown[], code: string) => {
  await client.query('SAVEPOINT database_violation')
  try {
    await expect(client.query(text, values)).rejects.toMatchObject({ code })
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT database_violation')
    await client.query('RELEASE SAVEPOINT database_violation')
  }
}

describe('PostgreSQL tenant integrity', () => {
  it('executes the proposed tenant triggers and rejects cross-company rows in a rolled-back temp schema', async (context) => {
    if (process.env.POSTGRES_TENANT_TRIGGER_INTEGRATION !== '1') {
      context.skip()
      return
    }
    if (!process.env.DATABASE_URL) {
      context.skip()
      return
    }

    const migration = await readFile(new URL('../prisma/migrations/20261025000000_add_company_drive_oauth_operations/migration.sql', import.meta.url), 'utf8')
    const triggerSql = migration
      .slice(migration.indexOf('CREATE FUNCTION "lock_evidentia_entities"(entity_keys TEXT[])'))
      .replaceAll('CREATE FUNCTION "', 'CREATE FUNCTION pg_temp."')
      .replaceAll('EXECUTE FUNCTION "', 'EXECUTE FUNCTION pg_temp."')
      .replaceAll('PERFORM "lock_evidentia_entities"(', 'PERFORM pg_temp."lock_evidentia_entities"(')
      .replaceAll('SET search_path = pg_catalog, public, pg_temp', 'SET search_path = pg_catalog, pg_temp, public')
    const client = new Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    let began = false
    try {
      await client.query('BEGIN')
      began = true
      await client.query('SET LOCAL search_path TO pg_temp, public')
      await client.query('CREATE TYPE "EvidenceStorageProvider" AS ENUM (\'LOCAL\', \'GOOGLE_DRIVE\')')
      await client.query('CREATE TYPE "EvidenceStorageOperationType" AS ENUM (\'UPLOAD\', \'FILE_DELETE\', \'AUDIT_DELETE\')')
      await client.query('CREATE TEMP TABLE "Company" ("id" text primary key)')
      await client.query('CREATE TEMP TABLE "Process" ("id" text primary key, "companyId" text not null)')
      await client.query('CREATE TEMP TABLE "Audit" ("id" text primary key, "processId" text not null)')
      await client.query('CREATE TEMP TABLE "CompanyGoogleDriveConnection" ("id" text primary key, "companyId" text not null)')
      await client.query('CREATE TEMP TABLE "AuditEvidenceFile" ("id" text primary key, "auditId" text not null, "storageProvider" "EvidenceStorageProvider" not null, "driveConnectionId" text)')
      await client.query('CREATE TEMP TABLE "EvidenceStorageOperation" ("id" text primary key, "companyId" text not null, "auditId" text, "evidenceFileId" text, "connectionId" text, "operationType" "EvidenceStorageOperationType" not null)')
      await client.query(triggerSql)
      await client.query('INSERT INTO "Company" VALUES (\'company-a\'), (\'company-b\')')
      await client.query('INSERT INTO "Process" VALUES (\'process-a\', \'company-a\'), (\'process-b\', \'company-b\')')
      await client.query('INSERT INTO "Audit" VALUES (\'audit-a\', \'process-a\'), (\'audit-b\', \'process-b\')')
      await client.query('INSERT INTO "CompanyGoogleDriveConnection" VALUES (\'connection-a\', \'company-a\'), (\'connection-b\', \'company-b\')')
      await client.query('INSERT INTO "AuditEvidenceFile" VALUES (\'local-a\', \'audit-a\', \'LOCAL\', NULL)')
      await client.query('INSERT INTO "EvidenceStorageOperation" VALUES (\'local-op\', \'company-a\', \'audit-a\', \'local-a\', NULL, \'FILE_DELETE\')')

      await expectTenantViolation(client, 'INSERT INTO "AuditEvidenceFile" VALUES ($1, $2, $3, $4)', ['cross-evidence', 'audit-a', 'GOOGLE_DRIVE', 'connection-b'])
      await expectTenantViolation(client, 'INSERT INTO "EvidenceStorageOperation" VALUES ($1, $2, $3, $4, $5, $6)', ['cross-audit-operation', 'company-a', 'audit-b', null, null, 'AUDIT_DELETE'])
      await expectTenantViolation(client, 'INSERT INTO "EvidenceStorageOperation" VALUES ($1, $2, $3, $4, $5, $6)', ['cross-connection-operation', 'company-a', 'audit-a', null, 'connection-b', 'AUDIT_DELETE'])
    } finally {
      if (began) await client.query('ROLLBACK')
      await client.end()
    }
  })

  it('serializes a connection reassignment against a concurrent evidence insert', async (context) => {
    const connectionString = process.env.POSTGRES_TENANT_CONCURRENCY_DATABASE_URL
    if (!connectionString) {
      context.skip()
      return
    }

    const setup = new Client({ connectionString })
    const evidenceClient = new Client({ connectionString })
    const reassignClient = new Client({ connectionString })
    let connectionId = ''
    const evidenceId = randomUUID()
    try {
      await setup.connect()
      const migration = await setup.query('SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1', [migrationName])
      if (migration.rowCount !== 1) {
        context.skip()
        return
      }
      const bases = await setup.query(`
        SELECT DISTINCT ON (c."id")
          c."id" AS company_id,
          a."id" AS audit_id,
          u."id" AS user_id
        FROM "Company" c
        JOIN "Process" p ON p."companyId" = c."id"
        JOIN "Audit" a ON a."processId" = p."id"
        JOIN "User" u ON u."companyId" = c."id"
        ORDER BY c."id", a."id"
      `)
      if ((bases.rowCount ?? 0) < 2) {
        context.skip()
        return
      }
      const first = bases.rows[0] as { company_id: string; audit_id: string; user_id: string }
      const second = bases.rows[1] as { company_id: string }
      connectionId = randomUUID()

      await setup.query('BEGIN')
      await setup.query(`
        INSERT INTO "CompanyGoogleDriveConnection" ("id", "companyId", "encryptedRefreshToken", "scopes", "status")
        VALUES ($1, $2, 'tenant-concurrency-token', ARRAY['https://www.googleapis.com/auth/drive.file'], 'DISCONNECTED')
      `, [connectionId, first.company_id])
      await setup.query('COMMIT')
      await evidenceClient.connect()
      await reassignClient.connect()

      await evidenceClient.query('BEGIN')
      await evidenceClient.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`5:connection:${connectionId}`])
      await evidenceClient.query(`
        INSERT INTO "AuditEvidenceFile" ("id", "auditId", "filename", "mimeType", "size", "uploadedById", "storageProvider", "storageState", "driveConnectionId")
        VALUES ($1, $2, 'concurrent.pdf', 'application/pdf', 1, $3, 'GOOGLE_DRIVE', 'PENDING', $4)
      `, [evidenceId, first.audit_id, first.user_id, connectionId])

      await reassignClient.query('BEGIN')
      const reassignment = reassignClient.query('UPDATE "CompanyGoogleDriveConnection" SET "companyId" = $1 WHERE "id" = $2', [second.company_id, connectionId])
      await new Promise((resolve) => setTimeout(resolve, 50))
      await evidenceClient.query('COMMIT')
      await expect(reassignment).rejects.toMatchObject({ code: '23514' })
      await reassignClient.query('ROLLBACK')
    } finally {
      if (connectionId) {
        await setup.query('BEGIN').catch(() => undefined)
        await setup.query('DELETE FROM "AuditEvidenceFile" WHERE "id" = $1', [evidenceId]).catch(() => undefined)
        await setup.query('DELETE FROM "CompanyGoogleDriveConnection" WHERE "id" = $1', [connectionId]).catch(() => undefined)
        await setup.query('COMMIT').catch(() => setup.query('ROLLBACK').catch(() => undefined))
      }
      await evidenceClient.end().catch(() => undefined)
      await reassignClient.end().catch(() => undefined)
      await setup.end().catch(() => undefined)
    }
  })

  it('rejects cross-company evidence and storage operations while allowing local rows', async (context) => {
    if (process.env.POSTGRES_TENANT_INTEGRATION !== '1') {
      context.skip()
      return
    }
    if (!process.env.DATABASE_URL) {
      context.skip()
      return
    }

    const client = new Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      const migration = await client.query('SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1', [migrationName])
      if (migration.rowCount !== 1) {
        context.skip()
        return
      }

      const bases = await client.query(`
        SELECT DISTINCT ON (c."id")
          c."id" AS company_id,
          p."id" AS process_id,
          a."id" AS audit_id,
          u."id" AS user_id
        FROM "Company" c
        JOIN "Process" p ON p."companyId" = c."id"
        JOIN "Audit" a ON a."processId" = p."id"
        JOIN "User" u ON u."companyId" = c."id"
        ORDER BY c."id", a."id"
      `)
      if ((bases.rowCount ?? 0) < 2) {
        context.skip()
        return
      }

      const first = bases.rows[0] as { company_id: string; process_id: string; audit_id: string; user_id: string }
      const second = bases.rows[1] as { company_id: string; process_id: string; audit_id: string; user_id: string }
      const connectionA = randomUUID()
      const connectionB = randomUUID()
      const localEvidence = randomUUID()
      const driveEvidence = randomUUID()

      await client.query('BEGIN')
      await client.query(`
        INSERT INTO "CompanyGoogleDriveConnection" ("id", "companyId", "encryptedRefreshToken", "scopes", "status")
        VALUES ($1, $2, 'encrypted-a', ARRAY['https://www.googleapis.com/auth/drive.file'], 'DISCONNECTED'),
               ($3, $4, 'encrypted-b', ARRAY['https://www.googleapis.com/auth/drive.file'], 'DISCONNECTED')
      `, [connectionA, first.company_id, connectionB, second.company_id])

      await expectTenantViolation(client, `
        INSERT INTO "AuditEvidenceFile" ("id", "auditId", "filename", "mimeType", "size", "uploadedById", "storageProvider", "storageState", "driveConnectionId")
        VALUES ($1, $2, 'cross-company.pdf', 'application/pdf', 1, $3, 'GOOGLE_DRIVE', 'PENDING', $4)
      `, [driveEvidence, first.audit_id, first.user_id, connectionB])

      await client.query(`
        INSERT INTO "AuditEvidenceFile" ("id", "auditId", "filename", "storedName", "mimeType", "size", "uploadedById", "storageProvider", "storageState")
        VALUES ($1, $2, 'local.pdf', $3, 'application/pdf', 1, $4, 'LOCAL', 'READY')
      `, [localEvidence, first.audit_id, `${randomUUID()}.pdf`, first.user_id])
      await client.query(`
        INSERT INTO "AuditEvidenceFile" ("id", "auditId", "filename", "mimeType", "size", "uploadedById", "storageProvider", "storageState", "driveConnectionId")
        VALUES ($1, $2, 'drive.pdf', 'application/pdf', 1, $3, 'GOOGLE_DRIVE', 'PENDING', $4)
      `, [driveEvidence, first.audit_id, first.user_id, connectionA])
      await client.query(`
        INSERT INTO "EvidenceStorageOperation" ("id", "companyId", "auditId", "evidenceFileId", "operationType", "idempotencyKey")
        VALUES ($1, $2, $3, $4, 'FILE_DELETE', $5)
      `, [randomUUID(), first.company_id, first.audit_id, localEvidence, `tenant-test-local-${randomUUID()}`])

      await expectTenantViolation(client, `
        UPDATE "AuditEvidenceFile" SET "driveConnectionId" = $1 WHERE "id" = $2
      `, [connectionB, driveEvidence])
      await expectTenantViolation(client, `
        UPDATE "AuditEvidenceFile" SET "auditId" = $1 WHERE "id" = $2
      `, [second.audit_id, driveEvidence])
      await expectTenantViolation(client, `
        UPDATE "EvidenceStorageOperation" SET "companyId" = $1 WHERE "evidenceFileId" = $2
      `, [second.company_id, localEvidence])
      await expectTenantViolation(client, `
        UPDATE "EvidenceStorageOperation" SET "operationType" = 'UPLOAD' WHERE "evidenceFileId" = $1
      `, [localEvidence])
      await expectTenantViolation(client, `
        UPDATE "Process" SET "companyId" = $1 WHERE "id" = $2
      `, [second.company_id, first.process_id])
      await expectTenantViolation(client, `
        UPDATE "Audit" SET "processId" = $1 WHERE "id" = $2
      `, [second.process_id, first.audit_id])
      await expectTenantViolation(client, `
        UPDATE "CompanyGoogleDriveConnection" SET "companyId" = $1 WHERE "id" = $2
      `, [second.company_id, connectionA])

      await expectTenantViolation(client, `
        INSERT INTO "EvidenceStorageOperation" ("id", "companyId", "auditId", "operationType", "idempotencyKey")
        VALUES ($1, $2, $3, 'AUDIT_DELETE', $4)
      `, [randomUUID(), first.company_id, second.audit_id, `tenant-test-audit-${randomUUID()}`])

      await expectTenantViolation(client, `
        INSERT INTO "EvidenceStorageOperation" ("id", "companyId", "auditId", "connectionId", "operationType", "idempotencyKey")
        VALUES ($1, $2, $3, $4, 'AUDIT_DELETE', $5)
      `, [randomUUID(), first.company_id, first.audit_id, connectionB, `tenant-test-connection-${randomUUID()}`])

      await expectDatabaseViolation(client, 'DELETE FROM "AuditEvidenceFile" WHERE "id" = $1', [localEvidence], '23503')
      await expectDatabaseViolation(client, 'DELETE FROM "CompanyGoogleDriveConnection" WHERE "id" = $1', [connectionA], '23503')

      await client.query('ROLLBACK')
    } finally {
      await client.end()
    }
  })
})
