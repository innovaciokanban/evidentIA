import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AcceptanceStatusField } from './ProcessRiskPanel'
import { draftFromRisk, emptyRiskDraft, riskPayloadFromDraft } from './risk-type'
import type { ProcessRisk, RiskAcceptanceStatus } from '../../types'

const baseRisk = (overrides: Partial<ProcessRisk> = {}): ProcessRisk => ({
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

/** Campo tal como lo pinta el formulario: para nuevo toma el borrador, para existente lo persistido. */
const fieldFor = (value: RiskAcceptanceStatus) => renderToStaticMarkup(<AcceptanceStatusField value={value} />)

describe('AcceptanceStatusField', () => {
  it('está deshabilitado para un riesgo nuevo y muestra «Pendiente»', () => {
    expect(emptyRiskDraft.acceptanceStatus).toBe('PENDING')
    const markup = fieldFor(emptyRiskDraft.acceptanceStatus)
    expect(markup).toContain('Aceptación del riesgo')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Pendiente')
    expect(markup).not.toContain('onChange')
  })

  it('está deshabilitado para un riesgo existente aprobado y muestra «Aceptado»', () => {
    const draft = draftFromRisk(baseRisk({ acceptanceStatus: 'ACCEPTED' }))
    const markup = fieldFor(draft.acceptanceStatus)
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Aceptado')
    expect(markup).not.toContain('onChange')
  })

  it('está deshabilitado para un riesgo existente rechazado y muestra «Rechazado»', () => {
    const draft = draftFromRisk(baseRisk({ acceptanceStatus: 'REJECTED' }))
    const markup = fieldFor(draft.acceptanceStatus)
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Rechazado')
    expect(markup).not.toContain('onChange')
  })

  it('pinta exactamente el valor persistido de un riesgo existente pendiente', () => {
    const draft = draftFromRisk(baseRisk({ acceptanceStatus: 'PENDING' }))
    const markup = fieldFor(draft.acceptanceStatus)
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Pendiente')
  })

  it('sigue siendo un select con etiqueta accesible y sin desplegar opciones', () => {
    const markup = fieldFor('ACCEPTED')
    expect(markup).toMatch(/<label>Aceptación del riesgo<select[^>]*disabled/)
    expect(markup).toContain('<option value="PENDING">Pendiente</option>')
    expect(markup).toContain('<option value="ACCEPTED" selected="">Aceptado</option>')
    expect(markup).toContain('<option value="REJECTED">Rechazado</option>')
  })

  it('marca como seleccionado exactamente el valor del riesgo, en los tres estados', () => {
    for (const value of ['PENDING', 'ACCEPTED', 'REJECTED'] as const) {
      const markup = fieldFor(value)
      expect(markup).toContain('disabled=""')
      expect(markup).toContain(`<option value="${value}" selected="">`)
      expect(markup.match(/selected=""/g)).toHaveLength(1)
    }
  })
})

describe('aceptación fuera del payload del formulario', () => {
  it('nunca envía acceptanceStatus al guardar: el servidor lo inicializa en PENDING', () => {
    const payload = riskPayloadFromDraft({ ...emptyRiskDraft, acceptanceStatus: 'ACCEPTED' })
    expect(payload).not.toHaveProperty('acceptanceStatus')
    expect(riskPayloadFromDraft(emptyRiskDraft)).toMatchObject({ treatment: null })
  })
})
