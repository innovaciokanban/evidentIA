import type { Prisma, PrismaClient } from '@prisma/client'
import { LearningCourseStatus, Role } from '@prisma/client'
import { LearningDomainError, assertLearningAdmin, canManageLearningCompany, courseVisibilityWhere, resolveLearningCompanyId, type LearningActor } from './learning-policy.js'

const courseInclude = {
  company: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
  versions: {
    orderBy: { versionNumber: 'desc' as const },
    include: {
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
      modules: {
        orderBy: { position: 'asc' as const },
        include: { lessons: { orderBy: { position: 'asc' as const } } },
      },
    },
  },
} as const

type CourseRecord = Prisma.LearningCourseGetPayload<{ include: typeof courseInclude }>
type LearningDb = PrismaClient | Prisma.TransactionClient

const enrollmentInclude = {
  user: { select: { id: true, name: true, email: true, role: true, companyId: true, isActive: true } },
  assignedBy: { select: { id: true, name: true, email: true } },
} as const

const studentEnrollmentInclude = {
  course: { include: courseInclude },
} as const

type EnrollmentRecord = Prisma.LearningEnrollmentGetPayload<{ include: typeof enrollmentInclude }>
type StudentEnrollmentRecord = Prisma.LearningEnrollmentGetPayload<{ include: typeof studentEnrollmentInclude }>

const versionView = (version: CourseRecord['versions'][number]) => ({
  id: version.id,
  courseId: version.courseId,
  versionNumber: version.versionNumber,
  status: version.status,
  changeSummary: version.changeSummary,
  publishedAt: version.publishedAt,
  createdAt: version.createdAt,
  updatedAt: version.updatedAt,
  createdBy: version.createdBy,
  updatedBy: version.updatedBy,
  modules: version.modules.map((module) => ({
    id: module.id,
    versionId: module.versionId,
    title: module.title,
    description: module.description,
    position: module.position,
    createdAt: module.createdAt,
    updatedAt: module.updatedAt,
    lessons: module.lessons,
  })),
})

const courseView = (course: CourseRecord, actor: LearningActor, visibleVersionId?: string) => ({
  id: course.id,
  companyId: course.companyId,
  title: course.title,
  description: course.description,
  category: course.category,
  status: course.status,
  createdAt: course.createdAt,
  updatedAt: course.updatedAt,
  company: course.company,
  createdBy: course.createdBy,
  updatedBy: course.updatedBy,
  versions: course.versions
    .filter((version) => actor.role !== 'COMPANY_USER' || (visibleVersionId ? version.id === visibleVersionId : version.status === LearningCourseStatus.PUBLISHED))
    .map(versionView),
})

const studentEnrollmentView = (enrollment: Pick<StudentEnrollmentRecord, 'id' | 'versionId' | 'assignedAt'>) => ({
  id: enrollment.id,
  versionId: enrollment.versionId,
  assignedAt: enrollment.assignedAt,
})

const enrollmentView = (enrollment: EnrollmentRecord) => ({
  id: enrollment.id,
  companyId: enrollment.companyId,
  courseId: enrollment.courseId,
  versionId: enrollment.versionId,
  userId: enrollment.userId,
  assignedById: enrollment.assignedById,
  assignedAt: enrollment.assignedAt,
  createdAt: enrollment.createdAt,
  updatedAt: enrollment.updatedAt,
  user: enrollment.user,
  assignedBy: enrollment.assignedBy,
})

const findCourse = async (db: LearningDb, actor: LearningActor, courseId: string, adminOnly = false): Promise<CourseRecord> => {
  const course = await db.learningCourse.findFirst({ where: { id: courseId, ...(adminOnly ? {} : courseVisibilityWhere(actor)) }, include: courseInclude })
  if (!course) throw new LearningDomainError(404, 'Learning course not found')
  if (adminOnly && !canManageLearningCompany(actor, course.companyId)) throw new LearningDomainError(404, 'Learning course not found')
  return course
}

