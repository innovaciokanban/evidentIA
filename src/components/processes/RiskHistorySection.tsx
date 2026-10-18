import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api'
import type { ProcessChangeValue, RiskAuditEvent, RiskAuditEventType } from '../../types'

const dateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

const valueLabel = (value: ProcessChangeValue) => {
  if (value === null || value === '') return 'Sin valor'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return value
}

/**
 * Presentación de cada tipo de evento del historial. El glifo es decorativo (aria-hidden) y el
 * título de la línea usa el resumen que ya trae el backend. En las decisiones, el glifo refleja
 * el veredicto: ✓ aprobado / ✕ rechazado.
 */
export const auditEventMeta: Record<RiskAuditEventType, { label: string; glyph: string }> = {
  RISK_CREATED: { label: 'Riesgo creado', glyph: '+' },
  RISK_UPDATED: { label: 'Riesgo actualizado', glyph: '✎' },
  CONTROL_CREATED: { label: 'Control agregado', glyph: '▣' },
  CONTROL_UPDATED: { label: 'Control modificado', glyph: '✎' },
  CONTROL_DELETED: { label: 'Control eliminado', glyph: '−' },
  EVIDENCE_CREATED: { label: 'Evidencia agregada', glyph: '▣' },
  EVIDENCE_UPDATED: { label: 'Evidencia actualizada', glyph: '✎' },
  EVIDENCE_DELETED: { label: 'Evidencia eliminada', glyph: '−' },
  APPROVAL_REQUESTED: { label: 'Solicitud de aprobación', glyph: '→' },
  APPROVAL_DECIDED: { label: 'Decisión de aprobación', glyph: '✓' },
  APPROVAL_OUTDATED: { label: 'Aprobación para nueva revisión', glyph: '↻' },
  TICKET_CREATED: { label: 'Ticket de seguimiento', glyph: '▤' },
  TICKET_STATUS_CHANGED: { label: 'Cambio de estado del ticket', glyph: '↕' },
}

const auditGlyph = (event: RiskAuditEvent): string => {
  if (event.eventType === 'APPROVAL_DECIDED' && event.metadata?.decision === 'REJECTED') return '✕'
  return auditEventMeta[event.eventType].glyph
}

/**
 * Línea individual del historial (componente puro, sin estado): se usa desde RiskHistorySection y
 * es la pieza que cubren las pruebas de render. Los enlaces a la aprobación o al ticket de origen
 * solo aparecen cuando el evento trae el identificador y la ruta pasó su manejador.
 */
export function RiskTimelineEntry({ event, onOpenApproval, onOpenTicket }: {
  event: RiskAuditEvent
  onOpenApproval?: (approvalId: string) => void
  onOpenTicket?: (ticketId: string) => void
}) {
  const meta = auditEventMeta[event.eventType]
  const approvalId = event.metadata?.approvalId
  const ticketId = event.metadata?.ticketId
  return (
    <article className="risk-history-entry">
      <div className="risk-history-marker" aria-hidden="true"><span className="risk-history-glyph">{auditGlyph(event)}</span></div>
      <div className="risk-history-body">
        <header className="risk-history-header">
          <div>
            <span className={`risk-history-chip risk-history-chip-${event.eventType.toLowerCase()}`}>{meta.label}</span>
            <h3>{event.summary}</h3>
          </div>
          <time dateTime={event.occurredAt}>{dateFormatter.format(new Date(event.occurredAt))}</time>
        </header>
        <p className="risk-history-actor">Registrado por: <strong>{event.actorName ?? event.actor?.name ?? 'Sistema'}</strong>{event.actorEmail && <span> · {event.actorEmail}</span>}</p>
        {event.changes.length > 0 && (
          <div className="history-change-list">
            {event.changes.map((change) => (
              <div className="history-change" key={`${event.id}-${change.field}`}>
                <span>{change.label}</span>
                <strong>{valueLabel(change.previousValue)}</strong>
                <b aria-hidden="true">→</b>
                <strong>{valueLabel(change.newValue)}</strong>
              </div>
            ))}
          </div>
        )}
        {event.metadata?.comment && <p className="risk-history-comment">Motivo: «{event.metadata.comment}»</p>}
        {(approvalId || ticketId) && (onOpenApproval || onOpenTicket) && (
          <div className="risk-history-links">
            {approvalId && onOpenApproval && <button type="button" className="text-button" onClick={() => onOpenApproval(approvalId)}>Ver aprobación</button>}
            {ticketId && onOpenTicket && <button type="button" className="text-button" onClick={() => onOpenTicket(ticketId)}>Ver ticket</button>}
          </div>
        )}
      </div>
    </article>
  )
}

