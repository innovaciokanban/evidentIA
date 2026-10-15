CREATE TYPE "RiskAcceptanceStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

CREATE TYPE "RiskTreatmentType" AS ENUM ('AVOID', 'MITIGATE', 'TRANSFER', 'ACCEPT');

ALTER TABLE "Risk" ADD COLUMN "acceptanceStatus" "RiskAcceptanceStatus" NOT NULL DEFAULT 'PENDING';

ALTER TABLE "Risk" ADD COLUMN "treatment" "RiskTreatmentType";

ALTER TABLE "Risk" ADD COLUMN "mitigationOwnerId" TEXT;

ALTER TABLE "Risk" ADD COLUMN "mitigationStartDate" TIMESTAMP(3);

ALTER TABLE "Risk" ADD COLUMN "mitigationDueDate" TIMESTAMP(3);

CREATE TABLE "RiskEvidence" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Risk_mitigationOwnerId_idx" ON "Risk"("mitigationOwnerId");

CREATE INDEX "RiskEvidence_riskId_idx" ON "RiskEvidence"("riskId");

ALTER TABLE "Risk" ADD CONSTRAINT "Risk_mitigationOwnerId_fkey" FOREIGN KEY ("mitigationOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RiskEvidence" ADD CONSTRAINT "RiskEvidence_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
