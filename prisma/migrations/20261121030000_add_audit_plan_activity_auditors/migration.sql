-- Asignacion de uno o varios integrantes del equipo auditor a una actividad.
-- Migracion aditiva: no cambia responsibleId ni crea asignaciones existentes.

CREATE TABLE "AuditPlanActivityAuditor" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "auditTeamMemberId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,

    CONSTRAINT "AuditPlanActivityAuditor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditPlanActivityAuditor_activityId_auditTeamMemberId_key"
    ON "AuditPlanActivityAuditor"("activityId", "auditTeamMemberId");
CREATE INDEX "AuditPlanActivityAuditor_activityId_isActive_idx"
    ON "AuditPlanActivityAuditor"("activityId", "isActive");
CREATE INDEX "AuditPlanActivityAuditor_auditTeamMemberId_isActive_idx"
    ON "AuditPlanActivityAuditor"("auditTeamMemberId", "isActive");
CREATE INDEX "AuditPlanActivityAuditor_assignedById_idx"
    ON "AuditPlanActivityAuditor"("assignedById");
CREATE INDEX "AuditPlanActivityAuditor_removedById_idx"
    ON "AuditPlanActivityAuditor"("removedById");

ALTER TABLE "AuditPlanActivityAuditor" ADD CONSTRAINT "AuditPlanActivityAuditor_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "AuditPlanActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditPlanActivityAuditor" ADD CONSTRAINT "AuditPlanActivityAuditor_auditTeamMemberId_fkey"
    FOREIGN KEY ("auditTeamMemberId") REFERENCES "AuditTeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditPlanActivityAuditor" ADD CONSTRAINT "AuditPlanActivityAuditor_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditPlanActivityAuditor" ADD CONSTRAINT "AuditPlanActivityAuditor_removedById_fkey"
    FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
