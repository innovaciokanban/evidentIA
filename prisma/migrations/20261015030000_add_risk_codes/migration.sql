-- Codificación automática de riesgos: columna única, backfill de registros clasificables y contador por categoría.

ALTER TABLE "Risk" ADD COLUMN "code" TEXT;

-- Backfill solo de los tipos clasificables (ESTRATEGICO/MISIONAL/APOYO), en orden de creación
-- con id como desempate para que sea determinista. Los tipos legados (TACTICO, OPERACIONAL y
-- textos históricos como "Operativo") quedan con code = NULL a propósito: no se les inventa categoría.
WITH ranked AS (
    SELECT
        "id",
        CASE "riskType"
            WHEN 'ESTRATEGICO' THEN 'EST'
            WHEN 'MISIONAL' THEN 'MIS'
            WHEN 'APOYO' THEN 'APO'
        END AS "prefix",
        ROW_NUMBER() OVER (PARTITION BY "riskType" ORDER BY "createdAt" ASC, "id" ASC) AS "rowNumber"
    FROM "Risk"
    WHERE "riskType" IN ('ESTRATEGICO', 'MISIONAL', 'APOYO')
)
UPDATE "Risk" AS r
SET "code" = ranked."prefix" || '-R' || ranked."rowNumber"
FROM ranked
WHERE r."id" = ranked."id";

-- Los códigos ya generados no vuelven a emitirse. Los NULL no colisionan en PostgreSQL.
CREATE UNIQUE INDEX "Risk_code_key" ON "Risk"("code");

CREATE TYPE "RiskCodeCategory" AS ENUM ('ESTRATEGICO', 'MISIONAL', 'APOYO');

CREATE TABLE "RiskCodeSequence" (
    "category" "RiskCodeCategory" NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskCodeSequence_pkey" PRIMARY KEY ("category")
);

-- "next" guarda el último código emitido por categoría (0 = aún no se ha emitido ninguno);
-- el primer incremento lo convierte en 1. El conteo coincide con el máximo emitido porque el
-- backfill genera R1..Rn contiguos por prefijo.
INSERT INTO "RiskCodeSequence" ("category", "next", "updatedAt")
VALUES
    ('ESTRATEGICO', (SELECT COUNT(*) FROM "Risk" WHERE "code" LIKE 'EST-R%'), CURRENT_TIMESTAMP),
    ('MISIONAL', (SELECT COUNT(*) FROM "Risk" WHERE "code" LIKE 'MIS-R%'), CURRENT_TIMESTAMP),
    ('APOYO', (SELECT COUNT(*) FROM "Risk" WHERE "code" LIKE 'APO-R%'), CURRENT_TIMESTAMP);
