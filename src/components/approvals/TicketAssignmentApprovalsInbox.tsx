import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api'
import { askConfirm } from '../ui/useConfirm'
import { EmptyState } from '../ui/EmptyState'
import { LoadingState } from '../ui/LoadingState'
import type { TicketAssignmentApproval, TicketAssignmentApprovalStatus, User } from '../../types'

const statusLabels: Record<TicketAssignmentApprovalStatus, string> = {
  PENDING: 'Pendiente',
  ACCEPTED: 'Aceptada',
  REJECTED: 'Rechazada',
  CANCELLED: 'Cancelada',
  SUPERSEDED: 'Reemplazada',
}

const sourceLabels: Record<TicketAssignmentApproval['source'], string> = {
  DIRECT: 'Asignación de ticket',
  ACTION_ITEM: 'Actividad de plan',
  STRATEGY_TASK: 'Tarea estratégica',
  RISK_APPROVAL: 'Aprobación de riesgo',
}

const formatDate = (value: string) => new Date(value).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })

export function TicketAssignmentStatusChip({ status }: { status: TicketAssignmentApprovalStatus }) {
  return <span className={`approval-status-chip ${status.toLowerCase()}`}>{statusLabels[status]}</span>
}

export function canDecideTicketAssignment(approval: TicketAssignmentApproval, user: Pick<User, 'id'>): boolean {
  return approval.status === 'PENDING' && approval.proposedAssignee.id === user.id
}

