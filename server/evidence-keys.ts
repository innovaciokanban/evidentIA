import { randomUUID } from 'node:crypto'

export type EvidenceModule = 'audits' | 'tickets'

const safeSegment = (value: string): string => {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]/g, '_')
  if (!sanitized || sanitized === '.' || sanitized === '..') throw new Error('Invalid evidence key segment')
  return sanitized
}

/** Object keys are opaque and scoped by tenant, module and parent resource. */
export const nextEvidenceObjectKey = (input: { companyId: string; module: EvidenceModule; resourceId: string }): string =>
  `evidentia/${safeSegment(input.companyId)}/${input.module}/${safeSegment(input.resourceId)}/${randomUUID()}.pdf`
