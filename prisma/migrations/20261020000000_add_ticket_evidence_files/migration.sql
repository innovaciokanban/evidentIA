-- Evidencia PDF de los tickets de mitigación (FASE 1).
-- Migración puramente aditiva: crea una tabla, sus índices y sus claves foráneas.
-- No modifica ni elimina tablas existentes, por lo que los datos actuales quedan intactos y no se
-- toca RiskCodeSequence. El nombre de archivo en disco (storedName) es aleatorio y único, generado
-- por el servidor; aquí solo queda la referencia, nunca la ruta física.
-- No ejecutar automáticamente: queda como migración pendiente para el entorno correspondiente.

-- CreateTable
CREATE TABLE "TicketEvidenceFile" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvidenceFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketEvidenceFile_storedName_key" ON "TicketEvidenceFile"("storedName");

-- CreateIndex
CREATE INDEX "TicketEvidenceFile_ticketId_idx" ON "TicketEvidenceFile"("ticketId");

-- CreateIndex
CREATE INDEX "TicketEvidenceFile_uploadedById_idx" ON "TicketEvidenceFile"("uploadedById");

-- AddForeignKey
ALTER TABLE "TicketEvidenceFile" ADD CONSTRAINT "TicketEvidenceFile_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvidenceFile" ADD CONSTRAINT "TicketEvidenceFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
