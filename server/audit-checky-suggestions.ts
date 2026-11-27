import { createHash } from 'node:crypto'
import { z } from 'zod'
import { auditCheckySuggestionPayloadSchema } from './validation.js'

export type AuditCheckySuggestionPayload = z.infer<typeof auditCheckySuggestionPayloadSchema>

const normalizeValue = (value: unknown): unknown => {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ').toLowerCase()
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalizeValue(item)]))
  return value
}

export const auditCheckySuggestionDedupeKey = (
  auditId: string,
  findingId: string,
  payload: AuditCheckySuggestionPayload,
  evidenceIds: readonly string[],
): string => createHash('sha256')
  .update(`${auditId}\u0000${findingId}\u0000${JSON.stringify(normalizeValue(payload))}\u0000${[...new Set(evidenceIds)].sort().join(',')}`)
  .digest('hex')
