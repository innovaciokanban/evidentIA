import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api'
import { friendlyPlanError } from './audit-plan-errors'

describe('friendlyPlanError', () => {
  it('keeps activity assignment errors specific instead of reporting a missing team', () => {
    const error = new ApiError('Activity "Revisión de evidencias" needs at least one active audit team member', 409)
    expect(friendlyPlanError(error, 'fallback')).toBe('La actividad «Revisión de evidencias» necesita al menos un integrante activo del equipo auditor.')
  })

  it('keeps the generic team message for a genuinely empty active team', () => {
    const error = new ApiError('An audit plan needs an active audit team', 409)
    expect(friendlyPlanError(error, 'fallback')).toBe('Asigna un equipo auditor activo antes de preparar el plan.')
  })
})
