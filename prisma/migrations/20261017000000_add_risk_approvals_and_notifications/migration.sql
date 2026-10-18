-- Aprobación colaborativa de riesgos + notificaciones in-app.
-- Aditivo: no modifica ni elimina columnas existentes; los datos actuales quedan intactos.
-- No ejecutar automáticamente: queda como migración pendiente para el entorno correspondiente.

-- CreateEnum
CREATE TYPE "RiskApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'OUTDATED');

-- CreateTable
CREATE TABLE "RiskApproval" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "RiskApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "openKey" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    "ticketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiskApproval_openKey_key" ON "RiskApproval"("openKey");

-- CreateIndex
CREATE UNIQUE INDEX "RiskApproval_ticketId_key" ON "RiskApproval"("ticketId");

-- CreateIndex
CREATE INDEX "RiskApproval_riskId_idx" ON "RiskApproval"("riskId");

-- CreateIndex
CREATE INDEX "RiskApproval_requestedById_idx" ON "RiskApproval"("requestedById");

-- CreateIndex
CREATE INDEX "RiskApproval_status_idx" ON "RiskApproval"("status");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_readAt_idx" ON "Notification"("readAt");

-- AddForeignKey
ALTER TABLE "RiskApproval" ADD CONSTRAINT "RiskApproval_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskApproval" ADD CONSTRAINT "RiskApproval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskApproval" ADD CONSTRAINT "RiskApproval_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskApproval" ADD CONSTRAINT "RiskApproval_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
