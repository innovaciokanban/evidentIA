-- CreateEnum
CREATE TYPE "CheckyMessageRole" AS ENUM ('USER', 'CHECKY');

-- CreateEnum
CREATE TYPE "CheckyFindingBasis" AS ENUM ('FACT', 'INFERENCE');

-- CreateEnum
CREATE TYPE "CheckySuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CheckyCategory" AS ENUM ('REVIEW_ASPECTS', 'MISSING_CROSSES', 'UNRELATED_FACTORS', 'STRENGTHEN_STRATEGIES', 'STRATEGIC_RISKS', 'MISSED_OPPORTUNITIES', 'INFO_TO_COMPLEMENT', 'NEXT_STEPS');

-- CreateTable
CREATE TABLE "CheckySession" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "title" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckyMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "CheckyMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "category" "CheckyCategory",
    "basis" "CheckyFindingBasis",
    "evidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "insufficientData" BOOLEAN NOT NULL DEFAULT false,
    "missingInformation" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "CheckySuggestionStatus",
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckyMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckySession_diagnosticId_idx" ON "CheckySession"("diagnosticId");

-- CreateIndex
CREATE INDEX "CheckySession_createdById_idx" ON "CheckySession"("createdById");

-- CreateIndex
CREATE INDEX "CheckyMessage_sessionId_idx" ON "CheckyMessage"("sessionId");

-- CreateIndex
CREATE INDEX "CheckyMessage_status_idx" ON "CheckyMessage"("status");

-- AddForeignKey
ALTER TABLE "CheckySession" ADD CONSTRAINT "CheckySession_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "QualityDiagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckySession" ADD CONSTRAINT "CheckySession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckyMessage" ADD CONSTRAINT "CheckyMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CheckySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
