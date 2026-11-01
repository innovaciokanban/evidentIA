-- Estado reversible de usuarios y trazabilidad de sus cambios de estado.
-- Aditivo y no destructivo: no elimina ni modifica datos, relaciones o migraciones anteriores.
-- No ejecutar automaticamente: queda como migracion pendiente para el entorno correspondiente.

-- CreateEnum
CREATE TYPE "UserStatusEventType" AS ENUM ('DEACTIVATED', 'REACTIVATED');

-- AlterTable
-- El valor por defecto true conserva activos todos los usuarios existentes.
ALTER TABLE "User"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "UserStatusEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT,
    "eventType" "UserStatusEventType" NOT NULL,
    "reason" TEXT,
    "actorName" TEXT,
    "actorEmail" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_companyId_isActive_idx"
ON "User"("companyId", "isActive");

CREATE INDEX "UserStatusEvent_userId_occurredAt_idx"
ON "UserStatusEvent"("userId", "occurredAt");

CREATE INDEX "UserStatusEvent_actorId_idx"
ON "UserStatusEvent"("actorId");

-- AddForeignKey
ALTER TABLE "UserStatusEvent"
ADD CONSTRAINT "UserStatusEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserStatusEvent"
ADD CONSTRAINT "UserStatusEvent_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
