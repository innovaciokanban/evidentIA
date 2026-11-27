-- 9D-2A: correcciones inmediatas y analisis historico de causa raiz.
-- Migracion exclusivamente aditiva: crea enums, tablas, indices y claves foraneas.
-- No modifica registros existentes ni cambia las reglas de cierre de auditorias.

-- Valores de AuditEventType reservados para los futuros servicios de correcciones y causas.
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'IMMEDIATE_CORRECTION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'IMMEDIATE_CORRECTION_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'IMMEDIATE_CORRECTION_STATUS_CHANGED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ROOT_CAUSE_ANALYSIS_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ROOT_CAUSE_ANALYSIS_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ROOT_CAUSE_ANALYSIS_STATUS_CHANGED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ROOT_CAUSE_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ROOT_CAUSE_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ROOT_CAUSE_STATUS_CHANGED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ROOT_CAUSE_FIVE_WHY_STEP_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ROOT_CAUSE_FIVE_WHY_STEP_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ROOT_CAUSE_FIVE_WHY_STEP_DELETED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CORRECTIVE_ACTION_CAUSE_LINKED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CORRECTIVE_ACTION_CAUSE_UNLINKED';

-- CreateEnum
CREATE TYPE "AuditImmediateCorrectionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditRootCauseAnalysisMethod" AS ENUM ('MANUAL', 'FIVE_WHYS', 'ISHIKAWA');

-- CreateEnum
CREATE TYPE "AuditRootCauseAnalysisStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "AuditRootCauseOrigin" AS ENUM ('MANUAL', 'CHECKY');

-- CreateEnum
CREATE TYPE "AuditRootCauseStatus" AS ENUM ('POTENTIAL', 'CONFIRMED', 'DISCARDED');

-- CreateTable
CREATE TABLE "AuditImmediateCorrection" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "containmentMeasures" TEXT,
    "consequencesIdentified" TEXT,
    "consequencesTreatment" TEXT,
    "responsibleId" TEXT,
    "plannedDate" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "status" "AuditImmediateCorrectionStatus" NOT NULL DEFAULT 'OPEN',
    "observations" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditImmediateCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRootCauseAnalysis" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "methodology" "AuditRootCauseAnalysisMethod" NOT NULL,
    "status" "AuditRootCauseAnalysisStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" "AuditRootCauseOrigin" NOT NULL DEFAULT 'MANUAL',
    "problemDescription" TEXT NOT NULL,
    "responsibleId" TEXT,
    "createdById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditRootCauseAnalysis_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditRootCauseAnalysis_id_findingId_key" UNIQUE ("id", "findingId")
);

-- CreateTable
CREATE TABLE "AuditRootCause" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "status" "AuditRootCauseStatus" NOT NULL DEFAULT 'POTENTIAL',
    "description" TEXT NOT NULL,
    "justification" TEXT,
    "supportingEvidence" TEXT,
    "ishikawaCategory" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditRootCause_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditRootCause_id_findingId_key" UNIQUE ("id", "findingId")
);

-- CreateTable
CREATE TABLE "AuditRootCauseFiveWhyStep" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditRootCauseFiveWhyStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditCorrectiveActionCause" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "causeId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedById" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,

    CONSTRAINT "AuditCorrectiveActionCause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditImmediateCorrection_findingId_status_idx" ON "AuditImmediateCorrection"("findingId", "status");
CREATE INDEX "AuditImmediateCorrection_responsibleId_status_idx" ON "AuditImmediateCorrection"("responsibleId", "status");
CREATE INDEX "AuditImmediateCorrection_createdById_idx" ON "AuditImmediateCorrection"("createdById");
CREATE INDEX "AuditImmediateCorrection_plannedDate_idx" ON "AuditImmediateCorrection"("plannedDate");

CREATE INDEX "AuditRootCauseAnalysis_findingId_status_idx" ON "AuditRootCauseAnalysis"("findingId", "status");
CREATE INDEX "AuditRootCauseAnalysis_findingId_methodology_idx" ON "AuditRootCauseAnalysis"("findingId", "methodology");
CREATE INDEX "AuditRootCauseAnalysis_responsibleId_idx" ON "AuditRootCauseAnalysis"("responsibleId");
CREATE INDEX "AuditRootCauseAnalysis_createdById_idx" ON "AuditRootCauseAnalysis"("createdById");
CREATE INDEX "AuditRootCauseAnalysis_confirmedById_idx" ON "AuditRootCauseAnalysis"("confirmedById");

