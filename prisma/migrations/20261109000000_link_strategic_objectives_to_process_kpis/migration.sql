ALTER TABLE "StrategicObjectiveIndicator" ADD COLUMN "kpiId" TEXT;

CREATE INDEX "StrategicObjectiveIndicator_kpiId_idx" ON "StrategicObjectiveIndicator"("kpiId");

ALTER TABLE "StrategicObjectiveIndicator" ADD CONSTRAINT "StrategicObjectiveIndicator_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "Kpi"("id") ON DELETE SET NULL ON UPDATE CASCADE;
