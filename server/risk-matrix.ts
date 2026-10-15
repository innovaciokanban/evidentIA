export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export const riskScoreFor = (impact: number, probability: number): number => impact * probability

export const riskLevelFor = (impact: number, probability: number): RiskLevel => {
  const score = riskScoreFor(impact, probability)
  if (score <= 5) return 'LOW'
  if (score <= 15) return 'MEDIUM'
  return 'HIGH'
}
