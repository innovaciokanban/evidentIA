export type SwotTextItem = { id: string; description: string }

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Technical references are allowed in structured fields, never in prose. The CUID2 branch is only
 * a fallback for unknown ids; known SWOT ids are always resolved through the real item map first.
 */
const unknownTechnicalReferencePattern = /\b(?:cross:cm[a-z0-9]{10,}|checky:cm[a-z0-9]{10,}|ai:[A-Za-z0-9]+:[A-Z]{1,3}:\d+|strategyRef\.?strat:?[0-9a-f]*|strat:[0-9a-f]+|cm[a-z0-9]{10,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{40,64})\b/gi

/** Replaces known SWOT ids with their human descriptions and removes unknown technical references. */
export const sanitizeTextWithSwotItems = (text: string, swotItems: readonly SwotTextItem[]): string => {
  const replacements = new Map(swotItems.map((item) => [item.id, item.description]))
  const knownIds = [...replacements.keys()].sort((left, right) => right.length - left.length)
  const withKnownIds = knownIds.length === 0
    ? text
    : text.replace(new RegExp(knownIds.map(escapeRegExp).join('|'), 'g'), (match) => replacements.get(match) ?? '')

  return withKnownIds
    .replace(unknownTechnicalReferencePattern, '')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .trim()
}
