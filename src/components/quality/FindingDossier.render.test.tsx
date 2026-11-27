import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AuditEvent, AuditFinding, AuditImmediateCorrection } from '../../types'
import { FindingDossier } from './FindingDossier'
import { cancellationDetailsFromHistory, immediateCorrectionPresentation } from './finding-dossier.model'

const finding = {
  id: 'finding-1',
  auditId: 'audit-1',
  title: 'Registro de capacitación incompleto',
  description: 'No se encontró el registro firmado.',
  type: 'NONCONFORMITY',
  severity: 'MAJOR',
  status: 'OPEN',
  responsible: { id: 'user-1', name: 'Laura Gómez', isActive: true },
  item: { id: 'item-1', description: '¿Se documenta el proceso?', checklistId: 'checklist-1' },
  process: { id: 'process-1', code: 'PROC-01', name: 'Operación' },
} as unknown as AuditFinding

describe('FindingDossier rendering', () => {
  it('exposes the official finding context and immediate correction workspace', () => {
    const markup = renderToStaticMarkup(
      <FindingDossier
        auditId="audit-1"
        finding={finding}
        users={[{ id: 'user-1', name: 'Laura Gómez', isActive: true, companyId: 'company-1' }]}
        canWrite
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onError={vi.fn()}
        onNotice={vi.fn()}
      />,
    )
    expect(markup).toContain('EXPEDIENTE DEL HALLAZGO')
    expect(markup).toContain('Registro de capacitación incompleto')
    expect(markup).toContain('Correcciones inmediatas')
    expect(markup).toContain('Cargando correcciones')
  })

  it('keeps consequence fields and empty observations independent', () => {
    const correction = {
      consequencesIdentified: 'Lote retenido',
      consequencesTreatment: 'Revisión adicional',
      containmentMeasures: 'Aislamiento preventivo',
      observations: null,
    } as unknown as AuditImmediateCorrection
    const presentation = immediateCorrectionPresentation(correction)
    expect(presentation).toMatchObject({
      containmentMeasures: 'Aislamiento preventivo',
      consequencesIdentified: 'Lote retenido',
      consequencesTreatment: 'Revisión adicional',
      observations: 'Sin registrar',
      cancellationJustification: null,
    })
  })

  it('separates cancellation justification using structured history metadata', () => {
    const event = {
      eventType: 'IMMEDIATE_CORRECTION_STATUS_CHANGED',
      metadata: { correctionId: 'correction-1', newStatus: 'CANCELLED', justification: 'La medida dejó de ser necesaria.' },
      changes: [{ field: 'observations', previousValue: 'Observación original', newValue: 'Observación original\nJustificación de cancelación: La medida dejó de ser necesaria.' }],
    } as unknown as AuditEvent
    const details = cancellationDetailsFromHistory([event])
    const presentation = immediateCorrectionPresentation({ observations: 'Observación original\nJustificación de cancelación: La medida dejó de ser necesaria.' } as unknown as AuditImmediateCorrection, details['correction-1'])
    expect(presentation.observations).toBe('Observación original')
    expect(presentation.cancellationJustification).toBe('La medida dejó de ser necesaria.')
  })
})
