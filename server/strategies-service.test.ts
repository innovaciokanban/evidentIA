import { describe, expect, it } from 'vitest'
import type { CrossOrigin, CrossType, StrategySource, WeightingLevel } from '@prisma/client'
import { collectStrategies, readAiStrategyTexts, strategyTitleFromText, type AiStrategySource, type CheckyStrategySource, type CrossStrategySource, type StoredWeighting, type StrategySources } from './strategies-service.js'
import { strategySourceRef, type StoredStrategyWeighting } from './strategy-weighting-service.js'

const factor = (id: string, type: string, description: string) => ({ id, type, description })
const strength = factor('cmfstrength00000000000001', 'STRENGTH', 'Equipo comprometido')
const opportunity = factor('cmfopportunity00000000001', 'OPPORTUNITY', 'Mercado en expansión')

/** Ponderación de un cruce tal como la guarda StrategicCrossWeighting: criteria más id y crossId. */
const weighting = (overrides: Partial<StoredWeighting> = {}): StoredWeighting & { id: string; crossId: string } => ({
  id: 'cmweighting0000000000001',
  crossId: 'cmcross0000000000000001',
  impactoEstrategico: 'ALTO' as WeightingLevel,
  viabilidad: 'MEDIO' as WeightingLevel,
  urgencia: 'MUY_ALTO' as WeightingLevel,
  sinergiaInterna: 'BAJO' as WeightingLevel,
  impactoReputacional: 'MEDIO' as WeightingLevel,
  weightedScore: 3.45,
  ...overrides,
})

/** Ponderación guardada de IA o Checky tal como la devuelve la tabla StrategyWeighting. */
const storedWeighting = (overrides: Partial<StoredStrategyWeighting> = {}): StoredStrategyWeighting => ({
  source: 'AI_ANALYSIS' as StrategySource,
  sourceRef: 'origen',
  impactoEstrategico: 'ALTO' as WeightingLevel,
  viabilidad: 'MEDIO' as WeightingLevel,
  urgencia: 'MUY_ALTO' as WeightingLevel,
  sinergiaInterna: 'BAJO' as WeightingLevel,
  impactoReputacional: 'MEDIO' as WeightingLevel,
  weightedScore: 3.45,
  ...overrides,
})

const cross = (overrides: Partial<CrossStrategySource> = {}): CrossStrategySource => ({
  id: 'cmcross0000000000000001',
  crossType: 'FO' as CrossType,
  origin: 'USER' as CrossOrigin,
  factor1: strength,
  factor2: opportunity,
  strategy: 'Llevar el equipo comprometido al mercado en expansión antes de que se consolide.',
  weighting: null,
  ...overrides,
})

const aiStrategy = (overrides: Partial<AiStrategySource> = {}): AiStrategySource => ({
  analysisId: 'cmanalysis00000000000001',
  quadrant: 'DO' as CrossType,
  index: 0,
  text: 'Transformar la capacitación contable en un plan de formación interna que reduzca la omisión de procesos.',
  ...overrides,
})

const checkySuggestion = (overrides: Partial<CheckyStrategySource> = {}): CheckyStrategySource => ({
  messageId: 'cmcheckymessage00000001',
  category: 'STRENGTHEN_STRATEGIES',
  evidenceIds: [strength.id],
  title: 'Reforzar la estrategia de FO',
  description: 'Asignar al equipo comprometido la apertura de cuentas en el mercado en expansión.',
  factors: [strength],
  ...overrides,
})

const sources = (overrides: Partial<StrategySources> = {}): StrategySources => ({ crosses: [], aiStrategies: [], checkySuggestions: [], ...overrides })

