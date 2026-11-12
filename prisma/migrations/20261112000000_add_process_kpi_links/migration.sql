CREATE TABLE "ProcessKpi" (
    "processId" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessKpi_pkey" PRIMARY KEY ("processId", "kpiId")
);

INSERT INTO "ProcessKpi" ("processId", "kpiId")
SELECT "processId", "id" FROM "Kpi";

CREATE INDEX "ProcessKpi_kpiId_idx" ON "ProcessKpi"("kpiId");

ALTER TABLE "ProcessKpi" ADD CONSTRAINT "ProcessKpi_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessKpi" ADD CONSTRAINT "ProcessKpi_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "Kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
