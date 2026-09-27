import { describe, expect, it } from 'vitest'
import { WEIGHTING_CRITERIA, WEIGHTING_LEVEL_SCORE, calculateWeightedScore } from './weighting-service.js'

const uniform = (level: keyof typeof WEIGHTING_LEVEL_SCORE) => ({
  impactoEstrategico: level,
  viabilidad: level,
  urgencia: level,
  sinergiaInterna: level,
  impactoReputacional: level,
})

describe('strategy weighting service', () => {
  it('maps every level of the scale to its score', () => {
    expect(WEIGHTING_LEVEL_SCORE).toEqual({ MUY_BAJO: 1, BAJO: 2, MEDIO: 3, ALTO: 4, MUY_ALTO: 5 })
  })

  it('weights the five criteria as 20/25/20/15/20', () => {
    expect(WEIGHTING_CRITERIA).toEqual({
      impactoEstrategico: 0.2,
      viabilidad: 0.25,
      urgencia: 0.2,
      sinergiaInterna: 0.15,
      impactoReputacional: 0.2,
    })
    const total = Object.values(WEIGHTING_CRITERIA).reduce((sum, weight) => sum + weight, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('keeps the result between 1 and 5 when all criteria are equal', () => {
    expect(calculateWeightedScore(uniform('MUY_BAJO'))).toBe(1)
    expect(calculateWeightedScore(uniform('BAJO'))).toBe(2)
    expect(calculateWeightedScore(uniform('MEDIO'))).toBe(3)
    expect(calculateWeightedScore(uniform('ALTO'))).toBe(4)
    expect(calculateWeightedScore(uniform('MUY_ALTO'))).toBe(5)
  })

  it('applies each weight independently', () => {
    // 4*0.20 + 3*0.25 + 5*0.20 + 2*0.15 + 3*0.20
    expect(calculateWeightedScore({
      impactoEstrategico: 'ALTO',
      viabilidad: 'MEDIO',
      urgencia: 'MUY_ALTO',
      sinergiaInterna: 'BAJO',
      impactoReputacional: 'MEDIO',
    })).toBe(3.45)
  })

  it('gives viabilidad the heaviest influence and sinergia interna the lightest', () => {
    const heavyViabilidad = { ...uniform('MEDIO'), viabilidad: 'MUY_ALTO' as const }
    const heavySinergia = { ...uniform('MEDIO'), sinergiaInterna: 'MUY_ALTO' as const }
    expect(calculateWeightedScore(heavyViabilidad) - calculateWeightedScore(uniform('MEDIO'))).toBeCloseTo(0.5, 10)
    expect(calculateWeightedScore(heavySinergia) - calculateWeightedScore(uniform('MEDIO'))).toBeCloseTo(0.3, 10)
  })

  it('rounds to two decimals instead of leaking floating point noise', () => {
    // 1*0.20 + 2*0.25 + 3*0.20 + 4*0.15 + 5*0.20 = 2.9
    const score = calculateWeightedScore({
      impactoEstrategico: 'MUY_BAJO',
      viabilidad: 'BAJO',
      urgencia: 'MEDIO',
      sinergiaInterna: 'ALTO',
      impactoReputacional: 'MUY_ALTO',
    })
    expect(score).toBe(2.9)
    expect(String(score)).not.toContain('0000')
  })

  it('is deterministic and never uses the order of the criteria', () => {
    const criteria = { impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'MUY_ALTO', sinergiaInterna: 'BAJO', impactoReputacional: 'MEDIO' } as const
    const shuffled = { impactoReputacional: 'MEDIO', sinergiaInterna: 'BAJO', urgencia: 'MUY_ALTO', viabilidad: 'MEDIO', impactoEstrategico: 'ALTO' } as const
    expect(calculateWeightedScore(criteria)).toBe(calculateWeightedScore(criteria))
    expect(calculateWeightedScore(shuffled)).toBe(calculateWeightedScore(criteria))
  })

  it('never returns a score outside the scale range', () => {
    const levels = Object.keys(WEIGHTING_LEVEL_SCORE) as Array<keyof typeof WEIGHTING_LEVEL_SCORE>
    for (const a of levels) {
      for (const b of levels) {
        const score = calculateWeightedScore({ ...uniform(a), viabilidad: b })
        expect(score).toBeGreaterThanOrEqual(1)
        expect(score).toBeLessThanOrEqual(5)
      }
    }
  })
})
