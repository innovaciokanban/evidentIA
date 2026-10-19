-- Módulo Procedimientos (Trazabilidad y Control).
-- Migración puramente aditiva: crea dos enums, dos tablas, sus índices y claves foráneas.
-- No modifica ni elimina tablas existentes, por lo que no afecta a datos existentes.

-- CreateEnum
CREATE TYPE "ProcedureStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'OBSOLETE');

-- CreateEnum
CREATE TYPE "ProcedureHistoryAction" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED');

-- CreateTable
CREATE TABLE "Procedure" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "description" TEXT,
    "responsibleId" TEXT,
    "status" "ProcedureStatus" NOT NULL DEFAULT 'DRAFT',
    "version" TEXT NOT NULL DEFAULT '1.0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Procedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcedureVersion" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "ProcedureStatus" NOT NULL,
    "action" "ProcedureHistoryAction" NOT NULL,
    "changes" JSONB,
    "snapshot" JSONB,
    "changedById" TEXT,
    "changedByName" TEXT,
    "changedByEmail" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcedureVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Procedure_processId_idx" ON "Procedure"("processId");

-- CreateIndex
CREATE INDEX "Procedure_status_idx" ON "Procedure"("status");

-- CreateIndex
CREATE INDEX "Procedure_responsibleId_idx" ON "Procedure"("responsibleId");

-- CreateIndex
CREATE UNIQUE INDEX "Procedure_processId_code_key" ON "Procedure"("processId", "code");

-- CreateIndex
CREATE INDEX "ProcedureVersion_procedureId_changedAt_idx" ON "ProcedureVersion"("procedureId", "changedAt");

-- CreateIndex
CREATE INDEX "ProcedureVersion_changedById_idx" ON "ProcedureVersion"("changedById");

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcedureVersion" ADD CONSTRAINT "ProcedureVersion_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcedureVersion" ADD CONSTRAINT "ProcedureVersion_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
