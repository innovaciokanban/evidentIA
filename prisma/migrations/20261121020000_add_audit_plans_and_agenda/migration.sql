-- Plan de auditoria y agenda. Migracion aditiva; no modifica auditorias ni registros existentes.

ALTER TYPE "AuditEventType" ADD VALUE 'AUDIT_PLAN_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'AUDIT_PLAN_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'AUDIT_PLAN_STATUS_CHANGED';
ALTER TYPE "AuditEventType" ADD VALUE 'AUDIT_PLAN_ACTIVITY_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'AUDIT_PLAN_ACTIVITY_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'AUDIT_PLAN_ACTIVITY_DELETED';

CREATE TYPE "AuditPlanStatus" AS ENUM ('DRAFT', 'READY', 'APPROVED', 'CANCELLED');
CREATE TYPE "AuditPlanActivityType" AS ENUM ('OPENING_MEETING', 'DOCUMENT_REVIEW', 'INTERVIEW', 'PROCESS_REVIEW', 'CLOSING_MEETING', 'OTHER');
CREATE TYPE "AuditPlanActivityStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "AuditPlan" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "methodology" TEXT NOT NULL,
    "samplingMethod" TEXT,
    "resources" TEXT,
    "notes" TEXT,
    "status" "AuditPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditPlanActivity" (
    "id" TEXT NOT NULL,
    "auditPlanId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "type" "AuditPlanActivityType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "responsibleId" TEXT,
    "processId" TEXT,
    "status" "AuditPlanActivityStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditPlanActivity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditPlan_auditId_key" ON "AuditPlan"("auditId");
CREATE INDEX "AuditPlan_status_idx" ON "AuditPlan"("status");
CREATE INDEX "AuditPlan_preparedById_idx" ON "AuditPlan"("preparedById");
CREATE INDEX "AuditPlan_approvedById_idx" ON "AuditPlan"("approvedById");
CREATE INDEX "AuditPlanActivity_auditPlanId_scheduledStart_idx" ON "AuditPlanActivity"("auditPlanId", "scheduledStart");
CREATE INDEX "AuditPlanActivity_auditPlanId_status_idx" ON "AuditPlanActivity"("auditPlanId", "status");
CREATE INDEX "AuditPlanActivity_responsibleId_idx" ON "AuditPlanActivity"("responsibleId");
CREATE INDEX "AuditPlanActivity_processId_idx" ON "AuditPlanActivity"("processId");

ALTER TABLE "AuditPlan" ADD CONSTRAINT "AuditPlan_auditId_fkey"
    FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditPlan" ADD CONSTRAINT "AuditPlan_preparedById_fkey"
    FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditPlan" ADD CONSTRAINT "AuditPlan_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditPlanActivity" ADD CONSTRAINT "AuditPlanActivity_auditPlanId_fkey"
    FOREIGN KEY ("auditPlanId") REFERENCES "AuditPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditPlanActivity" ADD CONSTRAINT "AuditPlanActivity_responsibleId_fkey"
    FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditPlanActivity" ADD CONSTRAINT "AuditPlanActivity_processId_fkey"
    FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE SET NULL ON UPDATE CASCADE;
