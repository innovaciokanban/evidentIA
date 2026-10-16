import { Fragment } from 'react'
import { heatmapCellsFor, riskLevelLabel, type HeatmapMode } from '../../risk-matrix'
import type { ProcessRisk, RiskLevel } from '../../types'

export type HeatmapSelection = { mode: HeatmapMode; impact: number; probability: number }

const probabilityAxis = [1, 2, 3, 4, 5]
const impactAxis = [5, 4, 3, 2, 1]
// Máximo de códigos visibles por celda; el resto se consulta en el tooltip/title,
// en la etiqueta accesible de la celda y en el listado al seleccionarla.
const visibleCodeLimit = 2

export function RiskHeatmap({ title, subtitle, mode, risks, selection, onSelect }: {
  title: string
  subtitle: string
  mode: HeatmapMode
  risks: ProcessRisk[]
  selection: HeatmapSelection | null
  onSelect: (selection: HeatmapSelection) => void
}) {
  const cells = heatmapCellsFor(risks, mode)
  const byPosition = new Map(cells.map((cell) => [`${cell.impact}-${cell.probability}`, cell]))
  const totals: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 }
  for (const cell of cells) totals[cell.level] += cell.count
  return (
    <section className="risk-heatmap" aria-label={title}>
      <div className="risk-heatmap-header">
        <div><p className="detail-label">{subtitle}</p><h3>{title}</h3></div>
        <div className="risk-heatmap-legend">
          <span className="low"><i />Bajo {totals.LOW}</span>
          <span className="medium"><i />Medio {totals.MEDIUM}</span>
          <span className="high"><i />Alto {totals.HIGH}</span>
        </div>
      </div>
      <div className="risk-heatmap-body">
        <span className="risk-heatmap-y-label">Impacto</span>
        <div className="risk-heatmap-grid">
          <span className="risk-heatmap-axis risk-heatmap-corner" aria-hidden="true" />
          {probabilityAxis.map((probability) => <span className="risk-heatmap-axis" key={`p-${probability}`}>{probability}</span>)}
          {impactAxis.map((impact) => (
            <Fragment key={impact}>
              <span className="risk-heatmap-axis">{impact}</span>
              {probabilityAxis.map((probability) => {
                const cell = byPosition.get(`${impact}-${probability}`)
                if (!cell) return null
                const isSelected = selection?.mode === mode && selection.impact === impact && selection.probability === probability
                const codesLabel = cell.codes.length > 0 ? `. Códigos: ${cell.codes.join(', ')}` : ''
                const visibleCodes = cell.codes.slice(0, visibleCodeLimit)
                const hiddenCodes = cell.codes.length - visibleCodes.length
                return (
                  <button
                    type="button"
                    key={`${impact}-${probability}`}
                    className={`risk-heatmap-cell level-${cell.level.toLowerCase()}${cell.count === 0 ? ' is-empty' : ''}${isSelected ? ' is-selected' : ''}`}
                    aria-pressed={isSelected}
                    aria-label={`Impacto ${impact}, probabilidad ${probability}: ${cell.count} riesgos, ${riskLevelLabel[cell.level]}, puntaje ${cell.score}${codesLabel}`}
                    title={cell.codes.length > 0 ? cell.codes.join(', ') : undefined}
                    onClick={() => onSelect({ mode, impact, probability })}
                  >
                    <span className="risk-heatmap-score">{cell.score}</span>
                    <span className="risk-heatmap-count">{cell.count}</span>
                    {cell.codes.length > 0 && (
                      <span className="risk-heatmap-codes">
                        {visibleCodes.map((code) => <span className="risk-heatmap-code" key={code}>{code}</span>)}
                        {hiddenCodes > 0 && <span className="risk-heatmap-code-more" aria-hidden="true">+{hiddenCodes}</span>}
                      </span>
                    )}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="risk-heatmap-x-label">Probabilidad</div>
    </section>
  )
}
