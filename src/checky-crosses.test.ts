import { describe, expect, it } from 'vitest'
import { buildCrossStrategyEntries, crossTypeForPair, isCompatibleCrossPair, isWeightableStrategySource, normalizeStrategyText } from './checky-crosses'
import type { CheckyMessage, StrategicCross, StrategySource, SWOTItem } from './types'

const factor = (id: string, type: SWOTItem['type'], description: string): SWOTItem => ({ id, swotId: 'cmswot0000000000000001', type, description, createdAt: '2026-01-04' })

const strength = factor('cmfuerza00000000000001', 'STRENGTH', 'Equipo comprometido')
const weakness = factor('cmdebil000000000000001', 'WEAKNESS', 'Procesos sin documentar')
const opportunity = factor('cmoport000000000000001', 'OPPORTUNITY', 'Mercado en expansión')
const threat = factor('cmamen0000000000000001', 'THREAT', 'Normativa nueva')

const cross = (overrides: Partial<StrategicCross> = {}): StrategicCross => ({
  id: 'cmcross0000000000000001',
  diagnosticId: 'cmdiag0000000000000001',
  crossType: 'FO',
  origin: 'USER',
  factor1: strength,
  factor2: opportunity,
  strategy: 'Abrir el mercado con el equipo comprometido.',
  strategyStatus: null,
  aiAnalysis: null,
  priority: null,
  createdById: 'cmuser0000000000000001',
  createdAt: '2026-01-08',
  updatedAt: '2026-01-08',
  ...overrides,
})

const message = (overrides: Partial<CheckyMessage> = {}): CheckyMessage => ({
  id: 'cmmsg00000000000000001',
  sessionId: 'cmsess000000000000001',
  role: 'CHECKY',
  content: 'Propongo un cruce entre tus factores.',
  category: 'MISSING_CROSSES',
  basis: 'FACT',
  evidenceIds: [strength.id, opportunity.id],
  insufficientData: false,
  missingInformation: [],
  status: 'PENDING',
  decisionNote: null,
  suggestedStrategyTitle: null,
  suggestedStrategyDescription: null,
  createdAt: '2026-01-09',
  ...overrides,
})

describe('la pareja DOFA de la sección', () => {
  it('resuelve los cuatro cruces permitidos y nada más', () => {
    expect(crossTypeForPair('STRENGTH', 'OPPORTUNITY')).toBe('FO')
    expect(crossTypeForPair('OPPORTUNITY', 'WEAKNESS')).toBe('DO')
    expect(crossTypeForPair('STRENGTH', 'THREAT')).toBe('FA')
    expect(crossTypeForPair('WEAKNESS', 'THREAT')).toBe('DA')
  })

  it('descarta factores del mismo lado y una fortaleza con una debilidad', () => {
    expect(crossTypeForPair('STRENGTH', 'STRENGTH')).toBeNull()
    expect(crossTypeForPair('OPPORTUNITY', 'THREAT')).toBeNull()
    expect(crossTypeForPair('STRENGTH', 'WEAKNESS')).toBeNull()
    expect(isCompatibleCrossPair('THREAT', 'WEAKNESS')).toBe(true)
    expect(isCompatibleCrossPair('STRENGTH', 'WEAKNESS')).toBe(false)
  })

  it('normaliza el texto de una estrategia igual que el servidor', () => {
    expect(normalizeStrategyText('  Abrir   el mercado.  ')).toBe('abrir el mercado.')
    expect(normalizeStrategyText('Abrir el mercado.')).toBe(normalizeStrategyText('  abrir   EL mercado. '))
  })
})

