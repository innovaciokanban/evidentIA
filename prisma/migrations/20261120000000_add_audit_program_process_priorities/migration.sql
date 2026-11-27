-- Matriz de priorización de procesos por programa de auditoría. Migración aditiva.

CREATE TABLE "AuditProgramProcessPriority" (
    "id" TEXT NOT NULL,
    "auditProgramId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "criticality" INTEGER NOT NULL,
    "recentChanges" INTEGER NOT NULL,
    "previousUnfavorableResults" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "calculatedPriority" "Priority" NOT NULL,
    "manualPriority" "Priority",
    "manualJustification" TEXT,
    "observations" TEXT,
    "evaluatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditProgramProcessPriority_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditProgramProcessPriority_criticality_check" CHECK ("criticality" BETWEEN 1 AND 3),
    CONSTRAINT "AuditProgramProcessPriority_recentChanges_check" CHECK ("recentChanges" BETWEEN 1 AND 3),
    CONSTRAINT "AuditProgramProcessPriority_previousUnfavorableResults_check" CHECK ("previousUnfavorableResults" BETWEEN 1 AND 3),
    CONSTRAINT "AuditProgramProcessPriority_score_check" CHECK ("score" BETWEEN 3 AND 9),
    CONSTRAINT "AuditProgramProcessPriority_manual_justification_check" CHECK ("manualPriority" IS NULL OR NULLIF(BTRIM("manualJustification"), '') IS NOT NULL)
);

CREATE UNIQUE INDEX "AuditProgramProcessPriority_auditProgramId_processId_key" ON "AuditProgramProcessPriority"("auditProgramId", "processId");
CREATE INDEX "AuditProgramProcessPriority_auditProgramId_calculatedPriority_idx" ON "AuditProgramProcessPriority"("auditProgramId", "calculatedPriority");
CREATE INDEX "AuditProgramProcessPriority_auditProgramId_score_idx" ON "AuditProgramProcessPriority"("auditProgramId", "score");
CREATE INDEX "AuditProgramProcessPriority_processId_idx" ON "AuditProgramProcessPriority"("processId");
CREATE INDEX "AuditProgramProcessPriority_evaluatedById_idx" ON "AuditProgramProcessPriority"("evaluatedById");

ALTER TABLE "AuditProgramProcessPriority" ADD CONSTRAINT "AuditProgramProcessPriority_auditProgramId_fkey" FOREIGN KEY ("auditProgramId") REFERENCES "AuditProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditProgramProcessPriority" ADD CONSTRAINT "AuditProgramProcessPriority_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditProgramProcessPriority" ADD CONSTRAINT "AuditProgramProcessPriority_evaluatedById_fkey" FOREIGN KEY ("evaluatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
