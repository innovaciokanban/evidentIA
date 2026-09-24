CREATE TYPE "DiagnosticStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED');
CREATE TYPE "SWOTType" AS ENUM ('STRENGTH', 'WEAKNESS', 'OPPORTUNITY', 'THREAT');
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "Impact" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "QualityDiagnostic" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DiagnosticStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QualityDiagnostic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SWOTAnalysis" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SWOTAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SWOTItem" (
    "id" TEXT NOT NULL,
    "swotId" TEXT NOT NULL,
    "type" "SWOTType" NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "Priority" NOT NULL,
    "impact" "Impact" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SWOTItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SWOTAnalysis_diagnosticId_key" ON "SWOTAnalysis"("diagnosticId");
CREATE INDEX "QualityDiagnostic_companyId_idx" ON "QualityDiagnostic"("companyId");
CREATE INDEX "QualityDiagnostic_createdById_idx" ON "QualityDiagnostic"("createdById");
CREATE INDEX "QualityDiagnostic_status_idx" ON "QualityDiagnostic"("status");
CREATE INDEX "SWOTItem_swotId_idx" ON "SWOTItem"("swotId");
CREATE INDEX "SWOTItem_type_idx" ON "SWOTItem"("type");

ALTER TABLE "QualityDiagnostic" ADD CONSTRAINT "QualityDiagnostic_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QualityDiagnostic" ADD CONSTRAINT "QualityDiagnostic_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SWOTAnalysis" ADD CONSTRAINT "SWOTAnalysis_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "QualityDiagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SWOTItem" ADD CONSTRAINT "SWOTItem_swotId_fkey" FOREIGN KEY ("swotId") REFERENCES "SWOTAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
