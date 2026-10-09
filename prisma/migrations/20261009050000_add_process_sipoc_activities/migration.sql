CREATE TABLE "SipocProcess" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SipocProcess_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SipocProcess_processId_idx" ON "SipocProcess"("processId");

ALTER TABLE "SipocProcess" ADD CONSTRAINT "SipocProcess_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