CREATE INDEX "AuditRootCause_analysisId_status_position_idx" ON "AuditRootCause"("analysisId", "status", "position");
CREATE INDEX "AuditRootCause_findingId_status_idx" ON "AuditRootCause"("findingId", "status");
CREATE INDEX "AuditRootCause_createdById_idx" ON "AuditRootCause"("createdById");
CREATE INDEX "AuditRootCause_confirmedById_idx" ON "AuditRootCause"("confirmedById");

CREATE UNIQUE INDEX "AuditRootCauseFiveWhyStep_analysisId_sequence_key" ON "AuditRootCauseFiveWhyStep"("analysisId", "sequence");
CREATE INDEX "AuditRootCauseFiveWhyStep_analysisId_sequence_idx" ON "AuditRootCauseFiveWhyStep"("analysisId", "sequence");

CREATE UNIQUE INDEX "AuditCorrectiveActionCause_findingId_actionId_causeId_key" ON "AuditCorrectiveActionCause"("findingId", "actionId", "causeId");
CREATE INDEX "AuditCorrectiveActionCause_findingId_isActive_idx" ON "AuditCorrectiveActionCause"("findingId", "isActive");
CREATE INDEX "AuditCorrectiveActionCause_actionId_isActive_idx" ON "AuditCorrectiveActionCause"("actionId", "isActive");
CREATE INDEX "AuditCorrectiveActionCause_causeId_isActive_idx" ON "AuditCorrectiveActionCause"("causeId", "isActive");
CREATE INDEX "AuditCorrectiveActionCause_linkedById_idx" ON "AuditCorrectiveActionCause"("linkedById");
CREATE INDEX "AuditCorrectiveActionCause_removedById_idx" ON "AuditCorrectiveActionCause"("removedById");

-- Required by the composite foreign keys below so that an action/cause can only be linked
-- when both rows carry the same findingId.
CREATE UNIQUE INDEX "AuditCorrectiveAction_id_findingId_key" ON "AuditCorrectiveAction"("id", "findingId");

-- AddForeignKey
ALTER TABLE "AuditImmediateCorrection" ADD CONSTRAINT "AuditImmediateCorrection_findingId_fkey"
    FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditImmediateCorrection" ADD CONSTRAINT "AuditImmediateCorrection_responsibleId_fkey"
    FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditImmediateCorrection" ADD CONSTRAINT "AuditImmediateCorrection_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditRootCauseAnalysis" ADD CONSTRAINT "AuditRootCauseAnalysis_findingId_fkey"
    FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditRootCauseAnalysis" ADD CONSTRAINT "AuditRootCauseAnalysis_responsibleId_fkey"
    FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditRootCauseAnalysis" ADD CONSTRAINT "AuditRootCauseAnalysis_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditRootCauseAnalysis" ADD CONSTRAINT "AuditRootCauseAnalysis_confirmedById_fkey"
    FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditRootCause" ADD CONSTRAINT "AuditRootCause_analysisId_findingId_fkey"
    FOREIGN KEY ("analysisId", "findingId") REFERENCES "AuditRootCauseAnalysis"("id", "findingId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditRootCause" ADD CONSTRAINT "AuditRootCause_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditRootCause" ADD CONSTRAINT "AuditRootCause_confirmedById_fkey"
    FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditRootCauseFiveWhyStep" ADD CONSTRAINT "AuditRootCauseFiveWhyStep_analysisId_fkey"
    FOREIGN KEY ("analysisId") REFERENCES "AuditRootCauseAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditCorrectiveActionCause" ADD CONSTRAINT "AuditCorrectiveActionCause_findingId_fkey"
    FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditCorrectiveActionCause" ADD CONSTRAINT "AuditCorrectiveActionCause_actionId_findingId_fkey"
    FOREIGN KEY ("actionId", "findingId") REFERENCES "AuditCorrectiveAction"("id", "findingId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditCorrectiveActionCause" ADD CONSTRAINT "AuditCorrectiveActionCause_causeId_findingId_fkey"
    FOREIGN KEY ("causeId", "findingId") REFERENCES "AuditRootCause"("id", "findingId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditCorrectiveActionCause" ADD CONSTRAINT "AuditCorrectiveActionCause_linkedById_fkey"
    FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditCorrectiveActionCause" ADD CONSTRAINT "AuditCorrectiveActionCause_removedById_fkey"
    FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
