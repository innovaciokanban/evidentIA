-- Banco de auditores y competencias por empresa. Migracion aditiva; no vincula aun auditores a auditorias.

CREATE TYPE "AuditorType" AS ENUM ('INTERNAL', 'EXTERNAL');
CREATE TYPE "AuditorStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'INACTIVE');

CREATE TABLE "Auditor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "type" "AuditorType" NOT NULL,
    "position" TEXT,
    "organization" TEXT,
    "experience" TEXT,
    "status" "AuditorStatus" NOT NULL DEFAULT 'AVAILABLE',
    "observations" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Auditor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Auditor_companyId_email_key" ON "Auditor"("companyId", "email");
CREATE INDEX "Auditor_companyId_status_idx" ON "Auditor"("companyId", "status");
CREATE INDEX "Auditor_companyId_type_idx" ON "Auditor"("companyId", "type");
CREATE INDEX "Auditor_createdById_idx" ON "Auditor"("createdById");

ALTER TABLE "Auditor" ADD CONSTRAINT "Auditor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Auditor" ADD CONSTRAINT "Auditor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AuditorCompetency" (
    "id" TEXT NOT NULL,
    "auditorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditorCompetency_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditorCompetency_level_check" CHECK ("level" BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX "AuditorCompetency_auditorId_nameKey_key" ON "AuditorCompetency"("auditorId", "nameKey");
CREATE INDEX "AuditorCompetency_auditorId_idx" ON "AuditorCompetency"("auditorId");

ALTER TABLE "AuditorCompetency" ADD CONSTRAINT "AuditorCompetency_auditorId_fkey" FOREIGN KEY ("auditorId") REFERENCES "Auditor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
