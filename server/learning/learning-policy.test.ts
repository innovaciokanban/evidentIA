import { describe, expect, it } from 'vitest'
import { courseVisibilityWhere, resolveLearningCompanyId, type LearningActor } from './learning-policy.js'

const superuser: LearningActor = { id: 'superuser', role: 'SUPERUSER', companyId: null }
const companyAdmin: LearningActor = { id: 'admin', role: 'COMPANY_ADMIN', companyId: 'company-a' }
const companyUser: LearningActor = { id: 'user', role: 'COMPANY_USER', companyId: 'company-a' }

describe('learning policy', () => {
  it('applies company and publication scope to company users', () => {
    expect(courseVisibilityWhere(companyUser)).toEqual({ companyId: 'company-a', status: 'PUBLISHED' })
  })

  it('allows an administrator only inside its company', () => {
    expect(courseVisibilityWhere(companyAdmin)).toEqual({ companyId: 'company-a' })
    expect(resolveLearningCompanyId(companyAdmin)).toBe('company-a')
    expect(() => resolveLearningCompanyId(companyAdmin, 'company-b')).toThrow('Learning course not found')
  })

  it('requires an explicit company for a global administrator', () => {
    expect(resolveLearningCompanyId(superuser, 'company-b')).toBe('company-b')
    expect(() => resolveLearningCompanyId(superuser)).toThrow('companyId is required')
  })
})
