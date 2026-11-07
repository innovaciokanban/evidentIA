-- Fase 1 de E-Learning. Migracion aditiva: solo crea enums, tablas, indices y relaciones nuevas.
-- No modifica Auditorias, Tickets, Procesos, evidencias existentes ni R2.

CREATE TYPE "LearningCourseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "LearningLessonType" AS ENUM ('TEXT', 'VIDEO', 'AUDIO', 'DOCUMENT', 'IMAGE');

CREATE TABLE "LearningCourse" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "LearningCourseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningCourse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningCourseVersion" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "LearningCourseStatus" NOT NULL DEFAULT 'DRAFT',
    "changeSummary" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningCourseVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningModule" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningModule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningLesson" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "LearningLessonType" NOT NULL DEFAULT 'TEXT',
    "content" TEXT,
    "durationMinutes" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningLesson_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LearningCourse_companyId_status_idx" ON "LearningCourse"("companyId", "status");
CREATE INDEX "LearningCourse_companyId_category_idx" ON "LearningCourse"("companyId", "category");
CREATE INDEX "LearningCourse_updatedAt_idx" ON "LearningCourse"("updatedAt");
CREATE UNIQUE INDEX "LearningCourseVersion_courseId_versionNumber_key" ON "LearningCourseVersion"("courseId", "versionNumber");
CREATE INDEX "LearningCourseVersion_courseId_status_idx" ON "LearningCourseVersion"("courseId", "status");
CREATE INDEX "LearningCourseVersion_status_publishedAt_idx" ON "LearningCourseVersion"("status", "publishedAt");
CREATE INDEX "LearningModule_versionId_position_idx" ON "LearningModule"("versionId", "position");
CREATE INDEX "LearningLesson_moduleId_position_idx" ON "LearningLesson"("moduleId", "position");
CREATE INDEX "LearningLesson_type_idx" ON "LearningLesson"("type");
CREATE UNIQUE INDEX "LearningCourseVersion_one_published_per_course_key"
    ON "LearningCourseVersion"("courseId")
    WHERE "status" = 'PUBLISHED';

ALTER TABLE "LearningCourse"
    ADD CONSTRAINT "LearningCourse_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LearningCourse"
    ADD CONSTRAINT "LearningCourse_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LearningCourse"
    ADD CONSTRAINT "LearningCourse_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LearningCourseVersion"
    ADD CONSTRAINT "LearningCourseVersion_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "LearningCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LearningCourseVersion"
    ADD CONSTRAINT "LearningCourseVersion_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LearningCourseVersion"
    ADD CONSTRAINT "LearningCourseVersion_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LearningModule"
    ADD CONSTRAINT "LearningModule_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "LearningCourseVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LearningLesson"
    ADD CONSTRAINT "LearningLesson_moduleId_fkey"
    FOREIGN KEY ("moduleId") REFERENCES "LearningModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
