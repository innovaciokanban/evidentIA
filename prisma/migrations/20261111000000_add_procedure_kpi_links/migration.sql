CREATE TABLE "ProcedureKpi" (
    "procedureId" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcedureKpi_pkey" PRIMARY KEY ("procedureId", "kpiId")
);

CREATE INDEX "ProcedureKpi_kpiId_idx" ON "ProcedureKpi"("kpiId");

ALTER TABLE "ProcedureKpi" ADD CONSTRAINT "ProcedureKpi_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProcedureKpi" ADD CONSTRAINT "ProcedureKpi_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "Kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
