import { createHash } from 'node:crypto'
import { z } from 'zod'
import { strategicObjectiveSuggestionPayloadSchema, strategicObjectiveSuggestionStrategyRefsSchema } from './validation.js'

export type StrategicObjectiveSuggestionPayload = z.infer<typeof strategicObjectiveSuggestionPayloadSchema>

const normalizeText = (value: string | null): string | null => value === null ? null : value.trim().replace(/\s+/g, ' ').toLowerCase()

const normalizedPayloadOf = (payload: StrategicObjectiveSuggestionPayload) => ({
  title: normalizeText(payload.title),
  statement: normalizeText(payload.statement),
  specificCriteria: normalizeText(payload.specificCriteria),
  measurableCriteria: normalizeText(payload.measurableCriteria),
  achievableCriteria: normalizeText(payload.achievableCriteria),
  relevantCriteria: normalizeText(payload.relevantCriteria),
  timeBoundCriteria: normalizeText(payload.timeBoundCriteria),
  indicators: (payload.indicators && payload.indicators.length > 0 ? payload.indicators : payload.indicator ? [payload.indicator] : []).map((indicator) => ({
    name: normalizeText(indicator.name),
    description: normalizeText(indicator.description ?? null),
    frequency: normalizeText(indicator.frequency ?? null),
    formula: normalizeText(indicator.formula ?? null),
    dataSource: normalizeText(indicator.dataSource ?? null),
    unit: normalizeText(indicator.unit),
    reportResponsibleId: indicator.reportResponsibleId ?? null,
    monitorResponsibleId: indicator.monitorResponsibleId ?? null,
    greenThreshold: normalizeText(indicator.greenThreshold ?? null),
    yellowThreshold: normalizeText(indicator.yellowThreshold ?? null),
    redThreshold: normalizeText(indicator.redThreshold ?? null),
    baselineValue: normalizeText(indicator.baselineValue),
    targetValue: normalizeText(indicator.targetValue),
    measurementMethod: normalizeText(indicator.measurementMethod),
    deadline: indicator.deadline,
  })),
})

/**
 * Canonical proposal content used for duplicate detection. Strategy references are sorted because
 * their order is not meaningful, while the proposal fields retain their explicit structure.
 */
export const normalizeStrategicObjectiveSuggestion = (
  payload: StrategicObjectiveSuggestionPayload,
  strategyRefs: readonly string[],
): string => {
  const parsedPayload = strategicObjectiveSuggestionPayloadSchema.parse(payload)
  const parsedRefs = strategicObjectiveSuggestionStrategyRefsSchema.parse([...strategyRefs])
  return JSON.stringify({
    payload: normalizedPayloadOf(parsedPayload),
    strategyRefs: [...new Set(parsedRefs.map((ref) => ref.trim()))].sort(),
  })
}

/**
 * The diagnostic is part of the hash as well as the database unique key. This keeps the key
 * deterministic when the same proposal is generated for two tenants and prevents callers from
 * accidentally treating a proposal from another diagnostic as the same record.
 */
export const strategicObjectiveSuggestionDedupeKey = (
  diagnosticId: string,
  payload: StrategicObjectiveSuggestionPayload,
  strategyRefs: readonly string[],
): string => createHash('sha256')
  .update(`${diagnosticId}\u0000${normalizeStrategicObjectiveSuggestion(payload, strategyRefs)}`)
  .digest('hex')
