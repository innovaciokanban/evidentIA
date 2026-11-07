import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { archiveLearningCourse, createLearningCourse, createLearningLesson, createLearningModule, deleteLearningLesson, deleteLearningModule, enrollLearningUser, enrollLearningUsers, getLearningCourse, listLearningCourses, publishLearningCourse, reorderLearningLessons, reorderLearningModules, updateLearningCourse, updateLearningLesson, updateLearningModule } from './learning-service.js'
import { LearningDomainError, type LearningActor } from './learning-policy.js'

const admin: LearningActor = { id: 'admin', role: 'COMPANY_ADMIN', companyId: 'company-a' }
const learner: LearningActor = { id: 'learner', role: 'COMPANY_USER', companyId: 'company-a' }
const moduleRecord = { id: 'module-a', versionId: 'version-a', title: 'Fundamentos', description: 'Base', position: 0, createdAt: new Date(), updatedAt: new Date(), lessons: [{ id: 'lesson-a', moduleId: 'module-a', title: 'Inicio', description: 'Primera lección', type: 'TEXT', content: null, durationMinutes: 10, position: 0, createdAt: new Date(), updatedAt: new Date() }] }
const draftVersion = { id: 'version-a', courseId: 'course-a', versionNumber: 1, status: 'DRAFT', changeSummary: null, publishedAt: null, createdAt: new Date(), updatedAt: new Date(), createdBy: { id: 'admin', name: 'Admin' }, updatedBy: { id: 'admin', name: 'Admin' }, modules: [moduleRecord] }
const publishedVersion = { ...draftVersion, id: 'version-published', versionNumber: 2, status: 'PUBLISHED', publishedAt: new Date() }
const courseRecord = { id: 'course-a', companyId: 'company-a', title: 'Curso base', description: 'Descripción', category: 'Cultura', status: 'PUBLISHED', createdAt: new Date(), updatedAt: new Date(), company: { id: 'company-a', name: 'Empresa A' }, createdBy: { id: 'admin', name: 'Admin' }, updatedBy: { id: 'admin', name: 'Admin' }, versions: [publishedVersion, draftVersion] }
const enrollmentRecord = { id: 'enrollment-a', companyId: 'company-a', courseId: 'course-a', versionId: 'version-published', userId: 'learner', assignedById: 'admin', assignedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), user: { id: 'learner', name: 'Learner', email: 'learner@test.local', role: 'COMPANY_USER', companyId: 'company-a', isActive: true }, assignedBy: { id: 'admin', name: 'Admin', email: 'admin@test.local' }, course: courseRecord }

