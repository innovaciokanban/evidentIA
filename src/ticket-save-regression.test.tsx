import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TicketDetail } from './App'
import type { Ticket, TicketAssignmentApproval, User } from './types'

const user: User = { id: 'user-1', name: 'Ana Responsable', email: 'ana@example.com', role: 'COMPANY_USER', companyId: 'company-1' }
const pendingApproval: TicketAssignmentApproval = {
  id: 'assignment-1',
  ticketId: 'ticket-1',
  status: 'PENDING',
  source: 'DIRECT',
  riskApprovalId: null,
  comment: null,
  createdAt: '2026-10-28T08:00:00.000Z',
  decidedAt: null,
  updatedAt: '2026-10-28T08:00:00.000Z',
  requestedBy: user,
  proposedAssignee: user,
  previousAssignee: null,
  decidedBy: null,
  ticket: null,
}

const makeTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: 'ticket-1',
  title: 'Ticket asignado',
  description: 'Validar asignación',
  status: 'OPEN',
  priority: 'MEDIUM',
  createdAt: '2026-10-28T08:00:00.000Z',
  updatedAt: '2026-10-28T08:00:00.000Z',
  createdBy: user,
  assignedTo: null,
  actionItem: null,
  riskApprovals: [],
  ...overrides,
})

const renderTicket = (ticket: Ticket) => renderToStaticMarkup(
  <TicketDetail ticket={ticket} user={user} onEdit={() => {}} onDelete={() => {}} onClose={() => {}} onOpenRisk={() => {}} />,
)

describe('ticket save regression', () => {
  it('does not crash when the saved ticket has no action plan and keeps a pending assignment visible', () => {
    const markup = renderTicket(makeTicket({
      actionItem: { id: 'action-1', actionPlan: null as never },
      assignmentApproval: pendingApproval,
      saveMessage: 'Solicitud de asignación guardada. El responsable propuesto debe aceptarla.',
    }))
    expect(markup).toContain('Solicitud de asignación guardada')
    expect(markup).toContain('Asignación pendiente')
    expect(markup).toContain('Ana Responsable debe aceptar esta solicitud')
  })

  it('renders a normal successful save without an assignment request', () => {
    expect(renderTicket(makeTicket({ saveMessage: 'Ticket actualizado correctamente.' }))).toContain('Ticket actualizado correctamente.')
  })

  it('renders an explicit overdue date only for an open ticket', () => {
    const overdue = renderTicket(makeTicket({ dueDate: '2000-01-01T00:00:00.000Z', status: 'IN_PROGRESS' }))
    expect(overdue).toContain('Vencido')
    expect(overdue).toContain('2000')

    const closed = renderTicket(makeTicket({ dueDate: '2000-01-01T00:00:00.000Z', status: 'CLOSED' }))
    expect(closed).toContain('Vence')
    expect(closed).not.toContain('Vencido')
  })
})
