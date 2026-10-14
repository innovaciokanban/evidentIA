ALTER TABLE "ProcessChange" DROP CONSTRAINT "ProcessChange_processId_fkey";

ALTER TABLE "ProcessChange" ADD COLUMN "changedByName" TEXT;
ALTER TABLE "ProcessChange" ADD COLUMN "changedByEmail" TEXT;

ALTER TABLE "ProcessChange" ADD CONSTRAINT "ProcessChange_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
