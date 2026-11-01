import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TicketAuditEventType, TicketHistoryEvent } from '../../types'
import { TicketHistorySection, TicketTimelineEntry } from './TicketHistorySection'
import { ticketEventMeta, ticketHistoryValue, unknownTicketEventMeta } from './ticket-history-meta'

const makeEvent = (overrides: Partial<TicketHistoryEvent> & { eventType: TicketAuditEventType }): TicketHistoryEvent => ({
  id: `audit-${overrides.eventType}`,
  ticketId: 'tk-abcdef123456',
  summary: 'Resumen del evento',
  actorId: 'user-1',
  actor: { id: 'user-1', name: 'Ana Admin' },
  actorName: 'Ana Admin',
  actorEmail: 'ana@audit.test',
  occurredAt: '2026-10-01T09:30:00.000Z',
  changes: [],
  metadata: null,
  ticket: { id: 'tk-abcdef123456', title: 'Revisar contrato', status: 'IN_PROGRESS', priority: 'HIGH' },
  ...overrides,
})

const renderEntry = (event: TicketHistoryEvent, showTicket = false) => renderToStaticMarkup(<TicketTimelineEntry event={event} showTicket={showTicket} />)

const renderSection = (overrides: Partial<Parameters<typeof TicketHistorySection>[0]> = {}) => renderToStaticMarkup(
  <TicketHistorySection heading={{ eyebrow: 'TRAZABILIDAD', title: 'HISTORIAL DEL TICKET' }} total={1} events={[]} loading={false} error="" onRetry={() => {}} {...overrides} />
)

