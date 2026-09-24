CREATE TABLE "AIAnalysis" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "executiveSummary" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "keyFindings" JSONB NOT NULL,
    "foStrategies" JSONB NOT NULL,
    "doStrategies" JSONB NOT NULL,
    "faStrategies" JSONB NOT NULL,
    "daStrategies" JSONB NOT NULL,
    "priorityRisks" JSONB NOT NULL,
    "priorityOpportunities" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AIAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AIAnalysis_diagnosticId_key" ON "AIAnalysis"("diagnosticId");

ALTER TABLE "AIAnalysis" ADD CONSTRAINT "AIAnalysis_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "QualityDiagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
