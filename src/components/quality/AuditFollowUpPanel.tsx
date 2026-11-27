import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api'
import type { Audit, AuditEvent, AuditFollowUp } from '../../types'
import { askConfirm } from '../ui/useConfirm'
import { FindingDossier } from './FindingDossier'
import { findingStatusLabels, findingTypeLabels, type QualityUser } from './quality.model'
import { formatAuditDateTime } from './audit-history.model'

const followUpStatusLabels: Record<AuditFollowUp['status'], string> = {
  ENABLED: 'Activo',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Finalizado',
  CANCELLED: 'Cancelado',
}
const actionStatusLabels: Record<string, string> = { OPEN: 'Abierta', IN_PROGRESS: 'En curso', COMPLETED: 'Completada', CANCELLED: 'Cancelada' }
const efficacyStatusLabels: Record<string, string> = { PLANNED: 'Planificada', IN_PROGRESS: 'En curso', COMPLETED: 'Verificada', CANCELLED: 'Cancelada' }
const actionPriorityLabels: Record<string, string> = { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta', CRITICAL: 'Crítica' }

const eventLabels: Record<string, string> = {
  AUDIT_FOLLOW_UP_ENABLED: 'Seguimiento CAPA habilitado',
  AUDIT_FOLLOW_UP_UPDATED: 'Seguimiento CAPA actualizado',
  AUDIT_FOLLOW_UP_COMPLETED: 'Seguimiento CAPA finalizado',
  ACTION_CREATED: 'Acción correctiva creada',
  ACTION_UPDATED: 'Acción correctiva actualizada',
  ACTION_STATUS_CHANGED: 'Estado de acción actualizado',
  ACTION_PROGRESS_ADDED: 'Avance de acción registrado',
  EFFICACY_EVALUATION_CREATED: 'Evaluación de eficacia planificada',
  EFFICACY_EVALUATION_UPDATED: 'Evaluación de eficacia actualizada',
  EFFICACY_EVALUATION_STARTED: 'Evaluación de eficacia iniciada',
  EFFICACY_EVALUATION_COMPLETED: 'Evaluación de eficacia finalizada',
  EFFICACY_EVALUATION_CANCELLED: 'Evaluación de eficacia cancelada',
  EFFICACY_EVALUATION_EVIDENCE_LINKED: 'Evidencia de eficacia vinculada',
  EFFICACY_EVALUATION_EVIDENCE_UNLINKED: 'Evidencia de eficacia desvinculada',
  EVIDENCE_CREATED: 'Evidencia registrada',
  EVIDENCE_FILE_CREATED: 'Archivo de evidencia registrado',
}

const formatDate = (value: string | null | undefined): string => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value)) : '—'
const isActiveFollowUp = (status: AuditFollowUp['status'] | undefined): boolean => status === 'ENABLED' || status === 'IN_PROGRESS'
const isActionFinal = (status: string): boolean => status === 'COMPLETED' || status === 'CANCELLED'

function requestErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

