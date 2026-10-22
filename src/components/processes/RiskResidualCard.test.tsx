import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RiskResidualCard, residualRiskLocked } from './ProcessRiskPanel'
import type { ProcessRisk, ProcessRiskControl } from '../../types'

const makeControl = (overrides: Partial<ProcessRiskControl> = {}): ProcessRiskControl => ({
  id: 'cmcontrol000000000001',
  riskId: 'cmrisk000000000000000001',
  description: 'Revisión periódica de accesos',
  evaluation: 'PENDING',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const makeRisk = (overrides: Partial<ProcessRisk> = {}): ProcessRisk => ({
  id: 'cmrisk000000000000000001',
  processId: 'cmprocess000000000000000001',
  name: 'Entrega tardía de información',
  description: 'La información puede llegar después del plazo y afectar la respuesta.',
  riskType: 'MISIONAL',
  code: 'MIS-R1',
  riskOwner: null,
  acceptanceStatus: 'PENDING',
  treatment: null,
  mitigationOwner: null,
  mitigationDueDate: null,
  inherentImpact: 3,
  inherentProbability: 4,
  inherentScore: 12,
  inherentLevel: 'MEDIUM',
  residualImpact: 1,
  residualProbability: 1,
  residualScore: 1,
  residualLevel: 'LOW',
  controls: [],
  evidences: [],
  approval: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const draft = { residualImpact: '1', residualProbability: '1' }
const noop = () => {}

describe('residualRiskLocked', () => {
  it('bloquea el residual mientras no exista, mientras falte el paso 2 o sin controles', () => {
    expect(residualRiskLocked(null)).toBe(true)
    expect(residualRiskLocked(makeRisk({ controls: [] }))).toBe(true)
    // Con controles pero sin aceptar el riesgo, el paso 4 sigue bloqueado.
    expect(residualRiskLocked(makeRisk({ controls: [makeControl()], acceptanceStatus: 'ACCEPTED', treatment: null }))).toBe(true)
    expect(residualRiskLocked(makeRisk({ controls: [makeControl()], acceptanceStatus: 'REJECTED', treatment: 'MITIGATE' }))).toBe(true)
  })

  it('habilita el residual con aceptación, tratamiento y al menos un control', () => {
    const unlocked = { treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED' } as const
    expect(residualRiskLocked(makeRisk({ ...unlocked, controls: [makeControl({ evaluation: 'PENDING' })] }))).toBe(false)
    expect(residualRiskLocked(makeRisk({ ...unlocked, controls: [makeControl({ evaluation: 'EFFECTIVE' })] }))).toBe(false)
  })

  it('vuelve a bloquear el residual al quitar el último control', () => {
    const withControl = makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED', controls: [makeControl()] })
    expect(residualRiskLocked(withControl)).toBe(false)
    expect(residualRiskLocked({ ...withControl, controls: [] })).toBe(true)
  })
})

describe('RiskResidualCard', () => {
  it('deshabilita la tarjeta y explica el primer requisito que falta, en orden de etapas', () => {
    const cases: Array<[ProcessRisk | null, string]> = [
      [null, 'Guarda el riesgo para continuar con la gestión.'],
      [makeRisk({ controls: [] }), 'Define el tratamiento del riesgo para continuar'],
      [makeRisk({ controls: [], treatment: 'MITIGATE' }), 'La gestión de controles y mitigación se habilitará cuando el dueño del riesgo acepte el riesgo'],
      [makeRisk({ controls: [makeControl()], treatment: 'MITIGATE', acceptanceStatus: 'REJECTED' }), 'El riesgo fue rechazado. Se requiere una nueva decisión autorizada antes de continuar'],
      // Aceptado pero sin controles: ya no es el paso 2 lo que falta, es el paso 3.
      [makeRisk({ controls: [], treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED' }), 'Agrega al menos un control para habilitar el riesgo residual'],
    ]
    for (const [risk, expectedNote] of cases) {
      const markup = renderToStaticMarkup(<RiskResidualCard risk={risk} draft={draft} onImpact={noop} onProbability={noop} />)
      expect(markup).toContain('RIESGO RESIDUAL')
      expect(markup).toContain(expectedNote)
      expect(markup.match(/<select[^>]*disabled/g)).toHaveLength(2)
    }
  })

  it('habilita la tarjeta residual y oculta el mensaje cuando ya está todo resuelto', () => {
    const risk = makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED', controls: [makeControl()] })
    const markup = renderToStaticMarkup(<RiskResidualCard risk={risk} draft={draft} onImpact={noop} onProbability={noop} />)
    expect(markup).toContain('RIESGO RESIDUAL')
    expect(markup).not.toContain('Agrega al menos un control')
    expect(markup).not.toContain('disabled')
  })

  it('expone el ancla de la notificación de plan de mitigación completado', () => {
    // El link "risks/<proceso>/<riesgo>/residual" apunta a este id para llevar al usuario hasta la
    // calificación residual en cuanto se cerraron las actividades del plan.
    const markup = renderToStaticMarkup(<RiskResidualCard risk={makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED', controls: [makeControl()] })} draft={draft} onImpact={noop} onProbability={noop} />)
    expect(markup).toContain('id="risk-residual-section"')
  })

  it('usa la variante residual de la tarjeta y la retícula compartida de campos', () => {
    const markup = renderToStaticMarkup(<RiskResidualCard risk={makeRisk({ treatment: 'MITIGATE', acceptanceStatus: 'ACCEPTED', controls: [makeControl()] })} draft={draft} onImpact={noop} onProbability={noop} />)
    expect(markup).toContain('risk-evaluation-card is-residual')
    expect(markup).toContain('risk-evaluation-body')
    expect(markup).toContain('Nivel calculado')
  })
})
