import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AuditCorrectiveAction, AuditFinding } from '../../types'
import { RootCauseActionLinksPanel } from './RootCauseActionLinksPanel'

const finding = {
  id: 'finding-1',
  auditId: 'audit-1',
  title: 'Control documental incompleto',
  description: 'No se encontró el registro firmado.',
  status: 'OPEN',
} as unknown as AuditFinding

const action = {
  id: 'action-1',
  findingId: 'finding-1',
  title: 'Actualizar procedimiento',
  description: 'Actualizar el procedimiento vigente.',
  status: 'OPEN',
  priority: 'HIGH',
  required: true,
  responsible: { id: 'user-1', name: 'Laura Gómez', isActive: true },
  progress: [],
} as unknown as AuditCorrectiveAction

describe('RootCauseActionLinksPanel', () => {
  it('renders a loading workspace without fabricating causes or associations', () => {
    const markup = renderToStaticMarkup(
      <RootCauseActionLinksPanel
        auditId="audit-1"
        finding={finding}
        actions={[action]}
        canWrite
        onChanged={vi.fn()}
        onError={vi.fn()}
        onNotice={vi.fn()}
      />,
    )
    expect(markup).toContain('Causas y acciones correctivas')
    expect(markup).toContain('Cargando vinculaciones')
  })
})
