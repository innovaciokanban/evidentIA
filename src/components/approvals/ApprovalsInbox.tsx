import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api'
import { riskLevelLabel, riskScoreFor } from '../../risk-matrix'
import { askConfirm } from '../ui/useConfirm'
import { EmptyState } from '../ui/EmptyState'
import { LoadingState } from '../ui/LoadingState'
import type { RiskApproval, RiskApprovalStatus, RiskTreatment, User } from '../../types'

export const approvalStatusLabels: Record<RiskApprovalStatus, string> = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  OUTDATED: 'Requiere revisión',
}

const treatmentLabels: Record<string, string> = { AVOID: 'Evitar', MITIGATE: 'Mitigar', TRANSFER: 'Transferir', ACCEPT: 'Aceptar' }
const acceptanceLabels: Record<string, string> = { PENDING: 'Pendiente', ACCEPTED: 'Aceptado', REJECTED: 'Rechazado' }
const treatmentLabel = (value: RiskTreatment | null): string => value ? (treatmentLabels[value] ?? value) : 'Sin tratamiento'
const formatDate = (value: string) => new Date(value).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Solo el dueño asignado del riesgo o un administrador de la empresa (superusuario incluido)
 * pueden decidir, y solo mientras el ciclo sigue PENDING; el backend vuelve a validarlo porque la
 * visibilidad del cliente nunca es autorización.
 */
export function canDecideApproval(approval: RiskApproval, user: Pick<User, 'id' | 'role'>): boolean {
  if (approval.status !== 'PENDING') return false
  if (approval.risk.riskOwner?.id === user.id) return true
  return user.role === 'SUPERUSER' || user.role === 'COMPANY_ADMIN'
}

/** Chip de estado del ciclo; se reutiliza en la bandeja y en el detalle. */
export function ApprovalStatusChip({ status }: { status: RiskApprovalStatus }) {
  return <span className={`approval-status-chip ${status.toLowerCase()}`}>{approvalStatusLabels[status]}</span>
}

function LevelBadge({ impact, probability }: { impact: number; probability: number }) {
  const score = riskScoreFor(impact, probability)
  const level = score <= 5 ? 'LOW' : score <= 15 ? 'MEDIUM' : 'HIGH'
  return <span className={`risk-level-badge ${level.toLowerCase()}`}><span className="risk-level-dot" />{score} — {riskLevelLabel[level]}</span>
}

/**
 * Detalle de la revisión: información del riesgo (código prominente, causas y consecuencias en la
 * descripción, controles, tratamiento y niveles) más la decisión del dueño. Es un componente puro
 * (sin efectos): los estados de carga y el diálogo de confirmación viven en la bandeja.
 */
