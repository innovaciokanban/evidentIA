-- Additive OAuth and storage-operation metadata. Existing local evidence remains untouched.
-- PostgreSQL 12+ is required for ADD VALUE inside the migration transaction.
ALTER TYPE "EvidenceStorageState" RENAME TO "EvidenceStorageState_old";
CREATE TYPE "EvidenceStorageState" AS ENUM ('PENDING', 'READY', 'DELETE_PENDING', 'FAILED');
ALTER TABLE "AuditEvidenceFile" ALTER COLUMN "storageState" DROP DEFAULT;
ALTER TABLE "AuditEvidenceFile" ALTER COLUMN "storageState" TYPE "EvidenceStorageState" USING "storageState"::text::"EvidenceStorageState";
DROP TYPE "EvidenceStorageState_old";
ALTER TYPE "AuditEventType" ADD VALUE 'EVIDENCE_FILE_STORAGE_READY' BEFORE 'ACTION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'EVIDENCE_FILE_STORAGE_FAILED' BEFORE 'ACTION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'EVIDENCE_FILE_DELETE_PENDING' BEFORE 'ACTION_CREATED';

CREATE TYPE "GoogleDriveConnectionStatus" AS ENUM ('CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED');
CREATE TYPE "EvidenceStorageOperationType" AS ENUM ('UPLOAD', 'FILE_DELETE', 'AUDIT_DELETE');
CREATE TYPE "EvidenceStorageOperationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'RETRYABLE', 'FAILED', 'CANCELLED');

ALTER TABLE "Audit" ADD COLUMN "storageDeletionRequestedAt" TIMESTAMP(3);

ALTER TABLE "AuditEvidenceFile" ALTER COLUMN "storageState" SET DEFAULT 'PENDING';
ALTER TABLE "AuditEvidenceFile" ADD COLUMN "storageErrorCode" TEXT;
ALTER TABLE "AuditEvidenceFile" ADD COLUMN "stagedName" TEXT;
ALTER TABLE "AuditEvidenceFile" ADD COLUMN "lastAttemptAt" TIMESTAMP(3);
ALTER TABLE "AuditEvidenceFile" ADD COLUMN "driveConnectionId" TEXT;

CREATE TABLE "CompanyGoogleDriveConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "googleSubject" TEXT,
    "googleAccountEmail" TEXT,
    "rootFolderId" TEXT,
    "scopes" TEXT[] NOT NULL,
    "status" "GoogleDriveConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastRefreshAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyGoogleDriveConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleDriveOAuthState" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "encryptedVerifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoogleDriveOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvidenceStorageOperation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "auditId" TEXT,
    "evidenceFileId" TEXT,
    "connectionId" TEXT,
    "operationType" "EvidenceStorageOperationType" NOT NULL,
    "status" "EvidenceStorageOperationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "remoteFileId" TEXT,
    "remoteFolderId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceStorageOperation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyGoogleDriveConnection_companyId_status_idx" ON "CompanyGoogleDriveConnection"("companyId", "status");
CREATE UNIQUE INDEX "CompanyGoogleDriveConnection_one_active_per_company" ON "CompanyGoogleDriveConnection"("companyId") WHERE "status" = 'CONNECTED';
CREATE UNIQUE INDEX "GoogleDriveOAuthState_stateHash_key" ON "GoogleDriveOAuthState"("stateHash");
CREATE INDEX "GoogleDriveOAuthState_expiresAt_idx" ON "GoogleDriveOAuthState"("expiresAt");
CREATE INDEX "GoogleDriveOAuthState_companyId_idx" ON "GoogleDriveOAuthState"("companyId");
CREATE INDEX "GoogleDriveOAuthState_sessionId_idx" ON "GoogleDriveOAuthState"("sessionId");
CREATE UNIQUE INDEX "EvidenceStorageOperation_idempotencyKey_key" ON "EvidenceStorageOperation"("idempotencyKey");
CREATE INDEX "EvidenceStorageOperation_status_nextAttemptAt_idx" ON "EvidenceStorageOperation"("status", "nextAttemptAt");
CREATE INDEX "EvidenceStorageOperation_leaseUntil_idx" ON "EvidenceStorageOperation"("leaseUntil");
CREATE INDEX "EvidenceStorageOperation_companyId_auditId_idx" ON "EvidenceStorageOperation"("companyId", "auditId");
CREATE INDEX "EvidenceStorageOperation_evidenceFileId_idx" ON "EvidenceStorageOperation"("evidenceFileId");

