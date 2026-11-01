-- Historial append-only del ciclo de vida de los tickets.
-- Aditivo: no modifica ni elimina tablas, columnas ni datos existentes.

CREATE TYPE "TicketAuditEventType" AS ENUM ('TICKET_CREATED', 'TICKET_UPDATED', 'TICKET_ASSIGNED', 'TICKET_UNASSIGNED', 'TICKET_STATUS_CHANGED', 'TICKET_PRIORITY_CHANGED', 'TICKET_DUE_DATE_CHANGED', 'EVIDENCE_ATTACHED', 'EVIDENCE_DELETED', 'TICKET_DELETED');

CREATE TABLE "TicketAuditEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "ticketTitle" TEXT,
    "companyId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorEmail" TEXT,
    "eventType" "TicketAuditEventType" NOT NULL,
    "summary" TEXT NOT NULL,
    "changes" JSONB,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketAuditEvent_ticketId_occurredAt_idx" ON "TicketAuditEvent"("ticketId", "occurredAt");
CREATE INDEX "TicketAuditEvent_companyId_occurredAt_idx" ON "TicketAuditEvent"("companyId", "occurredAt");
CREATE INDEX "TicketAuditEvent_eventType_idx" ON "TicketAuditEvent"("eventType");

ALTER TABLE "TicketAuditEvent" ADD CONSTRAINT "TicketAuditEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TicketAuditEvent" ADD CONSTRAINT "TicketAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