const findStudentEnrollment = async (db: LearningDb, actor: LearningActor, courseId: string): Promise<StudentEnrollmentRecord> => {
  const enrollment = await db.learningEnrollment.findFirst({
    where: { courseId, userId: actor.id, companyId: actor.companyId ?? 'none' },
    include: studentEnrollmentInclude,
  })
  if (!enrollment) throw new LearningDomainError(404, 'Learning course not found')
  if (enrollment.course.companyId !== actor.companyId) throw new LearningDomainError(404, 'Learning course not found')
  if (!enrollment.course.versions.some((version) => version.id === enrollment.versionId)) throw new LearningDomainError(404, 'Learning course not found')
  return enrollment
}

const findPublishedCourse = async (db: LearningDb, actor: LearningActor, courseId: string) => {
  const course = await findCourse(db, actor, courseId, true)
  if (course.status !== LearningCourseStatus.PUBLISHED) throw new LearningDomainError(409, 'Only published learning courses can be assigned')
  const version = course.versions.find((item) => item.status === LearningCourseStatus.PUBLISHED)
  if (!version) throw new LearningDomainError(409, 'The learning course has no published version')
  return { course, version }
}

const assignableUserWhere = (companyId: string, ids?: string[]) => ({
  ...(ids ? { id: { in: ids } } : {}),
  companyId,
  isActive: true,
  role: { in: [Role.COMPANY_ADMIN, Role.COMPANY_USER] },
})

const findEditableVersion = async (db: LearningDb, actor: LearningActor, versionId: string) => {
  const version = await db.learningCourseVersion.findUnique({ where: { id: versionId }, include: { course: { select: { id: true, companyId: true } } } })
  if (!version || !canManageLearningCompany(actor, version.course.companyId)) throw new LearningDomainError(404, 'Learning version not found')
  if (version.status !== LearningCourseStatus.DRAFT) throw new LearningDomainError(409, 'Only draft learning versions can be edited')
  return version
}

const findEditableModule = async (db: LearningDb, actor: LearningActor, moduleId: string) => {
  const module = await db.learningModule.findUnique({ where: { id: moduleId }, include: { version: { include: { course: { select: { id: true, companyId: true } } } } } })
  if (!module || !canManageLearningCompany(actor, module.version.course.companyId)) throw new LearningDomainError(404, 'Learning module not found')
  if (module.version.status !== LearningCourseStatus.DRAFT) throw new LearningDomainError(409, 'Only draft learning versions can be edited')
  return module
}

const findEditableLesson = async (db: LearningDb, actor: LearningActor, lessonId: string) => {
  const lesson = await db.learningLesson.findUnique({ where: { id: lessonId }, include: { module: { include: { version: { include: { course: { select: { id: true, companyId: true } } } } } } } })
  if (!lesson || !canManageLearningCompany(actor, lesson.module.version.course.companyId)) throw new LearningDomainError(404, 'Learning lesson not found')
  if (lesson.module.version.status !== LearningCourseStatus.DRAFT) throw new LearningDomainError(409, 'Only draft learning versions can be edited')
  return lesson
}

export const listLearningCourses = async (db: LearningDb, actor: LearningActor, query: { search?: string; category?: string; status?: LearningCourseStatus; companyId?: string }) => {
  if (actor.role === 'COMPANY_USER') {
    const where: Prisma.LearningEnrollmentWhereInput = { userId: actor.id, companyId: actor.companyId ?? 'none' }
    if (query.search || query.category) {
      where.course = {
        ...(query.category ? { category: query.category } : {}),
        ...(query.search ? { OR: [{ title: { contains: query.search, mode: 'insensitive' } }, { description: { contains: query.search, mode: 'insensitive' } }] } : {}),
      }
    }
    const enrollments = await db.learningEnrollment.findMany({ where, include: studentEnrollmentInclude, orderBy: { assignedAt: 'desc' } })
    return enrollments.flatMap((enrollment) => {
      if (enrollment.course.companyId !== actor.companyId) return []
      const version = enrollment.course.versions.find((item) => item.id === enrollment.versionId)
      return version ? [{ ...courseView({ ...enrollment.course, versions: [version] }, actor, version.id), enrollment: studentEnrollmentView(enrollment) }] : []
    })
  }
  const where: Prisma.LearningCourseWhereInput = { ...courseVisibilityWhere(actor) }
  if (query.search) where.OR = [{ title: { contains: query.search, mode: 'insensitive' } }, { description: { contains: query.search, mode: 'insensitive' } }]
  if (query.category) where.category = query.category
  if (actor.role === 'SUPERUSER' && query.companyId) where.companyId = query.companyId
  if (query.status) where.status = query.status
  const courses = await db.learningCourse.findMany({ where, include: courseInclude, orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }] })
  return courses.map((course) => courseView(course, actor))
}

