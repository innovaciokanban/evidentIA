-- Fase 2 de E-Learning. Migracion aditiva para asignaciones de cursos.
-- Conserva la version publicada asignada y no modifica tablas de otros modulos.

CREATE TABLE "LearningEnrollment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearningEnrollment_courseId_userId_key" ON "LearningEnrollment"("courseId", "userId");
CREATE INDEX "LearningEnrollment_companyId_userId_idx" ON "LearningEnrollment"("companyId", "userId");
CREATE INDEX "LearningEnrollment_courseId_versionId_idx" ON "LearningEnrollment"("courseId", "versionId");
CREATE INDEX "LearningEnrollment_userId_assignedAt_idx" ON "LearningEnrollment"("userId", "assignedAt");

ALTER TABLE "LearningEnrollment"
    ADD CONSTRAINT "LearningEnrollment_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LearningEnrollment"
    ADD CONSTRAINT "LearningEnrollment_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "LearningCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LearningEnrollment"
    ADD CONSTRAINT "LearningEnrollment_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "LearningCourseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LearningEnrollment"
    ADD CONSTRAINT "LearningEnrollment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LearningEnrollment"
    ADD CONSTRAINT "LearningEnrollment_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
