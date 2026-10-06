-- Add the optional characterization data without changing existing process rows.
ALTER TABLE "Process"
  ADD COLUMN "version" TEXT,
  ADD COLUMN "frequency" TEXT,
  ADD COLUMN "executionLevel" TEXT,
  ADD COLUMN "organizationalArea" TEXT,
  ADD COLUMN "businessLine" TEXT,
  ADD COLUMN "supervision" TEXT,
  ADD COLUMN "deliveryMethod" TEXT,
  ADD COLUMN "executionType" TEXT,
  ADD COLUMN "thirdPartyProvided" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "critical" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cashMovement" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contingencyPlan" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "taxOperations" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "affectsAccounting" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "personalData" BOOLEAN NOT NULL DEFAULT false;
