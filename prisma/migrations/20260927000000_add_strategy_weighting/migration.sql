-- CreateEnum
CREATE TYPE "StrategySource" AS ENUM ('AI_ANALYSIS', 'CHECKY');

-- CreateTable
CREATE TABLE "StrategyWeighting" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "source" "StrategySource" NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "impactoEstrategico" "WeightingLevel" NOT NULL,
    "viabilidad" "WeightingLevel" NOT NULL,
    "urgencia" "WeightingLevel" NOT NULL,
    "sinergiaInterna" "WeightingLevel" NOT NULL,
    "impactoReputacional" "WeightingLevel" NOT NULL,
    "weightedScore" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyWeighting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrategyWeighting_diagnosticId_weightedScore_idx" ON "StrategyWeighting"("diagnosticId", "weightedScore");

-- CreateIndex
CREATE INDEX "StrategyWeighting_createdById_idx" ON "StrategyWeighting"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyWeighting_diagnosticId_source_sourceRef_key" ON "StrategyWeighting"("diagnosticId", "source", "sourceRef");

-- AddForeignKey
ALTER TABLE "StrategyWeighting" ADD CONSTRAINT "StrategyWeighting_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "QualityDiagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyWeighting" ADD CONSTRAINT "StrategyWeighting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