-- Prisma cannot express this partial unique index. Keep it in SQL and preserve it when generating
-- future migrations: one CONNECTED OAuth account is allowed per company, while disconnected
-- connections remain available for historical evidence references.

ALTER TABLE "CompanyGoogleDriveConnection" ADD CONSTRAINT "CompanyGoogleDriveConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoogleDriveOAuthState" ADD CONSTRAINT "GoogleDriveOAuthState_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleDriveOAuthState" ADD CONSTRAINT "GoogleDriveOAuthState_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleDriveOAuthState" ADD CONSTRAINT "GoogleDriveOAuthState_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvidenceFile" ADD CONSTRAINT "AuditEvidenceFile_driveConnectionId_fkey" FOREIGN KEY ("driveConnectionId") REFERENCES "CompanyGoogleDriveConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceStorageOperation" ADD CONSTRAINT "EvidenceStorageOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceStorageOperation" ADD CONSTRAINT "EvidenceStorageOperation_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceStorageOperation" ADD CONSTRAINT "EvidenceStorageOperation_evidenceFileId_fkey" FOREIGN KEY ("evidenceFileId") REFERENCES "AuditEvidenceFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceStorageOperation" ADD CONSTRAINT "EvidenceStorageOperation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CompanyGoogleDriveConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The tenant is derived through Audit -> Process -> Company. These triggers enforce that
-- transitive invariant without adding redundant tenant columns or rewriting existing rows.
-- Every trigger acquires these advisory locks in lexicographic order. Entity keys use a stable
-- prefix order: company, process, audit, evidence, connection, operation. The subsequent SELECTs
-- run after the lock acquisition so READ COMMITTED takes a fresh snapshot of the locked rows.
CREATE FUNCTION "lock_evidentia_entities"(entity_keys TEXT[])
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    entity_key TEXT;
BEGIN
    FOR entity_key IN
        SELECT DISTINCT value
          FROM unnest(COALESCE(entity_keys, ARRAY[]::TEXT[])) AS keys(value)
         WHERE value IS NOT NULL
         ORDER BY value
    LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended(entity_key, 0));
    END LOOP;
END;
$$;

CREATE FUNCTION "validate_audit_evidence_file_tenant"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    audit_company_id TEXT;
    audit_process_id TEXT;
    connection_company_id TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND (
        NEW."auditId" IS DISTINCT FROM OLD."auditId"
        OR NEW."storageProvider" IS DISTINCT FROM OLD."storageProvider"
        OR NEW."driveConnectionId" IS DISTINCT FROM OLD."driveConnectionId"
    ) THEN
        RAISE EXCEPTION 'Evidence file tenant references are immutable after creation' USING ERRCODE = '23514';
    END IF;

    SELECT a."processId"
      INTO audit_process_id
      FROM "Audit" a
     WHERE a."id" = NEW."auditId";

    PERFORM "lock_evidentia_entities"(ARRAY[
        '2:process:' || audit_process_id,
        '3:audit:' || NEW."auditId",
        '5:connection:' || NEW."driveConnectionId"
    ]);

    IF audit_process_id IS NOT NULL THEN
        PERFORM 1 FROM "Process" p WHERE p."id" = audit_process_id FOR UPDATE;
    END IF;
    PERFORM 1 FROM "Audit" a WHERE a."id" = NEW."auditId" FOR UPDATE;
    IF NEW."driveConnectionId" IS NOT NULL THEN
        PERFORM 1 FROM "CompanyGoogleDriveConnection" c WHERE c."id" = NEW."driveConnectionId" FOR UPDATE;
    END IF;

    SELECT p."companyId"
      INTO audit_company_id
      FROM "Audit" a
      JOIN "Process" p ON p."id" = a."processId"
     WHERE a."id" = NEW."auditId";

    IF audit_company_id IS NULL THEN
        RAISE EXCEPTION 'Audit % does not resolve to a company', NEW."auditId" USING ERRCODE = '23514';
    END IF;

    IF NEW."storageProvider" = 'GOOGLE_DRIVE'::"EvidenceStorageProvider" AND NEW."driveConnectionId" IS NULL THEN
        RAISE EXCEPTION 'Google Drive evidence % requires a company connection', NEW."id" USING ERRCODE = '23514';
    END IF;

    IF NEW."storageProvider" = 'LOCAL'::"EvidenceStorageProvider" AND NEW."driveConnectionId" IS NOT NULL THEN
        RAISE EXCEPTION 'Local evidence % cannot reference a Google Drive connection', NEW."id" USING ERRCODE = '23514';
    END IF;

    IF NEW."driveConnectionId" IS NOT NULL THEN
        SELECT c."companyId"
          INTO connection_company_id
          FROM "CompanyGoogleDriveConnection" c
         WHERE c."id" = NEW."driveConnectionId";

        IF connection_company_id IS NULL OR connection_company_id IS DISTINCT FROM audit_company_id THEN
            RAISE EXCEPTION 'Evidence % and Drive connection % belong to different companies', NEW."id", NEW."driveConnectionId" USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "AuditEvidenceFile_validate_tenant"