export const getLearningCourse = async (db: LearningDb, actor: LearningActor, courseId: string) => {
  if (actor.role === 'COMPANY_USER') {
    const enrollment = await findStudentEnrollment(db, actor, courseId)
    const version = enrollment.course.versions.find((item) => item.id === enrollment.versionId)!
    return { ...courseView({ ...enrollment.course, versions: [version] }, actor, version.id), enrollment: studentEnrollmentView(enrollment) }
  }
  return courseView(await findCourse(db, actor, courseId), actor)
}

export const listLearningAssignableUsers = async (db: LearningDb, actor: LearningActor, courseId: string) => {
  assertLearningAdmin(actor)
  const { course } = await findPublishedCourse(db, actor, courseId)
  const [users, enrollments] = await Promise.all([
    db.user.findMany({ where: assignableUserWhere(course.companyId), select: { id: true, name: true, email: true, role: true, companyId: true, isActive: true }, orderBy: [{ name: 'asc' }, { email: 'asc' }] }),
    db.learningEnrollment.findMany({ where: { courseId: course.id }, select: { userId: true } }),
  ])
  const enrolledIds = new Set(enrollments.map((enrollment) => enrollment.userId))
  return users.map((user) => ({ ...user, enrolled: enrolledIds.has(user.id) }))
}

export const listLearningEnrollments = async (db: LearningDb, actor: LearningActor, courseId: string) => {
  assertLearningAdmin(actor)
  const { course } = await findPublishedCourse(db, actor, courseId)
  const enrollments = await db.learningEnrollment.findMany({ where: { courseId: course.id }, include: enrollmentInclude, orderBy: [{ assignedAt: 'desc' }, { user: { name: 'asc' } }] })
  return enrollments.map(enrollmentView)
}

const createLearningEnrollment = async (db: LearningDb, actor: LearningActor, courseId: string, userId: string) => {
  const { course, version } = await findPublishedCourse(db, actor, courseId)
  const user = await db.user.findFirst({ where: assignableUserWhere(course.companyId, [userId]), select: { id: true } })
  if (!user) throw new LearningDomainError(404, 'Learning user not found')
  return db.learningEnrollment.upsert({
    where: { courseId_userId: { courseId: course.id, userId: user.id } },
    create: { companyId: course.companyId, courseId: course.id, versionId: version.id, userId: user.id, assignedById: actor.id },
    update: {},
    include: enrollmentInclude,
  })
}

export const enrollLearningUser = async (db: PrismaClient, actor: LearningActor, courseId: string, userId: string) => {
  assertLearningAdmin(actor)
  const enrollment = await db.$transaction((tx) => createLearningEnrollment(tx, actor, courseId, userId))
  return enrollmentView(enrollment)
}

