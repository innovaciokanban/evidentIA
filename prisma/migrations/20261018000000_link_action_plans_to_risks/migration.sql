-- Vincula un plan de acción con el riesgo cuyo plan de mitigación ejecuta (ActionPlan.riskId).
--
-- Propósito: poder detectar que todas las actividades del plan de mitigación de un riesgo están
-- completadas y avisar al creador y al dueño del riesgo para que califiquen el riesgo residual.
-- Antes de esta columna no existía ninguna relación entre Risk y ActionPlan/ActionItem: los planes
-- solo colgaban de un QualityDiagnostic.
--
-- Naturaleza: 100 % aditiva. Agrega una columna nullable, su índice y una llave foránea con
-- ON DELETE SET NULL (el plan sobrevive a la baja del riesgo y solo pierde el vínculo; no se
-- escriben ni se borran filas existentes).
--
-- Estado: PENDIENTE a propósito. No ejecutar en automático: cada entorno decide cuándo aplicarla
-- con `npx prisma migrate deploy`. Hasta entonces, las rutas que leen ActionPlan.riskId fallarán
-- con P2022 (columna inexistente), así que aplícala antes de desplegar.

-- AlterTable
ALTER TABLE "ActionPlan" ADD COLUMN "riskId" TEXT;

-- CreateIndex
CREATE INDEX "ActionPlan_riskId_idx" ON "ActionPlan"("riskId");

-- AddForeignKey
ALTER TABLE "ActionPlan" ADD CONSTRAINT "ActionPlan_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
