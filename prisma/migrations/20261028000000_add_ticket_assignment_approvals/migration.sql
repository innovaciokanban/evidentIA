-- Solicitudes de asignacion de tickets y eventos de auditoria.
-- Aditivo: no modifica ni elimina columnas, relaciones ni datos existentes.
-- No ejecutar automaticamente: queda como migracion pendiente para el entorno correspondiente.

-- CreateEnum
CREATE TYPE "TicketAssignmentApprovalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "TicketAssignmentApprovalSource" AS ENUM ('DIRECT', 'RISK_APPROVAL', 'ACTION_ITEM', 'STRATEGY_TASK');

-- Extend the existing audit enum without rewriting existing rows.
ALTER TYPE "TicketAuditEventType" ADD VALUE 'TICKET_ASSIGNMENT_REQUESTED' BEFORE 'TICKET_UNASSIGNED';
ALTER TYPE "TicketAuditEventType" ADD VALUE 'TICKET_ASSIGNMENT_ACCEPTED' BEFORE 'TICKET_UNASSIGNED';
ALTER TYPE "TicketAuditEventType" ADD VALUE 'TICKET_ASSIGNMENT_REJECTED' BEFORE 'TICKET_UNASSIGNED';
ALTER TYPE "TicketAuditEventType" ADD VALUE 'TICKET_ASSIGNMENT_CANCELLED' BEFORE 'TICKET_UNASSIGNED';
ALTER TYPE "TicketAuditEventType" ADD VALUE 'TICKET_ASSIGNMENT_SUPERSEDED' BEFORE 'TICKET_UNASSIGNED';

-- CreateTable
CREATE TABLE "TicketAssignmentApproval" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "requestedById" TEXT NOT NULL,
    "proposedAssigneeId" TEXT NOT NULL,
    "previousAssigneeId" TEXT,
    "decidedById" TEXT,
    "riskApprovalId" TEXT,
    "status" "TicketAssignmentApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "source" "TicketAssignmentApprovalSource" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketAssignmentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketAssignmentApproval_riskApprovalId_key"
ON "TicketAssignmentApproval"("riskApprovalId");

CREATE UNIQUE INDEX "TicketAssignmentApproval_one_pending_per_ticket"
ON "TicketAssignmentApproval"("ticketId")
WHERE "status" = 'PENDING';

CREATE INDEX "TicketAssignmentApproval_ticketId_createdAt_idx"
ON "TicketAssignmentApproval"("ticketId", "createdAt");

CREATE INDEX "TicketAssignmentApproval_ticketId_status_idx"
ON "TicketAssignmentApproval"("ticketId", "status");

CREATE INDEX "TicketAssignmentApproval_proposedAssigneeId_status_idx"
ON "TicketAssignmentApproval"("proposedAssigneeId", "status");

CREATE INDEX "TicketAssignmentApproval_requestedById_status_idx"
ON "TicketAssignmentApproval"("requestedById", "status");

CREATE INDEX "TicketAssignmentApproval_status_idx"
ON "TicketAssignmentApproval"("status");

-- AddForeignKey
ALTER TABLE "TicketAssignmentApproval"
ADD CONSTRAINT "TicketAssignmentApproval_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TicketAssignmentApproval"
ADD CONSTRAINT "TicketAssignmentApproval_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TicketAssignmentApproval"
ADD CONSTRAINT "TicketAssignmentApproval_proposedAssigneeId_fkey"
FOREIGN KEY ("proposedAssigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TicketAssignmentApproval"
ADD CONSTRAINT "TicketAssignmentApproval_previousAssigneeId_fkey"
FOREIGN KEY ("previousAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TicketAssignmentApproval"
ADD CONSTRAINT "TicketAssignmentApproval_decidedById_fkey"
FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TicketAssignmentApproval"
ADD CONSTRAINT "TicketAssignmentApproval_riskApprovalId_fkey"
FOREIGN KEY ("riskApprovalId") REFERENCES "RiskApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;
