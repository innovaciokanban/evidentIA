import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../../api'
import type { Audit, AuditPlan, AuditPlanActivity, AuditPlanResponse, AuditTeamMember, AuditTeamResponse, Process } from '../../types'
import { askConfirm } from '../ui/useConfirm'
import {
  activityDraftFromActivity,
  activeActivities,
  auditPlanActivityStatusLabels,
  auditPlanActivityTypeLabels,
  auditPlanStatusLabels,
  emptyAuditPlanActivityDraft,
  emptyAuditPlanDraft,
  independenceSummary,
  independenceSummaryLabel,
  toIsoDateTime,
  validateActivityDraft,
  type AuditPlanActivityDraft,
  type AuditPlanDraft,
} from './audit-plan.model'
import {
  auditTeamRoleLabels,
  independenceStatusClass,
  independenceStatusLabels,
} from './audit-team.model'
import { friendlyPlanError } from './audit-plan-errors'
import type { QualityUser } from './quality.model'
import { ActivityAuditorSummary, ActivityEditorWithAuditors } from './AuditPlanActivityAssignment'
import { AuditPlanActivityExecution } from './AuditPlanActivityExecution'

const dateFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })
const timeFormatter = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' })

const formatDate = (value: string | null | undefined): string => value ? dateFormatter.format(new Date(value)) : '—'
const formatTime = (value: string): string => timeFormatter.format(new Date(value))
const errorMessage = (error: unknown, fallback: string): string => error instanceof ApiError ? error.message : fallback
const sameIdSet = (left: string[], right: string[]): boolean => left.length === right.length && left.every((id) => right.includes(id))

type AuditPlanSectionProps = {
  audit: Audit
  users: QualityUser[]
  processes: Process[]
  canWrite: boolean
  readOnly: boolean
  onNotice: (message: string) => void
  onOpenTeam: () => void
  onOpenChecklistItem: (itemId: string) => void
  onCreateChecklistItem: (activity: AuditPlanActivity) => void
  onRequestChecklistProposals: (activity: AuditPlanActivity) => void
  onCreateFinding: (activity: AuditPlanActivity) => void
  onOpenFinding: (findingId: string) => void
  onCreateEvidence?: (activity: AuditPlanActivity) => void
  onOpenEvidence?: (kind: 'url' | 'pdf', evidenceId: string) => void
}

