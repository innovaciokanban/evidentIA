ALTER TABLE "Risk" ADD COLUMN "riskOwnerId" TEXT;

CREATE INDEX "Risk_riskOwnerId_idx" ON "Risk"("riskOwnerId");

ALTER TABLE "Risk"
ADD CONSTRAINT "Risk_riskOwnerId_fkey"
FOREIGN KEY ("riskOwnerId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
