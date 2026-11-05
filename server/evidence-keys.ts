import { randomUUID } from 'node:crypto'

export type EvidenceModule = 'audits' | 'tickets'

export type EvidenceObjectKeyContext = {
  companyId: string
  module: EvidenceModule
  resourceId: string
}

const safeSegment = (value: string): string => {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]/g, '_')
  if (!sanitized || sanitized === '.' || sanitized === '..') throw new Error('Invalid evidence key segment')
  return sanitized
}

/** Object keys are opaque and scoped by tenant, module and parent resource. */
export const nextEvidenceObjectKey = (input: EvidenceObjectKeyContext): string =>
  `evidentia/${safeSegment(input.companyId)}/${input.module}/${safeSegment(input.resourceId)}/${randomUUID()}.pdf`

/** Existing R2 objects must remain inside the tenant/module/resource namespace that owns them. */
export const isEvidenceObjectKeyFor = (storedName: string | null | undefined, input: EvidenceObjectKeyContext): boolean => {
  if (!storedName) return false
  const prefix = `evidentia/${safeSegment(input.companyId)}/${input.module}/${safeSegment(input.resourceId)}/`
  const objectName = storedName.slice(prefix.length)
  return storedName.startsWith(prefix) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i.test(objectName)
}
