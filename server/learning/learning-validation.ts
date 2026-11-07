import { z } from 'zod'

const learningId = z.string().trim().min(1).max(64)
const learningText = (max: number) => z.string().trim().min(1).max(max)

export const learningCourseStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
export const learningLessonTypeSchema = z.enum(['TEXT', 'VIDEO', 'AUDIO', 'DOCUMENT', 'IMAGE'])

export const learningCourseCreateSchema = z.object({
  title: learningText(160),
  description: learningText(5000),
  category: learningText(80),
  companyId: learningId.optional(),
}).strict()

export const learningCourseUpdateSchema = z.object({
  title: learningText(160).optional(),
  description: learningText(5000).optional(),
  category: learningText(80).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required')

export const learningCourseQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  status: learningCourseStatusSchema.optional(),
  companyId: learningId.optional(),
})

export const learningVersionCreateSchema = z.object({
  changeSummary: z.string().trim().max(500).nullable().optional(),
}).strict()

export const learningPublishSchema = z.object({
  versionId: learningId.optional(),
}).strict()

export const learningModuleCreateSchema = z.object({
  title: learningText(160),
  description: z.string().trim().max(2000).default(''),
  position: z.number().int().min(0).max(10000).optional(),
}).strict()

export const learningModuleUpdateSchema = learningModuleCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const learningLessonCreateSchema = z.object({
  title: learningText(160),
  description: z.string().trim().max(2000).default(''),
  type: learningLessonTypeSchema.default('TEXT'),
  content: z.string().trim().max(10000).nullable().optional(),
  durationMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  position: z.number().int().min(0).max(10000).optional(),
}).strict()

export const learningLessonUpdateSchema = learningLessonCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required',
)

export const learningReorderSchema = z.object({
  ids: z.array(learningId).min(1).max(500),
}).strict()

export const learningEnrollmentCreateSchema = z.object({
  userId: learningId,
}).strict()

export const learningEnrollmentBulkSchema = z.object({
  userIds: z.array(learningId).max(500).optional(),
  allCurrentCompanyUsers: z.boolean().default(false),
}).strict().refine((value) => value.allCurrentCompanyUsers || Boolean(value.userIds?.length), {
  message: 'userIds or allCurrentCompanyUsers is required',
})
