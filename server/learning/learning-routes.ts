import type { Application, NextFunction, Request, RequestHandler, Response } from 'express'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import { LearningDomainError, type LearningActor } from './learning-policy.js'
import { archiveLearningCourse, createLearningCourse, createLearningLesson, createLearningModule, createLearningVersion, deleteLearningLesson, deleteLearningModule, enrollLearningUser, enrollLearningUsers, getLearningCourse, listLearningAssignableUsers, listLearningCourses, listLearningEnrollments, publishLearningCourse, reorderLearningLessons, reorderLearningModules, updateLearningCourse, updateLearningLesson, updateLearningModule } from './learning-service.js'
import { learningCourseCreateSchema, learningCourseQuerySchema, learningCourseUpdateSchema, learningEnrollmentBulkSchema, learningEnrollmentCreateSchema, learningLessonCreateSchema, learningLessonUpdateSchema, learningModuleCreateSchema, learningModuleUpdateSchema, learningPublishSchema, learningReorderSchema, learningVersionCreateSchema } from './learning-validation.js'

type LearningRouteOptions = {
  app: Application
  db: PrismaClient
  authMiddleware: RequestHandler
  adminMiddleware: RequestHandler
}

type LearningHandler = (request: Request, response: Response, next: NextFunction) => Promise<void>

const route = (handler: LearningHandler): RequestHandler => async (request, response, next) => {
  try {
    await handler(request, response, next)
  } catch (error) {
    if (error instanceof LearningDomainError) {
      response.status(error.status).json({ error: error.message })
      return
    }
    next(error)
  }
}

const actorOf = (request: Request): LearningActor => {
  if (!request.user) throw new LearningDomainError(401, 'Authentication required')
  return { id: request.user.id, role: request.user.role, companyId: request.user.companyId }
}

const bodyOf = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new LearningDomainError(400, 'Invalid learning request')
  return parsed.data as T
}

const paramsId = (request: Request, name: string): string => {
  const value = request.params[name]
  if (!value) throw new LearningDomainError(400, `Missing ${name}`)
  return String(value)
}

