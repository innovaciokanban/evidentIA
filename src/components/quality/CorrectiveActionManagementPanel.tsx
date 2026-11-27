import { useState, type FormEvent } from 'react'
import { api, apiUpload } from '../../api'
import type { AuditActionAcceptanceCriterion, AuditCorrectiveAction, AuditFinding } from '../../types'
import { askConfirm } from '../ui/useConfirm'
import { formatAuditCalendarDate, formatAuditDateTime } from './audit-history.model'
import { actionPriorityLabels, actionStatusLabels, type QualityUser } from './quality.model'
import { actionCanComplete, actionCurrentPercent, actionDeadlineStatus, correctiveActionDeadlineLabels, pendingImplementationCriteria } from './corrective-action.model'
import { correctiveActionRequestMessage } from './corrective-action-errors'

type ActionDraft = {
  title: string
  description: string
  objective: string
  implementationPlan: string
  resources: string
  observations: string
  responsibleId: string
  priority: AuditCorrectiveAction['priority']
  required: boolean
  evidenceRequired: boolean
  dueDate: string
}

type CriterionDraft = {
  type: AuditActionAcceptanceCriterion['type']
  description: string
  expectedResult: string
  required: boolean
  isMet: boolean
  observations: string
}

type ProgressDraft = {
  note: string
  activities: string
  results: string
  difficulties: string
  pendingActivities: string
  observations: string
  percent: string
}

const emptyActionDraft: ActionDraft = { title: '', description: '', objective: '', implementationPlan: '', resources: '', observations: '', responsibleId: '', priority: 'MEDIUM', required: true, evidenceRequired: false, dueDate: '' }
const emptyCriterionDraft: CriterionDraft = { type: 'IMPLEMENTATION', description: '', expectedResult: '', required: true, isMet: false, observations: '' }
const emptyProgressDraft: ProgressDraft = { note: '', activities: '', results: '', difficulties: '', pendingActivities: '', observations: '', percent: '' }

const actionDraftFrom = (action: AuditCorrectiveAction): ActionDraft => ({
  title: action.title,
  description: action.description,
  objective: action.objective ?? '',
  implementationPlan: action.implementationPlan ?? '',
  resources: action.resources ?? '',
  observations: action.observations ?? '',
  responsibleId: action.responsible?.id ?? '',
  priority: action.priority,
  required: action.required,
  evidenceRequired: action.evidenceRequired ?? false,
  dueDate: action.dueDate?.slice(0, 10) ?? '',
})

