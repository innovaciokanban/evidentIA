import { describe, expect, it } from 'vitest'
import { parseNotificationLink } from './notification-links'

describe('parseNotificationLink', () => {
  it('interpreta el enlace de una aprobación como su revisión en la bandeja', () => {
    expect(parseNotificationLink('approvals/cmapproval00000000000001')).toEqual({ kind: 'approval', approvalId: 'cmapproval00000000000001' })
  })

  it('interpreta el enlace residual de un riesgo llevando a la sección de calificación', () => {
    expect(parseNotificationLink('risks/cmprocess000000000000000001/cmrisk000000000000000001/residual')).toEqual({
      kind: 'risk',
      processId: 'cmprocess000000000000000001',
      riskId: 'cmrisk000000000000000001',
      section: 'residual',
    })
  })

  it('un enlace de riesgo sin sección navega al detalle sin forzar el scroll', () => {
    expect(parseNotificationLink('risks/cmprocess000000000000000001/cmrisk000000000000000001')).toEqual({
      kind: 'risk',
      processId: 'cmprocess000000000000000001',
      riskId: 'cmrisk000000000000000001',
      section: null,
    })
  })

  it('ignora secciones desconocidas o enlaces incompletos en vez de adivinar', () => {
    expect(parseNotificationLink('')).toBeNull()
    expect(parseNotificationLink('risks')).toBeNull()
    expect(parseNotificationLink('risks/cmprocess000000000000000001')).toBeNull()
    expect(parseNotificationLink('approvals')).toBeNull()
    expect(parseNotificationLink('dashboard/cmcompany00000000000000001')).toBeNull()
  })
})
