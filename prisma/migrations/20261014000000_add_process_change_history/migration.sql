CREATE TYPE "ProcessChangeAction" AS ENUM ('CREATED', 'UPDATED');

CREATE TABLE "ProcessChange" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "processName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "action" "ProcessChangeAction" NOT NULL,
    "changedById" TEXT,
    "changes" JSONB NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProcessChange_processId_changedAt_idx" ON "ProcessChange"("processId", "changedAt");
CREATE INDEX "ProcessChange_changedById_idx" ON "ProcessChange"("changedById");

ALTER TABLE "ProcessChange" ADD CONSTRAINT "ProcessChange_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessChange" ADD CONSTRAINT "ProcessChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