export function AuditPlanSection({ audit, users, processes, canWrite, readOnly, onNotice, onOpenTeam, onOpenChecklistItem, onCreateChecklistItem, onRequestChecklistProposals, onCreateFinding, onOpenFinding, onCreateEvidence, onOpenEvidence }: AuditPlanSectionProps) {
  const [plan, setPlan] = useState<AuditPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [planError, setPlanError] = useState('')
  const [teamError, setTeamError] = useState('')
  const [members, setMembers] = useState<AuditTeamMember[]>([])
  const [teamLoading, setTeamLoading] = useState(true)
  const [planEditorOpen, setPlanEditorOpen] = useState(false)
  const [planDraft, setPlanDraft] = useState<AuditPlanDraft>(emptyAuditPlanDraft)
  const [planSaving, setPlanSaving] = useState(false)
  const [statusSaving, setStatusSaving] = useState(false)
  const [activityEditor, setActivityEditor] = useState<AuditPlanActivity | 'new' | null>(null)
  const [activityDraft, setActivityDraft] = useState<AuditPlanActivityDraft>(emptyAuditPlanActivityDraft)
  const [activitySaving, setActivitySaving] = useState(false)
  const [activityError, setActivityError] = useState('')

  const loadPlan = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await api<AuditPlanResponse>(`/audits/${audit.id}/plan`)
      setPlan(result.plan)
    } catch (error) {
      setLoadError(errorMessage(error, 'No pudimos cargar el plan de auditoría.'))
    } finally {
      setLoading(false)
    }
  }, [audit.id])

  const loadTeam = useCallback(async () => {
    setTeamLoading(true)
    setTeamError('')
    try {
      const result = await api<AuditTeamResponse>(`/audits/${audit.id}/team`)
      setMembers(result.members)
    } catch (error) {
      setTeamError(errorMessage(error, 'No pudimos cargar el control de independencia.'))
    } finally {
      setTeamLoading(false)
    }
  }, [audit.id])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPlan()
      void loadTeam()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadPlan, loadTeam])

  const canManage = canWrite && !readOnly
  const canEditPlan = canManage && plan?.status === 'DRAFT'
  const relatedProcessIds = useMemo(() => new Set([audit.processId, ...(audit.relatedProcesses ?? []).map((process) => process.id)]), [audit.processId, audit.relatedProcesses])
  const processOptions = useMemo(() => processes.filter((process) => relatedProcessIds.has(process.id)), [processes, relatedProcessIds])
  const responsibleUsers = useMemo(() => users.filter((user) => user.companyId === audit.companyId && user.isActive !== false), [audit.companyId, users])
  const activeTeamMembers = useMemo(() => members.filter((member) => member.isActive && !member.removedAt), [members])
  const agenda = useMemo(() => activeActivities(plan?.activities ?? []), [plan?.activities])
  const retiredActivities = (plan?.activities ?? []).filter((activity) => activity.status === 'CANCELLED')
  const summary = useMemo(() => independenceSummary(members), [members])
  const completedActivities = agenda.filter((activity) => activity.status === 'COMPLETED').length
  const agendaProgress = agenda.length > 0 ? Math.round((completedActivities / agenda.length) * 100) : 0

  function openPlanEditor() {
    setPlanError('')
    setPlanDraft(plan ? {
      methodology: plan.methodology,
      samplingMethod: plan.samplingMethod ?? '',
      resources: plan.resources ?? '',
      notes: plan.notes ?? '',
    } : emptyAuditPlanDraft)
    setPlanEditorOpen(true)
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (planSaving) return
    if (planDraft.methodology.trim().length < 1) {
      setPlanError('La metodología es obligatoria.')
      return
    }
    setPlanSaving(true)
    setPlanError('')
    const payload = {
      methodology: planDraft.methodology.trim(),
      samplingMethod: planDraft.samplingMethod.trim() || null,
      resources: planDraft.resources.trim() || null,
      notes: planDraft.notes.trim() || null,
    }
    try {
      const result = await api<{ plan: AuditPlan }>(`/audits/${audit.id}/plan`, {
        method: plan ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
      setPlan(result.plan)
      setPlanEditorOpen(false)
      onNotice(plan ? 'Plan de auditoría actualizado.' : 'Plan de auditoría creado.')
    } catch (error) {
      setPlanError(friendlyPlanError(error, 'No se pudo guardar el plan de auditoría.'))
    } finally {
      setPlanSaving(false)
    }
  }

  async function changePlanStatus(status: 'READY' | 'APPROVED' | 'CANCELLED') {
    if (!plan || statusSaving || !canManage) return
    if (status === 'CANCELLED') {
      const confirmed = await askConfirm({
        title: 'Cancelar plan de auditoría',
        message: `El plan de «${audit.title}» quedará cancelado y no podrá continuar su flujo.`,
        confirmLabel: 'Cancelar plan',
        variant: 'danger',
      })
      if (!confirmed) return
    }
    setStatusSaving(true)
    setPlanError('')
    try {
      const result = await api<{ plan: AuditPlan }>(`/audits/${audit.id}/plan/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      })
      setPlan(result.plan)
      onNotice(`Plan de auditoría: ${auditPlanStatusLabels[status]}.`)
    } catch (error) {
      setPlanError(friendlyPlanError(error, 'No se pudo cambiar el estado del plan.'))
    } finally {
      setStatusSaving(false)
    }
  }

  function openNewActivity() {
    setActivityError('')
    setActivityDraft(emptyAuditPlanActivityDraft)
    setActivityEditor('new')
  }

  function openExistingActivity(activity: AuditPlanActivity) {
    setActivityError('')
    setActivityDraft(activityDraftFromActivity(activity))
    setActivityEditor(activity)
  }

  async function saveActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!plan || activitySaving) return
    const validationError = validateActivityDraft(activityDraft)
    if (validationError) {
      setActivityError(validationError)
      return
    }
    setActivitySaving(true)
    setActivityError('')
    const editing = activityEditor && activityEditor !== 'new' ? activityEditor : null
    const previousAuditorIds = editing?.auditors.map((auditor) => auditor.teamMemberId) ?? []
    const auditorsChanged = !sameIdSet(previousAuditorIds, activityDraft.auditorIds)
    const existingActivityIds = new Set(plan.activities.map((activity) => activity.id))
    const payload = {
      type: activityDraft.type,
      title: activityDraft.title.trim(),
      description: activityDraft.description.trim() || null,
      scheduledStart: toIsoDateTime(activityDraft.scheduledStart),
      scheduledEnd: toIsoDateTime(activityDraft.scheduledEnd),
      location: activityDraft.location.trim() || null,
      responsibleId: activityDraft.responsibleId || null,
      processId: activityDraft.processId || null,
      notes: activityDraft.notes.trim() || null,
    }
    try {
      const result = await api<{ plan: AuditPlan }>(
        editing ? `/audits/${audit.id}/plan/activities/${editing.id}` : `/audits/${audit.id}/plan/activities`,
        { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      )
      setPlan(result.plan)
      const savedActivity = editing ?? result.plan.activities.find((activity) => !existingActivityIds.has(activity.id))
      if (auditorsChanged && savedActivity) {
        try {
          const assignmentResult = await api<{ plan: AuditPlan }>(`/audits/${audit.id}/plan/activities/${savedActivity.id}/auditors`, {
            method: 'PUT',
            body: JSON.stringify({ auditTeamMemberIds: activityDraft.auditorIds }),
          })
          setPlan(assignmentResult.plan)
        } catch (error) {
          setActivityEditor(savedActivity)
          setActivityError(`La actividad se guardó, pero no se pudieron actualizar sus auditores. ${friendlyPlanError(error, 'Revisa la asignación e inténtalo de nuevo.')}`)
          return
        }
      } else if (!savedActivity) {
        setActivityError('La actividad se guardó, pero no pudimos identificarla para actualizar sus auditores.')
        return
      }
      setActivityEditor(null)
      onNotice(editing ? 'Actividad y auditores actualizados.' : 'Actividad y auditores añadidos a la agenda.')
    } catch (error) {
      setActivityError(friendlyPlanError(error, 'No se pudo guardar la actividad.'))
    } finally {
      setActivitySaving(false)
    }
  }

  async function removeActivity(activity: AuditPlanActivity) {
    if (activitySaving) return
    const confirmed = await askConfirm({
      title: 'Retirar actividad',
      message: `Se retirará «${activity.title}» de la agenda. La acción conserva la trazabilidad del plan.`,
      confirmLabel: 'Retirar actividad',
      variant: 'danger',
    })
    if (!confirmed) return
    setActivitySaving(true)
    setPlanError('')
    try {
      await api<void>(`/audits/${audit.id}/plan/activities/${activity.id}`, { method: 'DELETE' })
      await loadPlan()
      onNotice('Actividad retirada de la agenda.')
    } catch (error) {
      setPlanError(friendlyPlanError(error, 'No se pudo retirar la actividad.'))
    } finally {
      setActivitySaving(false)
    }
  }

  return (
    <div className="audit-plan-workspace">
      {loading ? <div className="audit-plan-state"><span className="loader" />Cargando plan de auditoría…</div> : loadError ? (
        <div className="audit-plan-state audit-plan-state-error" role="alert"><p>{loadError}</p><button type="button" className="button secondary" onClick={() => void loadPlan()}>Reintentar</button></div>
      ) : !plan ? (
        <>
          <section className="panel audit-plan-empty" aria-labelledby="audit-plan-empty-title">
            <span className="audit-plan-empty-mark" aria-hidden="true">◇</span>
            <p className="detail-label">PLANIFICACIÓN CONTROLADA</p>
            <h2 id="audit-plan-empty-title">Aún no hay un plan de auditoría</h2>
            <p>Define la metodología y la agenda sin duplicar el objetivo, alcance, criterios ni fechas de la auditoría.</p>
            {canManage && <button type="button" className="button primary" onClick={openPlanEditor}>Crear plan</button>}
            {!canManage && <span className="muted">Tu usuario tiene permisos de consulta.</span>}
          </section>
          {planEditorOpen && canManage && <PlanEditor draft={planDraft} saving={planSaving} error={planError} editing={false} onChange={setPlanDraft} onSubmit={(event) => void savePlan(event)} onClose={() => setPlanEditorOpen(false)} />}
        </>
      ) : (
        <>
          <section className="panel audit-plan-overview" aria-labelledby="audit-plan-title">
            <header className="audit-plan-header">
              <div>
                <p className="detail-label">PLANIFICACIÓN CONTROLADA</p>
                <div className="audit-plan-title-row"><h2 id="audit-plan-title">Plan de auditoría</h2><span className={`badge audit-plan-status ${plan.status.toLowerCase()}`}>{auditPlanStatusLabels[plan.status]}</span></div>
                <p className="muted">La información base se toma del expediente de {audit.code}; aquí se documentan el método y la agenda.</p>
              </div>
              <div className="audit-plan-actions">
                {canEditPlan && <button type="button" className="button secondary" onClick={openPlanEditor}>Editar plan</button>}
                {canManage && plan.status === 'DRAFT' && <button type="button" className="button primary" onClick={() => void changePlanStatus('READY')} disabled={statusSaving}>Marcar listo</button>}
                {canManage && plan.status === 'READY' && <button type="button" className="button primary" onClick={() => void changePlanStatus('APPROVED')} disabled={statusSaving}>Aprobar plan</button>}
                {canManage && (plan.status === 'DRAFT' || plan.status === 'READY') && <button type="button" className="button danger small-button" onClick={() => void changePlanStatus('CANCELLED')} disabled={statusSaving}>Cancelar</button>}
              </div>
            </header>
            {planError && <p className="form-error" role="alert">{planError}</p>}
            {plan.status === 'APPROVED' && plan.approvedBy && <p className="audit-plan-approval-note" role="status">Aprobado por <strong>{plan.approvedBy.name}</strong> el {formatDate(plan.approvedAt)}. El contenido aprobado es de solo lectura.</p>}
            {plan.status === 'READY' && <p className="audit-plan-ready-note" role="status">El plan está listo para aprobación. La aprobación final valida nuevamente la agenda y la independencia del equipo en el servidor.</p>}
             <div className="audit-plan-audit-context">
               <div><span>Objetivo</span><strong>{audit.objectives || 'Sin objetivo registrado'}</strong></div>
               <div><span>Alcance</span><strong>{audit.scope}</strong></div>
               <div><span>Criterios</span><strong>{audit.criteria}</strong></div>
               <div><span>Fechas de auditoría</span><strong>{formatDate(audit.plannedDate)}{audit.startDate ? ` · ${formatDate(audit.startDate)}` : ''}{audit.endDate ? ` · ${formatDate(audit.endDate)}` : ''}</strong></div>
               <div><span>Programa de auditoría</span><strong>{audit.auditProgramId || 'Sin programa asociado'}</strong></div>
              </div>
             <div className="audit-plan-progress-summary" aria-label="Avance de la agenda">
               <div><span>Avance de agenda</span><strong>{agendaProgress}%</strong><small>{completedActivities} de {agenda.length} actividades completadas</small></div>
               <span className="audit-plan-progress-track" role="progressbar" aria-label="Actividades completadas" aria-valuemin={0} aria-valuemax={agenda.length || 1} aria-valuenow={completedActivities}><i style={{ width: `${agendaProgress}%` }} /></span>
               <div className="audit-plan-progress-facts"><span><strong>{agenda.filter((activity) => activity.status === 'IN_PROGRESS').length}</strong> en curso</span><span><strong>{agenda.filter((activity) => activity.status === 'PLANNED').length}</strong> programadas</span></div>
             </div>
             <div className="audit-plan-content-grid">
              <PlanField label="Metodología" value={plan.methodology} />
              <PlanField label="Método de muestreo" value={plan.samplingMethod} empty="No especificado." />
              <PlanField label="Recursos" value={plan.resources} empty="No registrados." />
              <PlanField label="Observaciones" value={plan.notes} empty="Sin observaciones." />
            </div>
          </section>

          {planEditorOpen && canEditPlan && <PlanEditor draft={planDraft} saving={planSaving} error={planError} editing onChange={setPlanDraft} onSubmit={(event) => void savePlan(event)} onClose={() => setPlanEditorOpen(false)} />}

          <section className="panel audit-plan-agenda" aria-labelledby="audit-plan-agenda-title">
            <header className="audit-plan-section-header">
              <div><p className="detail-label">SECUENCIA PROGRAMADA</p><h2 id="audit-plan-agenda-title">Agenda de auditoría</h2><p className="muted">Orden cronológico de reuniones, revisiones y entrevistas. Las actividades sin proceso sirven para coordinar momentos generales.</p></div>
              {canEditPlan && <button type="button" className="button primary" onClick={openNewActivity}>+ Añadir actividad</button>}
            </header>
            {agenda.length === 0 ? (
              <div className="audit-plan-agenda-empty" role="status"><strong>Agenda vacía</strong><p>Añade al menos una actividad para poder marcar el plan como listo.</p>{canEditPlan && <button type="button" className="button secondary" onClick={openNewActivity}>Añadir primera actividad</button>}</div>
            ) : (
               <div className="audit-plan-activity-list">{agenda.map((activity) => <div className="audit-plan-activity-item" key={activity.id}><ActivityCard activity={activity} canEdit={Boolean(canEditPlan)} busy={activitySaving} onEdit={() => openExistingActivity(activity)} onRemove={() => void removeActivity(activity)} /><ActivityAuditorSummary auditors={activity.auditors ?? []} /><AuditPlanActivityExecution key={`${activity.id}:${activity.updatedAt}`} audit={audit} plan={plan} activity={activity} canWrite={canWrite} readOnly={readOnly} onUpdated={setPlan} onNotice={onNotice} onOpenChecklistItem={onOpenChecklistItem} onCreateChecklistItem={onCreateChecklistItem} onRequestChecklistProposals={onRequestChecklistProposals} onCreateFinding={onCreateFinding} onOpenFinding={onOpenFinding} onCreateEvidence={onCreateEvidence} onOpenEvidence={onOpenEvidence} /></div>)}</div>
            )}
            {retiredActivities.length > 0 && <details className="audit-plan-retired"><summary>Actividades retiradas ({retiredActivities.length})</summary><ul>{retiredActivities.map((activity) => <li key={activity.id}><strong>{activity.title}</strong><span>{formatDate(activity.scheduledStart)}</span><span>{auditPlanActivityStatusLabels[activity.status]}</span></li>)}</ul></details>}
          </section>

          <section className="panel audit-plan-independence" aria-labelledby="audit-plan-independence-title">
            <header className="audit-plan-section-header"><div><p className="detail-label">SALVAGUARDA</p><h2 id="audit-plan-independence-title">Control de independencia</h2><p className="muted">Mitigado documenta una salvaguarda; no equivale a Sin conflicto.</p></div><button type="button" className="button secondary" onClick={onOpenTeam}>Revisar equipo auditor</button></header>
            {teamLoading ? <div className="audit-plan-inline-state"><span className="loader" />Cargando independencia…</div> : teamError ? <div className="audit-plan-inline-state audit-plan-inline-error" role="alert"><span>{teamError}</span><button type="button" className="button secondary small-button" onClick={() => void loadTeam()}>Reintentar</button></div> : (
              <>
                <div className={`audit-plan-independence-summary ${summary.conflicts > 0 ? 'is-conflict' : summary.pending > 0 ? 'is-pending' : summary.mitigated > 0 ? 'is-mitigated' : 'is-clear'}`} role="status"><strong>{independenceSummaryLabel(members)}</strong><span>{summary.total} {summary.total === 1 ? 'integrante activo' : 'integrantes activos'} · {summary.leaders ? 'líder asignado' : 'sin líder'}</span></div>
                <div className="audit-plan-independence-metrics"><div><strong>{summary.clear}</strong><span>Sin conflicto</span></div><div className={summary.mitigated > 0 ? 'is-mitigated' : ''}><strong>{summary.mitigated}</strong><span>Mitigados</span></div><div className={summary.pending > 0 ? 'is-pending' : ''}><strong>{summary.pending}</strong><span>Pendientes</span></div><div className={summary.conflicts > 0 ? 'is-conflict' : ''}><strong>{summary.conflicts}</strong><span>Conflictos</span></div></div>
                {members.length === 0 ? <p className="audit-plan-independence-empty">No hay integrantes activos asignados a esta auditoría.</p> : <div className="audit-plan-member-list">{members.map((member) => <article key={member.id} className={`audit-plan-member-card ${independenceStatusClass(member.independenceStatus)}`}><div><strong>{member.auditor.name}</strong><span>{auditTeamRoleLabels[member.role]} · {member.auditor.type === 'INTERNAL' ? 'Interno' : 'Externo'}</span></div><span className={`audit-plan-independence-badge ${independenceStatusClass(member.independenceStatus)}`}>{independenceStatusLabels[member.independenceStatus]}</span>{member.conflictDescription && <p><strong>Conflicto:</strong> {member.conflictDescription}</p>}{member.mitigationMeasures && <p><strong>Mitigación:</strong> {member.mitigationMeasures}</p>}</article>)}</div>}
              </>
            )}
          </section>
        </>
      )}

      {activityEditor && canEditPlan && (activeTeamMembers.length > 0 ? <ActivityEditorWithAuditors draft={activityDraft} users={responsibleUsers} processes={processOptions} members={activeTeamMembers} saving={activitySaving} error={activityError} editing={activityEditor !== 'new'} onChange={setActivityDraft} onSubmit={(event) => void saveActivity(event)} onClose={() => { if (!activitySaving) setActivityEditor(null) }} /> : <ActivityEditor draft={activityDraft} users={responsibleUsers} processes={processOptions} saving={activitySaving} error={activityError} editing={activityEditor !== 'new'} onChange={setActivityDraft} onSubmit={(event) => void saveActivity(event)} onClose={() => { if (!activitySaving) setActivityEditor(null) }} />)}
    </div>
  )
}

function PlanField({ label, value, empty = 'Sin información registrada.' }: { label: string; value: string | null; empty?: string }) {
  return <div><span>{label}</span><p>{value?.trim() || empty}</p></div>
}

function PlanEditor({ draft, saving, error, editing, onChange, onSubmit, onClose }: { draft: AuditPlanDraft; saving: boolean; error: string; editing: boolean; onChange: (draft: AuditPlanDraft) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  return <form className="audit-plan-editor" onSubmit={onSubmit}><div className="audit-plan-editor-heading"><div><p className="detail-label">{editing ? 'EDITAR PLAN' : 'NUEVO PLAN'}</p><h3>{editing ? 'Ajustar la preparación' : 'Crear plan de auditoría'}</h3></div><button type="button" className="icon-button" aria-label="Cerrar editor" onClick={onClose}>×</button></div><p className="muted">El objetivo, alcance, criterios y fechas permanecen en la información general de la auditoría.</p><label>Metodología<textarea value={draft.methodology} onChange={(event) => onChange({ ...draft, methodology: event.target.value })} minLength={1} maxLength={5000} rows={4} required placeholder="Describe el enfoque, técnicas y secuencia de trabajo." /></label><div className="form-grid"><label>Método de muestreo<input value={draft.samplingMethod} onChange={(event) => onChange({ ...draft, samplingMethod: event.target.value })} maxLength={5000} placeholder="Ej. Muestreo dirigido por riesgo" /></label><label>Recursos<input value={draft.resources} onChange={(event) => onChange({ ...draft, resources: event.target.value })} maxLength={5000} placeholder="Personas, documentos o herramientas" /></label></div><label>Observaciones<textarea value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} maxLength={10000} rows={3} /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear plan'}</button></div></form>
}

function ActivityCard({ activity, canEdit, busy, onEdit, onRemove }: { activity: AuditPlanActivity; canEdit: boolean; busy: boolean; onEdit: () => void; onRemove: () => void }) {
  return <article className="audit-plan-activity-card"><div className="audit-plan-activity-time"><strong>{formatTime(activity.scheduledStart)}</strong><span>{formatTime(activity.scheduledEnd)}</span><small>{formatDate(activity.scheduledStart)}</small></div><div className="audit-plan-activity-body"><div className="audit-plan-activity-heading"><div><span className="audit-plan-activity-type">{auditPlanActivityTypeLabels[activity.type]}</span><h3>{activity.title}</h3></div><span className={`badge audit-plan-activity-status ${activity.status.toLowerCase()}`}>{auditPlanActivityStatusLabels[activity.status]}</span></div>{activity.description && <p>{activity.description}</p>}<div className="audit-plan-activity-meta"><span><small>Proceso</small><strong>{activity.process ? `${activity.process.code ?? 'Sin código'} · ${activity.process.name}` : 'Actividad general'}</strong></span><span><small>Responsable</small><strong>{activity.responsible?.name ?? 'Sin asignar'}</strong></span>{activity.location && <span><small>Modalidad / lugar</small><strong>{activity.location}</strong></span>}</div>{activity.notes && <p className="audit-plan-activity-note">{activity.notes}</p>}{canEdit && <div className="audit-plan-activity-actions"><button type="button" className="button secondary small-button" onClick={onEdit} disabled={busy}>Editar</button><button type="button" className="button danger small-button" onClick={onRemove} disabled={busy}>Retirar</button></div>}</div></article>
}

function ActivityEditor({ draft, users, processes, saving, error, editing, onChange, onSubmit, onClose }: { draft: AuditPlanActivityDraft; users: QualityUser[]; processes: Process[]; saving: boolean; error: string; editing: boolean; onChange: (draft: AuditPlanActivityDraft) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  return <div className="drawer-backdrop centered-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="drawer centered-modal company-modal quality-plan-activity-modal" onSubmit={onSubmit} role="dialog" aria-modal="true" aria-labelledby="audit-plan-activity-title"><div className="company-modal-header"><div className="company-modal-icon" aria-hidden="true">◷</div><div className="company-modal-title"><p className="eyebrow">{editing ? 'EDITAR AGENDA' : 'NUEVA ACTIVIDAD'}</p><h2 id="audit-plan-activity-title">{editing ? 'Editar actividad' : 'Añadir actividad'}</h2><p className="company-modal-subtitle">Programa un momento concreto de la auditoría. El backend validará fechas, responsable, proceso y solapamientos.</p></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>×</button></div><div className="quality-plan-activity-body"><div className="form-grid"><label>Tipo<select value={draft.type} onChange={(event) => onChange({ ...draft, type: event.target.value as AuditPlanActivityDraft['type'] })}>{(Object.keys(auditPlanActivityTypeLabels) as AuditPlanActivityDraft['type'][]).map((type) => <option key={type} value={type}>{auditPlanActivityTypeLabels[type]}</option>)}</select></label><label>Título<input value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} minLength={3} maxLength={200} required autoFocus /></label></div><div className="form-grid"><label>Inicio<input type="datetime-local" value={draft.scheduledStart} onChange={(event) => onChange({ ...draft, scheduledStart: event.target.value })} required /></label><label>Fin<input type="datetime-local" value={draft.scheduledEnd} onChange={(event) => onChange({ ...draft, scheduledEnd: event.target.value })} required /></label></div><div className="form-grid"><label>Proceso vinculado<select value={draft.processId} onChange={(event) => onChange({ ...draft, processId: event.target.value })}><option value="">Actividad general</option>{processes.map((process) => <option key={process.id} value={process.id}>{process.code ?? 'Sin código'} · {process.name}</option>)}</select></label><label>Responsable<select value={draft.responsibleId} onChange={(event) => onChange({ ...draft, responsibleId: event.target.value })}><option value="">Sin asignar</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label></div><label>Descripción<textarea value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} maxLength={5000} rows={3} /></label><label>Modalidad o lugar<input value={draft.location} onChange={(event) => onChange({ ...draft, location: event.target.value })} maxLength={500} placeholder="Ej. Presencial · Planta principal" /></label><label>Notas<textarea value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} maxLength={5000} rows={2} /></label>{error && <p className="form-error" role="alert">{error}</p>}</div><div className="drawer-actions"><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Añadir actividad'}</button></div></form></div>
}
