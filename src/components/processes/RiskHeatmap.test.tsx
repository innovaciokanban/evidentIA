import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { riskLevelFor, riskScoreFor } from '../../risk-matrix'
import type { ProcessRisk } from '../../types'
import { RiskHeatmap, type HeatmapSelection } from './RiskHeatmap'

const makeRisk = ({ inherent, residual, code = 'MIS-R1', name = 'Riesgo de prueba' }: { inherent: [number, number]; residual: [number, number]; code?: string | null; name?: string }): ProcessRisk => ({
  id: `risk-${inherent[0]}${inherent[1]}-${residual[0]}${residual[1]}-${code ?? 'legacy'}`,
  processId: 'process-1',
  name,
  description: 'Riesgo para las pruebas de la matriz de calor.',
  riskType: 'MISIONAL',
  code,
  riskOwner: { id: 'user-1', name: 'Ana Dueña' },
  acceptanceStatus: 'PENDING',
  treatment: null,
  mitigationOwner: null,
  mitigationStartDate: null,
  mitigationDueDate: null,
  inherentImpact: inherent[0],
  inherentProbability: inherent[1],
  inherentScore: riskScoreFor(inherent[0], inherent[1]),
  inherentLevel: riskLevelFor(inherent[0], inherent[1]),
  residualImpact: residual[0],
  residualProbability: residual[1],
  residualScore: riskScoreFor(residual[0], residual[1]),
  residualLevel: riskLevelFor(residual[0], residual[1]),
  controls: [],
  evidences: [],
  approval: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const renderHeatmap = (risks: ProcessRisk[], selection: HeatmapSelection | null = null) => renderToStaticMarkup(
  <RiskHeatmap title="RIESGO INHERENTE" subtitle="ANTES DE CONTROLES" mode="inherent" risks={risks} selection={selection} onSelect={() => {}} />,
)

describe('RiskHeatmap', () => {
  it('dibuja los ejes, los puntajes por celda y la leyenda de niveles', () => {
    const markup = renderHeatmap([makeRisk({ inherent: [4, 4], residual: [1, 1] }), makeRisk({ inherent: [1, 1], residual: [2, 3] })])
    expect(markup).toContain('RIESGO INHERENTE')
    expect(markup).toContain('ANTES DE CONTROLES')
    expect(markup).toContain('Impacto')
    expect(markup).toContain('Probabilidad')
    expect(markup).toContain('>16<')
    expect(markup).toContain('>1<')
    expect(markup).toContain('risk-heatmap-cell level-high')
    expect(markup).toContain('risk-heatmap-cell level-low')
    expect(markup).toContain('Bajo 1')
    expect(markup).toContain('Medio 0')
    expect(markup).toContain('Alto 1')
    expect(markup).toContain('Impacto 4, probabilidad 4: 1 riesgos, Alto, puntaje 16')
    expect(markup).toContain('Impacto 5, probabilidad 5: 0 riesgos, Alto, puntaje 25')
    expect(markup).toContain('is-empty')
  })

  it('marca la celda seleccionada y refleja el conteo del modo consultado', () => {
    const risks = [makeRisk({ inherent: [5, 5], residual: [2, 3], code: 'EST-R1' }), makeRisk({ inherent: [5, 5], residual: [2, 3], code: 'MIS-R2' })]
    const markup = renderHeatmap(risks, { mode: 'inherent', impact: 5, probability: 5 })
    expect(markup).toContain('is-selected')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('Impacto 5, probabilidad 5: 2 riesgos, Alto, puntaje 25')
    const residual = renderToStaticMarkup(
      <RiskHeatmap title="RIESGO RESIDUAL" subtitle="DESPUÉS DE CONTROLES" mode="residual" risks={risks} selection={null} onSelect={() => {}} />,
    )
    expect(residual).toContain('RIESGO RESIDUAL')
    expect(residual).toContain('Impacto 2, probabilidad 3: 2 riesgos, Medio, puntaje 6')
    expect(residual).not.toContain('is-selected')
  })

  it('coloca los códigos de cada riesgo en su celda usando el código persistido', () => {
    const markup = renderHeatmap([
      makeRisk({ inherent: [4, 4], residual: [1, 1], code: 'EST-R1' }),
      makeRisk({ inherent: [2, 3], residual: [3, 5], code: 'MIS-R2' }),
      makeRisk({ inherent: [1, 1], residual: [2, 3], code: 'APO-R1' }),
    ])
    expect(markup).toMatch(/aria-label="Impacto 4, probabilidad 4: 1 riesgos, Alto, puntaje 16\. Códigos: EST-R1"/)
    expect(markup).toMatch(/aria-label="Impacto 2, probabilidad 3: 1 riesgos, Medio, puntaje 6\. Códigos: MIS-R2"/)
    expect(markup).toMatch(/aria-label="Impacto 1, probabilidad 1: 1 riesgos, Bajo, puntaje 1\. Códigos: APO-R1"/)
    expect(markup.match(/class="risk-heatmap-code"/g)).toHaveLength(3)
  })

  it('muestra varios códigos en una celda y reserva los restantes para el tooltip y la lista de selección', () => {
    const markup = renderHeatmap([
      makeRisk({ inherent: [5, 5], residual: [5, 5], code: 'EST-R1', name: 'Riesgo a' }),
      makeRisk({ inherent: [5, 5], residual: [5, 5], code: 'MIS-R2', name: 'Riesgo b' }),
      makeRisk({ inherent: [5, 5], residual: [5, 5], code: 'APO-R1', name: 'Riesgo c' }),
    ])
    expect(markup).toMatch(/aria-label="Impacto 5, probabilidad 5: 3 riesgos, Alto, puntaje 25\. Códigos: EST-R1, MIS-R2, APO-R1"/)
    expect(markup.match(/class="risk-heatmap-code"/g)).toHaveLength(2)
    expect(markup).toContain('risk-heatmap-code-more')
    expect(markup).toContain('>+1<')
    expect(markup).toContain('title="EST-R1, MIS-R2, APO-R1"')
  })

  it('agrupa los códigos según la combinación del modo consultado', () => {
    const risk = makeRisk({ inherent: [4, 4], residual: [1, 1], code: 'EST-R9' })
    const residual = renderToStaticMarkup(
      <RiskHeatmap title="RIESGO RESIDUAL" subtitle="DESPUÉS DE CONTROLES" mode="residual" risks={[risk]} selection={null} onSelect={() => {}} />,
    )
    expect(residual).toMatch(/aria-label="Impacto 1, probabilidad 1: 1 riesgos, Bajo, puntaje 1\. Códigos: EST-R9"/)
    expect(residual).not.toContain('Impacto 4, probabilidad 4: 1 riesgos')
  })

  it('cuenta los riesgos legados sin código sin mostrar chip de código', () => {
    const markup = renderHeatmap([makeRisk({ inherent: [3, 3], residual: [3, 3], code: null })])
    expect(markup).toMatch(/aria-label="Impacto 3, probabilidad 3: 1 riesgos, Medio, puntaje 9"/)
    expect(markup).not.toContain('Códigos:')
    expect(markup.match(/class="risk-heatmap-code"/g) ?? []).toHaveLength(0)
  })
})
