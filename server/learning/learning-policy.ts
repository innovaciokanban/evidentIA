import type { Prisma, Role } from '@prisma/client'

export type LearningActor = {
  id: string
  role: Role
  companyId: string | null
}

export class LearningDomainError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409

  constructor(status: 400 | 401 | 403 | 404 | 409, message: string) {
    super(message)
    this.name = 'LearningDomainError'
    this.status = status
  }
}

export const isLearningAdmin = (actor: LearningActor): boolean => actor.role === 'SUPERUSER' || actor.role === 'COMPANY_ADMIN'

export const canManageLearningCompany = (actor: LearningActor, companyId: string): boolean =>
  actor.role === 'SUPERUSER' || (actor.role === 'COMPANY_ADMIN' && actor.companyId === companyId)

export const resolveLearningCompanyId = (actor: LearningActor, requestedCompanyId?: string): string => {
  if (actor.role === 'SUPERUSER') {
    if (!requestedCompanyId) throw new LearningDomainError(400, 'companyId is required for a global administrator')
    return requestedCompanyId
  }
  if (!actor.companyId) throw new LearningDomainError(403, 'The user is not attached to a company')
  if (requestedCompanyId && requestedCompanyId !== actor.companyId) throw new LearningDomainError(404, 'Learning course not found')
  return actor.companyId
}

export const courseVisibilityWhere = (actor: LearningActor): Prisma.LearningCourseWhereInput => {
  if (actor.role === 'SUPERUSER') return {}
  if (actor.role === 'COMPANY_ADMIN') return { companyId: actor.companyId ?? 'none' }
  return { companyId: actor.companyId ?? 'none', status: 'PUBLISHED' }
}

export const assertLearningAdmin = (actor: LearningActor): void => {
  if (!isLearningAdmin(actor)) throw new LearningDomainError(403, 'Insufficient permissions')
}
