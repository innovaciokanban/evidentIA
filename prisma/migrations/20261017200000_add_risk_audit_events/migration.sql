-- Historial auditable del ciclo de vida de los riesgos (RiskAuditEvent).
-- Aditivo: no modifica ni elimina tablas, columnas ni datos existentes.
-- No ejecutar automáticamente: queda como migración pendiente para el entorno correspondiente.

-- CreateEnum
CREATE TYPE "RiskAuditEventType" AS ENUM ('RISK_CREATED', 'RISK_UPDATED', 'CONTROL_CREATED', 'CONTROL_UPDATED', 'CONTROL_DELETED', 'EVIDENCE_CREATED', 'EVIDENCE_UPDATED', 'EVIDENCE_DELETED', 'APPROVAL_REQUESTED', 'APPROVAL_DECIDED', 'APPROVAL_OUTDATED', 'TICKET_CREATED', 'TICKET_STATUS_CHANGED');

-- CreateTable
CREATE TABLE "RiskAuditEvent" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorEmail" TEXT,
    "eventType" "RiskAuditEventType" NOT NULL,
    "summary" TEXT NOT NULL,
    "changes" JSONB,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskAuditEvent_riskId_occurredAt_idx" ON "RiskAuditEvent"("riskId", "occurredAt");

-- CreateIndex
CREATE INDEX "RiskAuditEvent_eventType_idx" ON "RiskAuditEvent"("eventType");

-- AddForeignKey
ALTER TABLE "RiskAuditEvent" ADD CONSTRAINT "RiskAuditEvent_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAuditEvent" ADD CONSTRAINT "RiskAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
