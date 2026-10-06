-- KPI belongs to a process; the tenant is derived through Process.companyId.
CREATE TABLE "Kpi" (
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kpi_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Kpi_processId_idx" ON "Kpi"("processId");
CREATE INDEX "Kpi_reportResponsibleId_idx" ON "Kpi"("reportResponsibleId");
CREATE INDEX "Kpi_monitorResponsibleId_idx" ON "Kpi"("monitorResponsibleId");

ALTER TABLE "Kpi" ADD CONSTRAINT "Kpi_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Kpi" ADD CONSTRAINT "Kpi_reportResponsibleId_fkey" FOREIGN KEY ("reportResponsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Kpi" ADD CONSTRAINT "Kpi_monitorResponsibleId_fkey" FOREIGN KEY ("monitorResponsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
