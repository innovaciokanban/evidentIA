-- CreateEnum
CREATE TYPE "StrategicObjectiveStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "StrategicObjectiveOrigin" AS ENUM ('MANUAL', 'CHECKY');

-- CreateEnum
CREATE TYPE "StrategicObjectiveStrategySource" AS ENUM ('AI_ANALYSIS', 'CHECKY', 'STRATEGIC_CROSS');

-- CreateEnum
CREATE TYPE "StrategicObjectiveHistoryEventType" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'STRATEGY_LINKED', 'STRATEGY_UNLINKED');

-- CreateTable
CREATE TABLE "StrategicObjective" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "specificCriteria" TEXT,
    "measurableCriteria" TEXT,
    "achievableCriteria" TEXT,
    "relevantCriteria" TEXT,
    "timeBoundCriteria" TEXT,
    "status" "StrategicObjectiveStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" "StrategicObjectiveOrigin" NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategicObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategicObjectiveStrategy" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "source" "StrategicObjectiveStrategySource" NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "strategyTitle" TEXT NOT NULL,
    "strategyDescription" TEXT NOT NULL,
    "weightedScore" DOUBLE PRECISION NOT NULL,
    "weightingBand" TEXT NOT NULL,
    "linkedById" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicObjectiveStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategicObjectiveIndicator" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "name" TEXT,
    "unit" TEXT,
    "baselineValue" TEXT,
    "targetValue" TEXT,
    "measurementMethod" TEXT,
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategicObjectiveIndicator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategicObjectiveHistory" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorEmail" TEXT,
    "eventType" "StrategicObjectiveHistoryEventType" NOT NULL,
    "summary" TEXT NOT NULL,
    "changes" JSONB,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicObjectiveHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrategicObjective_diagnosticId_status_idx" ON "StrategicObjective"("diagnosticId", "status");
CREATE INDEX "StrategicObjective_createdById_idx" ON "StrategicObjective"("createdById");
CREATE INDEX "StrategicObjectiveStrategy_source_sourceRef_idx" ON "StrategicObjectiveStrategy"("source", "sourceRef");
CREATE INDEX "StrategicObjectiveStrategy_linkedById_idx" ON "StrategicObjectiveStrategy"("linkedById");
CREATE UNIQUE INDEX "StrategicObjectiveStrategy_objectiveId_source_sourceRef_key" ON "StrategicObjectiveStrategy"("objectiveId", "source", "sourceRef");
CREATE UNIQUE INDEX "StrategicObjectiveIndicator_objectiveId_key" ON "StrategicObjectiveIndicator"("objectiveId");
CREATE INDEX "StrategicObjectiveIndicator_deadline_idx" ON "StrategicObjectiveIndicator"("deadline");
CREATE INDEX "StrategicObjectiveHistory_objectiveId_occurredAt_idx" ON "StrategicObjectiveHistory"("objectiveId", "occurredAt");
CREATE INDEX "StrategicObjectiveHistory_eventType_idx" ON "StrategicObjectiveHistory"("eventType");
CREATE INDEX "StrategicObjectiveHistory_actorId_idx" ON "StrategicObjectiveHistory"("actorId");

-- AddForeignKey
ALTER TABLE "StrategicObjective" ADD CONSTRAINT "StrategicObjective_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "QualityDiagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StrategicObjective" ADD CONSTRAINT "StrategicObjective_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StrategicObjectiveStrategy" ADD CONSTRAINT "StrategicObjectiveStrategy_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "StrategicObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StrategicObjectiveStrategy" ADD CONSTRAINT "StrategicObjectiveStrategy_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StrategicObjectiveIndicator" ADD CONSTRAINT "StrategicObjectiveIndicator_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "StrategicObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StrategicObjectiveHistory" ADD CONSTRAINT "StrategicObjectiveHistory_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "StrategicObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StrategicObjectiveHistory" ADD CONSTRAINT "StrategicObjectiveHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
