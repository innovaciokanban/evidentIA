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
  mitigationStartDate: null,
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
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const draft = { residualImpact: '1', residualProbability: '1' }
const noop = () => {}

describe('residualRiskLocked', () => {
  it('bloquea el residual mientras el riesgo no tenga controles, incluida la creación', () => {
    expect(residualRiskLocked(null)).toBe(true)
    expect(residualRiskLocked(makeRisk({ controls: [] }))).toBe(true)
  })

  it('habilita el residual con al menos un control, sin importar su evaluación', () => {
    expect(residualRiskLocked(makeRisk({ controls: [makeControl({ evaluation: 'PENDING' })] }))).toBe(false)
    expect(residualRiskLocked(makeRisk({ controls: [makeControl({ evaluation: 'EFFECTIVE' })] }))).toBe(false)
  })

  it('vuelve a bloquear el residual al quitar el último control', () => {
    const withControl = makeRisk({ controls: [makeControl()] })
    expect(residualRiskLocked(withControl)).toBe(false)
    expect(residualRiskLocked({ ...withControl, controls: [] })).toBe(true)
  })
})

describe('RiskResidualCard', () => {
  it('deshabilita la tarjeta residual y pide al menos un control cuando no hay ninguno', () => {
    for (const risk of [null, makeRisk({ controls: [] })]) {
      const markup = renderToStaticMarkup(<RiskResidualCard risk={risk} draft={draft} onImpact={noop} onProbability={noop} />)
      expect(markup).toContain('RIESGO RESIDUAL')
      expect(markup).toContain('Agrega al menos un control para habilitar el riesgo residual')
      expect(markup.match(/<select[^>]*disabled/g)).toHaveLength(2)
    }
  })

  it('habilita la tarjeta residual y oculta el mensaje cuando existe al menos un control', () => {
    const markup = renderToStaticMarkup(<RiskResidualCard risk={makeRisk({ controls: [makeControl()] })} draft={draft} onImpact={noop} onProbability={noop} />)
    expect(markup).toContain('RIESGO RESIDUAL')
    expect(markup).not.toContain('Agrega al menos un control')
    expect(markup).not.toContain('disabled')
  })
})
