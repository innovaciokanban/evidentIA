-- Additive migration only. Existing local and Google Drive rows remain readable.
-- R2 uploads/deletes are synchronous in the application and do not create
-- EvidenceStorageOperation rows. The legacy operation trigger therefore remains
-- unchanged and continues to validate Google Drive recovery operations.
ALTER TYPE "EvidenceStorageProvider" ADD VALUE IF NOT EXISTS 'R2';

-- Keep tenant/provider validation aligned with the new enum value. Local and R2
-- objects are backend-managed and must never carry a Drive connection.
CREATE OR REPLACE FUNCTION "validate_audit_evidence_file_tenant"()
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

    IF NEW."storageProvider"::TEXT IN ('LOCAL', 'R2')
       AND NEW."driveConnectionId" IS NOT NULL THEN
        RAISE EXCEPTION 'Local or R2 evidence % cannot reference a Google Drive connection', NEW."id" USING ERRCODE = '23514';
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

ALTER TABLE "TicketEvidenceFile"
ADD COLUMN "storageProvider" "EvidenceStorageProvider" NOT NULL DEFAULT 'LOCAL';
