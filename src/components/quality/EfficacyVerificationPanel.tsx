import { useState, type FormEvent, type SetStateAction } from 'react'
import { api, ApiError } from '../../api'
import type { AuditEfficacyEvaluation, AuditEfficacyMethodology, AuditEfficacyOutcome, AuditFinding } from '../../types'
import { correctiveActionRequestMessage } from './corrective-action-errors'
import type { QualityUser } from './quality.model'

const methodologyLabels: Record<AuditEfficacyMethodology, string> = {
  DOCUMENTARY_SAMPLING: 'Muestreo documental',
  INDICATOR_MONITORING: 'Seguimiento de indicadores',
  DIRECT_OBSERVATION: 'Observación directa',
  INTERVIEWS: 'Entrevistas',
  RECORD_REVIEW: 'Revisión de registros',
  FOLLOW_UP_AUDIT: 'Auditoría de seguimiento',
  OTHER: 'Otra metodología',
}

const outcomeLabels: Record<AuditEfficacyOutcome, string> = {
  PENDING: 'Pendiente de dictamen',
  EFFECTIVE: 'Eficaz',
  PARTIALLY_EFFECTIVE: 'Parcialmente eficaz',
  INEFFECTIVE: 'No eficaz',
}

const statusLabels: Record<AuditEfficacyEvaluation['status'], string> = {
  PLANNED: 'Programada',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Finalizada',
  CANCELLED: 'Cancelada',
}

type PlanDraft = {
  actionId: string
  responsibleId: string
  scheduledDate: string
  methodology: AuditEfficacyMethodology
  methodologyOther: string
  observationPeriod: string
  observationStartDate: string
  observationEndDate: string
  scope: string
  observations: string
}

const emptyPlan: PlanDraft = { actionId: '', responsibleId: '', scheduledDate: '', methodology: 'DOCUMENTARY_SAMPLING', methodologyOther: '', observationPeriod: '', observationStartDate: '', observationEndDate: '', scope: '', observations: '' }

const dateInput = (value: string | null) => value?.slice(0, 10) ?? ''
const requestError = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : correctiveActionRequestMessage(error, fallback)
const completionRequestError = (error: unknown) => {
  const message = requestError(error, 'No se pudo finalizar la evaluación de eficacia.')
  const messages: Array<[string, string]> = [
    ['Complete every required efficacy criterion result before finalizing the evaluation', 'Completa todos los resultados de criterios de eficacia obligatorios antes de finalizar la evaluación.'],
    ['An effective evaluation requires every required efficacy criterion to be met', 'Un dictamen eficaz exige que todos los criterios obligatorios estén cumplidos.'],
    ['A recurring issue cannot receive an effective efficacy outcome', 'Una evaluación con recurrencia no puede recibir el dictamen Eficaz.'],
    ['The observation period has not ended yet', 'El periodo de observación aún no ha finalizado.'],
    ['Attach at least one objective URL or READY PDF evidence before finalizing the evaluation', 'Vincula al menos una evidencia objetiva URL o un PDF disponible antes de finalizar la evaluación.'],
    ['A technical conclusion is required before finalizing the efficacy evaluation', 'Diligencia la conclusión técnica antes de finalizar la evaluación.'],
    ['Create a follow-up corrective action before finalizing a partially effective or ineffective evaluation', 'Crea una acción correctiva de tratamiento antes de finalizar una evaluación parcial o no eficaz.'],
  ]
  return messages.find(([source]) => message.includes(source))?.[1] ?? message
}

