-- Referencias privadas a archivos seleccionados desde Google Picker.
-- No copia archivos ni modifica permisos en Google Drive.

CREATE TABLE "TicketDriveReference" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER,
    "driveUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketDriveReference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketDriveReference_ticketId_createdAt_idx" ON "TicketDriveReference"("ticketId", "createdAt");
CREATE UNIQUE INDEX "TicketDriveReference_ticketId_driveFileId_key" ON "TicketDriveReference"("ticketId", "driveFileId");
CREATE INDEX "TicketDriveReference_companyId_idx" ON "TicketDriveReference"("companyId");
CREATE INDEX "TicketDriveReference_connectionId_idx" ON "TicketDriveReference"("connectionId");
CREATE INDEX "TicketDriveReference_createdById_idx" ON "TicketDriveReference"("createdById");

ALTER TABLE "TicketDriveReference" ADD CONSTRAINT "TicketDriveReference_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketDriveReference" ADD CONSTRAINT "TicketDriveReference_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketDriveReference" ADD CONSTRAINT "TicketDriveReference_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "CompanyGoogleDriveConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketDriveReference" ADD CONSTRAINT "TicketDriveReference_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce that the persisted tenant and Drive connection match the ticket's company. The
-- application performs the same check before writing, but this protects direct database writes too.
CREATE FUNCTION "validate_ticket_drive_reference_tenant"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    ticket_company_id TEXT;
    connection_company_id TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND (
        NEW."ticketId" IS DISTINCT FROM OLD."ticketId"
        OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
        OR NEW."connectionId" IS DISTINCT FROM OLD."connectionId"
        OR NEW."driveFileId" IS DISTINCT FROM OLD."driveFileId"
    ) THEN
        RAISE EXCEPTION 'Ticket Drive references are immutable after creation' USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(creator."companyId", assigned."companyId")
      INTO ticket_company_id
      FROM "Ticket" t
      JOIN "User" creator ON creator."id" = t."createdById"
      LEFT JOIN "User" assigned ON assigned."id" = t."assignedToId"
     WHERE t."id" = NEW."ticketId";

    SELECT c."companyId"
      INTO connection_company_id
      FROM "CompanyGoogleDriveConnection" c
     WHERE c."id" = NEW."connectionId";

    IF ticket_company_id IS NULL OR NEW."companyId" IS DISTINCT FROM ticket_company_id THEN
        RAISE EXCEPTION 'Ticket % and Drive reference company % do not match', NEW."ticketId", NEW."companyId" USING ERRCODE = '23514';
    END IF;
    IF connection_company_id IS NULL OR connection_company_id IS DISTINCT FROM NEW."companyId" THEN
        RAISE EXCEPTION 'Drive connection % does not belong to company %', NEW."connectionId", NEW."companyId" USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "TicketDriveReference_validate_tenant"
BEFORE INSERT OR UPDATE OF "ticketId", "companyId", "connectionId", "driveFileId"
ON "TicketDriveReference"
FOR EACH ROW
EXECUTE FUNCTION "validate_ticket_drive_reference_tenant"();
