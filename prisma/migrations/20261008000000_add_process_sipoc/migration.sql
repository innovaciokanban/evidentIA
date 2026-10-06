CREATE TABLE "SipocSupplier" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SipocSupplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SipocInput" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SipocInput_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SipocOutput" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SipocOutput_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SipocCustomer" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SipocCustomer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SipocSupplier_processId_idx" ON "SipocSupplier"("processId");
CREATE INDEX "SipocInput_processId_idx" ON "SipocInput"("processId");
CREATE INDEX "SipocOutput_processId_idx" ON "SipocOutput"("processId");
CREATE INDEX "SipocCustomer_processId_idx" ON "SipocCustomer"("processId");

ALTER TABLE "SipocSupplier" ADD CONSTRAINT "SipocSupplier_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SipocInput" ADD CONSTRAINT "SipocInput_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SipocOutput" ADD CONSTRAINT "SipocOutput_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SipocCustomer" ADD CONSTRAINT "SipocCustomer_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
