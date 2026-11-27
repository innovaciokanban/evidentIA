-- BLOQUE 4: propuestas de Checky aisladas del expediente oficial.
-- Migracion aditiva. Debe revisarse y autorizarse antes de aplicarse a PostgreSQL.
-- La aceptacion de una propuesta no confirma causas, no completa acciones y no verifica hallazgos.

CREATE TYPE "AuditCheckySuggestionKind" AS ENUM ('ROOT_CAUSE', 'ROOT_CAUSE_ANALYSIS', 'CORRECTIVE_ACTION');

ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CHECKY_SUGGESTION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CHECKY_SUGGESTION_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CHECKY_SUGGESTION_ACCEPTED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'CHECKY_SUGGESTION_REJECTED';

CREATE TABLE "AuditCheckySuggestion" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "kind" "AuditCheckySuggestionKind" NOT NULL,
    "originalPayload" JSONB NOT NULL,
    "editablePayload" JSONB NOT NULL,
    "evidenceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "dedupeKey" TEXT NOT NULL,
    "status" "CheckySuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "acceptedRootCauseId" TEXT,
    "acceptedAnalysisId" TEXT,
    "acceptedActionId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditCheckySuggestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditCheckySuggestion_auditId_dedupeKey_key"
    ON "AuditCheckySuggestion"("auditId", "dedupeKey");
CREATE UNIQUE INDEX "AuditCheckySuggestion_acceptedRootCauseId_key"
    ON "AuditCheckySuggestion"("acceptedRootCauseId");
CREATE UNIQUE INDEX "AuditCheckySuggestion_acceptedAnalysisId_key"
    ON "AuditCheckySuggestion"("acceptedAnalysisId");
CREATE UNIQUE INDEX "AuditCheckySuggestion_acceptedActionId_key"
    ON "AuditCheckySuggestion"("acceptedActionId");
CREATE INDEX "AuditCheckySuggestion_auditId_findingId_kind_status_idx"
    ON "AuditCheckySuggestion"("auditId", "findingId", "kind", "status");
CREATE INDEX "AuditCheckySuggestion_requestedById_idx"
    ON "AuditCheckySuggestion"("requestedById");

ALTER TABLE "AuditCheckySuggestion"
    ADD CONSTRAINT "AuditCheckySuggestion_auditId_fkey"
    FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditCheckySuggestion_findingId_fkey"
    FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditCheckySuggestion_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditCheckySuggestion_acceptedRootCauseId_fkey"
    FOREIGN KEY ("acceptedRootCauseId") REFERENCES "AuditRootCause"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditCheckySuggestion_acceptedAnalysisId_fkey"
    FOREIGN KEY ("acceptedAnalysisId") REFERENCES "AuditRootCauseAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "AuditCheckySuggestion_acceptedActionId_fkey"
    FOREIGN KEY ("acceptedActionId") REFERENCES "AuditCorrectiveAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
