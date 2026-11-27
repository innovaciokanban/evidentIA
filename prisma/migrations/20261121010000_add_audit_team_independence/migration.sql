-- Equipo auditor e independencia. Migracion aditiva; no modifica auditorias ni registros existentes.

ALTER TYPE "AuditEventType" ADD VALUE 'TEAM_MEMBER_ASSIGNED';
ALTER TYPE "AuditEventType" ADD VALUE 'TEAM_MEMBER_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'TEAM_MEMBER_REMOVED';
ALTER TYPE "AuditEventType" ADD VALUE 'INDEPENDENCE_EVALUATED';

CREATE TYPE "AuditTeamRole" AS ENUM ('LEAD', 'MEMBER');
CREATE TYPE "AuditIndependenceStatus" AS ENUM ('PENDING', 'CLEAR', 'CONFLICT', 'MITIGATED');

CREATE TABLE "AuditTeamMember" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "auditorId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "AuditTeamRole" NOT NULL DEFAULT 'MEMBER',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,
    "observations" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "independenceStatus" "AuditIndependenceStatus" NOT NULL DEFAULT 'PENDING',
    "independenceDeclaration" TEXT,
    "conflictDescription" TEXT,
    "mitigationMeasures" TEXT,
    "independenceEvaluatedAt" TIMESTAMP(3),
    "independenceEvaluatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditTeamMember_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditTeamMember_auditId_isActive_idx" ON "AuditTeamMember"("auditId", "isActive");
CREATE INDEX "AuditTeamMember_auditId_role_isActive_idx" ON "AuditTeamMember"("auditId", "role", "isActive");
CREATE INDEX "AuditTeamMember_auditorId_isActive_idx" ON "AuditTeamMember"("auditorId", "isActive");
CREATE INDEX "AuditTeamMember_companyId_isActive_idx" ON "AuditTeamMember"("companyId", "isActive");
CREATE INDEX "AuditTeamMember_assignedById_idx" ON "AuditTeamMember"("assignedById");
CREATE INDEX "AuditTeamMember_removedById_idx" ON "AuditTeamMember"("removedById");
CREATE INDEX "AuditTeamMember_independenceEvaluatedById_idx" ON "AuditTeamMember"("independenceEvaluatedById");

-- Solo las asignaciones activas participan en las reglas de duplicidad y de líder único. Las filas
-- retiradas permanecen para conservar la historia y permiten una futura reasignación.
CREATE UNIQUE INDEX "AuditTeamMember_active_auditor_key"
    ON "AuditTeamMember"("auditId", "auditorId")
    WHERE "isActive" = true;
CREATE UNIQUE INDEX "AuditTeamMember_active_lead_key"
    ON "AuditTeamMember"("auditId")
    WHERE "isActive" = true AND "role" = 'LEAD';

ALTER TABLE "AuditTeamMember" ADD CONSTRAINT "AuditTeamMember_auditId_fkey"
    FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditTeamMember" ADD CONSTRAINT "AuditTeamMember_auditorId_fkey"
    FOREIGN KEY ("auditorId") REFERENCES "Auditor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditTeamMember" ADD CONSTRAINT "AuditTeamMember_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditTeamMember" ADD CONSTRAINT "AuditTeamMember_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditTeamMember" ADD CONSTRAINT "AuditTeamMember_removedById_fkey"
    FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditTeamMember" ADD CONSTRAINT "AuditTeamMember_independenceEvaluatedById_fkey"
    FOREIGN KEY ("independenceEvaluatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