export const registerLearningRoutes = ({ app, db, authMiddleware, adminMiddleware }: LearningRouteOptions): void => {
  app.get('/api/learning/courses', authMiddleware, route(async (request, response) => {
    const actor = actorOf(request)
    const query = bodyOf(learningCourseQuerySchema, request.query)
    const courses = await listLearningCourses(db, actor, query)
    response.json({ courses })
  }))

  app.post('/api/learning/courses', authMiddleware, adminMiddleware, route(async (request, response) => {
    const actor = actorOf(request)
    const input = bodyOf(learningCourseCreateSchema, request.body)
    const course = await createLearningCourse(db, actor, input)
    response.status(201).json({ course })
  }))

  app.get('/api/learning/courses/:courseId', authMiddleware, route(async (request, response) => {
    const course = await getLearningCourse(db, actorOf(request), paramsId(request, 'courseId'))
    response.json({ course })
  }))

  app.get('/api/learning/courses/:courseId/assignable-users', authMiddleware, adminMiddleware, route(async (request, response) => {
    const users = await listLearningAssignableUsers(db, actorOf(request), paramsId(request, 'courseId'))
    response.json({ users })
  }))

  app.get('/api/learning/courses/:courseId/enrollments', authMiddleware, adminMiddleware, route(async (request, response) => {
    const enrollments = await listLearningEnrollments(db, actorOf(request), paramsId(request, 'courseId'))
    response.json({ enrollments })
  }))

  app.post('/api/learning/courses/:courseId/enrollments/bulk', authMiddleware, adminMiddleware, route(async (request, response) => {
    const input = bodyOf(learningEnrollmentBulkSchema, request.body)
    const result = await enrollLearningUsers(db, actorOf(request), paramsId(request, 'courseId'), input)
    response.json(result)
  }))

  app.post('/api/learning/courses/:courseId/enrollments', authMiddleware, adminMiddleware, route(async (request, response) => {
    const input = bodyOf(learningEnrollmentCreateSchema, request.body)
    const enrollment = await enrollLearningUser(db, actorOf(request), paramsId(request, 'courseId'), input.userId)
    response.status(200).json({ enrollment })
  }))

  app.patch('/api/learning/courses/:courseId', authMiddleware, adminMiddleware, route(async (request, response) => {
    const input = bodyOf(learningCourseUpdateSchema, request.body)
    const course = await updateLearningCourse(db, actorOf(request), paramsId(request, 'courseId'), input)
    response.json({ course })
  }))

  app.post('/api/learning/courses/:courseId/versions', authMiddleware, adminMiddleware, route(async (request, response) => {
    const input = bodyOf(learningVersionCreateSchema, request.body)
    const version = await createLearningVersion(db, actorOf(request), paramsId(request, 'courseId'), input.changeSummary)
    response.status(201).json({ version })
  }))

  app.post('/api/learning/courses/:courseId/publish', authMiddleware, adminMiddleware, route(async (request, response) => {
    const input = bodyOf(learningPublishSchema, request.body)
    const course = await publishLearningCourse(db, actorOf(request), paramsId(request, 'courseId'), input.versionId)
    response.json({ course })
  }))

  app.post('/api/learning/courses/:courseId/archive', authMiddleware, adminMiddleware, route(async (request, response) => {
    const course = await archiveLearningCourse(db, actorOf(request), paramsId(request, 'courseId'))
    response.json({ course })
  }))

  app.post('/api/learning/versions/:versionId/modules', authMiddleware, adminMiddleware, route(async (request, response) => {
    const input = bodyOf(learningModuleCreateSchema, request.body)
    const module = await createLearningModule(db, actorOf(request), paramsId(request, 'versionId'), input)
    response.status(201).json({ module })
  }))

  app.patch('/api/learning/modules/:moduleId', authMiddleware, adminMiddleware, route(async (request, response) => {
    const input = bodyOf(learningModuleUpdateSchema, request.body)
    const module = await updateLearningModule(db, actorOf(request), paramsId(request, 'moduleId'), input)
    response.json({ module })
  }))

  app.delete('/api/learning/modules/:moduleId', authMiddleware, adminMiddleware, route(async (request, response) => {
    await deleteLearningModule(db, actorOf(request), paramsId(request, 'moduleId'))
    response.status(204).send()
  }))

  app.post('/api/learning/versions/:versionId/modules/reorder', authMiddleware, adminMiddleware, route(async (request, response) => {
    const input = bodyOf(learningReorderSchema, request.body)
    await reorderLearningModules(db, actorOf(request), paramsId(request, 'versionId'), input.ids)
    response.status(204).send()
  }))

  app.post('/api/learning/modules/:moduleId/lessons', authMiddleware, adminMiddleware, route(async (request, response) => {
    const input = bodyOf(learningLessonCreateSchema, request.body)
    const lesson = await createLearningLesson(db, actorOf(request), paramsId(request, 'moduleId'), input)
    response.status(201).json({ lesson })
  }))

  app.patch('/api/learning/lessons/:lessonId', authMiddleware, adminMiddleware, route(async (request, response) => {
    const input = bodyOf(learningLessonUpdateSchema, request.body)
    const lesson = await updateLearningLesson(db, actorOf(request), paramsId(request, 'lessonId'), input)
    response.json({ lesson })
  }))

  app.delete('/api/learning/lessons/:lessonId', authMiddleware, adminMiddleware, route(async (request, response) => {
    await deleteLearningLesson(db, actorOf(request), paramsId(request, 'lessonId'))
    response.status(204).send()
  }))

  app.post('/api/learning/modules/:moduleId/lessons/reorder', authMiddleware, adminMiddleware, route(async (request, response) => {
    const input = bodyOf(learningReorderSchema, request.body)
    await reorderLearningLessons(db, actorOf(request), paramsId(request, 'moduleId'), input.ids)
    response.status(204).send()
  }))
}