export function CorrectiveActionManagementPanel({ auditId, finding, actions, users, canWrite, onChanged, onError, onNotice, openNewActionForEfficacyId, onNewActionRequestHandled }: {
  auditId: string
  finding: AuditFinding
  actions: AuditCorrectiveAction[]
  users: QualityUser[]
  canWrite: boolean
  onChanged: () => Promise<void> | void
  onError: (message: string) => void
  onNotice: (message: string) => void
  openNewActionForEfficacyId?: string | null
  onNewActionRequestHandled?: () => void
}) {
  const [actionEditorState, setActionEditorState] = useState<'new' | string | null>(null)
  const [actionDraft, setActionDraft] = useState<ActionDraft>(emptyActionDraft)
  const [criterionEditor, setCriterionEditor] = useState<{ actionId: string; criterion?: AuditActionAcceptanceCriterion } | null>(null)
  const [criterionDraft, setCriterionDraft] = useState<CriterionDraft>(emptyCriterionDraft)
  const [progressFor, setProgressFor] = useState<string | null>(null)
  const [progressDraft, setProgressDraft] = useState<ProgressDraft>(emptyProgressDraft)
  const [completionFor, setCompletionFor] = useState<string | null>(null)
  const [completionObservations, setCompletionObservations] = useState('')
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const readonly = !canWrite || finding.status === 'VERIFIED'
  const [newActionEfficacyEvaluationId, setNewActionEfficacyEvaluationId] = useState<string | null>(null)
  const actionEditor = openNewActionForEfficacyId && !readonly ? 'new' : actionEditorState
  const setActionEditor = (value: 'new' | string | null) => {
    if (value === null && openNewActionForEfficacyId) onNewActionRequestHandled?.()
    setActionEditorState(value)
  }
  const efficacyEvaluationIdForNewAction = newActionEfficacyEvaluationId ?? openNewActionForEfficacyId

  const saveAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!actionEditor || busy || readonly) return
    setBusy(true)
    try {
      const body = { ...actionDraft, responsibleId: actionDraft.responsibleId || null, dueDate: actionDraft.dueDate || null, objective: actionDraft.objective.trim() || null, implementationPlan: actionDraft.implementationPlan.trim() || null, resources: actionDraft.resources.trim() || null, observations: actionDraft.observations.trim() || null, ...(actionEditor === 'new' && efficacyEvaluationIdForNewAction ? { efficacyEvaluationId: efficacyEvaluationIdForNewAction } : {}) }
      if (actionEditor === 'new') await api(`/audits/${auditId}/findings/${finding.id}/actions`, { method: 'POST', body: JSON.stringify(body) })
      else await api(`/audits/${auditId}/actions/${actionEditor}`, { method: 'PATCH', body: JSON.stringify(body) })
      setActionEditor(null)
      setNewActionEfficacyEvaluationId(null)
      await onChanged()
      onNotice(actionEditor === 'new' ? 'Acción correctiva creada.' : 'Acción correctiva actualizada.')
    } catch (error) {
      const message = correctiveActionRequestMessage(error, 'No se pudo guardar la acción correctiva.')
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  const saveCriterion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!criterionEditor || busy || readonly) return
    setBusy(true)
    try {
      const body = { ...criterionDraft, description: criterionDraft.description.trim(), expectedResult: criterionDraft.expectedResult.trim(), observations: criterionDraft.observations.trim() || null }
      const path = criterionEditor.criterion
        ? `/audits/${auditId}/actions/${criterionEditor.actionId}/acceptance-criteria/${criterionEditor.criterion.id}`
        : `/audits/${auditId}/actions/${criterionEditor.actionId}/acceptance-criteria`
      await api(path, { method: criterionEditor.criterion ? 'PATCH' : 'POST', body: JSON.stringify(body) })
      setCriterionEditor(null)
      await onChanged()
      onNotice(criterionEditor.criterion ? 'Criterio actualizado.' : 'Criterio añadido.')
    } catch (error) {
      onError(correctiveActionRequestMessage(error, 'No se pudo guardar el criterio de aceptación.'))
    } finally {
      setBusy(false)
    }
  }

  const saveProgress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!progressFor || busy || readonly) return
    setBusy(true)
    try {
      const percent = progressDraft.percent.trim() === '' ? null : Number(progressDraft.percent)
      await api(`/audits/${auditId}/actions/${progressFor}/progress`, { method: 'POST', body: JSON.stringify({ note: progressDraft.note.trim() || undefined, activities: progressDraft.activities.trim() || null, results: progressDraft.results.trim() || null, difficulties: progressDraft.difficulties.trim() || null, pendingActivities: progressDraft.pendingActivities.trim() || null, observations: progressDraft.observations.trim() || null, percent }) })
      setProgressFor(null)
      await onChanged()
      onNotice('Avance registrado.')
    } catch (error) {
      onError(correctiveActionRequestMessage(error, 'No se pudo registrar el avance.'))
    } finally {
      setBusy(false)
    }
  }

  const completeAction = async (action: AuditCorrectiveAction) => {
    if (busy || readonly) return
    const confirmed = await askConfirm({ title: 'Completar acción correctiva', message: `«${action.title}» quedará completada y no admitirá más cambios.`, confirmLabel: 'Completar' })
    if (!confirmed) return
    setBusy(true)
    try {
      await api(`/audits/${auditId}/actions/${action.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'COMPLETED', observations: completionObservations.trim() }) })
      setCompletionFor(null)
      setCompletionObservations('')
      await onChanged()
      onNotice('Acción correctiva completada.')
    } catch (error) {
      onError(correctiveActionRequestMessage(error, 'No se pudo completar la acción correctiva.'))
    } finally {
      setBusy(false)
    }
  }

  const saveUrlEvidence = async (event: FormEvent<HTMLFormElement>, action: AuditCorrectiveAction) => {
    event.preventDefault()
    if (busy || readonly) return
    const form = new FormData(event.currentTarget)
    setBusy(true)
    try {
      await api(`/audits/${auditId}/evidences`, { method: 'POST', body: JSON.stringify({ name: String(form.get('name') ?? '').trim(), description: String(form.get('description') ?? '').trim(), url: String(form.get('url') ?? '').trim(), findingId: action.findingId, actionId: action.id }) })
      setEvidenceFor(null)
      await onChanged()
      onNotice('Evidencia URL vinculada a la acción.')
    } catch (error) {
      onError(correctiveActionRequestMessage(error, 'No se pudo registrar la evidencia URL.'))
    } finally {
      setBusy(false)
    }
  }

  const uploadPdf = async (event: FormEvent<HTMLFormElement>, action: AuditCorrectiveAction) => {
    event.preventDefault()
    if (busy || readonly) return
    const input = event.currentTarget.elements.namedItem('file') as HTMLInputElement | null
    const file = input?.files?.[0]
    if (!file) { onError('Selecciona un PDF.'); return }
    setBusy(true)
    try {
      await apiUpload(`/audits/${auditId}/evidence-files`, file, { actionId: action.id })
      setEvidenceFor(null)
      await onChanged()
      onNotice('PDF vinculado a la acción.')
    } catch (error) {
      onError(correctiveActionRequestMessage(error, 'No se pudo vincular el PDF.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="corrective-action-management" aria-labelledby="corrective-action-management-title">
      <div className="finding-dossier-section-heading">
        <div><p className="detail-label">PLAN DE ACCIÓN CORRECTIVA</p><h3 id="corrective-action-management-title">Gestión integral de acciones</h3></div>
        {!readonly && <button type="button" className="button primary small-button" onClick={() => { setActionDraft(emptyActionDraft); setActionEditor('new') }} disabled={busy || actionEditor !== null}>+ Nueva acción</button>}
      </div>
      {finding.status === 'VERIFIED' && <p className="finding-dossier-lock" role="note">Este hallazgo está verificado. Las acciones quedan en solo lectura.</p>}
      {actions.length === 0 ? <div className="finding-dossier-empty"><strong>No hay acciones correctivas registradas.</strong><span>Registra una acción para planificar la eliminación de la causa.</span></div> : (
        <div className="corrective-action-management-list">
          {actions.map((action) => {
            const deadline = actionDeadlineStatus(action)
            const percent = actionCurrentPercent(action)
            const pendingCriteria = pendingImplementationCriteria(action)
            const terminal = action.status === 'COMPLETED' || action.status === 'CANCELLED'
            return <article className={`corrective-action-management-card ${deadline.toLowerCase()}`} key={action.id}>
              <header className="corrective-action-management-header">
                <div><span className="root-cause-action-kicker">{action.workflowVersion === 1 ? 'Flujo integral' : 'Registro histórico'}</span><h4>{action.title}</h4><p>{action.responsible?.name ?? 'Sin responsable'} · {actionPriorityLabels[action.priority]}</p></div>
                <div className="corrective-action-management-badges"><span className={`root-cause-action-status ${action.status.toLowerCase()}`}>{actionStatusLabels[action.status]}</span><span className={`corrective-action-deadline ${deadline.toLowerCase()}`}>{correctiveActionDeadlineLabels[deadline]}</span></div>
              </header>
              <div className="corrective-action-progress-summary"><div><span>Avance de implementación</span><strong>{percent}%</strong></div><span className="quality-progress-track"><i style={{ width: `${percent}%` }} /></span><small>{action.dueDate ? `Fecha límite: ${formatAuditCalendarDate(action.dueDate)}` : 'Sin fecha límite'}</small></div>
              <div className="corrective-action-management-grid"><div><span>Objetivo</span><p>{action.objective || 'No registrado'}</p></div><div><span>Plan de implementación</span><p>{action.implementationPlan || action.description}</p></div><div><span>Recursos</span><p>{action.resources || 'No registrados'}</p></div><div><span>Observaciones</span><p>{action.observations || 'Sin observaciones'}</p></div></div>
              <div className="corrective-action-requirements"><strong>Requisitos para finalizar</strong><span>{pendingCriteria.length === 0 ? 'Criterios de implementación completos' : `${pendingCriteria.length} criterio(s) obligatorio(s) pendiente(s)`}</span>{action.evidenceRequired && <span>{(action.evidences?.length ?? 0) + (action.evidenceFiles?.filter((file) => file.storageState === 'READY').length ?? 0) > 0 ? 'Evidencia disponible' : 'Evidencia requerida pendiente'}</span>}</div>
              {!terminal && !readonly && <div className="corrective-action-management-actions"><button type="button" className="button secondary small-button" onClick={() => { setActionDraft(actionDraftFrom(action)); setActionEditor(action.id) }} disabled={busy}>Editar planificación</button><button type="button" className="button secondary small-button" onClick={() => { setProgressDraft({ ...emptyProgressDraft, percent: String(percent) }); setProgressFor(action.id) }} disabled={busy}>Registrar avance</button><button type="button" className="button secondary small-button" onClick={() => setEvidenceFor(evidenceFor === action.id ? null : action.id)} disabled={busy}>Añadir evidencia</button>{action.status !== 'COMPLETED' && action.status !== 'CANCELLED' && <button type="button" className="button primary small-button" onClick={() => { setCompletionFor(action.id); setCompletionObservations('') }} disabled={busy || !actionCanComplete(action)}>Completar</button>}</div>}
              <div className="corrective-action-criteria"><div className="corrective-action-subheading"><strong>Criterios de aceptación</strong>{!readonly && !terminal && <button type="button" className="text-button" onClick={() => { setCriterionDraft(emptyCriterionDraft); setCriterionEditor({ actionId: action.id }) }} disabled={busy}>+ Añadir criterio</button>}</div>{(action.acceptanceCriteria ?? []).length === 0 ? <p className="muted">Sin criterios registrados.</p> : <ul>{(action.acceptanceCriteria ?? []).map((criterion) => <li key={criterion.id}><div><span className={`criterion-status ${criterion.isMet ? 'met' : 'pending'}`}>{criterion.isMet ? 'Cumplido' : 'Pendiente'}</span><strong>{criterion.description}</strong><small>{criterion.type === 'IMPLEMENTATION' ? 'Implementación' : 'Eficacia'} · Resultado esperado: {criterion.expectedResult}</small>{criterion.observations && <small>Observaciones: {criterion.observations}</small>}</div>{!readonly && !terminal && <button type="button" className="text-button" onClick={() => { setCriterionDraft({ type: criterion.type, description: criterion.description, expectedResult: criterion.expectedResult, required: criterion.required, isMet: criterion.isMet, observations: criterion.observations ?? '' }); setCriterionEditor({ actionId: action.id, criterion }) }} disabled={busy}>Editar</button>}</li>)}</ul>}</div>
              <div className="corrective-action-progress-history"><strong>Historial de seguimiento</strong>{action.progress.length === 0 ? <p className="muted">Sin avances registrados.</p> : <ol>{action.progress.map((entry) => <li key={entry.id}><div><time dateTime={entry.createdAt}>{formatAuditDateTime(entry.createdAt)}</time><strong>{entry.percent === null ? 'Sin cambio de porcentaje' : `${entry.percent}%`}</strong><span>{entry.createdBy?.name ?? 'Sistema'}</span></div><p>{entry.activities || entry.note}</p>{entry.results && <small>Resultado: {entry.results}</small>}{entry.difficulties && <small>Dificultades: {entry.difficulties}</small>}{entry.pendingActivities && <small>Pendientes: {entry.pendingActivities}</small>}{entry.observations && <small>Observaciones: {entry.observations}</small>}</li>)}</ol>}</div>
              <div className="corrective-action-evidence-list"><strong>Evidencias de implementación</strong>{(action.evidences?.length ?? 0) === 0 && (action.evidenceFiles?.length ?? 0) === 0 ? <p className="muted">Sin evidencias vinculadas.</p> : <ul>{action.evidences?.map((evidence) => <li key={evidence.id}><span>URL · {evidence.name}</span><a href={evidence.url} target="_blank" rel="noreferrer">Abrir evidencia</a></li>)}{action.evidenceFiles?.map((file) => <li key={file.id}><span>PDF · {file.storageState}</span><span>Archivo oficial</span></li>)}</ul>}</div>
              {actionEditor === action.id && <form className="corrective-action-form" onSubmit={saveAction}><div className="finding-dossier-form-title"><strong>Editar planificación</strong></div><label>Título<input value={actionDraft.title} onChange={(event) => setActionDraft((current) => ({ ...current, title: event.target.value }))} required minLength={3} /></label><label>Descripción<textarea value={actionDraft.description} onChange={(event) => setActionDraft((current) => ({ ...current, description: event.target.value }))} required rows={3} /></label><label>Objetivo o resultado esperado<textarea value={actionDraft.objective} onChange={(event) => setActionDraft((current) => ({ ...current, objective: event.target.value }))} rows={2} /></label><label>Plan de implementación<textarea value={actionDraft.implementationPlan} onChange={(event) => setActionDraft((current) => ({ ...current, implementationPlan: event.target.value }))} rows={3} /></label><label>Recursos<textarea value={actionDraft.resources} onChange={(event) => setActionDraft((current) => ({ ...current, resources: event.target.value }))} rows={2} /></label><label>Responsable<select value={actionDraft.responsibleId} onChange={(event) => setActionDraft((current) => ({ ...current, responsibleId: event.target.value }))}><option value="">Sin asignar</option>{users.filter((user) => user.isActive).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label>Prioridad<select value={actionDraft.priority} onChange={(event) => setActionDraft((current) => ({ ...current, priority: event.target.value as ActionDraft['priority'] }))}>{Object.entries(actionPriorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Fecha límite<input type="date" value={actionDraft.dueDate} onChange={(event) => setActionDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label><label className="quality-checkbox-field"><input type="checkbox" checked={actionDraft.required} onChange={(event) => setActionDraft((current) => ({ ...current, required: event.target.checked }))} /> Acción obligatoria</label><label className="quality-checkbox-field"><input type="checkbox" checked={actionDraft.evidenceRequired} onChange={(event) => setActionDraft((current) => ({ ...current, evidenceRequired: event.target.checked }))} /> Requiere evidencia para finalizar</label><label>Observaciones<textarea value={actionDraft.observations} onChange={(event) => setActionDraft((current) => ({ ...current, observations: event.target.value }))} rows={2} /></label><footer><button type="submit" className="button primary small-button" disabled={busy}>{busy ? 'Guardando…' : 'Guardar planificación'}</button><button type="button" className="button secondary small-button" onClick={() => setActionEditor(null)} disabled={busy}>Cancelar</button></footer></form>}
              {evidenceFor === action.id && <div className="corrective-action-evidence-editor"><form onSubmit={(event) => void saveUrlEvidence(event, action)}><strong>Registrar evidencia URL</strong><input name="name" placeholder="Nombre de la evidencia" required minLength={3} /><input name="description" placeholder="Qué demuestra" required minLength={3} /><input name="url" type="url" placeholder="https://..." required /><button type="submit" className="button secondary small-button" disabled={busy}>Guardar URL</button></form><form onSubmit={(event) => void uploadPdf(event, action)}><strong>Vincular PDF oficial</strong><input name="file" type="file" accept="application/pdf,.pdf" required /><button type="submit" className="button secondary small-button" disabled={busy}>Subir PDF</button></form></div>}
              {completionFor === action.id && <form className="corrective-action-completion" onSubmit={(event) => { event.preventDefault(); void completeAction(action) }}><strong>Observaciones finales</strong><textarea value={completionObservations} onChange={(event) => setCompletionObservations(event.target.value)} required minLength={1} rows={3} placeholder="Describe el resultado final de la implementación." /><button type="submit" className="button primary small-button" disabled={busy}>Confirmar finalización</button><button type="button" className="button secondary small-button" onClick={() => setCompletionFor(null)} disabled={busy}>Cancelar</button></form>}
              {criterionEditor?.actionId === action.id && <form className="corrective-action-criterion-form" onSubmit={saveCriterion}><strong>{criterionEditor.criterion ? 'Editar criterio' : 'Nuevo criterio'}</strong><label>Tipo<select value={criterionDraft.type} onChange={(event) => setCriterionDraft((current) => ({ ...current, type: event.target.value as CriterionDraft['type'], isMet: event.target.value === 'EFFECTIVENESS' ? false : current.isMet }))}><option value="IMPLEMENTATION">Implementación</option><option value="EFFECTIVENESS">Eficacia planificada</option></select></label><label>Descripción<input value={criterionDraft.description} onChange={(event) => setCriterionDraft((current) => ({ ...current, description: event.target.value }))} required /></label><label>Resultado esperado medible<textarea value={criterionDraft.expectedResult} onChange={(event) => setCriterionDraft((current) => ({ ...current, expectedResult: event.target.value }))} required rows={2} /></label><label className="quality-checkbox-field"><input type="checkbox" checked={criterionDraft.required} onChange={(event) => setCriterionDraft((current) => ({ ...current, required: event.target.checked }))} /> Obligatorio</label>{criterionDraft.type === 'IMPLEMENTATION' && <label className="quality-checkbox-field"><input type="checkbox" checked={criterionDraft.isMet} onChange={(event) => setCriterionDraft((current) => ({ ...current, isMet: event.target.checked }))} /> Cumplido</label>}<label>Observaciones<textarea value={criterionDraft.observations} onChange={(event) => setCriterionDraft((current) => ({ ...current, observations: event.target.value }))} rows={2} /></label><footer><button type="submit" className="button primary small-button" disabled={busy}>Guardar criterio</button><button type="button" className="button secondary small-button" onClick={() => setCriterionEditor(null)} disabled={busy}>Cancelar</button></footer></form>}
              {progressFor === action.id && <form className="corrective-action-progress-form" onSubmit={saveProgress}><strong>Registrar avance</strong><textarea value={progressDraft.note} onChange={(event) => setProgressDraft((current) => ({ ...current, note: event.target.value }))} rows={2} placeholder="Resumen del avance" /><textarea value={progressDraft.activities} onChange={(event) => setProgressDraft((current) => ({ ...current, activities: event.target.value }))} rows={2} placeholder="Actividades realizadas" /><textarea value={progressDraft.results} onChange={(event) => setProgressDraft((current) => ({ ...current, results: event.target.value }))} rows={2} placeholder="Resultados obtenidos" /><textarea value={progressDraft.difficulties} onChange={(event) => setProgressDraft((current) => ({ ...current, difficulties: event.target.value }))} rows={2} placeholder="Dificultades" /><textarea value={progressDraft.pendingActivities} onChange={(event) => setProgressDraft((current) => ({ ...current, pendingActivities: event.target.value }))} rows={2} placeholder="Actividades pendientes" /><textarea value={progressDraft.observations} onChange={(event) => setProgressDraft((current) => ({ ...current, observations: event.target.value }))} rows={2} placeholder="Observaciones" /><label>Porcentaje actual<input type="number" min="0" max="100" value={progressDraft.percent} onChange={(event) => setProgressDraft((current) => ({ ...current, percent: event.target.value }))} /></label><footer><button type="submit" className="button primary small-button" disabled={busy}>Guardar avance</button><button type="button" className="button secondary small-button" onClick={() => setProgressFor(null)} disabled={busy}>Cancelar</button></footer></form>}
            </article>
          })}
        </div>
      )}
      {actionEditor === 'new' && <form className="corrective-action-form" onSubmit={saveAction}><div className="finding-dossier-form-title"><strong>Nueva acción correctiva integral</strong></div><label>Título<input value={actionDraft.title} onChange={(event) => setActionDraft((current) => ({ ...current, title: event.target.value }))} required minLength={3} /></label><label>Descripción<textarea value={actionDraft.description} onChange={(event) => setActionDraft((current) => ({ ...current, description: event.target.value }))} required rows={3} /></label><label>Objetivo o resultado esperado<textarea value={actionDraft.objective} onChange={(event) => setActionDraft((current) => ({ ...current, objective: event.target.value }))} rows={2} /></label><label>Plan de implementación<textarea value={actionDraft.implementationPlan} onChange={(event) => setActionDraft((current) => ({ ...current, implementationPlan: event.target.value }))} rows={3} /></label><label>Recursos<textarea value={actionDraft.resources} onChange={(event) => setActionDraft((current) => ({ ...current, resources: event.target.value }))} rows={2} /></label><label>Responsable<select value={actionDraft.responsibleId} onChange={(event) => setActionDraft((current) => ({ ...current, responsibleId: event.target.value }))}><option value="">Sin asignar</option>{users.filter((user) => user.isActive).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label>Prioridad<select value={actionDraft.priority} onChange={(event) => setActionDraft((current) => ({ ...current, priority: event.target.value as ActionDraft['priority'] }))}>{Object.entries(actionPriorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Fecha límite<input type="date" value={actionDraft.dueDate} onChange={(event) => setActionDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label><label className="quality-checkbox-field"><input type="checkbox" checked={actionDraft.required} onChange={(event) => setActionDraft((current) => ({ ...current, required: event.target.checked }))} /> Acción obligatoria</label><label className="quality-checkbox-field"><input type="checkbox" checked={actionDraft.evidenceRequired} onChange={(event) => setActionDraft((current) => ({ ...current, evidenceRequired: event.target.checked }))} /> Requiere evidencia para finalizar</label><label>Observaciones<textarea value={actionDraft.observations} onChange={(event) => setActionDraft((current) => ({ ...current, observations: event.target.value }))} rows={2} /></label><footer><button type="submit" className="button primary small-button" disabled={busy}>{busy ? 'Creando…' : 'Crear acción'}</button><button type="button" className="button secondary small-button" onClick={() => setActionEditor(null)} disabled={busy}>Cancelar</button></footer></form>}
    </section>
  )
}
