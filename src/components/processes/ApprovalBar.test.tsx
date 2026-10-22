import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ApprovalBar } from './ProcessRiskPanel'
import type { ProcessRisk, RiskApprovalSummary } from '../../types'

const makeRisk = (overrides: Partial<ProcessRisk> = {}): ProcessRisk => ({
  id: 'cmrisk0000000000000001',
  processId: 'cmprocess000000000000001',
  name: 'Entrega tardía de información',
  description: 'La información puede llegar después del plazo y afectar la respuesta.',
  riskType: 'MISIONAL',
  code: 'MIS-R1',
  riskOwner: { id: 'cmowner1', name: 'Cleo Dueña' },
  acceptanceStatus: 'PENDING',
  treatment: null,
  mitigationOwner: null,
  mitigationDueDate: null,
  inherentImpact: 4,
  inherentProbability: 5,
  inherentScore: 20,
  inherentLevel: 'HIGH',
  residualImpact: 1,
  residualProbability: 1,
  residualScore: 1,
  residualLevel: 'LOW',
  controls: [],
  evidences: [],
  approval: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  ...overrides,
})

const summary = (overrides: Partial<RiskApprovalSummary> = {}): RiskApprovalSummary => ({
  id: 'cmapproval000000000001',
  status: 'PENDING',
  requestedAt: '2026-10-01T09:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  comment: null,
  ticketId: null,
  ...overrides,
})

const renderBar = (risk: ProcessRisk, canWrite = true, sending = false) => renderToStaticMarkup(
  <ApprovalBar risk={risk} canWrite={canWrite} sending={sending} onRequest={() => {}} />,
)

describe('ApprovalBar', () => {
  it('pide asignar dueño antes de iniciar el flujo cuando no hay dueño', () => {
    const markup = renderBar(makeRisk({ riskOwner: null }))
    expect(markup).toContain('Asigna un dueño y guarda el riesgo para iniciar el flujo de aprobación.')
    expect(markup).not.toContain('Enviar a aprobación')
  })

  it('permite enviar a aprobación un riesgo con dueño que nunca se envió', () => {
    const markup = renderBar(makeRisk())
    expect(markup).toContain('Aún no se ha enviado a aprobación.')
    expect(markup).toContain('Enviar a aprobación')
    expect(markup).not.toContain('approval-status-chip')
  })

  it('informa un ciclo pendiente sin ofrecer reenviar', () => {
    const markup = renderBar(makeRisk({ approval: summary() }))
    expect(markup).toContain('Pendiente')
    expect(markup).toContain('Mis aprobaciones')
    expect(markup).not.toContain('Reenviar a aprobación')
    expect(markup).not.toContain('Enviar a aprobación')
  })

  it('resume el rechazo con su motivo y ofrece reenviar', () => {
    const markup = renderBar(makeRisk({
      approval: summary({ status: 'REJECTED', decidedBy: { id: 'cmowner1', name: 'Cleo Dueña' }, decidedAt: '2026-10-02T10:00:00.000Z', comment: 'Falta el control clave.' }),
    }))
    expect(markup).toContain('Rechazado')
    expect(markup).toContain('«Falta el control clave.»')
    expect(markup).toContain('Reenviar a aprobación')
  })

  it('ofrece reenviar cuando el ciclo quedó obsoleto tras un cambio relevante', () => {
    const markup = renderBar(makeRisk({
      approval: summary({ status: 'OUTDATED', decidedBy: { id: 'cmowner1', name: 'Cleo Dueña' }, decidedAt: '2026-10-02T10:00:00.000Z' }),
    }))
    expect(markup).toContain('Requiere revisión')
    expect(markup).toContain('marcado para nueva revisión porque el riesgo cambió')
    expect(markup).toContain('Reenviar a aprobación')
  })

  it('no ofrece reenviar un ciclo aprobado ni a usuarios sin escritura', () => {
    const approved = renderBar(makeRisk({ approval: summary({ status: 'APPROVED', decidedBy: { id: 'cmowner1', name: 'Cleo Dueña' }, decidedAt: '2026-10-02T10:00:00.000Z' }) }))
    expect(approved).toContain('Aprobado')
    expect(approved).not.toContain('Reenviar a aprobación')
    const readOnly = renderBar(makeRisk({ approval: summary({ status: 'REJECTED', comment: 'Motivo.' }) }), false)
    expect(readOnly).not.toContain('Reenviar a aprobación')
  })

  it('refleja el estado del envío en curso', () => {
    const markup = renderBar(makeRisk(), true, true)
    expect(markup).toContain('Enviando...')
    expect(markup).toContain('disabled=""')
  })
})
