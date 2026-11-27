-- BLOQUE 2: gestión integral de acciones correctivas.
-- Migración aditiva y retrocompatible. No modifica ni elimina registros existentes.
-- Las acciones existentes quedan con workflowVersion=0 (legado) y progreso 0;
-- el progreso se reconstruye desde el último porcentaje histórico disponible.

CREATE TYPE "AuditActionAcceptanceCriterionType" AS ENUM ('IMPLEMENTATION', 'EFFECTIVENESS');

ALTER TABLE "AuditCorrectiveAction"
    ADD COLUMN "objective" TEXT,
    ADD COLUMN "implementationPlan" TEXT,
    ADD COLUMN "resources" TEXT,
    ADD COLUMN "observations" TEXT,
    ADD COLUMN "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "progressPercent" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "workflowVersion" INTEGER NOT NULL DEFAULT 0;

-- La fuente de verdad del avance pasa a ser AuditCorrectiveAction.progressPercent.
-- Los registros antiguos conservan sus porcentajes y se toma el último porcentaje
-- informado por acción; las acciones sin porcentaje histórico quedan en 0.
UPDATE "AuditCorrectiveAction" AS action
SET "progressPercent" = COALESCE((
    SELECT progress."percent"
    FROM "AuditActionProgress" AS progress
    WHERE progress."actionId" = action."id"
      AND progress."percent" IS NOT NULL
    ORDER BY progress."createdAt" DESC, progress."id" DESC
    LIMIT 1
), 0);

ALTER TABLE "AuditCorrectiveAction"
    ADD CONSTRAINT "AuditCorrectiveAction_progressPercent_check"
    CHECK ("progressPercent" BETWEEN 0 AND 100);

ALTER TABLE "AuditEvidence"
    ADD COLUMN "actionId" TEXT;

CREATE TABLE "AuditActionAcceptanceCriterion" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "type" "AuditActionAcceptanceCriterionType" NOT NULL DEFAULT 'IMPLEMENTATION',
    "description" TEXT NOT NULL,
    "expectedResult" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "isMet" BOOLEAN NOT NULL DEFAULT false,
    "observations" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditActionAcceptanceCriterion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvidence_actionId_idx" ON "AuditEvidence"("actionId");
CREATE INDEX "AuditCorrectiveAction_progressPercent_idx" ON "AuditCorrectiveAction"("progressPercent");
CREATE INDEX "AuditCorrectiveAction_workflowVersion_idx" ON "AuditCorrectiveAction"("workflowVersion");
CREATE INDEX "AuditActionAcceptanceCriterion_actionId_type_isMet_idx"
    ON "AuditActionAcceptanceCriterion"("actionId", "type", "isMet");
CREATE INDEX "AuditActionAcceptanceCriterion_actionId_required_isMet_idx"
    ON "AuditActionAcceptanceCriterion"("actionId", "required", "isMet");
CREATE INDEX "AuditActionAcceptanceCriterion_completedById_idx"
    ON "AuditActionAcceptanceCriterion"("completedById");
CREATE INDEX "AuditActionAcceptanceCriterion_createdById_idx"
    ON "AuditActionAcceptanceCriterion"("createdById");

ALTER TABLE "AuditEvidence"
    ADD CONSTRAINT "AuditEvidence_actionId_fkey"
    FOREIGN KEY ("actionId") REFERENCES "AuditCorrectiveAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditActionAcceptanceCriterion"
    ADD CONSTRAINT "AuditActionAcceptanceCriterion_actionId_fkey"
    FOREIGN KEY ("actionId") REFERENCES "AuditCorrectiveAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditActionAcceptanceCriterion_completedById_fkey"
    FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditActionAcceptanceCriterion_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