export const enrollLearningUsers = async (db: PrismaClient, actor: LearningActor, courseId: string, input: { userIds?: string[]; allCurrentCompanyUsers: boolean }) => {
  assertLearningAdmin(actor)
  return db.$transaction(async (tx) => {
    const { course, version } = await findPublishedCourse(tx, actor, courseId)
    const requestedIds = input.allCurrentCompanyUsers
      ? (await tx.user.findMany({ where: assignableUserWhere(course.companyId), select: { id: true } })).map((user) => user.id)
      : [...new Set(input.userIds ?? [])]
    if (requestedIds.length === 0) throw new LearningDomainError(400, 'No active company users are available for enrollment')
    const users = await tx.user.findMany({ where: assignableUserWhere(course.companyId, requestedIds), select: { id: true } })
    if (users.length !== requestedIds.length) throw new LearningDomainError(404, 'One or more learning users were not found')
    const result = await tx.learningEnrollment.createMany({
      data: requestedIds.map((userId) => ({ companyId: course.companyId, courseId: course.id, versionId: version.id, userId, assignedById: actor.id })),
      skipDuplicates: true,
    })
    const enrollments = await tx.learningEnrollment.findMany({ where: { courseId: course.id, userId: { in: requestedIds } }, include: enrollmentInclude, orderBy: [{ assignedAt: 'desc' }, { user: { name: 'asc' } }] })
    return { created: result.count, alreadyEnrolled: requestedIds.length - result.count, enrollments: enrollments.map(enrollmentView) }
  })
}

export const createLearningCourse = async (db: PrismaClient, actor: LearningActor, input: { title: string; description: string; category: string; companyId?: string }) => {
  assertLearningAdmin(actor)
  const companyId = resolveLearningCompanyId(actor, input.companyId)
  const company = await db.company.findUnique({ where: { id: companyId }, select: { id: true } })
  if (!company) throw new LearningDomainError(404, 'Company not found')
  const course = await db.$transaction(async (tx) => tx.learningCourse.create({
    data: {
      companyId,
      title: input.title,
      description: input.description,
      category: input.category,
      createdById: actor.id,
      updatedById: actor.id,
      versions: { create: { versionNumber: 1, status: LearningCourseStatus.DRAFT, createdById: actor.id, updatedById: actor.id } },
    },
    include: courseInclude,
  }))
  return courseView(course, actor)
}

export const updateLearningCourse = async (db: LearningDb, actor: LearningActor, courseId: string, input: { title?: string; description?: string; category?: string }) => {
  const course = await findCourse(db, actor, courseId, true)
  const updated = await db.learningCourse.update({ where: { id: course.id }, data: { ...input, updatedById: actor.id }, include: courseInclude })
  return courseView(updated, actor)
}

export const createLearningVersion = async (db: LearningDb, actor: LearningActor, courseId: string, changeSummary?: string | null) => {
  const course = await findCourse(db, actor, courseId, true)
  const latest = course.versions[0]?.versionNumber ?? 0
  const version = await db.learningCourseVersion.create({ data: { courseId: course.id, versionNumber: latest + 1, status: LearningCourseStatus.DRAFT, changeSummary: changeSummary ?? null, createdById: actor.id, updatedById: actor.id }, include: { modules: { include: { lessons: true } } } })
  return version
}

export const publishLearningCourse = async (db: PrismaClient, actor: LearningActor, courseId: string, versionId?: string) => {
  const course = await findCourse(db, actor, courseId, true)
  const target = versionId ? course.versions.find((version) => version.id === versionId) : course.versions.find((version) => version.status === LearningCourseStatus.DRAFT)
  if (!target) throw new LearningDomainError(404, 'Draft learning version not found')
  if (target.status !== LearningCourseStatus.DRAFT) throw new LearningDomainError(409, 'Only draft learning versions can be published')
  const published = await db.$transaction(async (tx) => {
    await tx.learningCourseVersion.updateMany({ where: { courseId: course.id, status: LearningCourseStatus.PUBLISHED }, data: { status: LearningCourseStatus.ARCHIVED } })
    await tx.learningCourseVersion.update({ where: { id: target.id }, data: { status: LearningCourseStatus.PUBLISHED, publishedAt: new Date(), updatedById: actor.id } })
    await tx.learningCourse.update({ where: { id: course.id }, data: { status: LearningCourseStatus.PUBLISHED, updatedById: actor.id }, include: courseInclude })
    return tx.learningCourse.findUniqueOrThrow({ where: { id: course.id }, include: courseInclude })
  })
  return courseView(published, actor)
}

