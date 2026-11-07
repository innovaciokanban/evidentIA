import express, { type RequestHandler } from 'express'
import supertest from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { registerLearningRoutes } from './learning-routes.js'

const course = {
  id: 'course-a', companyId: 'company-a', title: 'Curso visible', description: 'Contenido', category: 'Cultura', status: 'PUBLISHED', createdAt: new Date(), updatedAt: new Date(),
  company: { id: 'company-a', name: 'Empresa A' }, createdBy: { id: 'admin', name: 'Admin' }, updatedBy: { id: 'admin', name: 'Admin' }, versions: [{ id: 'version-a', courseId: 'course-a', versionNumber: 1, status: 'PUBLISHED', changeSummary: null, publishedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), createdBy: { id: 'admin', name: 'Admin' }, updatedBy: { id: 'admin', name: 'Admin' }, modules: [] }],
}
const enrollment = { id: 'enrollment-a', companyId: 'company-a', courseId: 'course-a', versionId: 'version-a', userId: 'user-a', assignedById: 'admin', assignedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), course, user: { id: 'user-a', name: 'User A', email: 'user@test.local', role: 'COMPANY_USER', companyId: 'company-a', isActive: true }, assignedBy: { id: 'admin', name: 'Admin', email: 'admin@test.local' } }

const appFor = (role: 'SUPERUSER' | 'COMPANY_ADMIN' | 'COMPANY_USER', courseResult: unknown = course) => {
  const app = express()
  app.use(express.json())
  const authMiddleware: RequestHandler = (request, _response, next) => {
    request.user = { id: 'user-a', name: 'User A', email: 'user@test.local', role, companyId: role === 'SUPERUSER' ? null : 'company-a', isActive: true }
    next()
  }
  const adminMiddleware: RequestHandler = (request, response, next) => {
    if (request.user?.role === 'SUPERUSER' || request.user?.role === 'COMPANY_ADMIN') next()
    else response.status(403).json({ error: 'Insufficient permissions' })
  }
  const db = {
    learningCourse: {
      findMany: vi.fn().mockResolvedValue(courseResult === null ? [] : [courseResult]),
      findFirst: vi.fn().mockResolvedValue(courseResult),
    },
    learningEnrollment: {
      findMany: vi.fn().mockResolvedValue(courseResult === null ? [] : [enrollment]),
      findFirst: vi.fn().mockResolvedValue(courseResult === null ? null : enrollment),
    },
  }
  registerLearningRoutes({ app, db: db as unknown as PrismaClient, authMiddleware, adminMiddleware })
  return { app, db }
}

describe('learning routes', () => {
  it('returns only enrolled courses to a company user', async () => {
    const { app } = appFor('COMPANY_USER')
    const response = await supertest(app).get('/api/learning/courses')
    expect(response.status).toBe(200)
    expect(response.body.courses[0].title).toBe('Curso visible')
  })

  it('returns 403 when a company user tries to create a course', async () => {
    const { app } = appFor('COMPANY_USER')
    const response = await supertest(app).post('/api/learning/courses').send({ title: 'No', description: 'No', category: 'No' })
    expect(response.status).toBe(403)
  })

  it('returns 404 for a course outside the visible tenant', async () => {
    const { app } = appFor('COMPANY_USER', null)
    const response = await supertest(app).get('/api/learning/courses/course-other')
    expect(response.status).toBe(404)
  })

  it('blocks assignment routes for a company user', async () => {
    const { app } = appFor('COMPANY_USER')
    const response = await supertest(app).post('/api/learning/courses/course-a/enrollments').send({ userId: 'user-a' })
    expect(response.status).toBe(403)
  })
})
