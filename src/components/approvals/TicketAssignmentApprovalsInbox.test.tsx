import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TicketAssignmentDetail, TicketAssignmentStatusChip, canDecideTicketAssignment } from './TicketAssignmentApprovalsInbox'
import type { TicketAssignmentApproval, User } from '../../types'

const proposed: User = { id: 'user-proposed', name: 'Ana Responsable', email: 'ana@example.com', role: 'COMPANY_USER', companyId: 'company-1' }
const otherUser: User = { id: 'user-other', name: 'Otro usuario', email: 'otro@example.com', role: 'COMPANY_USER', companyId: 'company-1' }
const approval: TicketAssignmentApproval = {
  id: 'approval-1',
  ticketId: 'ticket-1',
  status: 'PENDING',
  source: 'DIRECT',
  riskApprovalId: null,
  comment: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  decidedAt: null,
  updatedAt: '2026-10-01T08:00:00.000Z',
  requestedBy: otherUser,
  proposedAssignee: proposed,
  previousAssignee: null,
  decidedBy: null,
  ticket: { id: 'ticket-1', title: 'Actualizar procedimiento', status: 'OPEN', priority: 'HIGH', assignedTo: null, actionItemId: null },
}

describe('ticket assignment approval UI', () => {
  it('only allows the proposed assignee to decide', () => {
    expect(canDecideTicketAssignment(approval, proposed)).toBe(true)
    expect(canDecideTicketAssignment(approval, otherUser)).toBe(false)
    expect(canDecideTicketAssignment({ ...approval, status: 'ACCEPTED' }, proposed)).toBe(false)
  })

  it('renders the assignment status and decision context', () => {
    const markup = renderToStaticMarkup(<TicketAssignmentDetail approval={approval} user={proposed} deciding={false} error="" onAccept={() => {}} onReject={() => {}} onOpenTicket={() => {}} />)
    expect(markup).toContain('Pendiente')
    expect(markup).toContain('Actualizar procedimiento')
    expect(markup).toContain('Ana Responsable')
    expect(markup).toContain('Aceptar asignación')
    expect(markup).toContain('Rechazar')
  })

  it('uses the shared approval status chip visual language', () => {
    expect(renderToStaticMarkup(<TicketAssignmentStatusChip status="REJECTED" />)).toContain('approval-status-chip rejected')
  })
})
