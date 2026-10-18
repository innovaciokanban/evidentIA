import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ApprovalReviewDetail, ApprovalStatusChip, approvalStatusLabels, canDecideApproval } from './ApprovalsInbox'
import type { RiskApproval, User } from '../../types'

const ownerUser: Pick<User, 'id' | 'role'> = { id: 'cmowner1', role: 'COMPANY_USER' }
const memberUser: Pick<User, 'id' | 'role'> = { id: 'cmmember1', role: 'COMPANY_USER' }
const adminUser: Pick<User, 'id' | 'role'> = { id: 'cmadmin1', role: 'COMPANY_ADMIN' }

const makeApproval = (overrides: Partial<RiskApproval> = {}): RiskApproval => ({
  id: 'cmapproval000000000001',
  riskId: 'cmrisk0000000000000001',
  status: 'PENDING',
  requestedBy: { id: 'cmadmin1', name: 'Ben Admin' },
  requestedAt: '2026-10-01T08:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  comment: null,
  ticket: null,
  risk: {
    id: 'cmrisk0000000000000001',
    code: 'MIS-R1',
    name: 'Entrega tardía de información',
    description: 'La información puede llegar después del plazo y afectar la respuesta.',
    acceptanceStatus: 'PENDING',
    treatment: 'MITIGATE',
    riskOwner: { id: 'cmowner1', name: 'Cleo Dueña' },
    inherentImpact: 4,
    inherentProbability: 5,
    inherentScore: 20,
    inherentLevel: 'HIGH',
    residualImpact: 1,
    residualProbability: 1,
    residualScore: 1,
    residualLevel: 'LOW',
    controls: [{
      id: 'cmcontrol000000000001',
      riskId: 'cmrisk0000000000000001',
      description: 'Revisión semanal del plazo de entrega',
      evaluation: 'EFFECTIVE',
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
    }],
    process: { id: 'cmprocess0000000000000001', name: 'Proceso misional', code: 'PROC-01' },
  },
  ...overrides,
})

const renderDetail = (approval: RiskApproval, user: Pick<User, 'id' | 'role'>, extra: { deciding?: boolean; error?: string; onOpenRisk?: () => void } = {}) => renderToStaticMarkup(
  <ApprovalReviewDetail
    approval={approval}
    user={user}
    deciding={extra.deciding ?? false}
    error={extra.error ?? ''}
    onApprove={() => {}}
    onReject={() => {}}
    onOpenRisk={extra.onOpenRisk}
  />,
)

describe('approvalStatusLabels', () => {
  it('etiqueta los cuatro estados del ciclo en español', () => {
    expect(approvalStatusLabels).toEqual({
      PENDING: 'Pendiente',
      APPROVED: 'Aprobado',
      REJECTED: 'Rechazado',
      OUTDATED: 'Requiere revisión',
    })
  })

  it('pinta el chip con la clase del estado', () => {
    const markup = renderToStaticMarkup(<ApprovalStatusChip status="OUTDATED" />)
    expect(markup).toContain('approval-status-chip outdated')
    expect(markup).toContain('Requiere revisión')
  })
})

describe('canDecideApproval', () => {
  it('permite decidir al dueño del riesgo solo mientras el ciclo está pendiente', () => {
    expect(canDecideApproval(makeApproval(), ownerUser)).toBe(true)
    expect(canDecideApproval(makeApproval({ status: 'REJECTED' }), ownerUser)).toBe(false)
    expect(canDecideApproval(makeApproval({ status: 'APPROVED' }), ownerUser)).toBe(false)
    expect(canDecideApproval(makeApproval({ status: 'OUTDATED' }), ownerUser)).toBe(false)
  })

  it('permite decidir a administradores y superusuarios, nunca a un colaborador ajeno', () => {
    expect(canDecideApproval(makeApproval(), adminUser)).toBe(true)
    expect(canDecideApproval(makeApproval(), { id: 'cmsuper1', role: 'SUPERUSER' })).toBe(true)
    expect(canDecideApproval(makeApproval(), memberUser)).toBe(false)
    expect(canDecideApproval(makeApproval({ status: 'APPROVED' }), adminUser)).toBe(false)
  })
})

