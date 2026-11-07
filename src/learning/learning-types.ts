import type { User } from '../types'

export type LearningCourseStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
export type LearningLessonType = 'TEXT' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'IMAGE'

export type LearningLesson = {
  id: string
  moduleId: string
  title: string
  description: string
  type: LearningLessonType
  content: string | null
  durationMinutes: number | null
  position: number
  createdAt: string
  updatedAt: string
}

export type LearningModule = {
  id: string
  versionId: string
  title: string
  description: string
  position: number
  lessons: LearningLesson[]
  createdAt: string
  updatedAt: string
}

export type LearningCourseVersion = {
  id: string
  courseId: string
  versionNumber: number
  status: LearningCourseStatus
  changeSummary: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: Pick<User, 'id' | 'name'>
  updatedBy: Pick<User, 'id' | 'name'>
  modules: LearningModule[]
}

export type LearningCourse = {
  id: string
  companyId: string
  title: string
  description: string
  category: string
  status: LearningCourseStatus
  createdAt: string
  updatedAt: string
  company: { id: string; name: string }
  createdBy: Pick<User, 'id' | 'name'>
  updatedBy: Pick<User, 'id' | 'name'>
  versions: LearningCourseVersion[]
  enrollment?: LearningEnrollmentSummary
}

export type LearningEnrollmentSummary = {
  id: string
  versionId: string
  assignedAt: string
}

export type LearningAssignableUser = Pick<User, 'id' | 'name' | 'email' | 'role' | 'companyId' | 'isActive'> & {
  enrolled: boolean
}

export type LearningEnrollment = {
  id: string
  companyId: string
  courseId: string
  versionId: string
  userId: string
  assignedById: string
  assignedAt: string
  createdAt: string
  updatedAt: string
  user: Pick<User, 'id' | 'name' | 'email' | 'role' | 'companyId' | 'isActive'>
  assignedBy: Pick<User, 'id' | 'name' | 'email'>
}

export type LearningBulkEnrollmentResult = {
  created: number
  alreadyEnrolled: number
  enrollments: LearningEnrollment[]
}

export type LearningCourseInput = {
  title: string
  description: string
  category: string
  companyId?: string
}

export type LearningModuleInput = { title: string; description: string; position?: number }
export type LearningLessonInput = {
  title: string
  description: string
  type: LearningLessonType
  content?: string | null
  durationMinutes?: number | null
  position?: number
}