describe('las tarjetas de Cruces y estrategias', () => {
  it('pinta la estrategia del cruce con su botón todavía sin decidir', () => {
    const { entries } = buildCrossStrategyEntries([cross()], [])

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ group: 'user', originLabel: 'Usuario', crossType: 'FO' })
    expect(entries[0].blocks).toHaveLength(1)
    expect(entries[0].blocks[0]).toMatchObject({ owner: 'CROSS', messageId: null, status: 'PENDING', acceptLabel: 'Aceptar estrategia', decidedLabel: null })
  })

  it('deja de ofrecer el botón cuando la estrategia ya se aceptó', () => {
    const { entries } = buildCrossStrategyEntries([cross({ strategyStatus: 'ACCEPTED' })], [])

    expect(entries[0].blocks[0]).toMatchObject({ status: 'ACCEPTED', acceptLabel: null, decidedLabel: 'Aceptada' })
  })

  it('no monta una tarjeta para un cruce sin estrategia escrita', () => {
    const { entries } = buildCrossStrategyEntries([cross({ strategy: null })], [])

    expect(entries).toEqual([])
  })

  it('ignora un cruce que no es pareja DOFA válida, aunque tenga estrategia', () => {
    const { entries } = buildCrossStrategyEntries([cross({ factor2: weakness, crossType: 'DO' })], [])

    expect(entries).toEqual([])
  })

  it('no monta una tarjeta para una propuesta de Checky sin estrategia', () => {
    const { entries } = buildCrossStrategyEntries([cross({ strategy: null })], [message({ suggestedStrategyDescription: '   ' })])

    expect(entries).toEqual([])
  })
})

describe('la propuesta de Checky sobre un cruce existente', () => {
  it('se lee dentro del cruce y sale de la lista de sugerencias', () => {
    const proposed = message({ suggestedStrategyDescription: 'Abrir el mercado con el equipo comprometido.' })
    const { entries, hiddenSuggestionIds } = buildCrossStrategyEntries([cross({ strategy: null })], [proposed])

    expect(entries).toHaveLength(1)
    expect(entries[0].blocks).toHaveLength(1)
    expect(entries[0].blocks[0]).toMatchObject({ owner: 'CHECKY', messageId: proposed.id, status: 'PENDING' })
    expect(hiddenSuggestionIds.has(proposed.id)).toBe(true)
  })

  it('reconoce la propuesta por los dos factores aunque no cite el cruce', () => {
    const proposed = message({ evidenceIds: [strength.id, opportunity.id], suggestedStrategyDescription: 'Pedir cuentas nuevas en el mercado en expansión.' })
    const { entries, hiddenSuggestionIds } = buildCrossStrategyEntries([cross({ strategy: null })], [proposed])

    expect(entries[0].blocks).toHaveLength(1)
    expect(entries[0].blocks[0].owner).toBe('CHECKY')
    expect(hiddenSuggestionIds.has(proposed.id)).toBe(true)
  })

  it('pinta una sola vez cuando el cruce y Checky proponen exactamente la misma estrategia', () => {
    const shared = 'Abrir el mercado con el equipo comprometido.'
    const proposed = message({ suggestedStrategyDescription: '  abrir   EL mercado con el equipo comprometido. ', status: 'ACCEPTED' })
    const { entries, hiddenSuggestionIds } = buildCrossStrategyEntries([cross({ strategy: shared })], [proposed])

    expect(entries).toHaveLength(1)
    expect(entries[0].blocks).toHaveLength(1)
    expect(entries[0].blocks[0]).toMatchObject({ owner: 'CHECKY', messageId: proposed.id, status: 'ACCEPTED' })
    expect(hiddenSuggestionIds.has(proposed.id)).toBe(true)
  })

  it('suma los dos pronunciamientos sobre la misma estrategia en un solo estado', () => {
    const shared = 'Abrir el mercado con el equipo comprometido.'
    const [aceptadaEnCruce, rechazadaEnChecky] = [
      buildCrossStrategyEntries([cross({ strategy: shared, strategyStatus: 'ACCEPTED' })], [message({ suggestedStrategyDescription: shared, status: 'REJECTED' })]).entries[0].blocks[0],
      buildCrossStrategyEntries([cross({ strategy: shared, strategyStatus: 'REJECTED' })], [message({ suggestedStrategyDescription: shared, status: 'ACCEPTED' })]).entries[0].blocks[0],
    ]

    expect(aceptadaEnCruce.status).toBe('ACCEPTED')
    expect(aceptadaEnCruce.acceptLabel).toBeNull()
    expect(rechazadaEnChecky.status).toBe('ACCEPTED')
  })

  it('mantiene separadas las estrategias cuando los textos no son el mismo', () => {
    const proposed = message({ suggestedStrategyDescription: 'Pedir cuentas nuevas cada semana.', status: 'REJECTED' })
    const { entries } = buildCrossStrategyEntries([cross({ strategyStatus: 'ACCEPTED' })], [proposed])

    expect(entries[0].blocks).toHaveLength(2)
    expect(entries[0].blocks.map((block) => [block.owner, block.status])).toEqual([['CROSS', 'ACCEPTED'], ['CHECKY', 'REJECTED']])
  })

  it('no oculta una propuesta que pertenece a otro cruce', () => {
    const other = cross({ id: 'cmcross0000000000000002', crossType: 'DA', origin: 'AI', factor1: weakness, factor2: threat, strategy: null })
    const proposed = message({ evidenceIds: [other.id], suggestedStrategyDescription: 'Documentar los procesos frente a la normativa.' })
    const { entries, hiddenSuggestionIds } = buildCrossStrategyEntries([cross(), other], [proposed])

    expect(entries).toHaveLength(2)
    expect(entries[0].blocks).toHaveLength(1)
    expect(entries[0].blocks[0].owner).toBe('CROSS')
    expect(entries[1].blocks).toHaveLength(1)
    expect(entries[1].blocks[0].owner).toBe('CHECKY')
    expect(hiddenSuggestionIds.has(proposed.id)).toBe(true)
  })

  it('ignora lo que no sea una propuesta con estrategia de Checky', () => {
    const { entries, hiddenSuggestionIds } = buildCrossStrategyEntries(
      [cross({ strategy: null })],
      [message({ role: 'USER', suggestedStrategyDescription: 'Estrategia escrita por la persona.' }), message({ suggestedStrategyDescription: null })],
    )

    expect(entries).toEqual([])
    expect(hiddenSuggestionIds.size).toBe(0)
  })
})

