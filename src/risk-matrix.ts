import type { RiskLevel } from './types'

export const riskLevelLabel: Record<RiskLevel, string> = { LOW: 'Bajo', MEDIUM: 'Medio', HIGH: 'Alto' }

export const riskScoreFor = (impact: number, probability: number): number => impact * probability

export const riskLevelFor = (impact: number, probability: number): RiskLevel => {
  const score = riskScoreFor(impact, probability)
  if (score <= 5) return 'LOW'
  if (score <= 15) return 'MEDIUM'
  return 'HIGH'
}

export const riskLevelText = (impact: number, probability: number): string => `${riskScoreFor(impact, probability)} — ${riskLevelLabel[riskLevelFor(impact, probability)]}`