const PAGE_SIZE = 10

/**
 * Sección "Historial / Trazabilidad" del detalle del riesgo: consulta paginada del ciclo de vida
 * (creación, cambios, controles, evidencias, aprobaciones y tickets) con filtro por tipo de evento.
 * Es de solo lectura: no existe acción de escritura sobre los eventos en la interfaz.
 */
export function RiskHistorySection({ processId, riskId, refreshVersion = 0, onOpenApproval, onOpenTicket }: {
  processId: string
  riskId: string
  refreshVersion?: number
  onOpenApproval?: (approvalId: string) => void
  onOpenTicket?: (ticketId: string) => void
}) {
  const [open, setOpen] = useState(true)
  const [events, setEvents] = useState<RiskAuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [eventType, setEventType] = useState<RiskAuditEventType | ''>('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const loadFirstPage = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: '1', pageSize: String(PAGE_SIZE) })
      if (eventType) params.set('eventType', eventType)
      const result = await api<{ events: RiskAuditEvent[]; total: number; page: number }>(`/processes/${processId}/risks/${riskId}/history?${params.toString()}`)
      setEvents(result.events)
      setTotal(result.total)
      setPage(1)
    } catch (requestError) {
      setEvents([])
      setTotal(0)
      setError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar el historial del riesgo.')
    } finally {
      setLoading(false)
    }
    // refreshVersion cambia tras cada mutación del panel: la sección vuelve a la primera página
    // para mostrar los eventos recién registrados (dependencia de disparo, no leída en el cuerpo).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshVersion solo fuerza la recarga
  }, [processId, riskId, eventType, refreshVersion])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadFirstPage() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadFirstPage])

  async function loadMore() {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const nextPage = page + 1
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(PAGE_SIZE) })
      if (eventType) params.set('eventType', eventType)
      const result = await api<{ events: RiskAuditEvent[]; total: number; page: number }>(`/processes/${processId}/risks/${riskId}/history?${params.toString()}`)
      setEvents((current) => [...current, ...result.events])
      setTotal(result.total)
      setPage(result.page)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar más eventos del historial.')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <section className="panel risk-history-section">
      <div className="panel-heading risk-history-heading">
        <div>
          <p className="detail-label">TRAZABILIDAD</p>
          <h2>HISTORIAL DEL RIESGO</h2>
        </div>
        <div className="risk-history-tools">
          {!loading && !error && <span className="risk-history-count">{total} {total === 1 ? 'evento' : 'eventos'}</span>}
          <label className="risk-history-filter">Tipo de evento
            <select value={eventType} onChange={(event) => setEventType(event.target.value as RiskAuditEventType | '')} disabled={loading}>
              <option value="">Todos los eventos</option>
              {Object.entries(auditEventMeta).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}
            </select>
          </label>
          <button type="button" className="text-button" aria-expanded={open} aria-controls="risk-history-list" onClick={() => setOpen((current) => !current)}>
            {open ? 'Ocultar historial' : 'Ver historial'}
          </button>
        </div>
      </div>
      <div id="risk-history-list" hidden={!open}>
        {error && <div className="form-error page-alert" role="alert"><span>{error}</span><button type="button" className="button secondary small-button" onClick={() => void loadFirstPage()}>Reintentar</button></div>}
        {loading ? (
          <div className="inline-loading"><span className="loader" />Cargando historial...</div>
        ) : !error && events.length === 0 ? (
          <div className="risk-history-empty">
            <span className="history-empty-icon" aria-hidden="true">◷</span>
            <p>{eventType ? 'No hay eventos de este tipo para este riesgo.' : 'Todavía no hay eventos registrados para este riesgo.'}</p>
          </div>
        ) : (
          <>
            <div className="risk-history-list">
              {events.map((event) => (
                <RiskTimelineEntry key={event.id} event={event} onOpenApproval={onOpenApproval} onOpenTicket={onOpenTicket} />
              ))}
            </div>
            {events.length < total && (
              <div className="risk-history-more">
                <button type="button" className="button secondary small-button" disabled={loadingMore} onClick={() => void loadMore()}>
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
