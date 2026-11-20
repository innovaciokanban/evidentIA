-- CreateTable
CREATE TABLE "ProcedureStepResponsible" (
    "stepId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ProcedureStepResponsible_pkey" PRIMARY KEY ("stepId", "userId")
);

-- CreateIndex
CREATE INDEX "ProcedureStepResponsible_userId_idx" ON "ProcedureStepResponsible"("userId");

-- AddForeignKey
ALTER TABLE "ProcedureStepResponsible" ADD CONSTRAINT "ProcedureStepResponsible_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ProcedureStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcedureStepResponsible" ADD CONSTRAINT "ProcedureStepResponsible_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
