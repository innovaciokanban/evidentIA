-- Remove the deprecated process control attributes.
ALTER TABLE "Process" DROP COLUMN "cashMovement";
ALTER TABLE "Process" DROP COLUMN "contingencyPlan";
ALTER TABLE "Process" DROP COLUMN "taxOperations";
