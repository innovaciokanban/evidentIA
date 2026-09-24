import type { TicketStatus, TicketPriority } from '../../types'

const statusLabels: Record<TicketStatus, string> = { OPEN: 'Abierto', IN_PROGRESS: 'En progreso', RESOLVED: 'Resuelto', CLOSED: 'Cerrado' }
const priorityLabels: Record<TicketPriority, string> = { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta', URGENT: 'Urgente' }

export function Badge({ type, value }: { type: 'status' | 'priority'; value: TicketStatus | TicketPriority }) {
  return <span className={`badge ${type} ${value.toLowerCase()}`}>{type === 'status' ? statusLabels[value as TicketStatus] : priorityLabels[value as TicketPriority]}</span>
}
