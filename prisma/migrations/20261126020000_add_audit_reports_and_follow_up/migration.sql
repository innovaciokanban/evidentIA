-- BLOQUE 5: informe aprobado versionado y seguimiento CAPA post-cierre.
-- Migracion aditiva y retrocompatible. No debe aplicarse sin autorizacion explicita.

CREATE TYPE "AuditReportStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED');
CREATE TYPE "AuditFollowUpStatus" AS ENUM ('ENABLED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "AuditFollowUpActionReason" AS ENUM ('EFFICACY_INEFFECTIVE', 'RECURRENCE', 'ADDITIONAL_TREATMENT', 'OTHER');

ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'AUDIT_REPORT_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'AUDIT_REPORT_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'AUDIT_REPORT_SUBMITTED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'AUDIT_REPORT_REVIEWED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'AUDIT_REPORT_APPROVED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'AUDIT_REPORT_VERSION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'AUDIT_REPORT_PDF_GENERATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'AUDIT_FOLLOW_UP_ENABLED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'AUDIT_FOLLOW_UP_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'AUDIT_FOLLOW_UP_COMPLETED';

CREATE TABLE "AuditReport" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "status" "AuditReportStatus" NOT NULL DEFAULT 'DRAFT',
    "draftSnapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditReportVersion" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdfEvidenceFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditReportVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditFollowUp" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "status" "AuditFollowUpStatus" NOT NULL DEFAULT 'ENABLED',
    "scope" TEXT NOT NULL,
    "responsibleId" TEXT NOT NULL,
    "enabledById" TEXT NOT NULL,
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditFollowUp_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AuditCorrectiveAction"
    ADD COLUMN "followUpId" TEXT,
    ADD COLUMN "followUpReason" "AuditFollowUpActionReason",
    ADD COLUMN "followUpJustification" TEXT;

ALTER TABLE "AuditEfficacyEvaluation"
    ADD COLUMN "followUpId" TEXT;

CREATE UNIQUE INDEX "AuditReport_auditId_key" ON "AuditReport"("auditId");
CREATE UNIQUE INDEX "AuditReport_approvedVersionId_key" ON "AuditReport"("approvedVersionId");
CREATE INDEX "AuditReport_status_idx" ON "AuditReport"("status");
CREATE INDEX "AuditReport_createdById_idx" ON "AuditReport"("createdById");
CREATE INDEX "AuditReport_reviewedById_idx" ON "AuditReport"("reviewedById");

CREATE UNIQUE INDEX "AuditReportVersion_pdfEvidenceFileId_key" ON "AuditReportVersion"("pdfEvidenceFileId");
CREATE UNIQUE INDEX "AuditReportVersion_reportId_version_key" ON "AuditReportVersion"("reportId", "version");
CREATE INDEX "AuditReportVersion_reportId_approvedAt_idx" ON "AuditReportVersion"("reportId", "approvedAt");
CREATE INDEX "AuditReportVersion_approvedById_idx" ON "AuditReportVersion"("approvedById");

CREATE UNIQUE INDEX "AuditFollowUp_auditId_key" ON "AuditFollowUp"("auditId");
CREATE INDEX "AuditFollowUp_status_idx" ON "AuditFollowUp"("status");
CREATE INDEX "AuditFollowUp_responsibleId_status_idx" ON "AuditFollowUp"("responsibleId", "status");
CREATE INDEX "AuditFollowUp_enabledById_idx" ON "AuditFollowUp"("enabledById");
CREATE INDEX "AuditFollowUp_completedById_idx" ON "AuditFollowUp"("completedById");

CREATE INDEX "AuditCorrectiveAction_followUpId_status_idx" ON "AuditCorrectiveAction"("followUpId", "status");
CREATE INDEX "AuditEfficacyEvaluation_followUpId_status_idx" ON "AuditEfficacyEvaluation"("followUpId", "status");

ALTER TABLE "AuditReport"
    ADD CONSTRAINT "AuditReport_auditId_fkey"
        FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditReport_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditReport_reviewedById_fkey"
        FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditReportVersion"
    ADD CONSTRAINT "AuditReportVersion_reportId_fkey"
        FOREIGN KEY ("reportId") REFERENCES "AuditReport"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditReportVersion_approvedById_fkey"
        FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditReportVersion_pdfEvidenceFileId_fkey"
        FOREIGN KEY ("pdfEvidenceFileId") REFERENCES "AuditEvidenceFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditReport"
    ADD CONSTRAINT "AuditReport_approvedVersionId_fkey"
        FOREIGN KEY ("approvedVersionId") REFERENCES "AuditReportVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditFollowUp"
    ADD CONSTRAINT "AuditFollowUp_auditId_fkey"
        FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditFollowUp_responsibleId_fkey"
        FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditFollowUp_enabledById_fkey"
        FOREIGN KEY ("enabledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditFollowUp_completedById_fkey"
        FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditCorrectiveAction"
    ADD CONSTRAINT "AuditCorrectiveAction_followUpId_fkey"
        FOREIGN KEY ("followUpId") REFERENCES "AuditFollowUp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditEfficacyEvaluation"
    ADD CONSTRAINT "AuditEfficacyEvaluation_followUpId_fkey"
        FOREIGN KEY ("followUpId") REFERENCES "AuditFollowUp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
