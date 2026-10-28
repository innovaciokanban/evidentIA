import type { TicketAuditEventType } from '../../types'

export const ticketHistoryValue = (value: string | boolean | number | null) => {
  if (value === null || value === '') return 'Sin valor'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return String(value)
}

/**
 * Presentación de cada tipo de evento del historial de tickets, con el mismo patrón que
 * auditEventMeta del historial de riesgos: el glifo es decorativo (aria-hidden) y la etiqueta
 * es la fuente única usada también por el filtro de tipo de evento de la vista global.
 */
export const ticketEventMeta: Record<TicketAuditEventType, { label: string; glyph: string }> = {
  TICKET_CREATED: { label: 'Creación', glyph: '+' },
  TICKET_UPDATED: { label: 'Edición', glyph: '✎' },
  TICKET_ASSIGNED: { label: 'Asignación', glyph: '→' },
  TICKET_UNASSIGNED: { label: 'Desasignación', glyph: '←' },
  TICKET_STATUS_CHANGED: { label: 'Cambio de estado', glyph: '↕' },
  TICKET_PRIORITY_CHANGED: { label: 'Cambio de prioridad', glyph: '⇅' },
  TICKET_DUE_DATE_CHANGED: { label: 'Cambio de vencimiento', glyph: '◔' },
  EVIDENCE_ATTACHED: { label: 'Evidencia adjunta', glyph: '▣' },
  EVIDENCE_DELETED: { label: 'Evidencia eliminada', glyph: '−' },
  TICKET_DELETED: { label: 'Eliminación', glyph: '−' },
}