describe('TicketTimelineEntry', () => {
  it('pinta el resumen, el tipo, el actor y la fecha del evento', () => {
    const markup = renderEntry(makeEvent({ eventType: 'TICKET_STATUS_CHANGED', summary: 'Estado del ticket: En curso' }))
    expect(markup).toContain('Cambio de estado')
    expect(markup).toContain('Estado del ticket: En curso')
    expect(markup).toContain('Registrado por')
    expect(markup).toContain('Ana Admin')
    expect(markup).toContain('ana@audit.test')
    expect(markup).toContain('<time dateTime="2026-10-01T09:30:00.000Z"')
  })

  it('muestra los cambios campo a campo con valor anterior y nuevo', () => {
    const markup = renderEntry(makeEvent({
      eventType: 'TICKET_UPDATED',
      summary: 'Ticket actualizado',
      changes: [
        { field: 'status', label: 'Estado', previousValue: 'OPEN', newValue: 'IN_PROGRESS' },
        { field: 'resolved', label: 'Resuelto', previousValue: null, newValue: true },
        { field: 'archived', label: 'Archivado', previousValue: true, newValue: false },
      ],
    }))
    expect(markup).toContain('Estado')
    expect(markup).toContain('OPEN')
    expect(markup).toContain('IN_PROGRESS')
    expect(markup).toContain('Sin valor')
    expect(markup).toContain('>Sí<')
    expect(markup).toContain('>No<')
    expect(markup).toContain('history-change-list')
  })

  it('usa el glifo del tipo y marca los iconos como decorativos', () => {
    const assigned = renderEntry(makeEvent({ eventType: 'TICKET_ASSIGNED', summary: 'Ticket asignado' }))
    expect(assigned).toContain('aria-hidden="true"')
    expect(assigned).toContain('→')
    const created = renderEntry(makeEvent({ eventType: 'TICKET_CREATED', summary: 'Ticket creado' }))
    expect(created).toContain('+')
    const unassigned = renderEntry(makeEvent({ eventType: 'TICKET_UNASSIGNED', summary: 'Ticket desasignado' }))
    expect(unassigned).toContain('←')
  })

  it('renderiza los cinco eventos del ciclo de aprobación de asignaciones', () => {
    const events: Array<[TicketAuditEventType, string, string]> = [
      ['TICKET_ASSIGNMENT_REQUESTED', 'Solicitud de asignación', '↗'],
      ['TICKET_ASSIGNMENT_ACCEPTED', 'Asignación aceptada', '✓'],
      ['TICKET_ASSIGNMENT_REJECTED', 'Asignación rechazada', '×'],
      ['TICKET_ASSIGNMENT_CANCELLED', 'Solicitud cancelada', '−'],
      ['TICKET_ASSIGNMENT_SUPERSEDED', 'Solicitud reemplazada', '↻'],
    ]
    for (const [eventType, label, glyph] of events) {
      const markup = renderEntry(makeEvent({ eventType, summary: label }))
      expect(markup).toContain(label)
      expect(markup).toContain(glyph)
    }
  })

  it('usa metadatos de respaldo para un evento desconocido sin lanzar una excepción', () => {
    const unknown = renderEntry(makeEvent({ eventType: 'TICKET_ASSIGNMENT_UNKNOWN' as TicketAuditEventType, summary: 'Evento futuro' }))
    expect(unknown).toContain(unknownTicketEventMeta.label)
    expect(unknown).toContain(unknownTicketEventMeta.glyph)
    expect(unknown).toContain('Evento futuro')
  })

  it('pinta código, título y estado/prioridad del ticket solo con showTicket', () => {
    const withTicket = renderEntry(makeEvent({ eventType: 'TICKET_CREATED', summary: 'Ticket creado' }), true)
    expect(withTicket).toContain('#123456 · Revisar contrato')
    expect(withTicket).toContain('badge status in_progress')
    expect(withTicket).toContain('En progreso')
    expect(withTicket).toContain('badge priority high')
    expect(withTicket).toContain('Alta')
    const withoutTicket = renderEntry(makeEvent({ eventType: 'TICKET_CREATED', summary: 'Ticket creado' }))
    expect(withoutTicket).not.toContain('Revisar contrato')
    expect(withoutTicket).not.toContain('ticket-history-flags')
  })

  it('muestra el ticket eliminado con su código cuando ya no existe', () => {
    const deletedWithId = renderEntry(makeEvent({ eventType: 'TICKET_DELETED', summary: 'Ticket eliminado', ticket: undefined, ticketTitle: null }), true)
    expect(deletedWithId).toContain('#123456 · Ticket eliminado')
    expect(deletedWithId).not.toContain('badge status')
    const deletedWithoutId = renderEntry(makeEvent({ eventType: 'TICKET_DELETED', summary: 'Ticket eliminado', ticketId: null, ticket: undefined, ticketTitle: null }), true)
    expect(deletedWithoutId).toContain('Ticket eliminado')
    expect(deletedWithoutId).not.toContain('#')
  })

  it('usa la clase de chip compartida con el historial de riesgos', () => {
    expect(renderEntry(makeEvent({ eventType: 'TICKET_CREATED', summary: 'Creado' }))).toContain('risk-history-chip-ticket_created')
    expect(renderEntry(makeEvent({ eventType: 'EVIDENCE_ATTACHED', summary: 'Evidencia' }))).toContain('risk-history-chip-evidence_attached')
    expect(renderEntry(makeEvent({ eventType: 'EVIDENCE_DELETED', summary: 'Evidencia quitada' }))).toContain('risk-history-chip-evidence_deleted')
    expect(renderEntry(makeEvent({ eventType: 'TICKET_DELETED', summary: 'Eliminado' }))).toContain('risk-history-chip-ticket_deleted')
  })

  it('cubre en los metadatos todos los tipos de evento que emite el backend', () => {
    expect(Object.keys(ticketEventMeta)).toEqual([
      'TICKET_CREATED', 'TICKET_UPDATED',
      'TICKET_ASSIGNED',
      'TICKET_ASSIGNMENT_REQUESTED', 'TICKET_ASSIGNMENT_ACCEPTED', 'TICKET_ASSIGNMENT_REJECTED',
      'TICKET_ASSIGNMENT_CANCELLED', 'TICKET_ASSIGNMENT_SUPERSEDED',
      'TICKET_UNASSIGNED',
      'TICKET_STATUS_CHANGED', 'TICKET_PRIORITY_CHANGED', 'TICKET_DUE_DATE_CHANGED',
      'EVIDENCE_ATTACHED', 'EVIDENCE_DELETED',
      'TICKET_DELETED',
    ])
    for (const meta of Object.values(ticketEventMeta)) {
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.glyph.length).toBe(1)
    }
  })
})

