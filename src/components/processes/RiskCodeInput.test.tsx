import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RiskCodeInput } from './ProcessRiskPanel'

describe('RiskCodeInput', () => {
  it('shows an always-disabled field with the automatic placeholder in creation mode', () => {
    const markup = renderToStaticMarkup(<RiskCodeInput code={null} creating />)
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('placeholder="Se asignará automáticamente"')
    expect(markup).toContain('value=""')
    expect(markup).toContain('Código del riesgo')
  })

  it('shows the real generated code without allowing edits after saving', () => {
    const markup = renderToStaticMarkup(<RiskCodeInput code="EST-R4" creating={false} />)
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('value="EST-R4"')
  })

  it('keeps legacy risks without a code read-only until they are saved again', () => {
    const markup = renderToStaticMarkup(<RiskCodeInput code={null} creating={false} />)
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('placeholder="Se asignará al guardar el riesgo"')
    expect(markup).toContain('value=""')
  })
})
