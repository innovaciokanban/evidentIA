-- CreateEnum
CREATE TYPE "CrossType" AS ENUM ('FO', 'DO', 'FA', 'DA');

-- CreateEnum
CREATE TYPE "CrossOrigin" AS ENUM ('USER', 'AI', 'BOTH');

-- CreateTable
CREATE TABLE "StrategicCross" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "crossType" "CrossType" NOT NULL,
    "origin" "CrossOrigin" NOT NULL DEFAULT 'USER',
    "factor1Id" TEXT NOT NULL,
    "factor2Id" TEXT NOT NULL,
    "strategy" TEXT,
    "aiAnalysis" JSONB,
    "priority" "Priority",
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategicCross_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrategicCross_diagnosticId_idx" ON "StrategicCross"("diagnosticId");

-- CreateIndex
CREATE INDEX "StrategicCross_factor1Id_idx" ON "StrategicCross"("factor1Id");

-- CreateIndex
CREATE INDEX "StrategicCross_factor2Id_idx" ON "StrategicCross"("factor2Id");

-- CreateIndex
CREATE UNIQUE INDEX "StrategicCross_factor1Id_factor2Id_key" ON "StrategicCross"("factor1Id", "factor2Id");

-- AddForeignKey
ALTER TABLE "StrategicCross" ADD CONSTRAINT "StrategicCross_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "QualityDiagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicCross" ADD CONSTRAINT "StrategicCross_factor1Id_fkey" FOREIGN KEY ("factor1Id") REFERENCES "SWOTItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicCross" ADD CONSTRAINT "StrategicCross_factor2Id_fkey" FOREIGN KEY ("factor2Id") REFERENCES "SWOTItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicCross" ADD CONSTRAINT "StrategicCross_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
