ALTER TABLE "StrategicObjectiveIndicator"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "frequency" TEXT,
  ADD COLUMN "formula" TEXT,
  ADD COLUMN "dataSource" TEXT,
  ADD COLUMN "reportResponsibleId" TEXT,
  ADD COLUMN "monitorResponsibleId" TEXT,
  ADD COLUMN "greenThreshold" TEXT,
  ADD COLUMN "yellowThreshold" TEXT,
  ADD COLUMN "redThreshold" TEXT;

CREATE INDEX "StrategicObjectiveIndicator_reportResponsibleId_idx" ON "StrategicObjectiveIndicator"("reportResponsibleId");
CREATE INDEX "StrategicObjectiveIndicator_monitorResponsibleId_idx" ON "StrategicObjectiveIndicator"("monitorResponsibleId");

ALTER TABLE "StrategicObjectiveIndicator"
  ADD CONSTRAINT "StrategicObjectiveIndicator_reportResponsibleId_fkey"
  FOREIGN KEY ("reportResponsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "StrategicObjectiveIndicator_monitorResponsibleId_fkey"
  FOREIGN KEY ("monitorResponsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
