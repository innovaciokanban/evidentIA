-- CreateEnum
CREATE TYPE "ProcessType" AS ENUM ('STRATEGIC', 'MISSIONAL', 'SUPPORT');

-- CreateEnum
CREATE TYPE "ProcessStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "Process" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" "ProcessType" NOT NULL,
    "objective" TEXT NOT NULL,
    "description" TEXT,
    "responsibleId" TEXT,
    "status" "ProcessStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Process_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Process_companyId_idx" ON "Process"("companyId");

-- CreateIndex
CREATE INDEX "Process_type_idx" ON "Process"("type");

-- CreateIndex
CREATE INDEX "Process_responsibleId_idx" ON "Process"("responsibleId");

-- CreateIndex
CREATE UNIQUE INDEX "Process_companyId_name_key" ON "Process"("companyId", "name");

-- AddForeignKey
ALTER TABLE "Process" ADD CONSTRAINT "Process_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Process" ADD CONSTRAINT "Process_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