describe('strategies consolidation service', () => {
  it('gathers the three sources into one list, each with its own origin', () => {
    const strategies = collectStrategies(sources({
      crosses: [cross()],
      aiStrategies: [aiStrategy()],
      checkySuggestions: [checkySuggestion()],
    }))

    expect(strategies.map((strategy) => strategy.source)).toEqual(['STRATEGIC_CROSS', 'AI_ANALYSIS', 'CHECKY'])
    expect(strategies).toHaveLength(3)
    expect(strategies.map((strategy) => strategy.id)).toEqual([
      'cross:cmcross0000000000000001',
      'ai:cmanalysis00000000000001:DO:0',
      'checky:cmcheckymessage00000001',
    ])
  })

  it('keeps the weighted strategy with its stored score and the band resolveWeightingBand gives it', () => {
    const [strategy] = collectStrategies(sources({ crosses: [cross({ weighting: weighting() })] }))

    // El cliente recibe los cinco niveles, el ponderado y la banda: la fila de la base no se filtra.
    expect(strategy.weighting).toEqual({ impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'MUY_ALTO', sinergiaInterna: 'BAJO', impactoReputacional: 'MEDIO', weightedScore: 3.45, weightingBand: 'CORTO_PLAZO' })
    expect(strategy.weightedScore).toBe(3.45)
    // 3.45 cae en la banda CORTO_PLAZO: la clasificación no se recalcula aquí.
    expect(strategy.weightingBand).toBe('CORTO_PLAZO')
  })

  it('attaches the weighting stored for an AI strategy by the hash of its own text', () => {
    const entry = aiStrategy()
    const strategies = collectStrategies(sources({
      aiStrategies: [entry],
      weightings: new Map([[strategySourceRef(entry.text), storedWeighting({ sourceRef: strategySourceRef(entry.text) })]]),
    }))

    expect(strategies[0].source).toBe('AI_ANALYSIS')
    expect(strategies[0].weighting).toEqual({ impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'MUY_ALTO', sinergiaInterna: 'BAJO', impactoReputacional: 'MEDIO', weightedScore: 3.45, weightingBand: 'CORTO_PLAZO' })
  })

  it('attaches the weighting stored for a Checky strategy, also by the hash of its text', () => {
    const suggestion = checkySuggestion()
    const strategies = collectStrategies(sources({
      checkySuggestions: [suggestion],
      weightings: new Map([[strategySourceRef(suggestion.description!), storedWeighting({ source: 'CHECKY', sourceRef: strategySourceRef(suggestion.description!) })]]),
    }))

    expect(strategies[0].source).toBe('CHECKY')
    expect(strategies[0].weighting?.weightedScore).toBe(3.45)
    expect(strategies[0].weightingBand).toBe('CORTO_PLAZO')
  })

  it('leaves a strategy unweighted when no row matches the hash of its text', () => {
    const strategies = collectStrategies(sources({ aiStrategies: [aiStrategy()], weightings: new Map() }))

    expect(strategies[0].weighting).toBeNull()
    expect(strategies[0].weightedScore).toBeNull()
    expect(strategies[0].weightingBand).toBeNull()
  })

  it('finds the weighting of an AI strategy again after it moves to another position of the analysis', () => {
    const moved = aiStrategy({ index: 7, quadrant: 'DA' })
    const strategies = collectStrategies(sources({
      aiStrategies: [moved],
      weightings: new Map([[strategySourceRef(moved.text), storedWeighting()]]),
    }))

    // El id sintético sí cambia con la posición, pero la ponderación no depende de él.
    expect(strategies[0].id).toBe(`ai:${moved.analysisId}:DA:7`)
    expect(strategies[0].weighting?.weightedScore).toBe(3.45)
  })

  it('reads the band of the stored score without ever recalculating the weighting', () => {
    const bands = [4.4, 3.3, 2.5, 1.2].map((weightedScore) =>
      collectStrategies(sources({ crosses: [cross({ weighting: weighting({ weightedScore }) })] }))[0].weightingBand)

    expect(bands).toEqual(['INMEDIATA', 'CORTO_PLAZO', 'MEDIANO_PLAZO', 'LARGO_PLAZO'])
  })

  it('returns a strategy with no weighting as null score and null band, never as zero', () => {
    const [strategy] = collectStrategies(sources({ crosses: [cross({ weighting: null })] }))

    expect(strategy.weighting).toBeNull()
    expect(strategy.weightedScore).toBeNull()
    expect(strategy.weightingBand).toBeNull()
  })

  it('carries the cross origin, its quadrant and both factors for traceability', () => {
    const [strategy] = collectStrategies(sources({ crosses: [cross({ origin: 'BOTH', crossType: 'DA' })] }))

    expect(strategy.origin).toBe('BOTH')
    expect(strategy.crossType).toBe('DA')
    expect(strategy.crossId).toBe('cmcross0000000000000001')
    expect(strategy.factor1).toEqual(strength)
    expect(strategy.factor2).toEqual(opportunity)
  })

  it('leaves the AI strategy without a cross, factors or weighting, but keeps its quadrant', () => {
    const [strategy] = collectStrategies(sources({ aiStrategies: [aiStrategy({ quadrant: 'FA' })] }))

    expect(strategy.source).toBe('AI_ANALYSIS')
    expect(strategy.crossType).toBe('FA')
    expect(strategy.crossId).toBeNull()
    expect(strategy.origin).toBeNull()
    expect(strategy.factor1).toBeNull()
    expect(strategy.factor2).toBeNull()
    expect(strategy.weighting).toBeNull()
    expect(strategy.weightedScore).toBeNull()
    expect(strategy.weightingBand).toBeNull()
  })

  it('exposes the two factors a Checky suggestion cites, in the stored order', () => {
    const [strategy] = collectStrategies(sources({
      checkySuggestions: [checkySuggestion({ evidenceIds: [opportunity.id, strength.id], factors: [opportunity, strength] })],
    }))

    expect(strategy.source).toBe('CHECKY')
    expect(strategy.factor1).toEqual(opportunity)
    expect(strategy.factor2).toEqual(strength)
    expect(strategy.title).toBe('Reforzar la estrategia de FO')
  })

  it('drops exact duplicates and keeps the cross version, which is the one with a weighting', () => {
    const shared = 'Llevar el equipo comprometido al mercado en expansión antes de que se consolide.'
    const strategies = collectStrategies(sources({
      crosses: [cross({ strategy: shared, weighting: weighting() })],
      aiStrategies: [aiStrategy({ text: shared })],
      checkySuggestions: [checkySuggestion({ description: shared, title: '另一' })],
    }))

    expect(strategies).toHaveLength(1)
    expect(strategies[0].source).toBe('STRATEGIC_CROSS')
    expect(strategies[0].weightedScore).toBe(3.45)
  })

  it('ignores differences in case, spacing and surrounding whitespace when comparing', () => {
    const strategies = collectStrategies(sources({
      crosses: [cross({ strategy: 'Activar  el canal directo.' })],
      aiStrategies: [aiStrategy({ text: '  activar el canal DIRECTO.  ' })],
    }))

    expect(strategies).toHaveLength(1)
  })

  it('keeps similar but different strategies apart, because deduplication is not semantic', () => {
    const strategies = collectStrategies(sources({
      crosses: [cross({ strategy: 'Usar el soporte en casa para entregar atenciones rápidas.' })],
      aiStrategies: [aiStrategy({ text: 'Usar el soporte en casa y el trabajo en equipo para crear un programa de excelencia en soporte.' })],
    }))

    expect(strategies).toHaveLength(2)
  })

  it('does not repeat a strategy that appears twice inside the same source', () => {
    const text = 'Estandarizar un flujo mínimo de atención con guías por tipo de caso.'
    const strategies = collectStrategies(sources({ aiStrategies: [aiStrategy({ text }), aiStrategy({ text, index: 1 })] }))

    expect(strategies).toHaveLength(1)
  })

  it('omits a cross that has no strategy text yet, because there is nothing to prioritize', () => {
    const strategies = collectStrategies(sources({ crosses: [cross({ strategy: null }), cross({ strategy: '   ' }), cross({ id: 'cmcross0000000000000009', strategy: 'Plan de retorno al cliente prioritario.' })] }))

    expect(strategies.map((strategy) => strategy.crossId)).toEqual(['cmcross0000000000000009'])
  })

  it('omits an accepted Checky suggestion that became a cross, so the same strategy is not listed twice', () => {
    const materialised = 'Anticipar la norma de seguridad con el mercado en expansión.'
    const strategies = collectStrategies(sources({
      crosses: [cross({ id: 'cmcross0000000000000002', origin: 'AI', strategy: materialised })],
      checkySuggestions: [checkySuggestion({ category: 'MISSING_CROSSES', description: materialised })],
    }))

    expect(strategies).toHaveLength(1)
    expect(strategies[0].source).toBe('STRATEGIC_CROSS')
  })

  it('keeps an accepted MISSING_CROSSES suggestion as CHECKY in the weighting projection', () => {
    const materialised = 'Anticipar la norma de seguridad con el mercado en expansión.'
    const strategies = collectStrategies(sources({
      checkySuggestions: [checkySuggestion({ category: 'MISSING_CROSSES', description: materialised })],
      includeMissingCrossStrategies: true,
    }))

    expect(strategies).toHaveLength(1)
    expect(strategies[0]).toMatchObject({ source: 'CHECKY', crossId: null, description: materialised })
  })

  it('ignores a Checky suggestion that was accepted without a structured strategy', () => {
    const strategies = collectStrategies(sources({
      checkySuggestions: [checkySuggestion({ description: null }), checkySuggestion({ messageId: 'cmcheckymessage00000002', description: '   ' })],
    }))

    expect(strategies).toEqual([])
  })

  it('falls back to the projected text when a Checky suggestion arrives with no title', () => {
    const [strategy] = collectStrategies(sources({ checkySuggestions: [checkySuggestion({ title: null, description: 'Cerrar brechas de onboarding.' })] }))

    expect(strategy.title).toBe('Cerrar brechas de onboarding.')
  })

  it('returns an empty list when the diagnostic has nothing yet, without inventing entries', () => {
    expect(collectStrategies(sources())).toEqual([])
  })

  it('reads AI strategy texts tolerantly, ignoring anything that is not a usable string', () => {
    expect(readAiStrategyTexts(['uno', '', '   ', 'dos', 3, null, { text: 'tres' }])).toEqual(['uno', 'dos'])
    expect(readAiStrategyTexts(null)).toEqual([])
    expect(readAiStrategyTexts('texto suelto')).toEqual([])
    expect(readAiStrategyTexts({ 0: 'uno' })).toEqual([])
  })

  it('projects the title from the own text without adding words', () => {
    // Si la estrategia cabe en el límite, el título es el texto entero: no se recorta sin motivo.
    expect(strategyTitleFromText('Cerrar brechas. Segunda frase que no cabe.')).toBe('Cerrar brechas. Segunda frase que no cabe.')
    expect(strategyTitleFromText('Titulo corto')).toBe('Titulo corto')
    // Con un límite más corto que la primera oración, esa oración es el título.
    expect(strategyTitleFromText('Cerrar brechas. Segunda frase que no cabe.', 20)).toBe('Cerrar brechas.')
    const long = 'Palabra '.repeat(40).trim()
    const title = strategyTitleFromText(long)
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(91)
    expect(long.startsWith(title.replace('…', '').trimEnd())).toBe(true)
  })

  it('never mutates the sources it receives', () => {
    const input = sources({ crosses: [cross({ weighting: weighting() })], aiStrategies: [aiStrategy()], checkySuggestions: [checkySuggestion()] })
    const snapshot = JSON.parse(JSON.stringify(input))

    collectStrategies(input)

    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot)
  })
})
