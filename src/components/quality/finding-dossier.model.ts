import type { AuditEvent, AuditImmediateCorrection } from '../../types'

export type ImmediateCorrectionCancellationDetail = {
  justification: string
  previousObservations: string | null
}

export const cancellationDetailsFromHistory = (events: AuditEvent[]): Record<string, ImmediateCorrectionCancellationDetail> => {
  const details: Record<string, ImmediateCorrectionCancellationDetail> = {}
  for (const event of events) {
    if (event.eventType !== 'IMMEDIATE_CORRECTION_STATUS_CHANGED') continue
    const metadata = event.metadata
    const correctionId = typeof metadata?.correctionId === 'string' ? metadata.correctionId : null
    const justification = typeof metadata?.justification === 'string' ? metadata.justification : null
    if (!correctionId || metadata?.newStatus !== 'CANCELLED' || !justification) continue
    const observationChange = event.changes.find((change) => change.field === 'observations')
    const previousValue = observationChange?.previousValue
    details[correctionId] = {
      justification,
      previousObservations: typeof previousValue === 'string' ? previousValue : previousValue == null ? null : String(previousValue),
    }
  }
  return details
}

export const immediateCorrectionPresentation = (correction: AuditImmediateCorrection, cancellationDetail?: ImmediateCorrectionCancellationDetail) => ({
  containmentMeasures: correction.containmentMeasures?.trim() || 'Sin registrar',
  consequencesIdentified: correction.consequencesIdentified?.trim() || 'Sin registrar',
  consequencesTreatment: correction.consequencesTreatment?.trim() || 'Sin registrar',
  observations: (cancellationDetail?.previousObservations ?? correction.observations)?.trim() || 'Sin registrar',
  cancellationJustification: cancellationDetail?.justification.trim() || null,
})