export function TicketAssignmentDetail({ approval, user, deciding, error, onAccept, onReject, onOpenTicket }: {
  approval: TicketAssignmentApproval
  user: User
  deciding: boolean
  error: string
  onAccept: () => void
  onReject: (comment: string) => void
  onOpenTicket?: () => void
}) {
  const [rejecting, setRejecting] = useState(false)
  const [comment, setComment] = useState('')
  const canDecide = canDecideTicketAssignment(approval, user)
  const commentValid = comment.trim().length >= 3
  const ticket = approval.ticket

  return (
    <div className="approval-detail">
      <div className="approval-detail-head">
        <span className="approval-risk-code">TICKET</span>
        <div>
          <h2>{ticket?.title ?? 'Ticket no disponible'}</h2>
          <p className="muted">{ticket ? `#${ticket.id.slice(-6).toUpperCase()} · ${sourceLabels[approval.source]}` : sourceLabels[approval.source]}</p>
        </div>
        <TicketAssignmentStatusChip status={approval.status} />
        {ticket && onOpenTicket && <button type="button" className="text-button" onClick={onOpenTicket}>Ver ticket →</button>}
      </div>

      <div className="approval-detail-grid">
        <div className="approval-detail-block">
          <p className="detail-label">SOLICITUD</p>
          <p className="detail-description">Se propone a <strong>{approval.proposedAssignee.name}</strong> como responsable del ticket.</p>
          <div className="detail-meta">
            <div><span>Solicitado por</span><strong>{approval.requestedBy.name}</strong></div>
            <div><span>Responsable actual</span><strong>{approval.previousAssignee?.name ?? 'Sin asignar'}</strong></div>
            <div><span>Fecha</span><strong>{formatDate(approval.createdAt)}</strong></div>
          </div>
        </div>
        <div className="approval-detail-block">
          <p className="detail-label">DECISIÓN</p>
          {approval.status === 'PENDING'
            ? <p className="muted">Aceptar asignará el ticket a la persona propuesta. Rechazar mantiene el responsable actual.</p>
            : <>
              <p className="detail-description">{approval.status === 'ACCEPTED' ? 'La asignación fue aceptada.' : approval.status === 'REJECTED' ? 'La asignación fue rechazada.' : `La solicitud fue ${statusLabels[approval.status].toLowerCase()}.`}</p>
              {approval.decidedBy && <p className="muted">Decidida por {approval.decidedBy.name}{approval.decidedAt ? ` el ${formatDate(approval.decidedAt)}` : ''}.</p>}
              {approval.comment && <p className="detail-description">«{approval.comment}»</p>}
            </>}
        </div>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}
      {canDecide && (
        <div className="approval-actions">
          <button type="button" className="button primary" disabled={deciding} onClick={onAccept}>{deciding ? 'Guardando...' : 'Aceptar asignación'}</button>
          {!rejecting && <button type="button" className="button danger" disabled={deciding} onClick={() => setRejecting(true)}>Rechazar</button>}
          {rejecting && (
            <div className="approval-reject-form">
              <label>Motivo del rechazo (obligatorio)
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Indica por qué no puedes asumir este ticket." rows={3} maxLength={2000} autoFocus />
              </label>
              <div className="risk-control-editor-actions">
                <button type="button" className="text-button" onClick={() => { setRejecting(false); setComment('') }}>Cancelar</button>
                <button type="button" className="button danger small-button" disabled={deciding || !commentValid} onClick={() => onReject(comment.trim())}>{deciding ? 'Guardando...' : 'Confirmar rechazo'}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {!canDecide && approval.status === 'PENDING' && <p className="muted approval-readonly-note">Solo {approval.proposedAssignee.name} puede decidir esta solicitud.</p>}
    </div>
  )
}

type AssignmentFilter = 'ALL' | 'PENDING' | 'ACCEPTED' | 'REJECTED'
const filters: Array<{ key: AssignmentFilter; label: string }> = [
  { key: 'ALL', label: 'Todas' },
  { key: 'PENDING', label: 'Pendientes' },
  { key: 'ACCEPTED', label: 'Aceptadas' },
  { key: 'REJECTED', label: 'Rechazadas' },
]

export function TicketAssignmentApprovalsInbox({ user, initialTicketId, onConsumeInitialTicketId, onOpenTicket, onChanged }: {
  user: User
  initialTicketId?: string | null
  onConsumeInitialTicketId?: () => void
  onOpenTicket?: (ticketId: string) => void
  onChanged?: () => void
}) {
  const [approvals, setApprovals] = useState<TicketAssignmentApproval[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<AssignmentFilter>('PENDING')
  const [deciding, setDeciding] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadApprovals = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await api<{ approvals: TicketAssignmentApproval[] }>('/ticket-assignment-approvals')
      setApprovals(result.approvals)
    } catch (requestError) {
      setLoadError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar las solicitudes de asignación.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadApprovals() }, [loadApprovals])
  useEffect(() => {
    if (!initialTicketId || loading) return
    const timer = window.setTimeout(() => {
      const match = approvals.find((item) => item.ticket?.id === initialTicketId)
      if (match) setSelectedId(match.id)
      onConsumeInitialTicketId?.()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [approvals, initialTicketId, loading, onConsumeInitialTicketId])

  const counts = useMemo(() => ({
    ALL: approvals.length,
    PENDING: approvals.filter((item) => item.status === 'PENDING').length,
    ACCEPTED: approvals.filter((item) => item.status === 'ACCEPTED').length,
    REJECTED: approvals.filter((item) => item.status === 'REJECTED').length,
  }), [approvals])
  const visible = filter === 'ALL' ? approvals : approvals.filter((item) => item.status === filter)
  const selected = approvals.find((item) => item.id === selectedId) ?? null

  const decide = useCallback(async (decision: 'ACCEPT' | 'REJECT', comment?: string) => {
    if (!selected || deciding) return
    const confirmed = await askConfirm({
      title: decision === 'ACCEPT' ? 'Aceptar asignación' : 'Rechazar asignación',
      message: decision === 'ACCEPT' ? `El ticket «${selected.ticket?.title ?? 'seleccionado'}» quedará asignado a ti. ¿Continuar?` : `Se rechazará la asignación con el motivo «${comment}». ¿Continuar?`,
      confirmLabel: decision === 'ACCEPT' ? 'Aceptar' : 'Rechazar',
      variant: decision === 'ACCEPT' ? 'primary' : 'danger',
    })
    if (!confirmed) return
    setDeciding(true)
    setError('')
    setNotice('')
    try {
      const result = await api<{ approval: TicketAssignmentApproval }>(`/ticket-assignment-approvals/${selected.id}/decision`, { method: 'POST', body: JSON.stringify({ decision, comment }) })
      setApprovals((current) => current.map((item) => item.id === result.approval.id ? result.approval : item))
      setNotice(decision === 'ACCEPT' ? 'Asignación aceptada. El ticket ya aparece bajo tu responsabilidad.' : 'Asignación rechazada.')
      onChanged?.()
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'No se pudo registrar la decisión.')
    } finally {
      setDeciding(false)
    }
  }, [deciding, onChanged, selected])

  if (selected) return <div className="page approvals-page">
    <div className="page-heading"><div><p className="eyebrow">OPERACIÓN / MIS APROBACIONES</p><h1>Revisión de asignación</h1><p className="muted">Confirma si puedes asumir este ticket.</p></div><button type="button" className="text-button" onClick={() => { setSelectedId(null); setError('') }}>← Volver a la bandeja</button></div>
    {notice && <div className="form-success page-alert" role="status">{notice}</div>}
    <section className="panel"><TicketAssignmentDetail approval={selected} user={user} deciding={deciding} error={error} onAccept={() => void decide('ACCEPT')} onReject={(comment) => void decide('REJECT', comment)} onOpenTicket={selected.ticket ? () => onOpenTicket?.(selected.ticket!.id) : undefined} /></section>
  </div>

  return <div className="page approvals-page">
    <div className="page-heading"><div><p className="eyebrow">OPERACIÓN</p><h1>Solicitudes de asignación</h1><p className="muted">Revisa tickets que esperan confirmación del responsable propuesto.</p></div></div>
    {notice && <div className="form-success page-alert" role="status">{notice}</div>}
    {loadError && <div className="form-error page-alert" role="alert">{loadError}<button type="button" className="button secondary small-button" onClick={() => void loadApprovals()}>Reintentar</button></div>}
    <div className="approval-counters" role="list" aria-label="Contadores de solicitudes de asignación">
      {filters.filter((item) => item.key !== 'ALL').map((item) => <div key={item.key} role="listitem" className={`approval-counter ${filter === item.key ? 'is-active' : ''}`}><strong>{counts[item.key]}</strong><span>{item.label}</span></div>)}
    </div>
    <div className="approval-filters" role="group" aria-label="Filtrar solicitudes de asignación">
      {filters.map((item) => <button key={item.key} type="button" className={filter === item.key ? 'is-active' : ''} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>{item.label} ({counts[item.key]})</button>)}
    </div>
    {loading ? <section className="panel"><LoadingState text="Cargando solicitudes..." /></section> : visible.length === 0 ? <section className="panel"><EmptyState title={filter === 'PENDING' ? 'Sin solicitudes pendientes' : 'Sin solicitudes de asignación'} text={filter === 'PENDING' ? 'Cuando se proponga tu nombre en un ticket aparecerá aquí.' : 'Cambia de filtro para consultar otros ciclos.'} /></section> : <div className="approval-list">
      {visible.map((approval) => <button key={approval.id} type="button" className="approval-card" onClick={() => { setSelectedId(approval.id); setError(''); setNotice('') }}>
        <div className="approval-card-top"><span className="approval-risk-code">#{approval.ticket?.id.slice(-6).toUpperCase() ?? 'TICKET'}</span><TicketAssignmentStatusChip status={approval.status} /></div>
        <strong className="approval-card-name">{approval.ticket?.title ?? 'Ticket no disponible'}</strong>
        <p className="approval-card-summary">{approval.proposedAssignee.name} · solicitada por {approval.requestedBy.name}</p>
        <div className="approval-card-meta"><span>{sourceLabels[approval.source]}</span><span>{formatDate(approval.createdAt)}</span></div>
        <div className="approval-card-footer"><span>{approval.previousAssignee?.name ?? 'Sin responsable actual'}</span>{canDecideTicketAssignment(approval, user) && <span className="approval-card-cta">Revisar →</span>}</div>
      </button>)}
    </div>}
  </div>
}
