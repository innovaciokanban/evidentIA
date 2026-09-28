import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { indexStrategyWeightings, isWeightableStrategySource, normalizeStrategyText, strategySourceRef, strategyWeightingUpsertData, strategyWeightingView, WEIGHTABLE_STRATEGY_SOURCES, type StoredStrategyWeighting } from './strategy-weighting-service.js'

const criteria = { impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'MUY_ALTO', sinergiaInterna: 'BAJO', impactoReputacional: 'MEDIO' } as const

const stored = (overrides: Partial<StoredStrategyWeighting> = {}): StoredStrategyWeighting => ({
  source: 'AI_ANALYSIS',
  sourceRef: strategySourceRef('Usar el compromiso del equipo.'),
  impactoEstrategico: 'ALTO',
  viabilidad: 'MEDIO',
  urgencia: 'MUY_ALTO',
  sinergiaInterna: 'BAJO',
  impactoReputacional: 'MEDIO',
  weightedScore: 3.45,
  ...overrides,
})

describe('strategy weighting service', () => {
  describe('normalizeStrategyText', () => {
    it('collapses the differences that cannot make a strategy different', () => {
      const canonical = normalizeStrategyText('  Usar   el compromiso del equipo.  ')

      expect(canonical).toBe(normalizeStrategyText('usar el compromiso del equipo.'))
      expect(normalizeStrategyText('Usar\tel\ncompromiso del equipo.')).toBe(canonical)
    })

    it('keeps two different strategies different', () => {
      expect(normalizeStrategyText('Activar el canal directo.')).not.toBe(normalizeStrategyText('Activar el canal propio.'))
    })

    it('never reorders or rewrites the words', () => {
      expect(normalizeStrategyText('Retener a los clientes adecuados')).toBe('retener a los clientes adecuados')
    })
  })

  describe('strategySourceRef', () => {
    it('is the SHA-256 of the normalized text', () => {
      const text = '  Usar   el compromiso del equipo.  '

      expect(strategySourceRef(text)).toBe(createHash('sha256').update('usar el compromiso del equipo.', 'utf8').digest('hex'))
    })

    it('is stable across runs', () => {
      expect(strategySourceRef('Mismo texto.')).toBe(strategySourceRef('Mismo texto.'))
    })

    it('is 64 hex characters, so it is safe to store and to index', () => {
      expect(strategySourceRef('Mismo texto.')).toMatch(/^[0-9a-f]{64}$/)
    })

    it('gives the same ref to the same strategy when only case and spacing change', () => {
      expect(strategySourceRef('Cerrar brechas de onboarding.')).toBe(strategySourceRef('  CERRAR   BRECHAS de OnBoarding. '))
    })

    it('does not change when the strategy moves to another position of the analysis', () => {
      // El ancla se deriva del texto, así que reordenar foStrategies no puede invalidar la fila.
      const antes = { quadrant: 'FO', index: 0, text: 'Cerrar brechas de onboarding.' }
      const despues = { quadrant: 'DA', index: 7, text: 'Cerrar brechas de onboarding.' }

      expect(strategySourceRef(antes.text)).toBe(strategySourceRef(despues.text))
    })

    it('gives the same ref to the same strategy that arrives from Checky', () => {
      // La misma estrategia propuesta por IA y sugerida por Checky es una sola estrategia: por eso el
      // ancla no lleva la fuente dentro y el ponderado no se parte en dos.
      expect(strategySourceRef('Anticipar la norma de seguridad.')).toBe(strategySourceRef('Anticipar la norma de seguridad.'))
    })

    it('gives a different ref to a different text', () => {
      expect(strategySourceRef('Cerrar brechas de onboarding.')).not.toBe(strategySourceRef('Cerrar brechas de contratación.'))
    })

    it('does not confuse a text with itself plus a trailing character', () => {
      expect(strategySourceRef('Cerrar brechas.')).not.toBe(strategySourceRef('Cerrar brechas!'))
    })
  })

  describe('isWeightableStrategySource', () => {
    it('accepts only the sources that are not crosses', () => {
      expect(isWeightableStrategySource('AI_ANALYSIS')).toBe(true)
      expect(isWeightableStrategySource('CHECKY')).toBe(true)
    })

    it('rejects a cross, because a cross keeps its own weighting', () => {
      expect(isWeightableStrategySource('STRATEGIC_CROSS')).toBe(false)
    })

    it('rejects anything that is not a source at all', () => {
      expect(isWeightableStrategySource('cruce')).toBe(false)
      expect(isWeightableStrategySource(null)).toBe(false)
      expect(isWeightableStrategySource(1)).toBe(false)
    })

    it('publishes exactly the two sources it accepts', () => {
      expect([...WEIGHTABLE_STRATEGY_SOURCES]).toEqual(['AI_ANALYSIS', 'CHECKY'])
    })
  })

  describe('strategyWeightingView', () => {
    it('gives the client the five levels, the score and the band, and nothing else', () => {
      expect(strategyWeightingView(stored())).toEqual({
        impactoEstrategico: 'ALTO',
        viabilidad: 'MEDIO',
        urgencia: 'MUY_ALTO',
        sinergiaInterna: 'BAJO',
        impactoReputacional: 'MEDIO',
        weightedScore: 3.45,
        weightingBand: 'CORTO_PLAZO',
      })
    })

    it('never leaks the row id or the sourceRef of the stored weighting', () => {
      const view = strategyWeightingView(stored())

      expect(Object.keys(view).sort()).toEqual(['impactoEstrategico', 'impactoReputacional', 'sinergiaInterna', 'urgencia', 'viabilidad', 'weightedScore', 'weightingBand'])
    })

    it('reads the band from the stored score without recalculating it', () => {
      const bands = [4.4, 3.3, 2.5, 1.2].map((weightedScore) => strategyWeightingView(stored({ weightedScore })).weightingBand)

      expect(bands).toEqual(['INMEDIATA', 'CORTO_PLAZO', 'MEDIANO_PLAZO', 'LARGO_PLAZO'])
    })
  })

  describe('strategyWeightingUpsertData', () => {
    it('computes the score in the server with the weights of the methodology', () => {
      // 20% de ALTO(4) + 25% de MEDIO(3) + 20% de MUY_ALTO(5) + 15% de BAJO(2) + 20% de MEDIO(3)
      const data = strategyWeightingUpsertData(criteria, 'cmuser00000000000000001')

      expect(data.weightedScore).toBe(3.45)
    })

    it('keeps the five levels exactly as chosen and records who weighed it', () => {
      const data = strategyWeightingUpsertData(criteria, 'cmuser00000000000000001')

      expect(data.impactoEstrategico).toBe('ALTO')
      expect(data.viabilidad).toBe('MEDIO')
      expect(data.urgencia).toBe('MUY_ALTO')
      expect(data.sinergiaInterna).toBe('BAJO')
      expect(data.impactoReputacional).toBe('MEDIO')
      expect(data.createdById).toBe('cmuser00000000000000001')
    })

    it('gives the same score for the same levels, and a different one when a level moves', () => {
      expect(strategyWeightingUpsertData(criteria, 'u1').weightedScore).toBe(strategyWeightingUpsertData({ ...criteria }, 'u2').weightedScore)
      expect(strategyWeightingUpsertData(criteria, 'u1').weightedScore).not.toBe(strategyWeightingUpsertData({ ...criteria, urgencia: 'BAJO' }, 'u2').weightedScore)
    })

    it('never accepts a score from outside: the returned data has no score field to fill in', () => {
      const data = strategyWeightingUpsertData(criteria, 'cmuser00000000000000001')

      expect(data).not.toHaveProperty('id')
      expect(data).not.toHaveProperty('diagnosticId')
      expect(data).not.toHaveProperty('source')
      expect(data).not.toHaveProperty('sourceRef')
    })
  })

  describe('indexStrategyWeightings', () => {
    it('indexes by the hash of the text, which is how the strategies look for their own weighting', () => {
      const text = 'Cerrar brechas de onboarding.'
      const index = indexStrategyWeightings([stored({ sourceRef: strategySourceRef(text) })])

      expect(index.get(strategySourceRef(text))?.weightedScore).toBe(3.45)
    })

    it('returns an empty index when there is nothing weighed yet', () => {
      expect(indexStrategyWeightings([]).size).toBe(0)
    })
  })
})