export function AuditFollowUpPanel({ audit, users, canWrite, onChanged, onError, onNotice }: {
  audit: Audit
  users: QualityUser[]
  canWrite: boolean
  onChanged: () => Promise<void> | void
  onError: (message: string) => void
  onNotice: (message: string) => void
}) {
  const [followUp, setFollowUp] = useState<AuditFollowUp | null>(null)
  const [history, setHistory] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null)

  const loadFollowUp = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api<{ followUp: AuditFollowUp | null }>(`/audits/${audit.id}/follow-up`)
      setFollowUp(result.followUp)
    } catch (requestError) {
      const message = requestErrorMessage(requestError, 'No se pudo cargar el seguimiento CAPA.')
      setError(message)
      onError(message)
    } finally {
      setLoading(false)
    }
  }, [audit.id, onError])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await loadFollowUp()
      try {
        const result = await api<{ events: AuditEvent[] }>(`/audits/${audit.id}/history?pageSize=100`)
        if (!cancelled) setHistory(result.events.filter((event) => event.eventType.includes('FOLLOW_UP') || event.eventType.includes('ACTION_') || event.eventType.includes('EFFICACY_') || event.eventType.includes('EVIDENCE')))
      } catch (requestError) {
        if (!cancelled) setHistoryError(requestErrorMessage(requestError, 'No se pudo cargar el historial del seguimiento.'))
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [audit.id, loadFollowUp])

  const allActions = useMemo(() => audit.findings.flatMap((finding) => (finding.actions ?? []).map((action) => ({ action, finding }))), [audit.findings])
  const allEvaluations = useMemo(() => audit.findings.flatMap((finding) => finding.efficacyEvaluations ?? []), [audit.findings])
  const [now] = useState(() => Date.now())
  const pendingFindings = audit.findings.filter((finding) => finding.status !== 'VERIFIED')
  const pendingActions = allActions.filter(({ action }) => action.required && !isActionFinal(action.status))
  const completedActions = allActions.filter(({ action }) => action.status === 'COMPLETED')
  const overdueActions = allActions.filter(({ action }) => !isActionFinal(action.status) && action.dueDate && new Date(action.dueDate).getTime() < now)
  const pendingEvaluations = allEvaluations.filter((evaluation) => evaluation.status === 'PLANNED' || evaluation.status === 'IN_PROGRESS')
  const completedEvaluations = allEvaluations.filter((evaluation) => evaluation.status === 'COMPLETED')
  const selectedFinding = selectedFindingId ? audit.findings.find((finding) => finding.id === selectedFindingId) ?? null : null
  const canOperate = canWrite && audit.status === 'CLOSED' && isActiveFollowUp(followUp?.status)

  async function completeFollowUp() {
    const confirmed = await askConfirm({ title: 'Finalizar seguimiento CAPA', message: 'El servidor validará que no queden hallazgos ni tratamientos obligatorios pendientes.', confirmLabel: 'Finalizar seguimiento' })
    if (!confirmed) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ followUp: AuditFollowUp }>(`/audits/${audit.id}/follow-up/complete`, { method: 'POST', body: JSON.stringify({}) })
      setFollowUp(result.followUp)
      await Promise.resolve(onChanged())
      onNotice('El seguimiento CAPA fue finalizado.')
    } catch (requestError) {
      const message = requestErrorMessage(requestError, 'No se pudo finalizar el seguimiento CAPA.')
      setError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="panel audit-follow-up-loading" role="status"><span className="loader" />Cargando seguimiento CAPA…</div>

  return (
    <div className="audit-follow-up-panel-wrap">
      <section className="panel audit-follow-up-panel">
        <header className="audit-follow-up-heading">
          <div><p className="detail-label">CONTROL POSTERIOR AL CIERRE</p><h2>Seguimiento CAPA</h2><p className="muted">Consulta y gestiona únicamente tratamientos autorizados sobre hallazgos existentes.</p></div>
          {followUp && <span className={`audit-follow-up-status ${followUp.status.toLowerCase()}`}>{followUpStatusLabels[followUp.status]}</span>}
        </header>
        {followUp && <div className="audit-follow-up-boundary" aria-label="Diferencia entre cierre de auditoría y seguimiento CAPA"><span className="audit-boundary-audit"><small>Auditoría</small><strong>{audit.status === 'CLOSED' ? 'Cerrada' : audit.status}</strong></span><i aria-hidden="true">→</i><span className="audit-boundary-capa"><small>Seguimiento CAPA</small><strong>{followUpStatusLabels[followUp.status]}</strong></span></div>}
        {error && <div className="form-error page-alert" role="alert"><span>{error}</span><button type="button" className="icon-button" aria-label="Cerrar error" onClick={() => setError('')}>×</button></div>}
        {!followUp ? (
          <div className="audit-follow-up-empty"><strong>No hay un seguimiento CAPA habilitado.</strong><span>El seguimiento se habilita durante el cierre cuando existen hallazgos pendientes con tratamiento formal.</span></div>
        ) : (
          <>
            {audit.status !== 'CLOSED' && <div className="audit-follow-up-warning" role="status"><strong>El seguimiento está preparado, pero la auditoría aún no está cerrada.</strong><span>Las operaciones CAPA post-cierre se habilitarán cuando el estado sea Cerrada.</span></div>}
            {audit.status === 'CLOSED' && followUp.status === 'COMPLETED' && <div className="audit-follow-up-complete" role="status"><strong>Seguimiento finalizado</strong><span>Los datos originales de la auditoría permanecen protegidos.</span></div>}
            <div className="audit-follow-up-meta"><div><span>Responsable</span><strong>{followUp.responsible.name}</strong></div><div><span>Alcance</span><strong>{followUp.scope}</strong></div><div><span>Habilitado</span><strong>{formatDate(followUp.enabledAt)}</strong><small>Actualizado {formatDate(followUp.updatedAt)}</small></div><div><span>Finalizado</span><strong>{formatDate(followUp.completedAt)}</strong><small>{followUp.completedBy ? `Por ${followUp.completedBy.name}` : 'Pendiente'}</small></div></div>
             <div className="audit-follow-up-indicators" aria-label="Indicadores CAPA"><div className={pendingFindings.length ? 'attention' : 'ok'}><span>Hallazgos pendientes</span><strong>{pendingFindings.length}</strong><small>sin verificar</small></div><div className={pendingActions.length ? 'attention' : 'ok'}><span>Acciones pendientes</span><strong>{pendingActions.length}</strong><small>{completedActions.length} completadas · {allActions.length} totales</small></div><div className="ok"><span>Acciones completadas</span><strong>{completedActions.length}</strong><small>{allActions.length} registradas</small></div><div className={pendingEvaluations.length ? 'attention' : 'ok'}><span>Eficacia pendiente</span><strong>{pendingEvaluations.length}</strong><small>{completedEvaluations.length} verificadas</small></div><div className={overdueActions.length ? 'attention' : 'ok'}><span>Vencimientos</span><strong>{overdueActions.length}</strong><small>acciones fuera de plazo</small></div></div>
             <section className="audit-follow-up-requirements" aria-label="Requisitos para finalizar el seguimiento"><div><p className="detail-label">CIERRE CAPA</p><h3>Requisitos de finalización</h3></div><ul><li className={pendingFindings.length ? 'pending' : 'done'}><span aria-hidden="true">{pendingFindings.length ? '!' : '✓'}</span><div><strong>Hallazgos verificados</strong><small>{pendingFindings.length ? `${pendingFindings.length} pendiente(s)` : 'Todos verificados'}</small></div></li><li className={pendingActions.length ? 'pending' : 'done'}><span aria-hidden="true">{pendingActions.length ? '!' : '✓'}</span><div><strong>Acciones obligatorias</strong><small>{pendingActions.length ? `${pendingActions.length} abiertas` : 'Todas finalizadas'}</small></div></li><li className={pendingEvaluations.length ? 'pending' : 'done'}><span aria-hidden="true">{pendingEvaluations.length ? '!' : '✓'}</span><div><strong>Eficacia documentada</strong><small>{pendingEvaluations.length ? `${pendingEvaluations.length} pendiente(s)` : 'Evaluaciones al día'}</small></div></li></ul></section>
            {canOperate && <div className="audit-follow-up-operation-bar"><span><strong>Edición CAPA habilitada.</strong> Los paneles de tratamiento conservarán la auditoría y el hallazgo originales.</span><button type="button" className="button primary small-button" onClick={() => void completeFollowUp()} disabled={busy}>{busy ? 'Validando…' : 'Finalizar seguimiento'}</button></div>}
            {!canOperate && audit.status === 'CLOSED' && isActiveFollowUp(followUp.status) && <p className="audit-follow-up-readonly">Consulta de solo lectura: tu usuario no tiene permisos para operar o finalizar este seguimiento.</p>}

             <section className="audit-follow-up-findings"><div className="audit-follow-up-section-heading"><div><p className="detail-label">TRATAMIENTOS</p><h3>Hallazgos en seguimiento</h3></div><span>{pendingFindings.length} pendientes</span></div>{audit.findings.length === 0 ? <p className="muted">No hay hallazgos registrados.</p> : <div className="audit-follow-up-finding-list">{audit.findings.map((finding) => { const actions = finding.actions ?? []; const findingEvaluations = finding.efficacyEvaluations ?? []; return <article key={finding.id} className={finding.status === 'VERIFIED' ? 'verified' : ''}><div className="audit-follow-up-finding-main"><div className="audit-follow-up-finding-title"><span className={`audit-report-finding-type ${finding.type.toLowerCase()}`}>{findingTypeLabels[finding.type] ?? finding.type}</span><span className={`status-${finding.status.toLowerCase()}`}>{findingStatusLabels[finding.status] ?? finding.status}</span></div><h4>{finding.title}</h4><p>{finding.description}</p><div className="audit-follow-up-finding-tags"><span>{actions.filter((action) => !isActionFinal(action.status)).length} acciones abiertas</span><span>{findingEvaluations.filter((evaluation) => evaluation.status !== 'COMPLETED' && evaluation.status !== 'CANCELLED').length} evaluaciones abiertas</span></div><div className="audit-follow-up-treatment-list">{actions.length === 0 ? <span className="audit-follow-up-no-treatment">Sin acciones registradas</span> : actions.map((action) => { const progress = Math.max(0, Math.min(100, action.progressPercent ?? 0)); const overdue = !isActionFinal(action.status) && Boolean(action.dueDate && new Date(action.dueDate).getTime() < now); return <div className="audit-follow-up-treatment" key={action.id}><div className="audit-follow-up-treatment-head"><strong>{action.title}</strong><span className={`audit-follow-up-action-status ${action.status.toLowerCase()}`}>{actionStatusLabels[action.status] ?? action.status}</span></div><div className="audit-follow-up-treatment-meta"><span>{action.responsible?.name ?? 'Sin responsable'}</span><span className={overdue ? 'overdue' : ''}>{action.dueDate ? `Vence ${formatDate(action.dueDate)}` : 'Sin plazo'}</span><span>{actionPriorityLabels[action.priority] ?? action.priority}</span></div><span className="audit-follow-up-progress" role="progressbar" aria-label={`Avance de ${action.title}: ${progress}%`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></span><small>{progress}% de avance</small></div> })}{findingEvaluations.length > 0 && <div className="audit-follow-up-evaluation-list">{findingEvaluations.map((evaluation) => <div key={evaluation.id}><span className={`audit-follow-up-evaluation-status ${evaluation.status.toLowerCase()}`}>{efficacyStatusLabels[evaluation.status] ?? evaluation.status}</span><strong>{evaluation.responsible?.name ?? 'Sin responsable'}</strong><small>{evaluation.scheduledDate ? `Programada ${formatDate(evaluation.scheduledDate)}` : 'Sin fecha programada'}</small></div>)}</div>}</div></div><button type="button" className="button secondary small-button" onClick={() => setSelectedFindingId(finding.id)}>Ver tratamiento</button></article> })}</div>}</section>
          </>
        )}
      </section>

      <section className="panel audit-follow-up-history"><div className="audit-follow-up-section-heading"><div><p className="detail-label">TRAZABILIDAD</p><h3>Historial del seguimiento</h3></div><span>{history.length} eventos</span></div>{historyError ? <p className="form-error" role="alert">{historyError}</p> : historyLoading ? <div className="inline-loading"><span className="loader" />Cargando historial…</div> : history.length === 0 ? <p className="muted">Todavía no hay operaciones CAPA registradas.</p> : <ol>{history.slice(0, 12).map((event) => <li key={event.id}><span className="audit-follow-up-history-dot" aria-hidden="true" /><div><strong>{eventLabels[event.eventType] ?? event.summary}</strong><span>{event.actorName ?? event.actor?.name ?? 'Sistema'} · {formatAuditDateTime(event.occurredAt)}</span></div></li>)}</ol>}</section>

       {selectedFinding && <FindingDossier key={selectedFinding.id} auditId={audit.id} finding={selectedFinding} users={users} canWrite={canOperate} onClose={() => setSelectedFindingId(null)} onChanged={async () => { await Promise.resolve(onChanged()); await loadFollowUp() }} onError={onError} onNotice={onNotice} />}
    </div>
  )
}
