-- CreateEnum
CREATE TYPE "WeightingLevel" AS ENUM ('MUY_BAJO', 'BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO');

-- CreateTable
CREATE TABLE "StrategicCrossWeighting" (
    "id" TEXT NOT NULL,
    "crossId" TEXT NOT NULL,
    "impactoEstrategico" "WeightingLevel" NOT NULL,
    "viabilidad" "WeightingLevel" NOT NULL,
    "urgencia" "WeightingLevel" NOT NULL,
    "sinergiaInterna" "WeightingLevel" NOT NULL,
    "impactoReputacional" "WeightingLevel" NOT NULL,
    "weightedScore" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategicCrossWeighting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StrategicCrossWeighting_crossId_key" ON "StrategicCrossWeighting"("crossId");

-- CreateIndex
CREATE INDEX "StrategicCrossWeighting_weightedScore_idx" ON "StrategicCrossWeighting"("weightedScore");

-- CreateIndex
CREATE INDEX "StrategicCrossWeighting_createdById_idx" ON "StrategicCrossWeighting"("createdById");

-- AddForeignKey
ALTER TABLE "StrategicCrossWeighting" ADD CONSTRAINT "StrategicCrossWeighting_crossId_fkey" FOREIGN KEY ("crossId") REFERENCES "StrategicCross"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicCrossWeighting" ADD CONSTRAINT "StrategicCrossWeighting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
