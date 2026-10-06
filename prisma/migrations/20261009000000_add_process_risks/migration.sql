CREATE TYPE "RiskControlEvaluation" AS ENUM ('PENDING', 'WEAK', 'PARTIAL', 'EFFECTIVE');

CREATE TABLE "Risk" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "riskType" TEXT NOT NULL,
    "bpmnActivity" TEXT NOT NULL,
    "inherentImpact" INTEGER NOT NULL,
    "inherentProbability" INTEGER NOT NULL,
    "residualImpact" INTEGER NOT NULL,
    "residualProbability" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Risk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RiskControl" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evaluation" "RiskControlEvaluation" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskControl_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Risk_processId_idx" ON "Risk"("processId");
CREATE INDEX "RiskControl_riskId_idx" ON "RiskControl"("riskId");

ALTER TABLE "Risk" ADD CONSTRAINT "Risk_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiskControl" ADD CONSTRAINT "RiskControl_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
