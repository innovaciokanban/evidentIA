-- Link a reusable action plan to the weighted strategy that originated it.
ALTER TABLE "ActionPlan" ADD COLUMN "strategySource" TEXT;
ALTER TABLE "ActionPlan" ADD COLUMN "strategySourceRef" TEXT;
ALTER TABLE "ActionPlan" ADD COLUMN "strategyTitle" TEXT;
ALTER TABLE "ActionPlan" ADD COLUMN "strategyDescription" TEXT;
CREATE UNIQUE INDEX "ActionPlan_diagnosticId_strategySource_strategySourceRef_key" ON "ActionPlan"("diagnosticId", "strategySource", "strategySourceRef");
