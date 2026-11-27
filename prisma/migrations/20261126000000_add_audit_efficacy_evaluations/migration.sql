-- BLOQUE 3: verificacion historica de eficacia de acciones correctivas.
-- Migracion aditiva. No modifica ni convierte los campos legacy de AuditFinding.
-- Esta migracion debe revisarse y autorizarse antes de aplicarse a PostgreSQL.

CREATE TYPE "AuditEfficacyEvaluationStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "AuditEfficacyOutcome" AS ENUM ('PENDING', 'EFFECTIVE', 'PARTIALLY_EFFECTIVE', 'INEFFECTIVE');
CREATE TYPE "AuditEfficacyMethodology" AS ENUM ('DOCUMENTARY_SAMPLING', 'INDICATOR_MONITORING', 'DIRECT_OBSERVATION', 'INTERVIEWS', 'RECORD_REVIEW', 'FOLLOW_UP_AUDIT', 'OTHER');

ALTER TYPE "AuditEventType" ADD VALUE 'EFFICACY_EVALUATION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'EFFICACY_EVALUATION_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'EFFICACY_EVALUATION_PROGRESS_ADDED';
ALTER TYPE "AuditEventType" ADD VALUE 'EFFICACY_EVALUATION_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE 'EFFICACY_EVALUATION_COMPLETED';
ALTER TYPE "AuditEventType" ADD VALUE 'EFFICACY_EVALUATION_CANCELLED';
ALTER TYPE "AuditEventType" ADD VALUE 'EFFICACY_EVALUATION_EVIDENCE_LINKED';
ALTER TYPE "AuditEventType" ADD VALUE 'EFFICACY_EVALUATION_EVIDENCE_UNLINKED';

ALTER TABLE "AuditCorrectiveAction"
    ADD COLUMN "efficacyEvaluationId" TEXT;

CREATE TABLE "AuditEfficacyEvaluation" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "status" "AuditEfficacyEvaluationStatus" NOT NULL DEFAULT 'PLANNED',
    "outcome" "AuditEfficacyOutcome" NOT NULL DEFAULT 'PENDING',
    "responsibleId" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3),
    "methodology" "AuditEfficacyMethodology" NOT NULL,
    "methodologyOther" TEXT,
    "observationPeriod" TEXT,
    "observationStartDate" TIMESTAMP(3),
    "observationEndDate" TIMESTAMP(3),
    "scope" TEXT NOT NULL,
    "observations" TEXT,
    "conclusion" TEXT,
    "recurrenceDetected" BOOLEAN NOT NULL DEFAULT false,
    "recurrenceDescription" TEXT,
    "recurrenceIdentifiedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditEfficacyEvaluation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditEfficacyEvaluation_dates_check"
        CHECK ("observationStartDate" IS NULL OR "observationEndDate" IS NULL OR "observationStartDate" <= "observationEndDate"),
    CONSTRAINT "AuditEfficacyEvaluation_other_method_check"
        CHECK ("methodology" <> 'OTHER' OR length(trim(coalesce("methodologyOther", ''))) > 0),
    CONSTRAINT "AuditEfficacyEvaluation_recurrence_check"
        CHECK (NOT "recurrenceDetected" OR length(trim(coalesce("recurrenceDescription", ''))) > 0)
);

CREATE TABLE "AuditEfficacyCriterionResult" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expectedResult" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "resultObtained" TEXT,
    "measuredValue" TEXT,
    "measurementUnit" TEXT,
    "sampleSize" INTEGER,
    "isMet" BOOLEAN,
    "observations" TEXT,
    "evaluatedById" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditEfficacyCriterionResult_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditEfficacyCriterionResult_sampleSize_check"
        CHECK ("sampleSize" IS NULL OR "sampleSize" > 0)
);

CREATE TABLE "AuditEfficacyEvaluationProgress" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "results" TEXT,
    "difficulties" TEXT,
    "pendingActivities" TEXT,
    "percent" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEfficacyEvaluationProgress_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditEfficacyEvaluationProgress_percent_check"
        CHECK ("percent" IS NULL OR "percent" BETWEEN 0 AND 100)
);

CREATE TABLE "AuditEfficacyEvaluationEvidence" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "linkedById" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEfficacyEvaluationEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEfficacyEvaluationEvidenceFile" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "evidenceFileId" TEXT NOT NULL,
    "linkedById" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEfficacyEvaluationEvidenceFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditEfficacyCriterionResult_evaluationId_criterionId_key"
    ON "AuditEfficacyCriterionResult"("evaluationId", "criterionId");
CREATE UNIQUE INDEX "AuditEfficacyEvaluationEvidence_evaluationId_evidenceId_key"
    ON "AuditEfficacyEvaluationEvidence"("evaluationId", "evidenceId");
CREATE UNIQUE INDEX "AuditEfficacyEvaluationEvidenceFile_evaluationId_evidenceFileId_key"
    ON "AuditEfficacyEvaluationEvidenceFile"("evaluationId", "evidenceFileId");