export function ApprovalReviewDetail({ approval, user, deciding, error, onApprove, onReject, onOpenRisk }: {
  approval: RiskApproval
  user: Pick<User, 'id' | 'role'>
  deciding: boolean
  error: string
  onApprove: () => void
  onReject: (reason: string) => void
  onOpenRisk?: () => void
}) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const canDecide = canDecideApproval(approval, user)
  const reasonValid = reason.trim().length >= 3
  return (
    <div className="approval-detail">
      <div className="approval-detail-head">
        <span className="approval-risk-code">{approval.risk.code ?? 'Sin código'}</span>
        <div>
          <h2>{approval.risk.name}</h2>
          <p className="muted">{approval.risk.process.name}{approval.risk.process.code ? ` · ${approval.risk.process.code}` : ''}</p>
        </div>
        <ApprovalStatusChip status={approval.status} />
        {onOpenRisk && <button type="button" className="text-button" onClick={onOpenRisk}>Ver riesgo →</button>}
      </div>

      <div className="approval-detail-grid">
        <div className="approval-detail-block">
          <p className="detail-label">RIESGO</p>
          <p className="detail-description">{approval.risk.description}</p>
          <div className="approval-level-row">
            <div><span>Inherente</span><LevelBadge impact={approval.risk.inherentImpact} probability={approval.risk.inherentProbability} /></div>
            <div><span>Residual</span><LevelBadge impact={approval.risk.residualImpact} probability={approval.risk.residualProbability} /></div>
          </div>
          <div className="detail-meta">
            <div><span>Dueño</span><strong>{approval.risk.riskOwner?.name ?? 'Sin asignar'}</strong></div>
            <div><span>Tratamiento</span><strong>{treatmentLabel(approval.risk.treatment)}</strong></div>
            <div><span>Aceptación formal</span><strong>{acceptanceLabels[approval.risk.acceptanceStatus] ?? approval.risk.acceptanceStatus}</strong></div>
            <div><span>Solicitado</span><strong>{formatDate(approval.requestedAt)} por {approval.requestedBy.name}</strong></div>
          </div>
        </div>

        <div className="approval-detail-block">
          <p className="detail-label">CONTROLES ({approval.risk.controls.length})</p>
          {approval.risk.controls.length === 0
            ? <p className="muted">Sin controles registrados.</p>
            : <ul className="approval-control-list">{approval.risk.controls.map((control) => (
              <li key={control.id}><span className="risk-control-mark">✓</span><span>{control.description}</span></li>
            ))}</ul>}
        </div>
      </div>

      {approval.status !== 'PENDING' && (
        <div className={`approval-decision-note ${approval.status.toLowerCase()}`}>
          <p className="detail-label">DECISIÓN</p>
          <p>
            {approval.status === 'APPROVED' && `Aprobado${approval.decidedBy ? ` por ${approval.decidedBy.name}` : ''}${approval.decidedAt ? ` el ${formatDate(approval.decidedAt)}` : ''}.`}
            {approval.status === 'REJECTED' && `Rechazado${approval.decidedBy ? ` por ${approval.decidedBy.name}` : ''}${approval.decidedAt ? ` el ${formatDate(approval.decidedAt)}` : ''}.`}
            {approval.status === 'OUTDATED' && `Aprobado${approval.decidedBy ? ` por ${approval.decidedBy.name}` : ''}${approval.decidedAt ? ` el ${formatDate(approval.decidedAt)}` : ''} y marcado para nueva revisión porque el riesgo cambió.`}
          </p>
          {approval.comment && <p className="detail-description">«{approval.comment}»</p>}
          {approval.ticket && <p className="muted">Ticket generado: {approval.ticket.title}</p>}
        </div>
      )}

      {error && <div className="form-error" role="alert">{error}</div>}

      {canDecide && (
        <div className="approval-actions">
          <button type="button" className="button primary" disabled={deciding} onClick={onApprove}>{deciding ? 'Guardando...' : 'Aprobar y aceptar'}</button>
          {!rejecting && <button type="button" className="button danger" disabled={deciding} onClick={() => setRejecting(true)}>Rechazar</button>}
          {rejecting && (
            <div className="approval-reject-form">
              <label>Motivo del rechazo (obligatorio)
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Indica por qué se rechaza el riesgo y qué corregir." rows={3} maxLength={2000} autoFocus />
              </label>
              <div className="risk-control-editor-actions">
                <button type="button" className="text-button" onClick={() => { setRejecting(false); setReason('') }}>Cancelar</button>
                <button type="button" className="button danger small-button" disabled={deciding || !reasonValid} onClick={() => onReject(reason.trim())}>{deciding ? 'Guardando...' : 'Confirmar rechazo'}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {!canDecide && approval.status === 'PENDING' && (
        <p className="muted approval-readonly-note">Solo {approval.risk.riskOwner?.name ?? 'el dueño del riesgo'} puede decidir esta solicitud.</p>
      )}
    </div>
  )
}

const approvalFilters: Array<{ key: 'ALL' | RiskApprovalStatus; label: string }> = [
  { key: 'ALL', label: 'Todas' },
  { key: 'PENDING', label: 'Pendientes' },
  { key: 'APPROVED', label: 'Aprobadas' },
  { key: 'REJECTED', label: 'Rechazadas' },
  { key: 'OUTDATED', label: 'Requiere revisión' },
]

/**
 * Bandeja "Mis aprobaciones": tarjetas con código, resumen, proceso, nivel, fecha de solicitud y
 * estado; contadores derivados solo de los datos reales. Al decidir, la bandeja se actualiza en
 * memoria con la respuesta del servidor (sin recargar la aplicación).
 */
export function ApprovalsInbox({ user, initialApprovalId, onConsumeInitialId, onOpenRisk, onChanged }: {
  user: User
  initialApprovalId?: string | null
  onConsumeInitialId?: () => void
  onOpenRisk: (processId: string, riskId: string) => void
  onChanged?: () => void
}) {
  const [approvals, setApprovals] = useState<RiskApproval[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [decideError, setDecideError] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [filter, setFilter] = useState<'ALL' | RiskApprovalStatus>('ALL')
  const [selectedId, setSelectedId] = useState<string | null>(initialApprovalId ?? null)

  const loadApprovals = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await api<{ approvals: RiskApproval[] }>('/approvals')
      setApprovals(result.approvals)
    } catch (requestError) {
      setLoadError(requestError instanceof ApiError ? requestError.message : 'No pudimos cargar tus aprobaciones.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadApprovals() }, [loadApprovals])
  useEffect(() => {
    if (!initialApprovalId) return
    setSelectedId(initialApprovalId)
    onConsumeInitialId?.()
  }, [initialApprovalId, onConsumeInitialId])

  const counts = useMemo(() => ({
    ALL: approvals.length,
    PENDING: approvals.filter((item) => item.status === 'PENDING').length,
    APPROVED: approvals.filter((item) => item.status === 'APPROVED').length,
    REJECTED: approvals.filter((item) => item.status === 'REJECTED').length,
    OUTDATED: approvals.filter((item) => item.status === 'OUTDATED').length,
  }), [approvals])

  const visible = filter === 'ALL' ? approvals : approvals.filter((item) => item.status === filter)
  const selected = approvals.find((item) => item.id === selectedId) ?? null

  const decide = useCallback(async (decision: 'APPROVE' | 'REJECT', comment?: string) => {
    if (!selected || deciding) return
    const confirmed = await askConfirm({
      title: decision === 'APPROVE' ? 'Aprobar y aceptar el riesgo' : 'Rechazar el riesgo',
      message: decision === 'APPROVE'
        ? `Se aprobará «${selected.risk.name}» y se generará un ticket de seguimiento. ¿Continuar?`
        : `Se rechazará «${selected.risk.name}»${comment ? ` con el motivo «${comment}»` : ''}. El riesgo podrá corregirse y reenviarse.`,
      confirmLabel: decision === 'APPROVE' ? 'Aprobar' : 'Rechazar',
      variant: decision === 'APPROVE' ? 'primary' : 'danger',
    })
    if (!confirmed) return
    setDeciding(true)
    setDecideError('')
    setNotice('')
    try {
      const result = await api<{ approval: RiskApproval; ticket: { id: string; title: string } | null }>(`/approvals/${selected.id}/decision`, { method: 'POST', body: JSON.stringify({ decision, comment }) })
      setApprovals((current) => current.map((item) => item.id === result.approval.id ? result.approval : item))
      setNotice(decision === 'APPROVE'
        ? `Riesgo ${result.approval.risk.code ? `${result.approval.risk.code} ` : ''}aprobado${result.ticket ? `; ticket «${result.ticket.title}» creado.` : '.'}`
        : `Riesgo ${result.approval.risk.code ? `${result.approval.risk.code} ` : ''}rechazado. Ya puede corregirse y reenviarse.`)
      onChanged?.()
    } catch (requestError) {
      setDecideError(requestError instanceof ApiError ? requestError.message : 'No se pudo registrar la decisión.')
    } finally {
      setDeciding(false)
    }
  }, [selected, deciding, onChanged])

  if (selected) {
    return (
      <div className="page approvals-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">GESTIÓN DE RIESGOS / MIS APROBACIONES</p>
            <h1>Revisión de riesgo</h1>
            <p className="muted">Revisa la información antes de decidir.</p>
          </div>
          <button type="button" className="text-button" onClick={() => { setSelectedId(null); setNotice(''); setDecideError('') }}>← Volver a la bandeja</button>
        </div>
        {notice && <div className="form-success page-alert" role="status">{notice}</div>}
        <section className="panel">
          <ApprovalReviewDetail
            approval={selected}
            user={user}
            deciding={deciding}
            error={decideError}
            onApprove={() => void decide('APPROVE')}
            onReject={(reason) => void decide('REJECT', reason)}
            onOpenRisk={() => onOpenRisk(selected.risk.process.id, selected.risk.id)}
          />
        </section>
      </div>
    )
  }

  return (
    <div className="page approvals-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">GESTIÓN DE RIESGOS</p>
          <h1>Mis aprobaciones</h1>
          <p className="muted">Riesgos que esperan tu revisión y decisiones ya tomadas.</p>
        </div>
      </div>
      {notice && <div className="form-success page-alert" role="status">{notice}</div>}
      {loadError && <div className="form-error page-alert" role="alert">{loadError}<button type="button" className="button secondary small-button" onClick={() => void loadApprovals()}>Reintentar</button></div>}
      <div className="approval-counters" role="list" aria-label="Contadores de aprobaciones">
        {approvalFilters.filter((item) => item.key !== 'ALL').map((item) => (
          <div key={item.key} role="listitem" className={`approval-counter ${filter === item.key ? 'is-active' : ''}`}>
            <strong>{counts[item.key]}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <div className="approval-filters" role="group" aria-label="Filtrar aprobaciones">
        {approvalFilters.map((item) => (
          <button key={item.key} type="button" className={filter === item.key ? 'is-active' : ''} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
            {item.label} ({counts[item.key]})
          </button>
        ))}
      </div>
      {loading ? <section className="panel"><LoadingState text="Cargando aprobaciones..." /></section> : visible.length === 0 ? (
        <section className="panel">
          <EmptyState
            title={filter === 'ALL' ? 'Sin solicitudes de aprobación' : 'Sin resultados en este estado'}
            text={filter === 'ALL' ? 'Cuando un riesgo tuyo se envíe a revisión aparecerá aquí.' : 'Cambia de filtro para ver otros ciclos.'}
          />
        </section>
      ) : (
        <div className="approval-list">
          {visible.map((approval) => (
            <button key={approval.id} type="button" className="approval-card" onClick={() => { setSelectedId(approval.id); setNotice(''); setDecideError('') }}>
              <div className="approval-card-top">
                <span className="approval-risk-code">{approval.risk.code ?? 'Sin código'}</span>
                <ApprovalStatusChip status={approval.status} />
              </div>
              <strong className="approval-card-name">{approval.risk.name}</strong>
              <p className="approval-card-summary">{approval.risk.description}</p>
              <div className="approval-card-meta">
                <span>{approval.risk.process.name}</span>
                <span className={`risk-level-badge ${approval.risk.inherentLevel.toLowerCase()}`}>{riskScoreFor(approval.risk.inherentImpact, approval.risk.inherentProbability)} — {riskLevelLabel[approval.risk.inherentLevel]}</span>
                <span>Solicitado {formatDate(approval.requestedAt)}</span>
              </div>
              <div className="approval-card-footer">
                <span>{approval.risk.riskOwner?.name ?? 'Sin dueño'}</span>
                {approval.status === 'PENDING' && canDecideApproval(approval, user) && <span className="approval-card-cta">Revisar →</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