const dbOf = (overrides: Record<string, unknown> = {}) => {
  const database = {
  company: { findUnique: vi.fn().mockResolvedValue({ id: 'company-a' }) },
  learningCourse: {
    findMany: vi.fn().mockResolvedValue([courseRecord]),
    findFirst: vi.fn().mockResolvedValue(courseRecord),
    findUnique: vi.fn().mockResolvedValue(courseRecord),
    findUniqueOrThrow: vi.fn().mockResolvedValue(courseRecord),
    create: vi.fn().mockResolvedValue(courseRecord),
    update: vi.fn().mockResolvedValue(courseRecord),
  },
  learningCourseVersion: {
    findUnique: vi.fn().mockResolvedValue({ ...draftVersion, course: { id: 'course-a', companyId: 'company-a' } }),
    create: vi.fn().mockResolvedValue(draftVersion),
    update: vi.fn().mockResolvedValue(publishedVersion),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  learningModule: {
    count: vi.fn().mockResolvedValue(1),
    create: vi.fn().mockResolvedValue(moduleRecord),
    findUnique: vi.fn().mockResolvedValue({ ...moduleRecord, version: { ...draftVersion, course: { id: 'course-a', companyId: 'company-a' } } }),
    findMany: vi.fn().mockResolvedValue([{ id: 'module-a' }]),
    update: vi.fn().mockResolvedValue(moduleRecord),
    delete: vi.fn().mockResolvedValue(moduleRecord),
  },
  learningLesson: {
    count: vi.fn().mockResolvedValue(1),
    create: vi.fn().mockResolvedValue(moduleRecord.lessons[0]),
    findUnique: vi.fn().mockResolvedValue({ ...moduleRecord.lessons[0], module: { ...moduleRecord, version: { ...draftVersion, course: { id: 'course-a', companyId: 'company-a' } } } }),
    findMany: vi.fn().mockResolvedValue([{ id: 'lesson-a' }]),
    update: vi.fn().mockResolvedValue(moduleRecord.lessons[0]),
    delete: vi.fn().mockResolvedValue(moduleRecord.lessons[0]),
  },
  user: {
    findMany: vi.fn().mockResolvedValue([enrollmentRecord.user]),
    findFirst: vi.fn().mockResolvedValue({ id: 'learner' }),
  },
  learningEnrollment: {
    findMany: vi.fn().mockImplementation((args: { include?: unknown }) => Promise.resolve(args.include ? [enrollmentRecord] : [{ userId: 'learner' }])),
    findFirst: vi.fn().mockResolvedValue(enrollmentRecord),
    findUnique: vi.fn().mockResolvedValue(enrollmentRecord),
    upsert: vi.fn().mockResolvedValue(enrollmentRecord),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(database)),
    ...overrides,
  }
  return database
}

describe('learning service', () => {
  it('lists only the published version for a company user', async () => {
    const db = dbOf()
    const courses = await listLearningCourses(db as unknown as PrismaClient, learner, {})
    expect(courses).toHaveLength(1)
    expect(courses[0].versions).toHaveLength(1)
    expect(courses[0].versions[0].status).toBe('PUBLISHED')
    expect(db.learningEnrollment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'learner', companyId: 'company-a' } }))
  })

  it('keeps company administrators inside their tenant while superusers can filter globally', async () => {
    const db = dbOf()
    await listLearningCourses(db as unknown as PrismaClient, admin, {})
    expect(db.learningCourse.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 'company-a' } }))

    const superuser: LearningActor = { id: 'root', role: 'SUPERUSER', companyId: null }
    await listLearningCourses(db as unknown as PrismaClient, superuser, { companyId: 'company-b' })
    expect(db.learningCourse.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { companyId: 'company-b' } }))
  })

  it('rejects a course outside the actor company', async () => {
    const db = dbOf({ learningEnrollment: { findFirst: vi.fn().mockResolvedValue(null) } })
    await expect(getLearningCourse(db as unknown as PrismaClient, learner, 'course-other')).rejects.toMatchObject({ status: 404 })
  })

  it('keeps individual and bulk assignments idempotent and preserves the published version', async () => {
    const db = dbOf()
    const individual = await enrollLearningUser(db as unknown as PrismaClient, admin, 'course-a', 'learner')
    expect(individual.versionId).toBe('version-published')
    expect(db.learningEnrollment.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { courseId_userId: { courseId: 'course-a', userId: 'learner' } }, update: {} }))
    const repeated = await enrollLearningUser(db as unknown as PrismaClient, admin, 'course-a', 'learner')
    expect(repeated.id).toBe(individual.id)
    expect(db.learningEnrollment.upsert).toHaveBeenCalledTimes(2)

    const bulk = await enrollLearningUsers(db as unknown as PrismaClient, admin, 'course-a', { userIds: ['learner', 'learner'], allCurrentCompanyUsers: false })
    expect(bulk.created).toBe(1)
    expect(bulk.alreadyEnrolled).toBe(0)
    expect(db.learningEnrollment.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ versionId: 'version-published', userId: 'learner' })], skipDuplicates: true }))

    await enrollLearningUsers(db as unknown as PrismaClient, admin, 'course-a', { allCurrentCompanyUsers: true })
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 'company-a', isActive: true, role: { in: ['COMPANY_ADMIN', 'COMPANY_USER'] } } }))
  })

  it('rejects cross-tenant users and courses before creating an enrollment', async () => {
    const foreignUserDb = dbOf({ user: { findFirst: vi.fn().mockResolvedValue(null) } })
    await expect(enrollLearningUser(foreignUserDb as unknown as PrismaClient, admin, 'course-a', 'user-from-company-b')).rejects.toMatchObject({ status: 404 })

    const foreignActor: LearningActor = { id: 'other-admin', role: 'COMPANY_ADMIN', companyId: 'company-b' }
    await expect(enrollLearningUser(dbOf() as unknown as PrismaClient, foreignActor, 'course-a', 'learner')).rejects.toMatchObject({ status: 404 })
  })

  it('rejects assigning a course without a published version', async () => {
    const db = dbOf({ learningCourse: { findFirst: vi.fn().mockResolvedValue({ ...courseRecord, status: 'DRAFT' }) } })
    await expect(enrollLearningUser(db as unknown as PrismaClient, admin, 'course-a', 'learner')).rejects.toMatchObject({ status: 409 })
  })

  it('creates and updates a course through the service boundary', async () => {
    const db = dbOf()
    const created = await createLearningCourse(db as unknown as PrismaClient, admin, { title: 'Nuevo', description: 'Curso', category: 'Cultura' })
    expect(created.id).toBe('course-a')
    await updateLearningCourse(db as unknown as PrismaClient, admin, 'course-a', { title: 'Renombrado' })
    expect(db.learningCourse.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'course-a' } }))
  })

  it('publishes a draft and archives the previous published version', async () => {
    const db = dbOf()
    const tx = dbOf()
    db.$transaction = vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    await publishLearningCourse(db as unknown as PrismaClient, admin, 'course-a', 'version-a')
    expect(tx.learningCourseVersion.updateMany).toHaveBeenCalled()
    expect(tx.learningCourseVersion.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'version-a' }, data: expect.objectContaining({ status: 'PUBLISHED' }) }))
  })

  it('blocks edits to a published version', async () => {
    const db = dbOf({ learningCourseVersion: { findUnique: vi.fn().mockResolvedValue({ ...publishedVersion, course: { id: 'course-a', companyId: 'company-a' } }) } })
    await expect(createLearningModule(db as unknown as PrismaClient, admin, 'version-published', { title: 'Bloqueado', description: '' })).rejects.toMatchObject({ status: 409 })
  })

  it('supports module and lesson CRUD plus ordering in a draft', async () => {
    const db = dbOf()
    await createLearningModule(db as unknown as PrismaClient, admin, 'version-a', { title: 'Módulo nuevo', description: '' })
    await updateLearningModule(db as unknown as PrismaClient, admin, 'module-a', { title: 'Módulo editado' })
    await deleteLearningModule(db as unknown as PrismaClient, admin, 'module-a')
    await createLearningLesson(db as unknown as PrismaClient, admin, 'module-a', { title: 'Lección nueva', description: '', type: 'TEXT' })
    await updateLearningLesson(db as unknown as PrismaClient, admin, 'lesson-a', { title: 'Lección editada' })
    await deleteLearningLesson(db as unknown as PrismaClient, admin, 'lesson-a')
    await reorderLearningModules(db as unknown as PrismaClient, admin, 'version-a', ['module-a'])
    await reorderLearningLessons(db as unknown as PrismaClient, admin, 'module-a', ['lesson-a'])
    expect(db.learningModule.create).toHaveBeenCalled()
    expect(db.learningLesson.create).toHaveBeenCalled()
    expect(db.learningModule.delete).toHaveBeenCalled()
    expect(db.learningLesson.delete).toHaveBeenCalled()
  })

  it('archives a course without exposing an unexpected error type', async () => {
    const db = dbOf()
    const tx = dbOf()
    db.$transaction = vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    await archiveLearningCourse(db as unknown as PrismaClient, admin, 'course-a')
    expect(tx.learningCourseVersion.updateMany).toHaveBeenCalled()
  })

  it('keeps the domain error status available to route handlers', () => {
    expect(new LearningDomainError(409, 'conflict').status).toBe(409)
  })
})