BEFORE INSERT OR UPDATE OF "auditId", "storageProvider", "driveConnectionId"
ON "AuditEvidenceFile"
FOR EACH ROW
EXECUTE FUNCTION "validate_audit_evidence_file_tenant"();

CREATE FUNCTION "validate_audit_tenant"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    audit_company_id TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW."processId" IS DISTINCT FROM OLD."processId" THEN
        RAISE EXCEPTION 'Audit process references are immutable after creation' USING ERRCODE = '23514';
    END IF;

    PERFORM "lock_evidentia_entities"(ARRAY[
        '2:process:' || NEW."processId",
        '3:audit:' || NEW."id"
    ]);
    PERFORM 1 FROM "Process" p WHERE p."id" = NEW."processId" FOR UPDATE;
    PERFORM 1 FROM "Audit" a WHERE a."id" = NEW."id" FOR UPDATE;

    SELECT p."companyId"
      INTO audit_company_id
      FROM "Process" p
     WHERE p."id" = NEW."processId";

    IF audit_company_id IS NULL THEN
        RAISE EXCEPTION 'Process % does not resolve to a company', NEW."processId" USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "AuditEvidenceFile" e
          JOIN "CompanyGoogleDriveConnection" c ON c."id" = e."driveConnectionId"
         WHERE e."auditId" = NEW."id"
           AND c."companyId" IS DISTINCT FROM audit_company_id
    ) THEN
        RAISE EXCEPTION 'Audit % has evidence belonging to a different company', NEW."id" USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "EvidenceStorageOperation" o
         WHERE o."auditId" = NEW."id"
           AND o."companyId" IS DISTINCT FROM audit_company_id
    ) THEN
        RAISE EXCEPTION 'Audit % has storage operations belonging to a different company', NEW."id" USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "Audit_validate_tenant"
BEFORE INSERT OR UPDATE OF "processId"
ON "Audit"
FOR EACH ROW
EXECUTE FUNCTION "validate_audit_tenant"();

CREATE FUNCTION "prevent_process_tenant_change_with_audits"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    audit_keys TEXT[];
BEGIN
    PERFORM "lock_evidentia_entities"(ARRAY[
        '1:company:' || OLD."companyId",
        '1:company:' || NEW."companyId",
        '2:process:' || OLD."id"
    ]);
    SELECT array_agg('3:audit:' || a."id" ORDER BY a."id")
      INTO audit_keys
      FROM "Audit" a
     WHERE a."processId" = OLD."id";
    PERFORM "lock_evidentia_entities"(audit_keys);

    IF NEW."companyId" IS DISTINCT FROM OLD."companyId"
       AND EXISTS (SELECT 1 FROM "Company" c WHERE c."id" = OLD."companyId")
       AND EXISTS (SELECT 1 FROM "Audit" a WHERE a."processId" = OLD."id") THEN
        RAISE EXCEPTION 'Process % cannot change company while it has audits', OLD."id" USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "Process_prevent_tenant_change_with_audits"
