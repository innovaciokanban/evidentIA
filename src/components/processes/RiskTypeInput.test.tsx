import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RiskTypeInput } from './ProcessRiskPanel'
import { riskPayloadFromDraft, riskTypeForProcessType } from './risk-type'
import type { ProcessType } from '../../types'

const expectedLabel: Record<ProcessType, string> = { STRATEGIC: 'Estratégico', MISSIONAL: 'Misional', SUPPORT: 'Apoyo' }
const processTypes = Object.keys(expectedLabel) as ProcessType[]

describe('RiskTypeInput', () => {
  it('muestra la categoría del proceso en un campo desactivado, igual que el código del riesgo', () => {
    for (const processType of processTypes) {
      const markup = renderToStaticMarkup(<RiskTypeInput processType={processType} />)
      expect(markup).toContain('Tipo de riesgo')
      expect(markup).toContain('disabled=""')
      expect(markup).toContain(`value="${expectedLabel[processType]}"`)
      expect(markup).not.toContain('<select')
    }
  })

  it('actualiza el tipo automáticamente cuando cambia el proceso seleccionado', () => {
    const strategic = renderToStaticMarkup(<RiskTypeInput processType="STRATEGIC" />)
    const misional = renderToStaticMarkup(<RiskTypeInput processType="MISSIONAL" />)
    const apoyo = renderToStaticMarkup(<RiskTypeInput processType="SUPPORT" />)

    expect(strategic).toContain('value="Estratégico"')
    expect(misional).toContain('value="Misional"')
    expect(apoyo).toContain('value="Apoyo"')
  })

  it('deriva la misma categoría que el backend usa para el prefijo del código', () => {
    expect(riskTypeForProcessType).toEqual({ STRATEGIC: 'ESTRATEGICO', MISSIONAL: 'MISIONAL', SUPPORT: 'APOYO' })
  })
})

describe('riskPayloadFromDraft', () => {
  it('nunca envía riskType: la categoría la resuelve el backend a partir del proceso', () => {
    const payload = riskPayloadFromDraft({
      name: 'Entrega tardía de información',
      description: 'La información puede llegar después del plazo y afectar la respuesta.',
      riskOwnerId: '', acceptanceStatus: 'PENDING', treatment: '', mitigationOwnerId: '',
      mitigationStartDate: '', mitigationDueDate: '', inherentImpact: '3', inherentProbability: '4',
      residualImpact: '2', residualProbability: '2',
    })

    expect(payload).not.toHaveProperty('riskType')
    expect(payload).toMatchObject({
      name: 'Entrega tardía de información',
      riskOwnerId: null,
      treatment: null,
      inherentImpact: 3,
      inherentProbability: 4,
      residualImpact: 2,
      residualProbability: 2,
    })
  })
})
