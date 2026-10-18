import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RiskAuditEvent, RiskAuditEventType } from '../../types'
import { auditEventMeta, RiskTimelineEntry } from './RiskHistorySection'

const makeEvent = (overrides: Partial<RiskAuditEvent> & { eventType: RiskAuditEventType }): RiskAuditEvent => ({
  id: `audit-${overrides.eventType}`,
  riskId: 'risk-1',
  summary: 'Resumen del evento',
  actorId: 'user-1',
  actor: { id: 'user-1', name: 'Ben Admin' },
  actorName: 'Ben Admin',
  actorEmail: 'admin@audit.test',
  occurredAt: '2026-10-01T09:30:00.000Z',
  changes: [],
  metadata: null,
  ...overrides,
})

const renderEntry = (event: RiskAuditEvent, handlers: { onOpenApproval?: (approvalId: string) => void; onOpenTicket?: (ticketId: string) => void } = {}) =>
  renderToStaticMarkup(<RiskTimelineEntry event={event} {...handlers} />)

describe('RiskTimelineEntry', () => {
  it('pinta el resumen, el tipo, el actor y la fecha del evento', () => {
    const markup = renderEntry(makeEvent({ eventType: 'RISK_CREATED', summary: 'Riesgo MIS-R1 creado' }))
    expect(markup).toContain('Riesgo creado')
    expect(markup).toContain('Riesgo MIS-R1 creado')
    expect(markup).toContain('Ben Admin')
    expect(markup).toContain('admin@audit.test')
    expect(markup).toContain('<time dateTime="2026-10-01T09:30:00.000Z"')
    expect(markup).toContain('Registrado por')
  })

  it('muestra los cambios campo a campo con valor anterior y nuevo', () => {
    const markup = renderEntry(makeEvent({
      eventType: 'RISK_UPDATED',
      summary: 'Riesgo actualizado',
      changes: [
        { field: 'name', label: 'Nombre', previousValue: 'Entrega tardía', newValue: 'Entrega muy tardía' },
        { field: 'treatment', label: 'Tratamiento', previousValue: null, newValue: 'MITIGATE' },
      ],
    }))
    expect(markup).toContain('Nombre')
    expect(markup).toContain('Entrega tardía')
    expect(markup).toContain('Entrega muy tardía')
    expect(markup).toContain('Sin valor')
    expect(markup).toContain('MITIGATE')
  })

  it('refleja el veredicto de la decisión: ✓ aprobado y ✕ rechazado', () => {
    const approved = renderEntry(makeEvent({ eventType: 'APPROVAL_DECIDED', summary: 'Riesgo aprobado', metadata: { approvalId: 'approval-1', decision: 'APPROVED' } }))
    expect(approved).toContain('Decisión de aprobación')
    expect(approved).toContain('>✓</span>')
    const rejected = renderEntry(makeEvent({ eventType: 'APPROVAL_DECIDED', summary: 'Riesgo rechazado', metadata: { approvalId: 'approval-1', decision: 'REJECTED', comment: 'Falta documentar el control.' } }))
    expect(rejected).toContain('>✕</span>')
    expect(rejected).toContain('Falta documentar el control.')
    expect(rejected).not.toContain('>✓</span>')
  })

  it('ofrece los enlaces a la aprobación y al ticket solo con sus manejadores', () => {
    const event = makeEvent({ eventType: 'TICKET_STATUS_CHANGED', summary: 'Estado del ticket: En curso', metadata: { ticketId: 'ticket-1', approvalId: 'approval-1', previousStatus: 'OPEN', status: 'IN_PROGRESS' } })
    const withLinks = renderEntry(event, { onOpenApproval: () => {}, onOpenTicket: () => {} })
    expect(withLinks).toContain('Ver aprobación')
    expect(withLinks).toContain('Ver ticket')
    const withoutHandlers = renderEntry(event)
    expect(withoutHandlers).not.toContain('Ver aprobación')
    expect(withoutHandlers).not.toContain('Ver ticket')
  })

  it('oculta los enlaces cuando el evento no trae identificadores', () => {
    const markup = renderEntry(makeEvent({ eventType: 'CONTROL_DELETED', summary: 'Control eliminado' }), { onOpenApproval: () => {}, onOpenTicket: () => {} })
    expect(markup).not.toContain('Ver aprobación')
    expect(markup).not.toContain('Ver ticket')
  })

  it('usa el glifo del tipo y marca los iconos como decorativos', () => {
    const created = renderEntry(makeEvent({ eventType: 'CONTROL_CREATED', summary: 'Control agregado' }))
    expect(created).toContain('aria-hidden="true"')
    expect(created).toContain('▣')
    const outdated = renderEntry(makeEvent({ eventType: 'APPROVAL_OUTDATED', summary: 'Aprobación marcada para nueva revisión' }))
    expect(outdated).toContain('↻')
    const requested = renderEntry(makeEvent({ eventType: 'APPROVAL_REQUESTED', summary: 'Enviado a aprobación' }))
    expect(requested).toContain('→')
  })

  it('cubre en los metadatos los 13 tipos de evento que emite el backend', () => {
    expect(Object.keys(auditEventMeta)).toEqual([
      'RISK_CREATED', 'RISK_UPDATED',
      'CONTROL_CREATED', 'CONTROL_UPDATED', 'CONTROL_DELETED',
      'EVIDENCE_CREATED', 'EVIDENCE_UPDATED', 'EVIDENCE_DELETED',
      'APPROVAL_REQUESTED', 'APPROVAL_DECIDED', 'APPROVAL_OUTDATED',
      'TICKET_CREATED', 'TICKET_STATUS_CHANGED',
    ])
    for (const meta of Object.values(auditEventMeta)) {
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.glyph.length).toBe(1)
    }
  })
})