describe('los grupos de origen', () => {
  it('separa lo que creó la persona de lo que propuso la IA o Checky', () => {
    const { entries } = buildCrossStrategyEntries(
      [
        cross({ id: 'cmcross0000000000000001', origin: 'USER' }),
        cross({ id: 'cmcross0000000000000002', origin: 'BOTH' }),
        cross({ id: 'cmcross0000000000000003', origin: 'AI', crossType: 'DA', factor1: weakness, factor2: threat }),
      ],
      [],
    )

    expect(entries.map((entry) => [entry.group, entry.originLabel])).toEqual([
      ['user', 'Usuario'],
      ['user', 'Usuario + IA'],
      ['ai', 'IA / Checky'],
    ])
  })
})

describe('lo que Ponderación deja valorar', () => {
  it('valora la estrategia de un cruce aceptado igual que las de IA y de Checky', () => {
    expect(isWeightableStrategySource('STRATEGIC_CROSS')).toBe(true)
    expect(isWeightableStrategySource('AI_ANALYSIS')).toBe(true)
    expect(isWeightableStrategySource('CHECKY')).toBe(true)
    const sources: StrategySource[] = ['AI_ANALYSIS', 'CHECKY', 'STRATEGIC_CROSS']
    expect(sources.filter(isWeightableStrategySource)).toHaveLength(3)
  })

  it('acepta un cruce creado por la persona y uno propuesto por la IA con la misma respuesta', () => {
    // La función recibe solo la fuente: el origin (USER / IA) ni siquiera llega, así que no puede
    // decidir. Es la misma llamada para un cruce de la persona y para uno de la IA.
    const decide = (source: StrategySource) => isWeightableStrategySource(source)
    expect(decide('STRATEGIC_CROSS')).toBe(true)
    expect(isWeightableStrategySource.length).toBe(1)
  })

  it('no mira si ya tiene valoración: la tarjeta sigue editable con o sin ponderación guardada', () => {
    // El predicado no recibe ponderación, por eso el estado "Sin valoración" no bloquea nada:
    // la tarjeta decide con la fuente, su rol y si está guardando.
    expect(isWeightableStrategySource('STRATEGIC_CROSS')).toBe(true)
    expect(isWeightableStrategySource.length).toBe(1)
  })
})