describe('ApprovalReviewDetail', () => {
  it('muestra el código del riesgo, su descripción, proceso, niveles, controles y tratamiento', () => {
    const markup = renderDetail(makeApproval(), ownerUser)
    expect(markup).toContain('MIS-R1')
    expect(markup).toContain('Entrega tardía de información')
    expect(markup).toContain('La información puede llegar después del plazo y afectar la respuesta.')
    expect(markup).toContain('Proceso misional')
    expect(markup).toContain('20 — Alto')
    expect(markup).toContain('1 — Bajo')
    expect(markup).toContain('Revisión semanal del plazo de entrega')
    expect(markup).toContain('Mitigar')
    expect(markup).toContain('Cleo Dueña')
    expect(markup).toContain('Ben Admin')
  })

  it('ofrece aprobar y rechazar al que puede decidir un ciclo pendiente', () => {
    const markup = renderDetail(makeApproval(), ownerUser)
    expect(markup).toContain('Aprobar y aceptar')
    expect(markup).toContain('Rechazar')
    expect(markup).not.toContain('Confirmar rechazo')
    expect(markup).not.toContain('puede decidir esta solicitud')
  })

  it('oculta las acciones y explica quién decide para un colaborador ajeno', () => {
    const markup = renderDetail(makeApproval(), memberUser)
    expect(markup).not.toContain('Aprobar y aceptar')
    expect(markup).not.toContain('Rechazar')
    expect(markup).toContain('Solo Cleo Dueña puede decidir esta solicitud.')
  })

  it('resume la decisión con quién, cuándo, comentario y ticket una vez resuelto', () => {
    const markup = renderDetail(makeApproval({
      status: 'APPROVED',
      decidedBy: { id: 'cmowner1', name: 'Cleo Dueña' },
      decidedAt: '2026-10-02T10:00:00.000Z',
      comment: 'Aprobado con observación menor.',
      ticket: { id: 'cmticket000000000001', title: 'MIS-R1 · Entrega tardía de información', status: 'OPEN' },
    }), adminUser)
    expect(markup).toContain('DECISIÓN')
    expect(markup).toContain('Aprobado por Cleo Dueña')
    expect(markup).toContain('«Aprobado con observación menor.»')
    expect(markup).toContain('Ticket generado: MIS-R1 · Entrega tardía de información')
    expect(markup).not.toContain('Aprobar y aceptar')
  })

  it('explica un ciclo marcado para nueva revisión sin ofrecer decidir de nuevo', () => {
    const markup = renderDetail(makeApproval({
      status: 'OUTDATED',
      decidedBy: { id: 'cmowner1', name: 'Cleo Dueña' },
      decidedAt: '2026-10-02T10:00:00.000Z',
    }), ownerUser)
    expect(markup).toContain('marcado para nueva revisión porque el riesgo cambió')
    expect(markup).toContain('Requiere revisión')
    expect(markup).not.toContain('Aprobar y aceptar')
  })

  it('muestra el error del servidor y el acceso al riesgo cuando está disponible', () => {
    const withError = renderDetail(makeApproval(), ownerUser, { error: 'The approval decision could not be saved; it can be retried' })
    expect(withError).toContain('The approval decision could not be saved; it can be retried')
    const withLink = renderDetail(makeApproval(), ownerUser, { onOpenRisk: () => {} })
    expect(withLink).toContain('Ver riesgo')
  })

  it('indica que la decisión está en curso mientras se guarda', () => {
    const markup = renderDetail(makeApproval(), ownerUser, { deciding: true })
    expect(markup).toContain('Guardando...')
    expect(markup).toContain('disabled=""')
  })
})