CREATE INDEX "AuditCorrectiveAction_efficacyEvaluationId_idx" ON "AuditCorrectiveAction"("efficacyEvaluationId");
CREATE INDEX "AuditEfficacyEvaluation_auditId_createdAt_idx" ON "AuditEfficacyEvaluation"("auditId", "createdAt");
CREATE INDEX "AuditEfficacyEvaluation_findingId_createdAt_idx" ON "AuditEfficacyEvaluation"("findingId", "createdAt");
CREATE INDEX "AuditEfficacyEvaluation_actionId_createdAt_idx" ON "AuditEfficacyEvaluation"("actionId", "createdAt");
CREATE INDEX "AuditEfficacyEvaluation_status_idx" ON "AuditEfficacyEvaluation"("status");
CREATE INDEX "AuditEfficacyEvaluation_outcome_idx" ON "AuditEfficacyEvaluation"("outcome");
CREATE INDEX "AuditEfficacyEvaluation_responsibleId_idx" ON "AuditEfficacyEvaluation"("responsibleId");
CREATE INDEX "AuditEfficacyEvaluation_scheduledDate_idx" ON "AuditEfficacyEvaluation"("scheduledDate");
CREATE INDEX "AuditEfficacyCriterionResult_criterionId_idx" ON "AuditEfficacyCriterionResult"("criterionId");
CREATE INDEX "AuditEfficacyCriterionResult_evaluatedById_idx" ON "AuditEfficacyCriterionResult"("evaluatedById");
CREATE INDEX "AuditEfficacyEvaluationProgress_evaluationId_createdAt_idx" ON "AuditEfficacyEvaluationProgress"("evaluationId", "createdAt");
CREATE INDEX "AuditEfficacyEvaluationProgress_createdById_idx" ON "AuditEfficacyEvaluationProgress"("createdById");
CREATE INDEX "AuditEfficacyEvaluationEvidence_evidenceId_idx" ON "AuditEfficacyEvaluationEvidence"("evidenceId");
CREATE INDEX "AuditEfficacyEvaluationEvidence_linkedById_idx" ON "AuditEfficacyEvaluationEvidence"("linkedById");
CREATE INDEX "AuditEfficacyEvaluationEvidenceFile_evidenceFileId_idx" ON "AuditEfficacyEvaluationEvidenceFile"("evidenceFileId");
CREATE INDEX "AuditEfficacyEvaluationEvidenceFile_linkedById_idx" ON "AuditEfficacyEvaluationEvidenceFile"("linkedById");

ALTER TABLE "AuditCorrectiveAction"
    ADD CONSTRAINT "AuditCorrectiveAction_efficacyEvaluationId_fkey"
    FOREIGN KEY ("efficacyEvaluationId") REFERENCES "AuditEfficacyEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditEfficacyEvaluation"
    ADD CONSTRAINT "AuditEfficacyEvaluation_auditId_fkey"
    FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditEfficacyEvaluation_findingId_fkey"
    FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditEfficacyEvaluation_actionId_findingId_fkey"
    FOREIGN KEY ("actionId", "findingId") REFERENCES "AuditCorrectiveAction"("id", "findingId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditEfficacyEvaluation_responsibleId_fkey"
    FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditEfficacyEvaluation_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditEfficacyEvaluation_completedById_fkey"
    FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditEfficacyCriterionResult"
    ADD CONSTRAINT "AuditEfficacyCriterionResult_evaluationId_fkey"
    FOREIGN KEY ("evaluationId") REFERENCES "AuditEfficacyEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditEfficacyCriterionResult_criterionId_fkey"
    FOREIGN KEY ("criterionId") REFERENCES "AuditActionAcceptanceCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditEfficacyCriterionResult_evaluatedById_fkey"
    FOREIGN KEY ("evaluatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditEfficacyEvaluationProgress"
    ADD CONSTRAINT "AuditEfficacyEvaluationProgress_evaluationId_fkey"
    FOREIGN KEY ("evaluationId") REFERENCES "AuditEfficacyEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditEfficacyEvaluationProgress_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditEfficacyEvaluationEvidence"
    ADD CONSTRAINT "AuditEfficacyEvaluationEvidence_evaluationId_fkey"
    FOREIGN KEY ("evaluationId") REFERENCES "AuditEfficacyEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditEfficacyEvaluationEvidence_evidenceId_fkey"
    FOREIGN KEY ("evidenceId") REFERENCES "AuditEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditEfficacyEvaluationEvidence_linkedById_fkey"
    FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditEfficacyEvaluationEvidenceFile"
    ADD CONSTRAINT "AuditEfficacyEvaluationEvidenceFile_evaluationId_fkey"
    FOREIGN KEY ("evaluationId") REFERENCES "AuditEfficacyEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditEfficacyEvaluationEvidenceFile_evidenceFileId_fkey"
    FOREIGN KEY ("evidenceFileId") REFERENCES "AuditEvidenceFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditEfficacyEvaluationEvidenceFile_linkedById_fkey"
    FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
