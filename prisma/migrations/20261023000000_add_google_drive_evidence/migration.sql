-- Additive storage metadata. Existing evidence remains local and readable.
CREATE TYPE "EvidenceStorageProvider" AS ENUM ('LOCAL', 'GOOGLE_DRIVE');
CREATE TYPE "EvidenceStorageState" AS ENUM ('READY', 'DELETE_PENDING', 'FAILED');

ALTER TABLE "Company" ADD COLUMN "driveFolderId" TEXT;
CREATE UNIQUE INDEX "Company_driveFolderId_key" ON "Company"("driveFolderId");

ALTER TABLE "Audit" ADD COLUMN "driveFolderId" TEXT;
CREATE UNIQUE INDEX "Audit_driveFolderId_key" ON "Audit"("driveFolderId");

ALTER TABLE "AuditEvidenceFile" ALTER COLUMN "storedName" DROP NOT NULL;
ALTER TABLE "AuditEvidenceFile" ADD COLUMN "storageProvider" "EvidenceStorageProvider" NOT NULL DEFAULT 'LOCAL';
ALTER TABLE "AuditEvidenceFile" ADD COLUMN "storageState" "EvidenceStorageState" NOT NULL DEFAULT 'READY';
ALTER TABLE "AuditEvidenceFile" ADD COLUMN "driveFileId" TEXT;
ALTER TABLE "AuditEvidenceFile" ADD COLUMN "driveUrl" TEXT;
ALTER TABLE "AuditEvidenceFile" ADD COLUMN "storageError" TEXT;
CREATE UNIQUE INDEX "AuditEvidenceFile_driveFileId_key" ON "AuditEvidenceFile"("driveFileId");