BEFORE UPDATE OF "companyId"
ON "Process"
FOR EACH ROW
EXECUTE FUNCTION "prevent_process_tenant_change_with_audits"();

CREATE FUNCTION "prevent_drive_connection_tenant_change_with_references"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    PERFORM "lock_evidentia_entities"(ARRAY[
        '1:company:' || OLD."companyId",
        '1:company:' || NEW."companyId",
        '5:connection:' || OLD."id"
    ]);

    IF NEW."companyId" IS DISTINCT FROM OLD."companyId"
       AND EXISTS (SELECT 1 FROM "Company" c WHERE c."id" = OLD."companyId")
       AND (
           EXISTS (SELECT 1 FROM "AuditEvidenceFile" e WHERE e."driveConnectionId" = OLD."id")
           OR EXISTS (SELECT 1 FROM "EvidenceStorageOperation" o WHERE o."connectionId" = OLD."id")
       ) THEN
        RAISE EXCEPTION 'Drive connection % cannot change company while referenced', OLD."id" USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "CompanyGoogleDriveConnection_prevent_tenant_change_with_references"
BEFORE UPDATE OF "companyId"
ON "CompanyGoogleDriveConnection"
FOR EACH ROW
EXECUTE FUNCTION "prevent_drive_connection_tenant_change_with_references"();

CREATE FUNCTION "validate_storage_operation_tenant"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    audit_company_id TEXT;
    audit_process_id TEXT;
    evidence_company_id TEXT;
    evidence_audit_id TEXT;
    evidence_process_id TEXT;
    evidence_connection_id TEXT;
    evidence_provider "EvidenceStorageProvider";
    connection_company_id TEXT;
