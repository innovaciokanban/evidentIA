import type { ProcessRisk, RiskLevel } from './types'

export const riskLevelLabel: Record<RiskLevel, string> = { LOW: 'Bajo', MEDIUM: 'Medio', HIGH: 'Alto' }

export const riskScoreFor = (impact: number, probability: number): number => impact * probability

export const riskLevelFor = (impact: number, probability: number): RiskLevel => {
  const score = riskScoreFor(impact, probability)
  if (score <= 5) return 'LOW'
  if (score <= 15) return 'MEDIUM'
  return 'HIGH'
}

export const riskLevelText = (impact: number, probability: number): string => `${riskScoreFor(impact, probability)} — ${riskLevelLabel[riskLevelFor(impact, probability)]}`

export type HeatmapMode = 'inherent' | 'residual'

export type HeatmapCell = {
  impact: number
  probability: number
  score: number
  level: RiskLevel
  count: number
  // Códigos ya persistidos en cada riesgo (Risk.code); los riesgos legados sin código se omiten.
  codes: string[]
}

export const heatmapCellsFor = (risks: ProcessRisk[], mode: HeatmapMode): HeatmapCell[] => {
  const cells: HeatmapCell[] = []
  for (let impact = 1; impact <= 5; impact += 1) {
    for (let probability = 1; probability <= 5; probability += 1) {
      const inCell = risks.filter((risk) => (
        mode === 'inherent'
          ? risk.inherentImpact === impact && risk.inherentProbability === probability
          : risk.residualImpact === impact && risk.residualProbability === probability
      ))
      cells.push({
        impact,
        probability,
        score: riskScoreFor(impact, probability),
        level: riskLevelFor(impact, probability),
        count: inCell.length,
        codes: inCell.map((risk) => risk.code).filter((code): code is string => Boolean(code)),
      })
    }
  }
  return cells
}
