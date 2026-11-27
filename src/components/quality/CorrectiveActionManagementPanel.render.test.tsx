import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api'
import type { AuditCorrectiveAction, AuditFinding } from '../../types'
import { CorrectiveActionManagementPanel } from './CorrectiveActionManagementPanel'
import { actionCanComplete } from './corrective-action.model'
import { correctiveActionRequestMessage } from './corrective-action-errors'

const finding = { id: 'finding-1', auditId: 'audit-1', title: 'Control documental', description: 'Descripción', type: 'NONCONFORMITY', severity: 'MAJOR', status: 'OPEN' } as unknown as AuditFinding
const action = {
  id: 'action-1', findingId: 'finding-1', title: 'Actualizar procedimiento', description: 'Actualizar el procedimiento vigente.', objective: 'Eliminar recurrencia.', implementationPlan: 'Aprobar y comunicar.', resources: 'Calidad', observations: null,
  responsible: { id: 'user-1', name: 'Auditor', isActive: true }, priority: 'HIGH', status: 'OPEN', required: true, evidenceRequired: true, progressPercent: 100, workflowVersion: 1, dueDate: '2026-12-01T00:00:00.000Z', completedAt: null, progress: [{ id: 'progress-1', actionId: 'action-1', note: 'Avance', activities: 'Documento revisado.', results: null, difficulties: null, pendingActivities: null, observations: null, percent: 100, createdBy: { id: 'user-1', name: 'Auditor', isActive: true }, createdAt: '2026-11-25T12:00:00.000Z' }], acceptanceCriteria: [
    { id: 'criterion-1', actionId: 'action-1', type: 'IMPLEMENTATION', description: 'Control aprobado', expectedResult: 'Existe una versión aprobada.', required: true, isMet: true, observations: null, completedAt: null, completedBy: null, createdBy: null, createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z' },
    { id: 'criterion-2', actionId: 'action-1', type: 'IMPLEMENTATION', description: 'Control comunicado', expectedResult: 'El equipo conoce el control.', required: true, isMet: true, observations: null, completedAt: null, completedBy: null, createdBy: null, createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z' },
    { id: 'criterion-3', actionId: 'action-1', type: 'IMPLEMENTATION', description: 'Control registrado', expectedResult: 'El registro está disponible.', required: true, isMet: true, observations: null, completedAt: null, completedBy: null, createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z' },
    { id: 'criterion-4', actionId: 'action-1', type: 'EFFECTIVENESS', description: 'No hay recurrencia', expectedResult: 'No se repite el hallazgo.', required: true, isMet: false, observations: null, completedAt: null, completedBy: null, createdBy: null, createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z' },
  ], evidences: [{ id: 'evidence-1', auditId: 'audit-1', findingId: 'finding-1', actionId: 'action-1', name: 'Control documental', description: 'URL oficial', url: 'https://example.test/control', createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z' }], evidenceFiles: [{ id: 'file-1', storageState: 'READY' }], createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z',
} as unknown as AuditCorrectiveAction

describe('CorrectiveActionManagementPanel', () => {
  it('renders planning, progress, requirements and evidence sections', () => {
    expect(actionCanComplete(action)).toBe(true)
    const markup = renderToStaticMarkup(<CorrectiveActionManagementPanel auditId="audit-1" finding={finding} actions={[action]} users={[{ id: 'user-1', name: 'Auditor', email: 'auditor@example.com', companyId: 'company-1', role: 'COMPANY_ADMIN', isActive: true }]} canWrite onChanged={vi.fn()} onError={vi.fn()} onNotice={vi.fn()} />)
    expect(markup).toContain('Gestión integral de acciones')
    expect(markup).toContain('Actualizar procedimiento')
    expect(markup).toContain('100%')
    expect(markup).toContain('Criterios de aceptación')
    expect(markup).toContain('Evidencias de implementación')
    expect(markup).toContain('Eficacia')
    expect(markup).toContain('Completar')
  })

  it('preserves rejected API messages for the visible error handler', () => {
    expect(correctiveActionRequestMessage(new ApiError('La acción debe tener un avance del 100%', 409, 'ACTION_COMPLETION_REQUIREMENTS'), 'fallback')).toBe('La acción debe tener un avance del 100%')
    expect(correctiveActionRequestMessage(new Error('unexpected'), 'fallback')).toBe('fallback')
  })

  it('opens the official new-action form with the efficacy evaluation association', () => {
    const markup = renderToStaticMarkup(<CorrectiveActionManagementPanel auditId="audit-1" finding={finding} actions={[action]} users={[]} canWrite onChanged={vi.fn()} onError={vi.fn()} onNotice={vi.fn()} openNewActionForEfficacyId="evaluation-1" />)
    expect(markup).toContain('Nueva acción correctiva integral')
    expect(markup).toContain('Título')
  })
})
