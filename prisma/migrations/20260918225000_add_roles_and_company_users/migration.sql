-- Migración: arquitectura de roles y aislamiento multiempresa.
--   * enum Role pasa a SUPERUSER | COMPANY_ADMIN | COMPANY_USER (se elimina USER).
--   * User.companyId: pertenencia a una empresa (nullable solo para SUPERUSER).
--   * Company.consultantId se elimina; la propiedad de la empresa se deriva de User.companyId.

-- 1) Nuevo enum con exactamente los valores del esquema Prisma.
CREATE TYPE "Role_new" AS ENUM ('SUPERUSER', 'COMPANY_ADMIN', 'COMPANY_USER');

-- 2) Columna temporal para transformar los datos sin romper la constraint del enum actual.
ALTER TABLE "User" ADD COLUMN "role_new" "Role_new";

-- 3) Reasignación segura del rol heredado: USER -> COMPANY_ADMIN (conserva su capacidad de gestión).
--    Cualquier valor desconocido queda como COMPANY_ADMIN (nunca se pierde acceso).
UPDATE "User" SET "role_new" = CASE WHEN "role" = 'SUPERUSER' THEN 'SUPERUSER'::"Role_new" ELSE 'COMPANY_ADMIN'::"Role_new" END;

ALTER TABLE "User" DROP COLUMN "role";
ALTER TABLE "User" RENAME COLUMN "role_new" TO "role";

-- 4) Limpieza del enum antiguo.
DROP TYPE "Role";

-- 5) User.companyId: columna + relleno desde Company.consultantId (empresa más reciente de cada consultor).
ALTER TABLE "User" ADD COLUMN "companyId" TEXT;

UPDATE "User" SET "companyId" = sub.company_id
FROM (
  SELECT DISTINCT ON ("consultantId") "consultantId" AS user_id, id AS company_id
  FROM "Company"
  WHERE "consultantId" IS NOT NULL
  ORDER BY "consultantId", "createdAt" DESC
) sub
WHERE "User"."id" = sub.user_id
  AND "User"."role" <> 'SUPERUSER';

ALTER TABLE "User"
  ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- 6) Eliminación de Company.consultantId (ownership pasa a User.companyId).
DROP INDEX IF EXISTS "Company_consultantId_idx";
ALTER TABLE "Company" DROP COLUMN IF EXISTS "consultantId";