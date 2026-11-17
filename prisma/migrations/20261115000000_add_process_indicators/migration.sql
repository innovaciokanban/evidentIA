CREATE TABLE "ProcessIndicator" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
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

    CONSTRAINT "ProcessIndicator_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProcessIndicator_processId_idx" ON "ProcessIndicator"("processId");
CREATE INDEX "ProcessIndicator_deadline_idx" ON "ProcessIndicator"("deadline");
CREATE INDEX "ProcessIndicator_reportResponsibleId_idx" ON "ProcessIndicator"("reportResponsibleId");
CREATE INDEX "ProcessIndicator_monitorResponsibleId_idx" ON "ProcessIndicator"("monitorResponsibleId");

ALTER TABLE "ProcessIndicator"
  ADD CONSTRAINT "ProcessIndicator_processId_fkey"
  FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ProcessIndicator_reportResponsibleId_fkey"
  FOREIGN KEY ("reportResponsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ProcessIndicator_monitorResponsibleId_fkey"
  FOREIGN KEY ("monitorResponsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
