-- Ejecucion de actividades y vinculos historicos. Migracion aditiva; no transforma registros existentes.

ALTER TYPE "AuditEventType" ADD VALUE 'AUDIT_PLAN_ACTIVITY_EXECUTION_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE 'AUDIT_PLAN_ACTIVITY_EXECUTION_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'AUDIT_PLAN_ACTIVITY_EXECUTION_COMPLETED';
ALTER TYPE "AuditEventType" ADD VALUE 'AUDIT_PLAN_ACTIVITY_EXECUTION_CANCELLED';
ALTER TYPE "AuditEventType" ADD VALUE 'AUDIT_PLAN_ACTIVITY_RESOURCE_LINKED';
ALTER TYPE "AuditEventType" ADD VALUE 'AUDIT_PLAN_ACTIVITY_RESOURCE_UNLINKED';

CREATE TYPE "AuditActivityResult" AS ENUM ('SATISFACTORY', 'PARTIAL', 'ISSUE', 'NOT_APPLICABLE');

ALTER TABLE "AuditPlanActivity"
    ADD COLUMN "actualStart" TIMESTAMP(3),
    ADD COLUMN "actualEnd" TIMESTAMP(3),
    ADD COLUMN "executionResult" "AuditActivityResult",
    ADD COLUMN "executionObservations" TEXT,
    ADD COLUMN "startedById" TEXT,
    ADD COLUMN "completedById" TEXT;

CREATE INDEX "AuditPlanActivity_startedById_idx" ON "AuditPlanActivity"("startedById");
CREATE INDEX "AuditPlanActivity_completedById_idx" ON "AuditPlanActivity"("completedById");

ALTER TABLE "AuditPlanActivity" ADD CONSTRAINT "AuditPlanActivity_startedById_fkey"
    FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditPlanActivity" ADD CONSTRAINT "AuditPlanActivity_completedById_fkey"
    FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AuditPlanActivityChecklistItem" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    CONSTRAINT "AuditPlanActivityChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditPlanActivityChecklistItem_activityId_itemId_key"
    ON "AuditPlanActivityChecklistItem"("activityId", "itemId");
CREATE INDEX "AuditPlanActivityChecklistItem_activityId_isActive_idx"
    ON "AuditPlanActivityChecklistItem"("activityId", "isActive");
CREATE INDEX "AuditPlanActivityChecklistItem_itemId_isActive_idx"
    ON "AuditPlanActivityChecklistItem"("itemId", "isActive");

ALTER TABLE "AuditPlanActivityChecklistItem" ADD CONSTRAINT "AuditPlanActivityChecklistItem_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "AuditPlanActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditPlanActivityChecklistItem" ADD CONSTRAINT "AuditPlanActivityChecklistItem_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "AuditChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuditPlanActivityEvidence" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    CONSTRAINT "AuditPlanActivityEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditPlanActivityEvidence_activityId_evidenceId_key"
    ON "AuditPlanActivityEvidence"("activityId", "evidenceId");
CREATE INDEX "AuditPlanActivityEvidence_activityId_isActive_idx"
    ON "AuditPlanActivityEvidence"("activityId", "isActive");
CREATE INDEX "AuditPlanActivityEvidence_evidenceId_isActive_idx"
    ON "AuditPlanActivityEvidence"("evidenceId", "isActive");

ALTER TABLE "AuditPlanActivityEvidence" ADD CONSTRAINT "AuditPlanActivityEvidence_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "AuditPlanActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditPlanActivityEvidence" ADD CONSTRAINT "AuditPlanActivityEvidence_evidenceId_fkey"
    FOREIGN KEY ("evidenceId") REFERENCES "AuditEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuditPlanActivityEvidenceFile" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "evidenceFileId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    CONSTRAINT "AuditPlanActivityEvidenceFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditPlanActivityEvidenceFile_activityId_evidenceFileId_key"
    ON "AuditPlanActivityEvidenceFile"("activityId", "evidenceFileId");
CREATE INDEX "AuditPlanActivityEvidenceFile_activityId_isActive_idx"
    ON "AuditPlanActivityEvidenceFile"("activityId", "isActive");
CREATE INDEX "AuditPlanActivityEvidenceFile_evidenceFileId_isActive_idx"
    ON "AuditPlanActivityEvidenceFile"("evidenceFileId", "isActive");

ALTER TABLE "AuditPlanActivityEvidenceFile" ADD CONSTRAINT "AuditPlanActivityEvidenceFile_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "AuditPlanActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditPlanActivityEvidenceFile" ADD CONSTRAINT "AuditPlanActivityEvidenceFile_evidenceFileId_fkey"
    FOREIGN KEY ("evidenceFileId") REFERENCES "AuditEvidenceFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuditPlanActivityFinding" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    CONSTRAINT "AuditPlanActivityFinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditPlanActivityFinding_activityId_findingId_key"
    ON "AuditPlanActivityFinding"("activityId", "findingId");
CREATE INDEX "AuditPlanActivityFinding_activityId_isActive_idx"
    ON "AuditPlanActivityFinding"("activityId", "isActive");
CREATE INDEX "AuditPlanActivityFinding_findingId_isActive_idx"
    ON "AuditPlanActivityFinding"("findingId", "isActive");

ALTER TABLE "AuditPlanActivityFinding" ADD CONSTRAINT "AuditPlanActivityFinding_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "AuditPlanActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditPlanActivityFinding" ADD CONSTRAINT "AuditPlanActivityFinding_findingId_fkey"
    FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
