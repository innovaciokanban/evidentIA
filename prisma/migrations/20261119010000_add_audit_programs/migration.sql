-- Programa de auditorías: migración aditiva. Las auditorías existentes permanecen sin programa.

-- CreateEnum
CREATE TYPE "AuditProgramStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AuditProgram" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "responsibleId" TEXT,
    "criteria" TEXT NOT NULL,
    "resources" TEXT,
    "risks" TEXT,
    "notes" TEXT,
    "status" "AuditProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditProgram_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Audit" ADD COLUMN "auditProgramId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AuditProgram_companyId_code_key" ON "AuditProgram"("companyId", "code");
CREATE INDEX "AuditProgram_companyId_idx" ON "AuditProgram"("companyId");
CREATE INDEX "AuditProgram_companyId_status_idx" ON "AuditProgram"("companyId", "status");
CREATE INDEX "AuditProgram_responsibleId_idx" ON "AuditProgram"("responsibleId");
CREATE INDEX "Audit_auditProgramId_idx" ON "Audit"("auditProgramId");

-- AddForeignKey
ALTER TABLE "AuditProgram" ADD CONSTRAINT "AuditProgram_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditProgram" ADD CONSTRAINT "AuditProgram_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_auditProgramId_fkey" FOREIGN KEY ("auditProgramId") REFERENCES "AuditProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;
