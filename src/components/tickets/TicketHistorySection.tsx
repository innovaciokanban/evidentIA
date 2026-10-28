import { useId, useState, type ReactNode } from 'react'
import type { TicketHistoryEvent } from '../../types'
import { Badge } from '../ui/Badge'
import { ticketEventMeta, ticketHistoryValue } from './ticket-history-meta'

const dateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Línea individual del historial (componente puro, sin estado): reutiliza las clases del
 * historial de riesgos (risk-history-entry, chip, actor y cambios campo a campo). Con
 * showTicket pinta además el código, el título y el estado/prioridad actuales del ticket
 * tal como los mostraba la tabla anterior de la vista global.
 */
export function TicketTimelineEntry({ event, showTicket = false }: { event: TicketHistoryEvent; showTicket?: boolean }) {
  const meta = ticketEventMeta[event.eventType]
  const ticket = event.ticket
  const ticketCode = event.ticketId ? `#${event.ticketId.slice(-6).toUpperCase()}` : '—'
  const ticketTitle = ticket?.title ?? event.ticketTitle ?? 'Ticket eliminado'
  const comment = event.metadata?.comment
  return (
    <article className="risk-history-entry">
      <div className="risk-history-marker" aria-hidden="true"><span className="risk-history-glyph">{meta.glyph}</span></div>
      <div className="risk-history-body">
        <header className="risk-history-header">
          <div>
            <span className={`risk-history-chip risk-history-chip-${event.eventType.toLowerCase()}`}>{meta.label}</span>
            <h3>{event.summary}</h3>
            {showTicket && <strong className="ticket-history-ticket">{event.ticketId ? `${ticketCode} · ${ticketTitle}` : ticketTitle}</strong>}
            {showTicket && ticket && (
              <div className="ticket-history-flags">
                <Badge type="status" value={ticket.status} />
                <Badge type="priority" value={ticket.priority} />
              </div>
            )}
          </div>
          <time dateTime={event.occurredAt}>{dateFormatter.format(new Date(event.occurredAt))}</time>
        </header>
        <p className="risk-history-actor">Registrado por: <strong>{event.actorName ?? event.actor?.name ?? 'Sistema'}</strong>{event.actorEmail && <span> · {event.actorEmail}</span>}</p>
        {event.changes.length > 0 && (
          <div className="history-change-list">
            {event.changes.map((change) => (
              <div className="history-change" key={`${event.id}-${change.field}`}>
                <span>{change.label}</span>
                <strong>{ticketHistoryValue(change.previousValue)}</strong>
                <b aria-hidden="true">→</b>
                <strong>{ticketHistoryValue(change.newValue)}</strong>
              </div>
            ))}
          </div>
        )}
        {typeof comment === 'string' && comment.length > 0 && <p className="risk-history-comment">Motivo: «{comment}»</p>}
      </div>
    </article>
  )
}

/**
 * Sección de trazabilidad de tickets con el mismo patrón visual e interacción que
 * RiskHistorySection: encabezado con colapso (aria-expanded/aria-controls), estados de
 * carga/error/vacío compartidos y paginación incremental "Cargar más". Los datos, filtros,
 * permisos y endpoints se mantienen: quien controla la consulta es el componente contenedor
 * (la vista global o el detalle del ticket) y aquí solo se presentan.
 */
export function TicketHistorySection({ heading, total, events, loading, loadingMore = false, error, showTicket = false, filters, emptyMessage, ariaLabel, showCount = false, onRetry, onLoadMore }: {
  heading: { eyebrow: string; title: string }
  total: number
  events: TicketHistoryEvent[]
  loading: boolean
  loadingMore?: boolean
  error: string
  showTicket?: boolean
  filters?: ReactNode
  emptyMessage?: string
  ariaLabel?: string
  showCount?: boolean
  onRetry: () => void
  onLoadMore?: () => void
}) {
  const [open, setOpen] = useState(true)
  const listId = useId()
  return (
    <section className="panel risk-history-section" aria-label={ariaLabel}>
      <div className="panel-heading risk-history-heading">
        <div>
          <p className="detail-label">{heading.eyebrow}</p>
          <h2>{heading.title}</h2>
        </div>
        <div className="risk-history-tools">
          {showCount && !loading && !error && <span className="risk-history-count">{total} {total === 1 ? 'evento' : 'eventos'}</span>}
          <button type="button" className="text-button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((current) => !current)}>
            {open ? 'Ocultar historial' : 'Ver historial'}
          </button>
        </div>
      </div>
      {filters}
      <div id={listId} hidden={!open}>
        {error && <div className="form-error page-alert" role="alert"><span>{error}</span><button type="button" className="button secondary small-button" onClick={onRetry}>Reintentar</button></div>}
        {loading ? (
          <div className="inline-loading"><span className="loader" />Cargando historial...</div>
        ) : !error && events.length === 0 ? (
          <div className="risk-history-empty">
            <span className="history-empty-icon" aria-hidden="true">◷</span>
            <p>{emptyMessage ?? 'Todavía no hay eventos registrados en este ticket.'}</p>
          </div>
        ) : (
          <>
            <div className="risk-history-list">
              {events.map((event) => (
                <TicketTimelineEntry key={event.id} event={event} showTicket={showTicket} />
              ))}
            </div>
            {onLoadMore && events.length < total && (
              <div className="risk-history-more">
                <button type="button" className="button secondary small-button" disabled={loadingMore} onClick={onLoadMore}>
                  {loadingMore ? 'Cargando...' : 'Cargar más'}
                </button>
                <span>Mostrando {events.length} de {total}</span>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