describe('ticketHistoryValue', () => {
  it('representa vacíos, booleanos y textos como en el historial de riesgos', () => {
    expect(ticketHistoryValue(null)).toBe('Sin valor')
    expect(ticketHistoryValue('')).toBe('Sin valor')
    expect(ticketHistoryValue(true)).toBe('Sí')
    expect(ticketHistoryValue(false)).toBe('No')
    expect(ticketHistoryValue('EN_CURSO')).toBe('EN_CURSO')
    expect(ticketHistoryValue(42)).toBe('42')
  })
})

describe('TicketHistorySection', () => {
  it('renderiza el encabezado de trazabilidad con el colapso accesible', () => {
    const markup = renderSection()
    expect(markup).toContain('panel risk-history-section')
    expect(markup).toContain('TRAZABILIDAD')
    expect(markup).toContain('HISTORIAL DEL TICKET')
    const controls = markup.match(/aria-controls="([^"]+)"/)
    const listId = markup.match(/ id="([^"]+)"/)
    expect(controls).not.toBeNull()
    expect(listId).not.toBeNull()
    expect(controls?.[1]).toBe(listId?.[1])
    expect(markup).not.toContain(' hidden')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('Ocultar historial')
  })

  it('muestra el conteo de eventos cuando se pide', () => {
    expect(renderSection({ total: 12, showCount: true })).toContain('12 eventos')
    expect(renderSection({ total: 1, showCount: true })).toContain('1 evento')
    expect(renderSection({ total: 12 })).not.toContain('risk-history-count')
  })

  it('pinta los estados de carga, error y vacío como el historial de riesgos', () => {
    const loading = renderSection({ loading: true })
    expect(loading).toContain('Cargando historial...')
    expect(loading).not.toContain('risk-history-entry')
    const error = renderSection({ error: 'No pudimos cargar el historial.', events: [makeEvent({ eventType: 'TICKET_CREATED', summary: 'Creado' })] })
    expect(error).toContain('form-error page-alert')
    expect(error).toContain('No pudimos cargar el historial.')
    expect(error).toContain('Reintentar')
    expect(error).toContain('risk-history-entry')
    const empty = renderSection({ emptyMessage: 'Los cambios del ticket aparecerán aquí.' })
    expect(empty).toContain('risk-history-empty')
    expect(empty).toContain('history-empty-icon')
    expect(empty).toContain('Los cambios del ticket aparecerán aquí.')
  })

  it('pinta la lista con la línea de tiempo y las banderas del ticket en la vista global', () => {
    const markup = renderSection({ events: [makeEvent({ eventType: 'TICKET_ASSIGNED', summary: 'Ticket asignado' })], showTicket: true })
    expect(markup).toContain('risk-history-list')
    expect(markup).toContain('risk-history-entry')
    expect(markup).toContain('Ticket asignado')
    expect(markup).toContain('#123456 · Revisar contrato')
    const detail = renderSection({ events: [makeEvent({ eventType: 'TICKET_ASSIGNED', summary: 'Ticket asignado' })] })
    expect(detail).not.toContain('Revisar contrato')
  })

  it('ofrece "Cargar más" con el contador solo cuando quedan eventos por traer', () => {
    const more = renderSection({ total: 5, events: [makeEvent({ eventType: 'TICKET_CREATED', summary: 'Creado' })], onLoadMore: () => {} })
    expect(more).toContain('Cargar más')
    expect(more).toContain('Mostrando 1 de 5')
    const busy = renderSection({ total: 5, loadingMore: true, events: [makeEvent({ eventType: 'TICKET_CREATED', summary: 'Creado' })], onLoadMore: () => {} })
    expect(busy).toContain('Cargando...')
    expect(busy).toContain('disabled=""')
    const complete = renderSection({ total: 1, events: [makeEvent({ eventType: 'TICKET_CREATED', summary: 'Creado' })], onLoadMore: () => {} })
    expect(complete).not.toContain('Cargar más')
    const detail = renderSection({ total: 5, events: [makeEvent({ eventType: 'TICKET_CREATED', summary: 'Creado' })] })
    expect(detail).not.toContain('Cargar más')
    expect(detail).not.toContain('Mostrando')
  })

  it('mantiene los filtros del contenedor visibles junto a la sección', () => {
    const markup = renderSection({ filters: <div className="risk-evidence-block ticket-history-filter-block"><span>FILTROS</span></div> })
    expect(markup).toContain('ticket-history-filter-block')
    expect(markup).toContain('FILTROS')
  })
})