export function EfficacyVerificationPanel({ auditId, finding, users, canWrite, onChanged, onError, onNotice }: {
  auditId: string
  finding: AuditFinding
  users: QualityUser[]
  canWrite: boolean
  onChanged: () => Promise<void> | void
  onError: (message: string) => void
  onNotice: (message: string) => void
  onRequestTreatment?: (evaluationId: string) => void
}) {
  const evaluations = finding.efficacyEvaluations ?? []
  const completedActions = (finding.actions ?? []).filter((action) => action.status === 'COMPLETED')
  const [plannerOpen, setPlannerOpen] = useState(false)
  const [plan, setPlan] = useState<PlanDraft>({ ...emptyPlan, actionId: completedActions[0]?.id ?? '', responsibleId: users.find((user) => user.isActive)?.id ?? '' })
  type CompletionDraft = { outcome: AuditEfficacyOutcome; conclusion: string; recurrenceDetected: boolean; recurrenceDescription: string }
  const [completionDrafts, setCompletionDraftsState] = useState<Record<string, CompletionDraft>>({})
  const [completionErrors, setCompletionErrors] = useState<Record<string, string>>({})
  const [treatmentFor, setTreatmentForState] = useState<string | null>(null)
  const [treatmentDraft, setTreatmentDraft] = useState({ title: '', description: '', responsibleId: '', dueDate: '' })
  const [busy, setBusy] = useState(false)

  const setTreatmentFor = (evaluationId: string | null) => {
    if (evaluationId && onRequestTreatment) {
      onRequestTreatment(evaluationId)
      return
    }
    setTreatmentForState(evaluationId)
  }

  const setCompletionDrafts = (updater: SetStateAction<Record<string, CompletionDraft>>) => {
    setCompletionErrors((current) => Object.values(current).some(Boolean) ? {} : current)
    setCompletionDraftsState(updater)
  }

  const savePlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !canWrite) return
    setBusy(true)
    try {
      await api(`/audits/${auditId}/findings/${finding.id}/efficacy-evaluations`, { method: 'POST', body: JSON.stringify({ ...plan, scheduledDate: plan.scheduledDate || null, methodologyOther: plan.methodologyOther.trim() || null, observationPeriod: plan.observationPeriod.trim() || null, observationStartDate: plan.observationStartDate || null, observationEndDate: plan.observationEndDate || null, observations: plan.observations.trim() || null }) })
      setPlannerOpen(false)
      await onChanged()
      onNotice('Evaluación de eficacia planificada.')
    } catch (error) {
      onError(requestError(error, 'No se pudo planificar la evaluación de eficacia.'))
    } finally {
      setBusy(false)
    }
  }

  const changeStatus = async (evaluation: AuditEfficacyEvaluation, status: 'IN_PROGRESS' | 'CANCELLED' | 'COMPLETED') => {
    if (busy || !canWrite) return
    setCompletionErrors((current) => ({ ...current, [evaluation.id]: '' }))
    const draft = completionDrafts[evaluation.id] ?? { outcome: 'EFFECTIVE' as AuditEfficacyOutcome, conclusion: '', recurrenceDetected: false, recurrenceDescription: '' }
    const justification = status === 'CANCELLED' ? window.prompt('Justificación de la cancelación')?.trim() ?? '' : ''
    if (status === 'CANCELLED' && !justification) {
      onError('La cancelación requiere una justificación.')
      return
    }
    setBusy(true)
    try {
      await api(`/audits/${auditId}/efficacy-evaluations/${evaluation.id}/status`, { method: 'POST', body: JSON.stringify(status === 'COMPLETED' ? { status, outcome: draft.outcome, conclusion: draft.conclusion.trim(), recurrenceDetected: draft.recurrenceDetected, recurrenceDescription: draft.recurrenceDescription.trim() || null } : status === 'CANCELLED' ? { status, justification } : { status }) })
      await onChanged()
      onNotice(status === 'COMPLETED' ? 'Evaluación de eficacia finalizada.' : status === 'IN_PROGRESS' ? 'Evaluación de eficacia iniciada.' : 'Evaluación de eficacia cancelada.')
    } catch (error) {
      const message = status === 'COMPLETED' ? completionRequestError(error) : requestError(error, 'No se pudo actualizar la evaluación de eficacia.')
      if (status === 'COMPLETED') setCompletionErrors((current) => ({ ...current, [evaluation.id]: message }))
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  const saveCriterion = async (evaluation: AuditEfficacyEvaluation, criterion: AuditEfficacyEvaluation['criteria'][number], event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !canWrite) return
    const form = new FormData(event.currentTarget)
    setBusy(true)
    try {
      await api(`/audits/${auditId}/efficacy-evaluations/${evaluation.id}/criteria/${criterion.id}`, { method: 'PATCH', body: JSON.stringify({ resultObtained: String(form.get('resultObtained') ?? '').trim() || null, measuredValue: String(form.get('measuredValue') ?? '').trim() || null, measurementUnit: String(form.get('measurementUnit') ?? '').trim() || null, sampleSize: String(form.get('sampleSize') ?? '').trim() ? Number(form.get('sampleSize')) : null, isMet: form.get('isMet') === 'true', observations: String(form.get('observations') ?? '').trim() || null }) })
      await onChanged()
      onNotice('Resultado de eficacia actualizado.')
    } catch (error) {
      onError(requestError(error, 'No se pudo guardar el resultado del criterio.'))
    } finally {
      setBusy(false)
    }
  }

  const saveProgress = async (evaluation: AuditEfficacyEvaluation, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !canWrite) return
    const form = new FormData(event.currentTarget)
    setBusy(true)
    try {
      await api(`/audits/${auditId}/efficacy-evaluations/${evaluation.id}/progress`, { method: 'POST', body: JSON.stringify({ note: String(form.get('note') ?? '').trim(), results: String(form.get('results') ?? '').trim() || null, difficulties: String(form.get('difficulties') ?? '').trim() || null, pendingActivities: String(form.get('pendingActivities') ?? '').trim() || null, percent: String(form.get('percent') ?? '').trim() ? Number(form.get('percent')) : null }) })
      await onChanged()
      onNotice('Avance de eficacia registrado.')
    } catch (error) {
      onError(requestError(error, 'No se pudo registrar el avance de eficacia.'))
    } finally {
      setBusy(false)
    }
  }

  const linkUrlEvidence = async (evaluation: AuditEfficacyEvaluation, evidenceId: string) => {
    if (busy || !canWrite) return
    setBusy(true)
    try {
      await api(`/audits/${auditId}/efficacy-evaluations/${evaluation.id}/evidences`, { method: 'POST', body: JSON.stringify({ evidenceId }) })
      await onChanged()
      onNotice('Evidencia URL vinculada a la evaluación.')
    } catch (error) {
      onError(requestError(error, 'No se pudo vincular la evidencia URL.'))
    } finally {
      setBusy(false)
    }
  }

  const linkPdfEvidence = async (evaluation: AuditEfficacyEvaluation, evidenceFileId: string) => {
    if (busy || !canWrite) return
    setBusy(true)
    try {
      await api(`/audits/${auditId}/efficacy-evaluations/${evaluation.id}/evidence-files`, { method: 'POST', body: JSON.stringify({ evidenceFileId }) })
      await onChanged()
      onNotice('Evidencia PDF vinculada a la evaluación.')
    } catch (error) {
      onError(requestError(error, 'No se pudo vincular la evidencia PDF.'))
    } finally {
      setBusy(false)
    }
  }

  const createTreatment = async (evaluation: AuditEfficacyEvaluation, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !canWrite) return
    setBusy(true)
    try {
      await api(`/audits/${auditId}/findings/${finding.id}/actions`, { method: 'POST', body: JSON.stringify({ title: treatmentDraft.title.trim(), description: treatmentDraft.description.trim(), responsibleId: treatmentDraft.responsibleId || null, dueDate: treatmentDraft.dueDate || null, required: true, efficacyEvaluationId: evaluation.id }) })
      setTreatmentFor(null)
      setTreatmentDraft({ title: '', description: '', responsibleId: '', dueDate: '' })
      await onChanged()
      onNotice('Acción de tratamiento adicional creada.')
    } catch (error) {
      onError(requestError(error, 'No se pudo crear la acción de tratamiento.'))
    } finally {
      setBusy(false)
    }
  }

  const actionById = new Map((finding.actions ?? []).map((action) => [action.id, action]))
  const summary = { pending: evaluations.filter((evaluation) => evaluation.status === 'PLANNED').length, active: evaluations.filter((evaluation) => evaluation.status === 'IN_PROGRESS').length, effective: evaluations.filter((evaluation) => evaluation.outcome === 'EFFECTIVE').length, unsatisfactory: evaluations.filter((evaluation) => evaluation.outcome === 'PARTIALLY_EFFECTIVE' || evaluation.outcome === 'INEFFECTIVE').length }

  return <section className="efficacy-verification-panel" aria-labelledby="efficacy-verification-title">
    <div className="finding-dossier-section-heading">
      <div><p className="detail-label">SEGUIMIENTO POSTERIOR</p><h3 id="efficacy-verification-title">Verificación integral de eficacia</h3><p className="muted">La eficacia se evalúa después de completar la acción correctiva y no modifica su implementación histórica.</p></div>
      {canWrite && completedActions.length > 0 && <button type="button" className="button primary small-button" onClick={() => setPlannerOpen((current) => !current)} disabled={busy}>+ Planificar evaluación</button>}
    </div>
    <div className="efficacy-summary" role="status"><span><strong>{summary.pending}</strong> programadas</span><span><strong>{summary.active}</strong> en curso</span><span><strong>{summary.effective}</strong> eficaces</span><span><strong>{summary.unsatisfactory}</strong> con tratamiento</span></div>
    {completedActions.length === 0 && <p className="muted">No hay acciones correctivas completadas disponibles para evaluar.</p>}
    {completedActions.length > 0 && <div className="efficacy-available-actions"><strong>Acciones disponibles para evaluación</strong><ul>{completedActions.map((action) => <li key={action.id}>{action.title}<span>Completada</span></li>)}</ul></div>}
    {plannerOpen && <form className="efficacy-plan-form" onSubmit={savePlan}>
      <strong>Planificar evaluación de eficacia</strong>
      <label>Acción completada<select value={plan.actionId} onChange={(event) => setPlan((current) => ({ ...current, actionId: event.target.value }))} required><option value="">Selecciona una acción</option>{completedActions.map((action) => <option key={action.id} value={action.id}>{action.title}</option>)}</select></label>
      <label>Responsable<select value={plan.responsibleId} onChange={(event) => setPlan((current) => ({ ...current, responsibleId: event.target.value }))} required><option value="">Selecciona un responsable</option>{users.filter((user) => user.isActive).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
      <label>Fecha programada<input type="date" value={plan.scheduledDate} onChange={(event) => setPlan((current) => ({ ...current, scheduledDate: event.target.value }))} /></label>
      <label>Metodología<select value={plan.methodology} onChange={(event) => setPlan((current) => ({ ...current, methodology: event.target.value as AuditEfficacyMethodology }))}>{Object.entries(methodologyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {plan.methodology === 'OTHER' && <label>Justificación<textarea value={plan.methodologyOther} onChange={(event) => setPlan((current) => ({ ...current, methodologyOther: event.target.value }))} required rows={2} /></label>}
      <label>Periodo de observación<input value={plan.observationPeriod} onChange={(event) => setPlan((current) => ({ ...current, observationPeriod: event.target.value }))} placeholder="Ej. 30 días posteriores a la implementación" /></label>
      <label>Inicio del periodo<input type="date" value={plan.observationStartDate} onChange={(event) => setPlan((current) => ({ ...current, observationStartDate: event.target.value }))} /></label>
      <label>Fin del periodo<input type="date" value={plan.observationEndDate} onChange={(event) => setPlan((current) => ({ ...current, observationEndDate: event.target.value }))} /></label>
      <label>Alcance<textarea value={plan.scope} onChange={(event) => setPlan((current) => ({ ...current, scope: event.target.value }))} required rows={2} /></label>
      <label>Observaciones<textarea value={plan.observations} onChange={(event) => setPlan((current) => ({ ...current, observations: event.target.value }))} rows={2} /></label>
      <footer><button type="submit" className="button primary small-button" disabled={busy}>Guardar planificación</button><button type="button" className="button secondary small-button" onClick={() => setPlannerOpen(false)} disabled={busy}>Cancelar</button></footer>
    </form>}
    {evaluations.length === 0 && completedActions.length > 0 && <p className="muted">Todavía no hay evaluaciones de eficacia históricas para este hallazgo.</p>}
    <div className="efficacy-evaluation-list">{evaluations.map((evaluation) => {
      const action = actionById.get(evaluation.actionId)
      const completion = completionDrafts[evaluation.id] ?? { outcome: 'EFFECTIVE' as AuditEfficacyOutcome, conclusion: '', recurrenceDetected: false, recurrenceDescription: '' }
      const linkedUrlIds = new Set(evaluation.evidences.map((evidence) => evidence.id))
      const linkedPdfIds = new Set(evaluation.evidenceFiles.map((file) => file.id))
      const availableUrls = (action?.evidences ?? []).filter((evidence) => !linkedUrlIds.has(evidence.id))
      const availablePdfs = (action?.evidenceFiles ?? []).filter((file) => file.storageState === 'READY' && !linkedPdfIds.has(file.id))
      const terminal = evaluation.status === 'COMPLETED' || evaluation.status === 'CANCELLED'
      return <article className={`efficacy-evaluation-card ${evaluation.status.toLowerCase()}`} key={evaluation.id}>
        <header><div><span className="detail-label">{action?.title ?? 'Acción correctiva'}</span><h4>{statusLabels[evaluation.status]}</h4></div><span className={`badge quality-status ${evaluation.outcome.toLowerCase()}`}>{outcomeLabels[evaluation.outcome]}</span></header>
        <div className="efficacy-evaluation-meta"><span>Responsable: <strong>{evaluation.responsible.name}</strong></span><span>Metodología: <strong>{methodologyLabels[evaluation.methodology]}</strong></span>{evaluation.scheduledDate && <span>Programada: <strong>{dateInput(evaluation.scheduledDate)}</strong></span>}{evaluation.observationEndDate && <span>Fin de observación: <strong>{dateInput(evaluation.observationEndDate)}</strong></span>}</div>
        <p><strong>Alcance:</strong> {evaluation.scope}</p>
        {evaluation.observations && <p><strong>Observaciones:</strong> {evaluation.observations}</p>}
          {evaluation.status === 'PLANNED' && canWrite && <div className="efficacy-status-actions"><button type="button" className="button primary small-button" onClick={() => void changeStatus(evaluation, 'IN_PROGRESS')} disabled={busy}>Iniciar evaluación</button><button type="button" className="button secondary small-button" onClick={() => void changeStatus(evaluation, 'CANCELLED')} disabled={busy}>Cancelar evaluación</button></div>}
          {evaluation.status === 'IN_PROGRESS' && canWrite && <button type="button" className="button secondary small-button" onClick={() => void changeStatus(evaluation, 'CANCELLED')} disabled={busy}>Cancelar evaluación</button>}
        {evaluation.criteria.length > 0 && <div className="efficacy-criteria"><strong>Criterios de eficacia</strong>{evaluation.criteria.map((criterion) => <form className="efficacy-criterion-form" key={criterion.id} onSubmit={(event) => void saveCriterion(evaluation, criterion, event)}><div><strong>{criterion.description}</strong><small>Resultado esperado: {criterion.expectedResult}{criterion.required ? ' · Obligatorio' : ''}</small></div>{!terminal && evaluation.status === 'IN_PROGRESS' ? <><label>Resultado obtenido<textarea name="resultObtained" defaultValue={criterion.resultObtained ?? ''} rows={2} /></label><div className="efficacy-inline-fields"><label>Valor medido<input name="measuredValue" defaultValue={criterion.measuredValue ?? ''} /></label><label>Unidad<input name="measurementUnit" defaultValue={criterion.measurementUnit ?? ''} /></label><label>Muestra<input name="sampleSize" type="number" min="1" defaultValue={criterion.sampleSize ?? ''} /></label><label>Cumple<select name="isMet" defaultValue={criterion.isMet === null ? '' : String(criterion.isMet)} required><option value="">Selecciona</option><option value="true">Sí</option><option value="false">No</option></select></label></div><label>Observaciones<textarea name="observations" defaultValue={criterion.observations ?? ''} rows={2} /></label><button type="submit" className="button secondary small-button" disabled={busy}>Guardar resultado</button></> : <p className="efficacy-result-readonly"><strong>{criterion.isMet === null ? 'Pendiente' : criterion.isMet ? 'Cumple' : 'No cumple'}</strong>{criterion.resultObtained && ` · ${criterion.resultObtained}`}{criterion.measuredValue && ` · ${criterion.measuredValue}${criterion.measurementUnit ? ` ${criterion.measurementUnit}` : ''}`}</p>}</form>)}</div>}
        {evaluation.status === 'IN_PROGRESS' && canWrite && <form className="efficacy-progress-form" onSubmit={(event) => void saveProgress(evaluation, event)}><strong>Registrar avance</strong><textarea name="note" placeholder="Avance realizado" required rows={2} /><textarea name="results" placeholder="Resultados parciales" rows={2} /><textarea name="difficulties" placeholder="Dificultades" rows={2} /><textarea name="pendingActivities" placeholder="Actividades pendientes" rows={2} /><label>Porcentaje<input name="percent" type="number" min="0" max="100" /></label><button type="submit" className="button secondary small-button" disabled={busy}>Guardar avance</button></form>}
        <div className="efficacy-evidence-section"><strong>Evidencias de eficacia</strong>{evaluation.evidences.length === 0 && evaluation.evidenceFiles.length === 0 && <small>Sin evidencias vinculadas.</small>}<ul>{evaluation.evidences.map((evidence) => <li key={evidence.id}>URL · <a href={evidence.url} target="_blank" rel="noreferrer">{evidence.name}</a></li>)}{evaluation.evidenceFiles.map((file) => <li key={file.id}>PDF · {file.filename} · {file.storageState}</li>)}</ul>{!terminal && canWrite && <div className="efficacy-evidence-actions">{availableUrls.map((evidence) => <button type="button" className="text-button" key={evidence.id} onClick={() => void linkUrlEvidence(evaluation, evidence.id)} disabled={busy}>Vincular URL: {evidence.name}</button>)}{availablePdfs.map((file) => <button type="button" className="text-button" key={file.id} onClick={() => void linkPdfEvidence(evaluation, file.id)} disabled={busy}>Vincular PDF: {file.id}</button>)}</div>}</div>
        {evaluation.status === 'IN_PROGRESS' && canWrite && <div className="efficacy-completion-form"><strong>Dictamen de eficacia</strong><label>Resultado<select value={completion.outcome} onChange={(event) => setCompletionDrafts((current) => ({ ...current, [evaluation.id]: { ...completion, outcome: event.target.value as AuditEfficacyOutcome } }))}><option value="EFFECTIVE">Eficaz</option><option value="PARTIALLY_EFFECTIVE">Parcialmente eficaz</option><option value="INEFFECTIVE">No eficaz</option></select></label><label>Conclusión técnica<textarea value={completion.conclusion} onChange={(event) => setCompletionDrafts((current) => ({ ...current, [evaluation.id]: { ...completion, conclusion: event.target.value } }))} required rows={3} /></label><label className="quality-checkbox-field"><input type="checkbox" checked={completion.recurrenceDetected} onChange={(event) => setCompletionDrafts((current) => ({ ...current, [evaluation.id]: { ...completion, recurrenceDetected: event.target.checked } }))} /> Se detectó recurrencia</label>{completion.recurrenceDetected && <label>Descripción de recurrencia<textarea value={completion.recurrenceDescription} onChange={(event) => setCompletionDrafts((current) => ({ ...current, [evaluation.id]: { ...completion, recurrenceDescription: event.target.value } }))} required rows={2} /></label>} {(completion.outcome === 'PARTIALLY_EFFECTIVE' || completion.outcome === 'INEFFECTIVE') && <><p className="quality-attention-note">Este dictamen requiere una acción de tratamiento adicional antes de finalizar.</p>{treatmentFor === evaluation.id ? <form onSubmit={(event) => void createTreatment(evaluation, event)}><label>Título<input name="title" value={treatmentDraft.title} onChange={(event) => setTreatmentDraft((current) => ({ ...current, title: event.target.value }))} required minLength={3} /></label><label>Descripción<textarea name="description" value={treatmentDraft.description} onChange={(event) => setTreatmentDraft((current) => ({ ...current, description: event.target.value }))} required rows={2} /></label><label>Responsable<select value={treatmentDraft.responsibleId} onChange={(event) => setTreatmentDraft((current) => ({ ...current, responsibleId: event.target.value }))} required><option value="">Selecciona</option>{users.filter((user) => user.isActive).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><button type="submit" className="button secondary small-button" disabled={busy}>Crear tratamiento</button></form> : <button type="button" className="text-button" onClick={() => setTreatmentFor(evaluation.id)}>+ Crear acción de tratamiento</button>}</>}<footer><button type="button" className="button primary small-button" onClick={() => void changeStatus(evaluation, 'COMPLETED')} disabled={busy}>Finalizar evaluación</button><button type="button" className="button secondary small-button" onClick={() => void changeStatus(evaluation, 'CANCELLED')} disabled={busy}>Cancelar evaluación</button></footer></div>}
         {completionErrors[evaluation.id] && <p className="form-error efficacy-completion-error" role="alert">{completionErrors[evaluation.id]}</p>}
         {terminal && <div className="efficacy-final-readonly"><strong>Evaluación finalizada en solo lectura</strong>{evaluation.conclusion && <p>{evaluation.conclusion}</p>}{evaluation.recurrenceDetected && <p>Recurrencia: {evaluation.recurrenceDescription}</p>}</div>}
      </article>
    })}</div>
  </section>
}
