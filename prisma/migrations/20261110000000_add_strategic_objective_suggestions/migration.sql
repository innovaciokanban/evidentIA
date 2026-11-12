-- CreateTable
CREATE TABLE "StrategicObjectiveSuggestion" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "originalPayload" JSONB NOT NULL,
    "editablePayload" JSONB NOT NULL,
    "strategyRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "dedupeKey" TEXT NOT NULL,
    "status" "CheckySuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "acceptedObjectiveId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategicObjectiveSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StrategicObjectiveSuggestion_diagnosticId_dedupeKey_key" ON "StrategicObjectiveSuggestion"("diagnosticId", "dedupeKey");
CREATE UNIQUE INDEX "StrategicObjectiveSuggestion_acceptedObjectiveId_key" ON "StrategicObjectiveSuggestion"("acceptedObjectiveId");
CREATE INDEX "StrategicObjectiveSuggestion_diagnosticId_status_idx" ON "StrategicObjectiveSuggestion"("diagnosticId", "status");
CREATE INDEX "StrategicObjectiveSuggestion_requestedById_idx" ON "StrategicObjectiveSuggestion"("requestedById");

-- AddForeignKey
ALTER TABLE "StrategicObjectiveSuggestion" ADD CONSTRAINT "StrategicObjectiveSuggestion_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "QualityDiagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StrategicObjectiveSuggestion" ADD CONSTRAINT "StrategicObjectiveSuggestion_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StrategicObjectiveSuggestion" ADD CONSTRAINT "StrategicObjectiveSuggestion_acceptedObjectiveId_fkey" FOREIGN KEY ("acceptedObjectiveId") REFERENCES "StrategicObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;
