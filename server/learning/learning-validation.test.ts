import { describe, expect, it } from 'vitest'
import { learningCourseCreateSchema, learningEnrollmentBulkSchema, learningLessonCreateSchema, learningModuleCreateSchema } from './learning-validation.js'

describe('learning validation', () => {
  it('accepts a valid course and trims user input', () => {
    const result = learningCourseCreateSchema.parse({ title: '  Inducción  ', description: 'Contenido inicial', category: 'Cultura' })
    expect(result.title).toBe('Inducción')
  })

  it('rejects empty course content and unknown fields', () => {
    expect(learningCourseCreateSchema.safeParse({ title: 'x', description: '', category: 'x', status: 'PUBLISHED' }).success).toBe(false)
  })

  it('provides defaults for module and lesson authoring', () => {
    expect(learningModuleCreateSchema.parse({ title: 'Módulo 1' }).description).toBe('')
    expect(learningLessonCreateSchema.parse({ title: 'Lección 1' }).type).toBe('TEXT')
  })

  it('requires explicit users or the current-company bulk option', () => {
    expect(learningEnrollmentBulkSchema.safeParse({}).success).toBe(false)
    expect(learningEnrollmentBulkSchema.parse({ userIds: ['user-a', 'user-a'] }).allCurrentCompanyUsers).toBe(false)
    expect(learningEnrollmentBulkSchema.parse({ allCurrentCompanyUsers: true }).allCurrentCompanyUsers).toBe(true)
  })
})
