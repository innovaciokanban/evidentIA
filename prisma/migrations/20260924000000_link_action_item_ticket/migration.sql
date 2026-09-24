-- Link ActionItem to its operational Ticket (1:1)
-- Ticket.actionItemId is unique so each action item maps to at most one ticket.
ALTER TABLE "Ticket" ADD COLUMN "actionItemId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "dueDate" TIMESTAMP(3);
CREATE UNIQUE INDEX "Ticket_actionItemId_key" ON "Ticket"("actionItemId");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_actionItemId_fkey" FOREIGN KEY ("actionItemId") REFERENCES "ActionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;