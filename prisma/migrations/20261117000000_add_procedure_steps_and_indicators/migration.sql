CREATE TABLE "ProcedureStep" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "criteria" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcedureStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcedureIndicator" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "reportResponsibleId" TEXT,
    "monitorResponsibleId" TEXT,
    "greenThreshold" TEXT,
    "yellowThreshold" TEXT,
    "redThreshold" TEXT,
    "baselineValue" TEXT,
    "measurementMethod" TEXT,
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcedureIndicator_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcedureStep_procedureId_position_key" ON "ProcedureStep"("procedureId", "position");
CREATE INDEX "ProcedureStep_procedureId_idx" ON "ProcedureStep"("procedureId");

CREATE INDEX "ProcedureIndicator_procedureId_idx" ON "ProcedureIndicator"("procedureId");
CREATE INDEX "ProcedureIndicator_deadline_idx" ON "ProcedureIndicator"("deadline");
CREATE INDEX "ProcedureIndicator_reportResponsibleId_idx" ON "ProcedureIndicator"("reportResponsibleId");
CREATE INDEX "ProcedureIndicator_monitorResponsibleId_idx" ON "ProcedureIndicator"("monitorResponsibleId");

ALTER TABLE "ProcedureStep"
  ADD CONSTRAINT "ProcedureStep_procedureId_fkey"
  FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProcedureIndicator"
  ADD CONSTRAINT "ProcedureIndicator_procedureId_fkey"
  FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ProcedureIndicator_reportResponsibleId_fkey"
  FOREIGN KEY ("reportResponsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ProcedureIndicator_monitorResponsibleId_fkey"
  FOREIGN KEY ("monitorResponsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
