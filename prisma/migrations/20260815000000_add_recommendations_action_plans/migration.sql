CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
CREATE TYPE "ActionPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED');
CREATE TYPE "ActionItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "Priority" NOT NULL,
    "expectedImpact" TEXT NOT NULL,
    "suggestedAction" TEXT NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActionPlan" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ActionPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ActionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "actionPlanId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "Priority" NOT NULL,
    "status" "ActionItemStatus" NOT NULL DEFAULT 'PENDING',
    "responsibleId" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Recommendation_diagnosticId_idx" ON "Recommendation"("diagnosticId");
CREATE INDEX "Recommendation_status_idx" ON "Recommendation"("status");
CREATE INDEX "ActionPlan_diagnosticId_idx" ON "ActionPlan"("diagnosticId");
CREATE INDEX "ActionPlan_createdById_idx" ON "ActionPlan"("createdById");
CREATE INDEX "ActionPlan_status_idx" ON "ActionPlan"("status");
CREATE INDEX "ActionItem_actionPlanId_idx" ON "ActionItem"("actionPlanId");
CREATE INDEX "ActionItem_recommendationId_idx" ON "ActionItem"("recommendationId");
CREATE INDEX "ActionItem_responsibleId_idx" ON "ActionItem"("responsibleId");
CREATE INDEX "ActionItem_status_idx" ON "ActionItem"("status");

ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "QualityDiagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionPlan" ADD CONSTRAINT "ActionPlan_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "QualityDiagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionPlan" ADD CONSTRAINT "ActionPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_actionPlanId_fkey" FOREIGN KEY ("actionPlanId") REFERENCES "ActionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
