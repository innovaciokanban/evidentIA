import { describe, expect, it } from 'vitest'
import { heatmapCellsFor, riskLevelFor, riskLevelText, riskScoreFor } from './risk-matrix'
import type { ProcessRisk } from './types'

const makeRisk = ({ inherent, residual, code = 'MIS-R1' }: { inherent: [number, number]; residual: [number, number]; code?: string | null }): ProcessRisk => ({
  id: `risk-${inherent[0]}${inherent[1]}-${residual[0]}${residual[1]}-${code ?? 'legacy'}`,
  processId: 'process-1',
  name: 'Riesgo de prueba',
  description: 'Riesgo para las pruebas de la matriz de calor.',
  riskType: 'MISIONAL',
  code,
  riskOwner: null,
  acceptanceStatus: 'PENDING',
  treatment: null,
  mitigationOwner: null,
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

  it('builds the 5×5 heatmap with scores and levels from the existing ranges', () => {
    const cells = heatmapCellsFor([], 'inherent')
    expect(cells).toHaveLength(25)
    const cornerLow = cells.find((cell) => cell.impact === 1 && cell.probability === 1)
    expect(cornerLow).toMatchObject({ score: 1, level: 'LOW', count: 0 })
    const medium = cells.find((cell) => cell.impact === 3 && cell.probability === 5)
    expect(medium).toMatchObject({ score: 15, level: 'MEDIUM', count: 0 })
    const cornerHigh = cells.find((cell) => cell.impact === 5 && cell.probability === 5)
    expect(cornerHigh).toMatchObject({ score: 25, level: 'HIGH', count: 0 })
    expect(cells.every((cell) => cell.score === cell.impact * cell.probability)).toBe(true)
    expect(cells.every((cell) => cell.level === riskLevelFor(cell.impact, cell.probability))).toBe(true)
  })

  it('counts inherent and residual positions independently for each risk', () => {
    const risks = [
      makeRisk({ inherent: [5, 5], residual: [1, 1] }),
      makeRisk({ inherent: [5, 5], residual: [2, 3] }),
      makeRisk({ inherent: [2, 3], residual: [2, 3] }),
    ]
    const inherent = heatmapCellsFor(risks, 'inherent')
    expect(inherent.find((cell) => cell.impact === 5 && cell.probability === 5)?.count).toBe(2)
    expect(inherent.find((cell) => cell.impact === 2 && cell.probability === 3)?.count).toBe(1)
    expect(inherent.find((cell) => cell.impact === 1 && cell.probability === 1)?.count).toBe(0)
    const residual = heatmapCellsFor(risks, 'residual')
    expect(residual.find((cell) => cell.impact === 1 && cell.probability === 1)?.count).toBe(1)
    expect(residual.find((cell) => cell.impact === 2 && cell.probability === 3)?.count).toBe(2)
    expect(residual.find((cell) => cell.impact === 5 && cell.probability === 5)?.count).toBe(0)
    expect(inherent.reduce((total, cell) => total + cell.count, 0)).toBe(risks.length)
    expect(residual.reduce((total, cell) => total + cell.count, 0)).toBe(risks.length)
  })

  it('collects the stored codes of each cell per mode without rebuilding or inventing them', () => {
    const risks = [
      makeRisk({ inherent: [5, 5], residual: [1, 1], code: 'EST-R1' }),
      makeRisk({ inherent: [5, 5], residual: [1, 1], code: 'MIS-R2' }),
      makeRisk({ inherent: [2, 3], residual: [2, 3] }),
      makeRisk({ inherent: [2, 3], residual: [1, 1], code: null }),
    ]
    const inherent = heatmapCellsFor(risks, 'inherent')
    expect(inherent.find((cell) => cell.impact === 5 && cell.probability === 5)?.codes).toEqual(['EST-R1', 'MIS-R2'])
    expect(inherent.find((cell) => cell.impact === 2 && cell.probability === 3)?.codes).toEqual(['MIS-R1'])
    expect(inherent.find((cell) => cell.impact === 2 && cell.probability === 3)?.count).toBe(2)
    expect(inherent.find((cell) => cell.impact === 1 && cell.probability === 1)?.codes).toEqual([])
    const residual = heatmapCellsFor(risks, 'residual')
    expect(residual.find((cell) => cell.impact === 1 && cell.probability === 1)?.codes).toEqual(['EST-R1', 'MIS-R2'])
    expect(residual.find((cell) => cell.impact === 1 && cell.probability === 1)?.count).toBe(3)
    expect(residual.find((cell) => cell.impact === 2 && cell.probability === 3)?.codes).toEqual(['MIS-R1'])
  })
})
