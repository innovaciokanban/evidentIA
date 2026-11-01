import { useEffect, useState } from 'react'
import { ApprovalsInbox } from './ApprovalsInbox'
import { TicketAssignmentApprovalsInbox } from './TicketAssignmentApprovalsInbox'
import type { User } from '../../types'

export function ApprovalsHub({ user, initialApprovalId, onConsumeInitialApprovalId, initialAssignmentTicketId, onConsumeInitialAssignmentTicketId, onOpenRisk, onOpenTicket, onChanged }: {
  user: User
  initialApprovalId?: string | null
  onConsumeInitialApprovalId?: () => void
  initialAssignmentTicketId?: string | null
  onConsumeInitialAssignmentTicketId?: () => void
  onOpenRisk: (processId: string, riskId: string) => void
  onOpenTicket: (ticketId: string) => void
  onChanged?: () => void
}) {
  const [section, setSection] = useState<'risk' | 'assignment'>(initialAssignmentTicketId ? 'assignment' : 'risk')
  useEffect(() => {
    if (!initialAssignmentTicketId) return
    const timer = window.setTimeout(() => setSection('assignment'), 0)
    return () => window.clearTimeout(timer)
  }, [initialAssignmentTicketId])
  return <>
    <div className="approval-section-tabs" role="tablist" aria-label="Tipos de aprobación">
      <button type="button" role="tab" aria-selected={section === 'risk'} className={section === 'risk' ? 'is-active' : ''} onClick={() => setSection('risk')}>Riesgos</button>
      <button type="button" role="tab" aria-selected={section === 'assignment'} className={section === 'assignment' ? 'is-active' : ''} onClick={() => setSection('assignment')}>Asignaciones</button>
    </div>
    {section === 'risk'
      ? <ApprovalsInbox user={user} initialApprovalId={initialApprovalId} onConsumeInitialId={onConsumeInitialApprovalId} onOpenRisk={onOpenRisk} onChanged={onChanged} />
      : <TicketAssignmentApprovalsInbox user={user} initialTicketId={initialAssignmentTicketId} onConsumeInitialTicketId={onConsumeInitialAssignmentTicketId} onOpenTicket={onOpenTicket} onChanged={onChanged} />}
  </>
}
