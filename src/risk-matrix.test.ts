import { describe, expect, it } from 'vitest'
import { riskLevelFor, riskLevelText, riskScoreFor } from './risk-matrix'

describe('risk matrix', () => {
  it('multiplies probability by impact on the 1–5 scale', () => {
    expect(riskScoreFor(1, 1)).toBe(1)
    expect(riskScoreFor(1, 5)).toBe(5)
    expect(riskScoreFor(2, 3)).toBe(6)
    expect(riskScoreFor(3, 5)).toBe(15)
    expect(riskScoreFor(4, 4)).toBe(16)
    expect(riskScoreFor(5, 5)).toBe(25)
  })

  it('maps the boundary scores to the consultant ranges: 1–5 LOW, 6–15 MEDIUM, 16–25 HIGH', () => {
    expect(riskLevelFor(1, 1)).toBe('LOW')
    expect(riskLevelFor(1, 5)).toBe('LOW')
    expect(riskLevelFor(2, 3)).toBe('MEDIUM')
    expect(riskLevelFor(3, 5)).toBe('MEDIUM')
    expect(riskLevelFor(4, 4)).toBe('HIGH')
    expect(riskLevelFor(5, 5)).toBe('HIGH')
  })

  it('formats the score and level together, e.g. "10 — Medio"', () => {
    expect(riskLevelText(2, 5)).toBe('10 — Medio')
    expect(riskLevelText(1, 1)).toBe('1 — Bajo')
    expect(riskLevelText(5, 5)).toBe('25 — Alto')
  })
})
