import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api'
import type { AuditIndependenceStatus, AuditTeamMember, AuditTeamRole, AuditTeamResponse, Auditor } from '../../types'
import { askConfirm } from '../ui/useConfirm'
import { AuditIndependenceForm } from './AuditIndependenceForm'
import { AuditTeamAssignmentForm } from './AuditTeamAssignmentForm'
import {
  activeTeamSummary,
  auditTeamRoleLabels,
  auditorStatusLabels,
  auditorTypeLabels,
  independenceStatusClass,
  independenceStatusLabels,
  availableAuditorsForTeam,
  teamReadiness,
} from './audit-team.model'

const dateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

const formatDate = (value: string | null | undefined) => value ? dateFormatter.format(new Date(value)) : '—'
const errorMessage = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback

type AuditTeamSectionProps = {
  auditId: string
  companyId: string
  canWrite: boolean
  readOnly: boolean
}

type MemberUpdate = { role?: AuditTeamRole; observations?: string | null }
type IndependenceUpdate = { status: AuditIndependenceStatus; declaration: string | null; conflictDescription: string | null; mitigationMeasures: string | null }

export function AuditTeamSection({ auditId, companyId, canWrite, readOnly }: AuditTeamSectionProps) {
  const [members, setMembers] = useState<AuditTeamMember[]>([])
  const [history, setHistory] = useState<AuditTeamMember[]>([])
  const [auditors, setAuditors] = useState<Auditor[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [assignmentSaving, setAssignmentSaving] = useState(false)
  const [assignmentError, setAssignmentError] = useState('')
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null)
  const [evaluationMember, setEvaluationMember] = useState<AuditTeamMember | null>(null)
  const [evaluationSaving, setEvaluationSaving] = useState(false)
  const [evaluationError, setEvaluationError] = useState('')

  const loadTeam = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const query = `?companyId=${encodeURIComponent(companyId)}`
      const [teamResult, auditorsResult] = await Promise.all([
        api<AuditTeamResponse>(`/audits/${auditId}/team`),
        api<{ auditors: Auditor[] }>(`/auditors${query}`),
      ])
      setMembers(teamResult.members)
      setHistory(teamResult.history)
      setAuditors(auditorsResult.auditors)
    } catch (requestError) {
      setLoadError(errorMessage(requestError, 'No pudimos cargar el equipo auditor.'))
    } finally {
      setLoading(false)
    }
  }, [auditId, companyId])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadTeam() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadTeam])

  const canManage = canWrite && !readOnly
  const summary = useMemo(() => activeTeamSummary(members), [members])
  const leader = members.find((member) => member.role === 'LEAD') ?? null
  const availableAuditors = useMemo(() => availableAuditorsForTeam(auditors, members), [auditors, members])
  const readiness = teamReadiness(members)
  const prepared = Boolean(leader && readiness === 'READY')
  const readinessClass = prepared ? 'ready' : 'attention'
  const readinessLabel = prepared
    ? 'Equipo evaluado'
    : readiness === 'EMPTY'
      ? 'Sin equipo'
    : !leader
      ? 'Falta líder'
      : readiness === 'CONFLICT'
        ? 'Conflictos por resolver'
        : readiness === 'MITIGATED'
          ? 'Con mitigaciones documentadas'
          : readiness === 'PENDING'
            ? 'Evaluaciones pendientes'
            : 'Sin equipo'

  async function refreshAfterChange(message: string) {
    await loadTeam()
    setNotice(message)
    setActionError('')
  }

  async function assignMember(payload: { auditorId: string; role: AuditTeamRole; observations: string | null }) {
    if (assignmentSaving) return
    setAssignmentSaving(true)
    setAssignmentError('')
    try {
      await api<{ member: AuditTeamMember }>(`/audits/${auditId}/team`, { method: 'POST', body: JSON.stringify(payload) })
      setAssignmentOpen(false)
      await refreshAfterChange('Integrante asignado al equipo. Su independencia queda pendiente de evaluación.')
    } catch (requestError) {
      setAssignmentError(errorMessage(requestError, 'No se pudo asignar el integrante.'))
    } finally {
      setAssignmentSaving(false)
    }
  }

  async function updateMember(memberId: string, payload: MemberUpdate) {
    if (busyMemberId) return
    setBusyMemberId(memberId)
    setActionError('')
    try {
      await api<{ member: AuditTeamMember }>(`/audits/${auditId}/team/${memberId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      await refreshAfterChange('Integrante actualizado.')
    } catch (requestError) {
      setActionError(errorMessage(requestError, 'No se pudo actualizar el integrante.'))
    } finally {
      setBusyMemberId(null)
    }
  }

  async function removeMember(member: AuditTeamMember) {
    if (busyMemberId) return
    const confirmed = await askConfirm({
      title: 'Retirar del equipo auditor',
      message: `Se retirará a ${member.auditor.name} de esta auditoría. Esto no elimina al profesional del Banco de Auditores y conserva su historial.`,
      confirmLabel: 'Retirar del equipo',
      variant: 'danger',
    })
    if (!confirmed) return
    setBusyMemberId(member.id)
    setActionError('')
    try {
      await api<{ member: AuditTeamMember }>(`/audits/${auditId}/team/${member.id}`, { method: 'DELETE' })
      await refreshAfterChange('Integrante retirado del equipo. El profesional sigue en el Banco de Auditores.')
    } catch (requestError) {
      setActionError(errorMessage(requestError, 'No se pudo retirar el integrante.'))
    } finally {
      setBusyMemberId(null)
    }
  }

  async function evaluateIndependence(payload: IndependenceUpdate) {
    if (!evaluationMember || evaluationSaving) return
    setEvaluationSaving(true)
    setEvaluationError('')
    try {
      await api<{ member: AuditTeamMember }>(`/audits/${auditId}/team/${evaluationMember.id}/independence`, { method: 'PATCH', body: JSON.stringify(payload) })
      setEvaluationMember(null)
      await refreshAfterChange('Evaluación de independencia guardada.')
    } catch (requestError) {
      setEvaluationError(errorMessage(requestError, 'No se pudo guardar la evaluación de independencia.'))
    } finally {
      setEvaluationSaving(false)
    }
  }

  return (
    <div className="audit-team-workspace">
      <section className="panel audit-team-section" aria-labelledby="audit-team-title">
        <div className="audit-team-header">
          <div>
            <p className="detail-label">COMPOSICIÓN Y SALVAGUARDA</p>
            <h2 id="audit-team-title">Equipo auditor</h2>
            <p className="muted">Asigna profesionales del banco, define sus funciones y documenta su independencia para esta auditoría.</p>
          </div>
          <div className="audit-team-header-actions">
            <span className={`audit-team-readiness ${readinessClass}`}>{readinessLabel}</span>
            {canManage && <button type="button" className="button primary" onClick={() => { setAssignmentError(''); setNotice(''); setAssignmentOpen(true) }} disabled={assignmentSaving}>+ Asignar integrante</button>}
          </div>
        </div>

        <div className="audit-team-indicators" aria-label="Indicadores del equipo auditor">
           <div><strong>{summary.members}</strong><span>Integrantes activos</span></div>
           <div><strong>{summary.leaders ? 'Sí' : 'No'}</strong><span>Líder asignado</span></div>
           <div><strong>{availableAuditors.length}</strong><span>Auditores disponibles</span></div>
           <div className={summary.pending > 0 ? 'attention' : ''}><strong>{summary.pending}</strong><span>Independencias pendientes</span></div>
           <div className={summary.conflicts > 0 ? 'danger' : ''}><strong>{summary.conflicts}</strong><span>Conflictos abiertos</span></div>
           <div className={summary.mitigated > 0 ? 'mitigated' : ''}><strong>{summary.mitigated}</strong><span>Mitigaciones documentadas</span></div>
        </div>

        {notice && <p className="notice success" role="status">{notice}</p>}
        {actionError && <p className="notice error" role="alert">{actionError}</p>}
        {readOnly && <p className="audit-team-readonly-note">La auditoría está cerrada o cancelada. El equipo se muestra en modo consulta.</p>}

        {assignmentOpen && canManage && <AuditTeamAssignmentForm auditors={availableAuditors} leaderExists={Boolean(leader)} saving={assignmentSaving} error={assignmentError} onSubmit={(payload) => void assignMember(payload)} onClose={() => { if (!assignmentSaving) setAssignmentOpen(false) }} />}

        {loading ? <p className="audit-team-state">Cargando equipo auditor…</p> : loadError ? (
          <div className="audit-team-state audit-team-state-error" role="alert"><p>{loadError}</p><button type="button" className="button secondary" onClick={() => void loadTeam()}>Reintentar</button></div>
        ) : members.length === 0 ? (
          <div className="audit-team-empty"><strong>Aún no hay integrantes asignados</strong><p>El equipo se construye desde el Banco de Auditores. Cada nueva asignación inicia con independencia pendiente.</p>{canManage && <button type="button" className="button secondary" onClick={() => setAssignmentOpen(true)} disabled={!availableAuditors.length}>Asignar primer integrante</button>}</div>
        ) : (
          <div className="audit-team-member-list">
            {members.map((member) => <AuditTeamMemberCard key={`${member.id}-${member.updatedAt}`} member={member} canManage={canManage} leaderExists={Boolean(leader)} saving={busyMemberId === member.id} onUpdate={(payload) => void updateMember(member.id, payload)} onEvaluate={() => { setEvaluationError(''); setEvaluationMember(member) }} onRemove={() => void removeMember(member)} />)}
          </div>
        )}

        {history.length > members.length && <details className="audit-team-history"><summary>Historial de asignaciones ({history.length})</summary><div className="audit-team-history-list">{history.filter((member) => !member.isActive).map((member) => <div key={member.id} className="audit-team-history-row"><strong>{member.auditor.name}</strong><span>{auditTeamRoleLabels[member.role]}</span><span>Asignado {formatDate(member.assignedAt)}</span><span>Retirado {formatDate(member.removedAt)}</span><span>{independenceStatusLabels[member.independenceStatus]}</span></div>)}</div></details>}
      </section>
      {evaluationMember && <AuditIndependenceForm member={evaluationMember} saving={evaluationSaving} error={evaluationError} onSubmit={(payload) => void evaluateIndependence(payload)} onClose={() => { if (!evaluationSaving) setEvaluationMember(null) }} />}
    </div>
  )
}

function AuditTeamMemberCard({ member, canManage, leaderExists, saving, onUpdate, onEvaluate, onRemove }: {
  member: AuditTeamMember
  canManage: boolean
  leaderExists: boolean
  saving: boolean
  onUpdate: (payload: MemberUpdate) => void
  onEvaluate: () => void
  onRemove: () => void
}) {
  const [observations, setObservations] = useState(member.observations ?? '')
  const [role, setRole] = useState<AuditTeamRole>(member.role)

  const observationsChanged = observations.trim() !== (member.observations ?? '')
  const roleChanged = role !== member.role
  const hasActiveConflict = member.independenceStatus === 'CONFLICT'
  const isPending = member.independenceStatus === 'PENDING'

  return (
    <article className={`audit-team-member-card${hasActiveConflict ? ' conflict' : ''}`}>
      <header className="audit-team-member-header">
        <div className="audit-team-member-identity">
          <span className="audit-team-avatar" aria-hidden="true">{member.auditor.name.slice(0, 1).toUpperCase()}</span>
          <div><h3>{member.auditor.name}</h3><p>{member.auditor.email}</p></div>
        </div>
        <div className="audit-team-member-badges"><span className={`badge audit-team-role ${member.role.toLowerCase()}`}>{auditTeamRoleLabels[member.role]}</span><span className="badge">{auditorTypeLabels[member.auditor.type]}</span><span className={`badge auditor-bank-status ${member.auditor.status.toLowerCase()}`}>{auditorStatusLabels[member.auditor.status]}</span></div>
      </header>
      <div className="audit-team-member-meta"><span>{member.auditor.position || 'Sin cargo registrado'}</span><span>{member.auditor.organization || 'Sin organización registrada'}</span></div>
      <div className="audit-team-competencies"><strong>Competencias</strong>{member.auditor.competencies.length ? <ul>{member.auditor.competencies.map((competency) => <li key={competency.id}><span>{competency.name}</span><span aria-label={`Nivel ${competency.level} de 5`}>{competency.level}/5</span></li>)}</ul> : <p>Sin competencias registradas.</p>}</div>
      <div className={`audit-team-independence ${independenceStatusClass(member.independenceStatus)}`}>
        <div className="audit-team-independence-heading"><div><strong>Independencia</strong><span className={`audit-team-status ${independenceStatusClass(member.independenceStatus)}`}>{independenceStatusLabels[member.independenceStatus]}</span></div>{canManage && <button type="button" className="button secondary small-button" onClick={onEvaluate} disabled={saving}>{isPending ? 'Evaluar' : 'Actualizar evaluación'}</button>}</div>
        {member.independenceDeclaration && <p>{member.independenceDeclaration}</p>}
        {member.conflictDescription && <p><strong>Conflicto:</strong> {member.conflictDescription}</p>}
        {member.mitigationMeasures && <p><strong>Mitigación:</strong> {member.mitigationMeasures}</p>}
        {member.independenceEvaluatedBy && <small>Evaluó {member.independenceEvaluatedBy.name} · {formatDate(member.independenceEvaluatedAt)}</small>}
        {isPending && <small>Debe registrarse una evaluación antes de considerar el equipo preparado.</small>}
      </div>
       {canManage && <details className="audit-team-member-management">
         <summary>Gestionar integrante</summary>
         <div className="audit-team-member-controls">
           <label>Función<select value={role} onChange={(event) => setRole(event.target.value as AuditTeamRole)} disabled={saving}>{Object.entries(auditTeamRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
           {role === 'LEAD' && leaderExists && member.role !== 'LEAD' && <small className="audit-team-control-note">Cambiar a líder reemplazará al líder actual.</small>}
           <label className="audit-team-observations">Observaciones<textarea value={observations} onChange={(event) => setObservations(event.target.value)} maxLength={5000} rows={2} disabled={saving} /></label>
           <div className="audit-team-control-actions"><button type="button" className="button secondary small-button" onClick={() => onUpdate({ ...(roleChanged ? { role } : {}), ...(observationsChanged ? { observations: observations.trim() || null } : {}) })} disabled={saving || (!roleChanged && !observationsChanged)}>{saving ? 'Guardando…' : 'Guardar cambios'}</button><button type="button" className="text-button danger-text" onClick={onRemove} disabled={saving}>Retirar del equipo</button></div>
         </div>
       </details>}
    </article>
  )
}
