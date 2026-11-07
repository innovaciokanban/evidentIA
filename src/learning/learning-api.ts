import { api } from '../api'
import type { LearningAssignableUser, LearningBulkEnrollmentResult, LearningCourse, LearningCourseInput, LearningEnrollment, LearningLesson, LearningLessonInput, LearningModule, LearningModuleInput, LearningCourseStatus } from './learning-types'

export const learningApi = {
  listCourses: (filters: { search?: string; category?: string; status?: LearningCourseStatus; companyId?: string } = {}) => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value) })
    return api<{ courses: LearningCourse[] }>(`/learning/courses${params.size ? `?${params.toString()}` : ''}`)
  },
  getCourse: (courseId: string) => api<{ course: LearningCourse }>(`/learning/courses/${courseId}`),
  listAssignableUsers: (courseId: string) => api<{ users: LearningAssignableUser[] }>(`/learning/courses/${courseId}/assignable-users`),
  listEnrollments: (courseId: string) => api<{ enrollments: LearningEnrollment[] }>(`/learning/courses/${courseId}/enrollments`),
  enrollUser: (courseId: string, userId: string) => api<{ enrollment: LearningEnrollment }>(`/learning/courses/${courseId}/enrollments`, { method: 'POST', body: JSON.stringify({ userId }) }),
  enrollUsers: (courseId: string, input: { userIds?: string[]; allCurrentCompanyUsers?: boolean }) => api<LearningBulkEnrollmentResult>(`/learning/courses/${courseId}/enrollments/bulk`, { method: 'POST', body: JSON.stringify(input) }),
  createCourse: (input: LearningCourseInput) => api<{ course: LearningCourse }>('/learning/courses', { method: 'POST', body: JSON.stringify(input) }),
  updateCourse: (courseId: string, input: Partial<LearningCourseInput>) => api<{ course: LearningCourse }>(`/learning/courses/${courseId}`, { method: 'PATCH', body: JSON.stringify(input) }),
  createVersion: (courseId: string, changeSummary?: string) => api<{ version: LearningCourse['versions'][number] }>(`/learning/courses/${courseId}/versions`, { method: 'POST', body: JSON.stringify({ changeSummary: changeSummary || null }) }),
  publishCourse: (courseId: string, versionId?: string) => api<{ course: LearningCourse }>(`/learning/courses/${courseId}/publish`, { method: 'POST', body: JSON.stringify(versionId ? { versionId } : {}) }),
  archiveCourse: (courseId: string) => api<{ course: LearningCourse }>(`/learning/courses/${courseId}/archive`, { method: 'POST' }),
  createModule: (versionId: string, input: LearningModuleInput) => api<{ module: LearningModule }>(`/learning/versions/${versionId}/modules`, { method: 'POST', body: JSON.stringify(input) }),
  updateModule: (moduleId: string, input: Partial<LearningModuleInput>) => api<{ module: LearningModule }>(`/learning/modules/${moduleId}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteModule: (moduleId: string) => api<void>(`/learning/modules/${moduleId}`, { method: 'DELETE' }),
  reorderModules: (versionId: string, ids: string[]) => api<void>(`/learning/versions/${versionId}/modules/reorder`, { method: 'POST', body: JSON.stringify({ ids }) }),
  createLesson: (moduleId: string, input: LearningLessonInput) => api<{ lesson: LearningLesson }>(`/learning/modules/${moduleId}/lessons`, { method: 'POST', body: JSON.stringify(input) }),
  updateLesson: (lessonId: string, input: Partial<LearningLessonInput>) => api<{ lesson: LearningLesson }>(`/learning/lessons/${lessonId}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteLesson: (lessonId: string) => api<void>(`/learning/lessons/${lessonId}`, { method: 'DELETE' }),
  reorderLessons: (moduleId: string, ids: string[]) => api<void>(`/learning/modules/${moduleId}/lessons/reorder`, { method: 'POST', body: JSON.stringify({ ids }) }),
}
