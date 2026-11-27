import { describe, expect, it } from 'vitest'
import type { Audit, AuditEvent } from '../../types'
import { auditHistoryChangeValue, auditHistoryPresentation, auditHistoryValue, formatAuditDateTime } from './audit-history.model'

const audit = {
  checklists: [{ items: [{ id: 'item-1', description: 'Verificar direccionamiento' }] }],
  evidences: [{ id: 'evidence-1', name: 'Acta de revisión' }],
  evidenceFiles: [{ id: 'file-1', filename: 'acta.pdf' }],
  findings: [{ id: 'finding-1', title: 'Hallazgo de control' }],
} as unknown as Audit

const event = (eventType: AuditEvent['eventType'], summary: string): AuditEvent => ({
  id: 'event-1',
  auditId: 'audit-1',
  eventType,
  summary,
  actorId: 'user-1',
  actor: { id: 'user-1', name: 'Auditor', isActive: true },
  actorName: 'Auditor',
  actorEmail: 'auditor@example.com',
  occurredAt: '2026-11-22T12:00:00.000Z',
  changes: [],
  metadata: null,
})

describe('audit history presentation', () => {
  it('translates execution events and keeps the activity name', () => {
    expect(auditHistoryPresentation(event('AUDIT_PLAN_ACTIVITY_EXECUTION_COMPLETED', 'Ejecución completada: Revisión de Direccionamiento estratégico'))).toEqual({
      title: 'Actividad completada',
      detail: 'Revisión de Direccionamiento estratégico',
    })
  })

  it('resolves known resource names and preserves unknown IDs', () => {
    expect(auditHistoryValue(['item-1', 'item-unknown'], 'checklistItems', audit)).toBe('Verificar direccionamiento · item-unknown')
    expect(auditHistoryValue(['finding-1'], 'findings', audit)).toBe('Hallazgo de control')
  })

  it('translates execution results and dates', () => {
    expect(auditHistoryValue('ISSUE', 'executionResult', audit)).toBe('Con incidencia')
    expect(auditHistoryValue('2026-11-22T12:00:00.000Z', 'actualStart', audit)).toContain('2026')
  })

  it('keeps calendar dates stable and formats real instants in the official timezone', () => {
    expect(auditHistoryValue('2026-11-25', 'plannedDate', audit)).toContain('25')
    expect(auditHistoryValue('2026-11-25', 'executedAt', audit)).toContain('25')
    expect(formatAuditDateTime('2026-11-25T04:30:00.000Z')).toContain('24')
  })

  it('uses the status event instant for completed correction execution time', () => {
    const completed = event('IMMEDIATE_CORRECTION_STATUS_CHANGED', 'Corrección inmediata «Contención» completada')
    completed.occurredAt = '2026-11-25T04:30:00.000Z'
    completed.metadata = { newStatus: 'COMPLETED' }
    const change = { field: 'executedAt', previousValue: null, newValue: '2026-11-25' }
    expect(auditHistoryChangeValue(completed, change, audit)).toContain('24')
  })

  it('presents immediate correction events as finding response activity', () => {
    expect(auditHistoryPresentation(event('IMMEDIATE_CORRECTION_STATUS_CHANGED', 'Corrección inmediata «Aislar lote afectado» completada'))).toEqual({
      title: 'Estado de corrección inmediata',
      detail: 'Aislar lote afectado · completada',
    })
  })

  it('translates root cause summaries and keeps structured identifiers technical', () => {
    const confirmed = event('ROOT_CAUSE_ANALYSIS_STATUS_CHANGED', 'Root cause analysis confirmed')
    confirmed.metadata = { findingId: 'finding-1', analysisId: 'analysis-1', newStatus: 'CONFIRMED' }
    expect(auditHistoryPresentation(confirmed)).toEqual({ title: 'Análisis de causa raíz confirmado', detail: '' })
    expect(auditHistoryValue('ISHIKAWA', 'methodology', audit)).toBe('Ishikawa')

    const step = event('ROOT_CAUSE_FIVE_WHY_STEP_UPDATED', 'Five Whys step 3 updated')
    expect(auditHistoryPresentation(step)).toEqual({ title: 'Paso Five Whys actualizado', detail: 'Paso 3' })
  })

  it('translates corrective action cause link events', () => {
    expect(auditHistoryPresentation(event('CORRECTIVE_ACTION_CAUSE_LINKED', 'Root cause linked to corrective action "Actualizar procedimiento"'))).toEqual({
      title: 'Causa raíz vinculada a acción correctiva',
      detail: 'Acción: Actualizar procedimiento',
    })
    expect(auditHistoryPresentation(event('CORRECTIVE_ACTION_CAUSE_UNLINKED', 'Root cause unlinked from corrective action "Actualizar procedimiento"'))).toEqual({
      title: 'Causa raíz desvinculada de acción correctiva',
      detail: 'Acción: Actualizar procedimiento',
    })
  })
})
