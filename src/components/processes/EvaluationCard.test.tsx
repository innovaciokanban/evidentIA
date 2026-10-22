import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EvaluationCard } from './ProcessRiskPanel'

const noop = () => {}

describe('EvaluationCard', () => {
  it('diferencia la tarjeta inherente con su variante y muestra puntaje junto a la clasificación', () => {
    const markup = renderToStaticMarkup(
      <EvaluationCard title="RIESGO INHERENTE" variant="inherent" impact="4" probability="5" onImpact={noop} onProbability={noop} disabled={false} />,
    )
    expect(markup).toContain('risk-evaluation-card is-inherent')
    expect(markup).not.toContain('is-residual')
    expect(markup).toContain('RIESGO INHERENTE')
    // Puntaje 4 × 5 = 20 → Alto (matriz 5 × 5), presente tanto en la insignia como en el resultado.
    expect(markup).toContain('risk-level-score">20</span>')
    expect(markup).toContain('risk-level-word">Alto</span>')
    expect(markup).toContain('risk-level-badge high')
  })

  it('la variante residual usa su propio acento y conserva el bloque de nivel calculado', () => {
    const markup = renderToStaticMarkup(
      <EvaluationCard title="RIESGO RESIDUAL" variant="residual" impact="1" probability="1" onImpact={noop} onProbability={noop} disabled={false} />,
    )
    expect(markup).toContain('risk-evaluation-card is-residual')
    expect(markup).not.toContain('is-inherent')
    expect(markup).toContain('risk-level-score">1</span>')
    expect(markup).toContain('risk-level-word">Bajo</span>')
  })

  it('alinea impacto y probabilidad dentro de la misma retícula con dos selectores', () => {
    const markup = renderToStaticMarkup(
      <EvaluationCard title="RIESGO INHERENTE" variant="inherent" impact="3" probability="3" onImpact={noop} onProbability={noop} disabled={false} />,
    )
    const body = markup.slice(markup.indexOf('risk-evaluation-body'))
    expect(body).toContain('Impacto<select')
    expect(body).toContain('Probabilidad<select')
    expect(body.match(/<select/g)).toHaveLength(2)
    // Las opciones de la matriz no cambian: 5 impactos + 5 probabilidades con sus etiquetas.
    expect(body.match(/<option/g)).toHaveLength(10)
    expect(body).toContain('1 - Insignificante')
    expect(body).toContain('5 - Casi seguro')
    expect(body).toContain('Nivel calculado')
  })

  it('en modo solo lectura deshabilita ambos selectores y anuncia el nivel con aria-live', () => {
    const markup = renderToStaticMarkup(
      <EvaluationCard title="RIESGO RESIDUAL" variant="residual" impact="2" probability="4" onImpact={noop} onProbability={noop} disabled note="Agrega al menos un control" />,
    )
    expect(markup.match(/<select[^>]*disabled/g)).toHaveLength(2)
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('role="note"')
    expect(markup).toContain('Agrega al menos un control')
    expect(markup).toContain('risk-level-word">Medio</span>')
  })
})
