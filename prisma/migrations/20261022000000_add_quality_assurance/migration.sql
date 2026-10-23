-- Módulo Aseguramiento de Calidad: extiende Auditorías de calidad con listas de verificación,
-- relaciones a múltiples procesos/procedimientos, acciones correctivas y evidencias en PDF.
-- Migración aditiva: crea tres enums, siete tablas, extiende AuditFinding y AuditEventType y no
-- elimina ni reescribe datos existentes. Los ON DELETE evitan destruir el historial: las acciones
-- correctivas usan Restrict sobre el hallazgo (la API bloquea el borrado), las evidencias y los
-- vínculos de ítems usan Set Null, y el historial (AuditEvent) sigue muriendo solo con su auditoría.

-- AlterEnum (valores nuevos del historial append-only; PG 12+ permite ADD VALUE en transacción)
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'AUDIT_RELATIONS_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CHECKLIST_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CHECKLIST_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CHECKLIST_DELETED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CHECKLIST_ITEM_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CHECKLIST_ITEM_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CHECKLIST_ITEM_DELETED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'EVIDENCE_FILE_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'EVIDENCE_FILE_DELETED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ACTION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ACTION_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ACTION_STATUS_CHANGED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ACTION_PROGRESS_ADDED';

-- CreateEnum
CREATE TYPE "AuditChecklistResult" AS ENUM ('PENDING', 'CONFORM', 'NON_CONFORM', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "AuditCorrectiveActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditCorrectiveActionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterTable (AuditFinding: vínculos a checklist/proceso/procedimiento y verificación de eficacia)
ALTER TABLE "AuditFinding" ADD COLUMN "itemId" TEXT;
ALTER TABLE "AuditFinding" ADD COLUMN "processId" TEXT;
ALTER TABLE "AuditFinding" ADD COLUMN "procedureId" TEXT;
ALTER TABLE "AuditFinding" ADD COLUMN "efficacyVerification" TEXT;
ALTER TABLE "AuditFinding" ADD COLUMN "efficacyVerifiedById" TEXT;
ALTER TABLE "AuditFinding" ADD COLUMN "efficacyVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AuditProcess" (
    "auditId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditProcess_pkey" PRIMARY KEY ("auditId","processId")
);

-- CreateTable
CREATE TABLE "AuditProcedure" (
    "auditId" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditProcedure_pkey" PRIMARY KEY ("auditId","procedureId")
);

-- CreateTable
CREATE TABLE "AuditChecklist" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditChecklistItem" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "result" "AuditChecklistResult" NOT NULL DEFAULT 'PENDING',
    "observations" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditCorrectiveAction" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "responsibleId" TEXT,
    "priority" "AuditCorrectiveActionPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "AuditCorrectiveActionStatus" NOT NULL DEFAULT 'OPEN',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditCorrectiveAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditActionProgress" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "percent" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditActionProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvidenceFile" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "findingId" TEXT,
    "actionId" TEXT,
    "itemId" TEXT,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvidenceFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditProcess_processId_idx" ON "AuditProcess"("processId");

-- CreateIndex
CREATE INDEX "AuditProcedure_procedureId_idx" ON "AuditProcedure"("procedureId");

-- CreateIndex
CREATE INDEX "AuditChecklist_auditId_idx" ON "AuditChecklist"("auditId");

-- CreateIndex
CREATE INDEX "AuditChecklistItem_checklistId_idx" ON "AuditChecklistItem"("checklistId");

-- CreateIndex
CREATE INDEX "AuditChecklistItem_result_idx" ON "AuditChecklistItem"("result");

-- CreateIndex
CREATE INDEX "AuditCorrectiveAction_findingId_idx" ON "AuditCorrectiveAction"("findingId");

-- CreateIndex
CREATE INDEX "AuditCorrectiveAction_status_idx" ON "AuditCorrectiveAction"("status");

-- CreateIndex
CREATE INDEX "AuditCorrectiveAction_responsibleId_idx" ON "AuditCorrectiveAction"("responsibleId");

-- CreateIndex
CREATE INDEX "AuditCorrectiveAction_dueDate_idx" ON "AuditCorrectiveAction"("dueDate");

-- CreateIndex
CREATE INDEX "AuditActionProgress_actionId_createdAt_idx" ON "AuditActionProgress"("actionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvidenceFile_storedName_key" ON "AuditEvidenceFile"("storedName");

-- CreateIndex
CREATE INDEX "AuditEvidenceFile_auditId_idx" ON "AuditEvidenceFile"("auditId");

-- CreateIndex
CREATE INDEX "AuditEvidenceFile_findingId_idx" ON "AuditEvidenceFile"("findingId");

-- CreateIndex
CREATE INDEX "AuditEvidenceFile_actionId_idx" ON "AuditEvidenceFile"("actionId");

-- CreateIndex
CREATE INDEX "AuditEvidenceFile_itemId_idx" ON "AuditEvidenceFile"("itemId");

-- CreateIndex
CREATE INDEX "AuditEvidenceFile_uploadedById_idx" ON "AuditEvidenceFile"("uploadedById");

-- CreateIndex
CREATE INDEX "AuditFinding_itemId_idx" ON "AuditFinding"("itemId");

-- CreateIndex
CREATE INDEX "AuditFinding_processId_idx" ON "AuditFinding"("processId");

-- CreateIndex
CREATE INDEX "AuditFinding_procedureId_idx" ON "AuditFinding"("procedureId");

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "AuditChecklistItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_efficacyVerifiedById_fkey" FOREIGN KEY ("efficacyVerifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProcess" ADD CONSTRAINT "AuditProcess_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProcess" ADD CONSTRAINT "AuditProcess_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProcedure" ADD CONSTRAINT "AuditProcedure_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProcedure" ADD CONSTRAINT "AuditProcedure_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditChecklist" ADD CONSTRAINT "AuditChecklist_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditChecklistItem" ADD CONSTRAINT "AuditChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "AuditChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditCorrectiveAction" ADD CONSTRAINT "AuditCorrectiveAction_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditCorrectiveAction" ADD CONSTRAINT "AuditCorrectiveAction_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditActionProgress" ADD CONSTRAINT "AuditActionProgress_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "AuditCorrectiveAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditActionProgress" ADD CONSTRAINT "AuditActionProgress_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvidenceFile" ADD CONSTRAINT "AuditEvidenceFile_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvidenceFile" ADD CONSTRAINT "AuditEvidenceFile_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvidenceFile" ADD CONSTRAINT "AuditEvidenceFile_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "AuditCorrectiveAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvidenceFile" ADD CONSTRAINT "AuditEvidenceFile_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "AuditChecklistItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvidenceFile" ADD CONSTRAINT "AuditEvidenceFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