BEGIN
    SELECT e."auditId", a."processId", e."driveConnectionId"
      INTO evidence_audit_id, evidence_process_id, evidence_connection_id
      FROM "AuditEvidenceFile" e
      JOIN "Audit" a ON a."id" = e."auditId"
     WHERE e."id" = NEW."evidenceFileId";

    IF NEW."evidenceFileId" IS NOT NULL
       AND NEW."auditId" IS NOT NULL
       AND evidence_audit_id IS DISTINCT FROM NEW."auditId" THEN
        RAISE EXCEPTION 'Storage operation % and evidence % belong to different audits', NEW."id", NEW."evidenceFileId" USING ERRCODE = '23514';
    END IF;

    IF NEW."auditId" IS NOT NULL THEN
        SELECT a."processId"
          INTO audit_process_id
          FROM "Audit" a
         WHERE a."id" = NEW."auditId";
    ELSE
        audit_process_id := evidence_process_id;
    END IF;

    PERFORM "lock_evidentia_entities"(ARRAY[
        '1:company:' || NEW."companyId",
        '2:process:' || audit_process_id,
        '3:audit:' || COALESCE(NEW."auditId", evidence_audit_id),
        '4:evidence:' || NEW."evidenceFileId",
        '5:connection:' || NEW."connectionId",
        '6:operation:' || NEW."id"
    ]);

    IF audit_process_id IS NOT NULL THEN
        PERFORM 1 FROM "Process" p WHERE p."id" = audit_process_id FOR UPDATE;
    END IF;
    IF COALESCE(NEW."auditId", evidence_audit_id) IS NOT NULL THEN
        PERFORM 1 FROM "Audit" a WHERE a."id" = COALESCE(NEW."auditId", evidence_audit_id) FOR UPDATE;
    END IF;
    IF NEW."evidenceFileId" IS NOT NULL THEN
        SELECT e."auditId", a."processId", e."driveConnectionId", e."storageProvider"
          INTO evidence_audit_id, evidence_process_id, evidence_connection_id, evidence_provider
          FROM "AuditEvidenceFile" e
          JOIN "Audit" a ON a."id" = e."auditId"
         WHERE e."id" = NEW."evidenceFileId"
         FOR UPDATE OF e;
    END IF;
    IF NEW."connectionId" IS NOT NULL THEN
        PERFORM 1 FROM "CompanyGoogleDriveConnection" c WHERE c."id" = NEW."connectionId" FOR UPDATE;
    END IF;

    IF NEW."auditId" IS NOT NULL THEN
        SELECT p."companyId"
          INTO audit_company_id
          FROM "Audit" a
          JOIN "Process" p ON p."id" = a."processId"
         WHERE a."id" = NEW."auditId";

        IF audit_company_id IS NULL OR audit_company_id IS DISTINCT FROM NEW."companyId" THEN
            RAISE EXCEPTION 'Storage operation % and audit % belong to different companies', NEW."id", NEW."auditId" USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW."connectionId" IS NOT NULL THEN
        SELECT c."companyId"
          INTO connection_company_id
          FROM "CompanyGoogleDriveConnection" c
         WHERE c."id" = NEW."connectionId";

        IF connection_company_id IS NULL OR connection_company_id IS DISTINCT FROM NEW."companyId" THEN
            RAISE EXCEPTION 'Storage operation % and Drive connection % belong to different companies', NEW."id", NEW."connectionId" USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW."evidenceFileId" IS NOT NULL THEN
        SELECT e."auditId", p."companyId", e."driveConnectionId", e."storageProvider"
          INTO evidence_audit_id, evidence_company_id, evidence_connection_id, evidence_provider
          FROM "AuditEvidenceFile" e
          JOIN "Audit" a ON a."id" = e."auditId"
          JOIN "Process" p ON p."id" = a."processId"
         WHERE e."id" = NEW."evidenceFileId";

        IF evidence_company_id IS NULL OR evidence_company_id IS DISTINCT FROM NEW."companyId" THEN
            RAISE EXCEPTION 'Storage operation % and evidence % belong to different companies', NEW."id", NEW."evidenceFileId" USING ERRCODE = '23514';
        END IF;

        IF evidence_provider = 'GOOGLE_DRIVE'::"EvidenceStorageProvider"
           AND (evidence_connection_id IS NULL OR NEW."connectionId" IS DISTINCT FROM evidence_connection_id) THEN
            RAISE EXCEPTION 'Storage operation % and evidence % use different Drive connections', NEW."id", NEW."evidenceFileId" USING ERRCODE = '23514';
        END IF;

        IF evidence_provider = 'LOCAL'::"EvidenceStorageProvider" AND NEW."connectionId" IS NOT NULL THEN
            RAISE EXCEPTION 'Local evidence % cannot have a Drive storage operation connection', NEW."evidenceFileId" USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW."operationType" = 'UPLOAD'::"EvidenceStorageOperationType"
       AND (NEW."auditId" IS NULL OR NEW."evidenceFileId" IS NULL OR NEW."connectionId" IS NULL) THEN
        RAISE EXCEPTION 'UPLOAD operations require an audit, evidence file and Drive connection' USING ERRCODE = '23514';
    END IF;

    IF NEW."operationType" = 'FILE_DELETE'::"EvidenceStorageOperationType"
       AND (NEW."auditId" IS NULL OR NEW."evidenceFileId" IS NULL) THEN
        RAISE EXCEPTION 'FILE_DELETE operations require an audit and evidence file' USING ERRCODE = '23514';
    END IF;

    IF NEW."operationType" = 'AUDIT_DELETE'::"EvidenceStorageOperationType"
       AND (NEW."auditId" IS NULL OR NEW."evidenceFileId" IS NOT NULL OR NEW."connectionId" IS NOT NULL) THEN
        RAISE EXCEPTION 'AUDIT_DELETE operations require only an audit reference' USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "EvidenceStorageOperation_validate_tenant"
BEFORE INSERT OR UPDATE OF "companyId", "auditId", "evidenceFileId", "connectionId", "operationType"
ON "EvidenceStorageOperation"
FOR EACH ROW
EXECUTE FUNCTION "validate_storage_operation_tenant"();