export const archiveLearningCourse = async (db: PrismaClient, actor: LearningActor, courseId: string) => {
  const course = await findCourse(db, actor, courseId, true)
  const archived = await db.$transaction(async (tx) => {
    await tx.learningCourseVersion.updateMany({ where: { courseId: course.id, status: LearningCourseStatus.PUBLISHED }, data: { status: LearningCourseStatus.ARCHIVED } })
    return tx.learningCourse.update({ where: { id: course.id }, data: { status: LearningCourseStatus.ARCHIVED, updatedById: actor.id }, include: courseInclude })
  })
  return courseView(archived, actor)
}

export const createLearningModule = async (db: LearningDb, actor: LearningActor, versionId: string, input: { title: string; description: string; position?: number }) => {
  const version = await findEditableVersion(db, actor, versionId)
  const position = input.position ?? await db.learningModule.count({ where: { versionId: version.id } })
  return db.learningModule.create({ data: { versionId: version.id, title: input.title, description: input.description, position } })
}

export const updateLearningModule = async (db: LearningDb, actor: LearningActor, moduleId: string, input: { title?: string; description?: string; position?: number }) => {
  await findEditableModule(db, actor, moduleId)
  return db.learningModule.update({ where: { id: moduleId }, data: input })
}

export const deleteLearningModule = async (db: LearningDb, actor: LearningActor, moduleId: string) => {
  await findEditableModule(db, actor, moduleId)
  await db.learningModule.delete({ where: { id: moduleId } })
}

export const reorderLearningModules = async (db: LearningDb, actor: LearningActor, versionId: string, ids: string[]) => {
  const version = await findEditableVersion(db, actor, versionId)
  const modules = await db.learningModule.findMany({ where: { versionId: version.id }, select: { id: true } })
  if (modules.length !== ids.length || modules.some((module) => !ids.includes(module.id))) throw new LearningDomainError(400, 'The module order must include every module in the version')
  await Promise.all(ids.map((id, position) => db.learningModule.update({ where: { id }, data: { position } })))
}

export const createLearningLesson = async (db: LearningDb, actor: LearningActor, moduleId: string, input: { title: string; description: string; type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'IMAGE'; content?: string | null; durationMinutes?: number | null; position?: number }) => {
  const module = await findEditableModule(db, actor, moduleId)
  const position = input.position ?? await db.learningLesson.count({ where: { moduleId: module.id } })
  return db.learningLesson.create({ data: { moduleId: module.id, title: input.title, description: input.description, type: input.type, content: input.content ?? null, durationMinutes: input.durationMinutes ?? null, position } })
}

export const updateLearningLesson = async (db: LearningDb, actor: LearningActor, lessonId: string, input: { title?: string; description?: string; type?: 'TEXT' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'IMAGE'; content?: string | null; durationMinutes?: number | null; position?: number }) => {
  await findEditableLesson(db, actor, lessonId)
  return db.learningLesson.update({ where: { id: lessonId }, data: input })
}

export const deleteLearningLesson = async (db: LearningDb, actor: LearningActor, lessonId: string) => {
  await findEditableLesson(db, actor, lessonId)
  await db.learningLesson.delete({ where: { id: lessonId } })
}

export const reorderLearningLessons = async (db: LearningDb, actor: LearningActor, moduleId: string, ids: string[]) => {
  const module = await findEditableModule(db, actor, moduleId)
  const lessons = await db.learningLesson.findMany({ where: { moduleId: module.id }, select: { id: true } })
  if (lessons.length !== ids.length || lessons.some((lesson) => !ids.includes(lesson.id))) throw new LearningDomainError(400, 'The lesson order must include every lesson in the module')
  await Promise.all(ids.map((id, position) => db.learningLesson.update({ where: { id }, data: { position } })))
}
